/* Интерфейс, сеть, звук и анимации. Правила лежат в engine.js, наполнение в data.js, рисунки в art.js. */
const { BOARD, GROUPS, TOKENS } = DATA;
const money = DATA.money;
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PREFIX = 'koenig-magnat-';
const store = (st) => ({ get(k) { try { return st.getItem(k); } catch (e) { return null; } }, set(k, v) { try { st.setItem(k, v); } catch (e) {} }, del(k) { try { st.removeItem(k); } catch (e) {} } });
// Access to the storage property itself can throw in restricted browsers.
const safeStorage = (name) => { try { return store(window[name]); } catch (e) { const memory = new Map(); return { get: (k) => memory.get(k) || null, set: (k, v) => memory.set(k, String(v)), del: (k) => memory.delete(k) }; } };
const LS = safeStorage('localStorage'), SS = safeStorage('sessionStorage');

let S = null, V = null, mode = null, myPid = null, code = null, peer = null, conn = null, online = false, statusText = '', offset = 0;
const conns = {}, queue = [];
let pumping = false, busy = false, boardBuilt = false, pickedToken = null, unread = 0, LC = 11, LR = 11, tokPos = {}, lastKey = '', tradeN = null, lastTick = -1;

const tokOf = (id) => TOKENS.find((t) => t.id === id);
const tokHTML = (t) => `<span class="tk" style="background:${t.color}"><svg viewBox="0 0 24 24" fill="#fff">${t.text ? `<text x="12" y="14.4" text-anchor="middle" font-size="6.4" font-weight="900" fill="#231a00" textLength="20" lengthAdjust="spacingAndGlyphs">${t.text}</text>` : t.svg}</svg></span>`;
const PL = (id) => (V ? V.players.find((p) => p.id === id) : null);
const isHost = () => mode !== 'client';
const me = () => (mode === 'local' ? (V && V.phase === 'play' ? Engine.actor(V) : null) : myPid);
const randId = () => 'p' + Math.random().toString(36).slice(2, 10);
const randCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const cellColor = (c) => (c.t === 'prop' ? GROUPS[c.g].color : c.t === 'transport' ? '#5b6b8c' : c.t === 'utility' ? '#0f9b94' : c.t === 'card' ? (c.deck === 'D' ? '#7357e8' : '#c2255c') : '#2a3b5f');
const cellKind = (c) => (c.t === 'prop' ? `Группа «${GROUPS[c.g].name}»` : c.t === 'transport' ? 'Транспорт' : c.t === 'utility' ? 'Предприятие' : '');

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.remove('hide'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), 2800); Snd.play('err'); }
let modalFn = null;
function closeModal() { $('#modal').classList.remove('trade-mode'); $$('.cell').forEach(c => c.classList.remove('selected-trade'));  $('#modal').classList.add('hide'); $('#modal').innerHTML = ''; modalFn = null; }
function openModal(fn) { modalFn = fn; $('#modal').classList.remove('hide'); fn(); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ---------- Звук: всё синтезируется на лету, файлов нет ---------- */
const Snd = (() => {
  let ctx = null, on = LS.get('km_snd') !== '0';
  const ac = () => { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  function tone(f, at, dur, type, vol, f2) {
    const c = ac(); if (!c) return; const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(at, dur, freq, q, vol) {
    const c = ac(); if (!c) return; const t = c.currentTime + at, n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    g.gain.setValueAtTime(vol || 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(c.destination); s.start(t);
  }
  const lib = {
    dice() { for (let i = 0; i < 8; i++) noise(i * 0.065 + Math.random() * 0.02, 0.05, 1500 + Math.random() * 2200, 2.5, 0.3); },
    double() { tone(880, 0, 0.1, 'triangle', 0.16); tone(1175, 0.09, 0.16, 'triangle', 0.16); },
    step(k) { tone(430 + ((k || 0) % 6) * 28, 0, 0.07, 'triangle', 0.16, 300); },
    whoosh() { noise(0, 0.35, 900, 0.7, 0.22); tone(300, 0, 0.3, 'sine', 0.08, 900); },
    card() { noise(0, 0.16, 3200, 0.8, 0.2); tone(660, 0.1, 0.14, 'sine', 0.1); },
    coin() { tone(1320, 0, 0.09, 'square', 0.07); tone(1760, 0.07, 0.22, 'square', 0.07); },
    pay() { tone(700, 0, 0.09, 'triangle', 0.15); tone(520, 0.09, 0.1, 'triangle', 0.15); tone(390, 0.18, 0.2, 'triangle', 0.15); },
    buy() { tone(1600, 0, .06, 'square', .08); tone(2200, .08, .12, 'sine', .14); tone(2800, .18, .35, 'sine', .1); noise(0,.07,4200,1,.12); return; noise(0, 0.05, 4000, 1, 0.2); tone(1047, 0.03, 0.1, 'triangle', 0.18); tone(1319, 0.11, 0.1, 'triangle', 0.18); tone(1568, 0.19, 0.3, 'triangle', 0.18); },
    offer() { tone(587, 0, 0.12, 'sine', 0.13); tone(784, 0.1, 0.2, 'sine', 0.13); },
    gavel() { tone(95, 0, .09, 'square', .2, 45); noise(.01, .07, 650, 1, .3); tone(95, .22, .1, 'square', .2, 45);  },
    bid() { tone(880, 0, 0.06, 'square', 0.08); },
    pass() { tone(300, 0, 0.12, 'sine', 0.12, 220); },
    sold() { tone(150, 0, 0.2, 'square', 0.22, 60); tone(1047, 0.18, 0.12, 'triangle', 0.16); tone(1568, 0.28, 0.3, 'triangle', 0.16); },
    build() { for (let i = 0; i < 3; i++) { noise(i * 0.12, 0.04, 900, 3, 0.35); tone(210, i * 0.12, 0.05, 'square', 0.1); } },
    honk() { tone(310, 0, 0.18, 'square', 0.09); tone(370, 0, 0.18, 'square', 0.09); tone(310, 0.24, 0.3, 'square', 0.09); tone(370, 0.24, 0.3, 'square', 0.09); },
    boing() { tone(220, 0, 0.3, 'sine', 0.22, 660); tone(660, 0.28, 0.2, 'sine', 0.12, 330); },
    fire() { noise(0, 0.7, 500, 0.5, 0.3); },
    lap() { tone(784, 0, 0.1, 'triangle', 0.15); tone(988, 0.09, 0.1, 'triangle', 0.15); tone(1319, 0.18, 0.25, 'triangle', 0.15); },
    turn() { tone(520, 0, 0.08, 'sine', 0.07); },
    myturn() { tone(659, 0, 0.14, 'sine', 0.2); tone(880, 0.13, 0.14, 'sine', 0.2); tone(1319, 0.26, 0.35, 'sine', 0.2); },
    pop() { tone(500, 0, 0.09, 'sine', 0.16, 900); },
    tick() { tone(1000, 0, 0.04, 'square', 0.06); },
    low() { tone(160, 0, 0.35, 'sawtooth', 0.1, 90); },
    sad() { tone(440, 0, 0.2, 'triangle', 0.15); tone(370, 0.2, 0.2, 'triangle', 0.15); tone(294, 0.4, 0.5, 'triangle', 0.15); },
    start() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.22, 'triangle', 0.16)); },
    win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.13, 0.3, 'triangle', 0.18)); },
    err() { tone(200, 0, 0.14, 'square', 0.06, 150); },
  };
  return {
    play(n, a) { if (!on) return; try { lib[n] && lib[n](a); } catch (e) {} },
    toggle() { on = !on; LS.set('km_snd', on ? '1' : '0'); if (on) this.play('pop'); return on; },
    get on() { return on; }, unlock: ac,
  };
})();
document.addEventListener('pointerdown', () => Snd.unlock(), { passive: true });

/* ---------- Действия и сеть ---------- */
function act(type, extra) {
  const a = Object.assign({ type }, extra || {});
  if (!a.pid) a.pid = me();
  if (mode === 'client') { if (conn && conn.open) conn.send({ t: 'act', a }); else toast('Нет связи с комнатой, переподключаюсь'); return; }
  hostApply(a, null);
}
function hostApply(a, cn) {
  const err = Engine.apply(S, a);
  if (err) { if (cn) cn.send({ t: 'err', m: err }); else toast(err); return false; }
  commit(); return true;
}
function animTime(evs) { let t = 300; (evs || []).forEach((e) => { t += e.t === 'roll' ? 800 : e.t === 'move' ? (e.mode === 'jump' ? 600 : 1500) : e.t === 'card' ? 2400 : e.t === 'chat' || e.t === 'emo' ? 0 : 320; }); return Math.min(t, 8000); }
// Таймер ведёт создатель комнаты: когда меняется «чей выбор», выставляется новый дедлайн
function armTimers() {
  const key = Engine.turnKey(S), T = S.opt.timer;
  if (S.phase !== 'play' || !T) { S.deadline = 0; S.dur = 0; }
  else if (key !== lastKey) { const dur = (S.afk === Engine.actor(S) ? 6 : S.auction ? Math.min(T, 25) : T) * 1000; S.dur = dur; S.deadline = Date.now() + dur + animTime(S.ev); }
  lastKey = key;
  if (S.trade) { if (S.trade.n !== tradeN) { tradeN = S.trade.n; S.tradeDeadline = Date.now() + 45000; } } else { tradeN = null; S.tradeDeadline = 0; }
}
function commit() {
  if(S.phase==='play' && S.step==='end' && !S.debt && !S.auction) Engine.apply(S,{type:'endTurn',pid:S.players[S.turn].id});
  armTimers();
  const json = JSON.stringify(S), snap = JSON.parse(json);
  if (mode === 'local') LS.set('km_local_v2', json);
  if (mode === 'host') { LS.set('km_state_' + code, json); Object.values(conns).forEach((c) => { if (c.open) c.send({ t: 'state', s: snap, now: Date.now() }); }); }
  enqueue(snap);
}
setInterval(() => {
  if (!S || mode === 'client' || S.phase !== 'play' || !S.opt) return;
  const now = Date.now();
  if (S.trade && S.tradeDeadline && now > S.tradeDeadline) return void hostApply({ type: 'rejectTrade', pid: S.trade.to }, null);
  if (S.deadline && now > S.deadline) hostApply({ type: 'timeout', pid: S.hostId }, null);
}, 400);

function pidFor(c, host) {
  if (host) { let p = LS.get('km_hostpid_' + c); if (!p) { p = randId(); LS.set('km_hostpid_' + c, p); } return p; }
  let p = SS.get('km_pid_' + c) || LS.get('km_pid_' + c);
  if (!p) { p = randId(); LS.set('km_pid_' + c, p); }
  SS.set('km_pid_' + c, p); return p;
}
function startHost(c, saved) {
  mode = 'host'; code = c; myPid = pidFor(c, true); LS.set('km_last_host', c);
  S = saved || Engine.newGame(myPid);
  S.ev = []; S.players.forEach((p) => (p.on = p.id === myPid));
  lastKey = ''; location.hash = c; statusText = 'Открываю комнату… Если сервер спал, это займёт до минуты.';
  let tries = 0;
  const open = () => {
    peer = new Peer(PREFIX + c);
    peer.on('open', () => { online = true; statusText = ''; render(); });
    peer.on('connection', (cn) => {
      cn.on('data', (m) => hostMsg(cn, m));
      cn.on('close', () => { if (cn.pid && conns[cn.pid] === cn) { delete conns[cn.pid]; const p = S.players.find((x) => x.id === cn.pid); if (p) p.on = false; S.ev = []; commit(); } });
    });
    peer.on('disconnected', () => { online = false; render(); setTimeout(() => { if (peer && !peer.destroyed) peer.reconnect(); }, 1500); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries++ < 15) { statusText = 'Жду, пока освободится код комнаты…'; render(); peer.destroy(); setTimeout(open, 2000); }
      else if (e.type !== 'peer-unavailable') { online = false; statusText = 'Проблема со связью: ' + e.type; render(); }
    });
  };
  open(); commit();
}
function hostMsg(cn, m) {
  if (m.t === 'hello') {
    let pid = m.pid;
    if (pid === myPid || (conns[pid] && conns[pid] !== cn && conns[pid].open)) return cn.send({ t: 'newid' });
    if (S.phase !== 'lobby' && !S.players.find((x) => x.id === pid) && m.name) {
      const p = S.players.find((x) => !x.on && x.id !== myPid && x.name.toLowerCase() === String(m.name).toLowerCase());
      if (p) { pid = p.id; cn.send({ t: 'you', pid }); }
    }
    cn.pid = pid; conns[pid] = cn;
    const p = S.players.find((x) => x.id === pid); if (p) p.on = true;
    S.ev = []; commit();
  } else if (m.t === 'act' && cn.pid && m.a) {
    const a = m.a; a.pid = cn.pid;
    if (['start', 'finishGame', 'hostSkip', 'timeout', 'setOpt'].includes(a.type)) return;
    hostApply(a, cn);
  }
}
function startClient(c) {
  mode = 'client'; code = c; myPid = pidFor(c); location.hash = c;
  statusText = 'Подключаюсь к комнате ' + c + '…'; V = null; online = false; render();
  if (peer) peer.destroy();
  const client = peer = new Peer();
  let timer, retry, attempts = 0, stopped = false;
  const current = () => peer === client && !stopped;
  const fail = (reason) => {
    if (!current()) return;
    clearTimeout(timer); clearTimeout(retry);
    online = false;
    const old = conn; conn = null;
    if (old) old.close();
    statusText = reason;
    if (attempts >= 3 || client.destroyed) {
      stopped = true; client.destroy();
      statusText += ' Попытки остановлены. Проверьте код и открытую вкладку создателя. Попробуйте другую сеть и обновите страницу. Если повторяется — отправьте создателю этот текст ошибки.';
    } else {
      statusText += ' Повторная попытка через 3 секунды…';
      retry = setTimeout(connect, 3000);
    }
    render();
  };
  const connect = () => {
    if (!current() || (conn && conn.open)) return;
    clearTimeout(timer); clearTimeout(retry); attempts++;
    statusText = 'Подключаюсь к комнате ' + c + ' (попытка ' + attempts + '/3)…'; render();
    timer = setTimeout(() => fail('Комната не прислала данные за 20 секунд. Возможно, соединение блокируется сетью.'), 20000);
    if (client.disconnected) { client.reconnect(); return; }
    if (!client.open) return;
    const cn = conn = client.connect(PREFIX + c, { reliable: true });
    cn.on('open', () => {
      if (!current() || conn !== cn) return;
      cn.send({ t: 'hello', pid: myPid, name: LS.get('km_name') || '' });
    });
    cn.on('data', (m) => {
      if (!current() || conn !== cn || !m) return;
      if (m.t === 'state') {
        clearTimeout(timer); clearTimeout(retry); attempts = 0; online = true; statusText = '';
        offset = (m.now || Date.now()) - Date.now(); enqueue(m.s);
      }
      else if (m.t === 'err') toast(m.m);
      else if (m.t === 'you') { myPid = m.pid; SS.set('km_pid_' + c, myPid); LS.set('km_pid_' + c, myPid); }
      else if (m.t === 'newid') { myPid = randId(); SS.set('km_pid_' + c, myPid); cn.send({ t: 'hello', pid: myPid, name: '' }); }
    });
    cn.on('close', () => { if (current() && conn === cn) fail('Связь с создателем комнаты потеряна.'); });
    cn.on('error', (e) => { if (current() && conn === cn) fail('Ошибка соединения: ' + (e.type || e.message)); });
  };
  timer = setTimeout(() => fail('Сервер игры не ответил за 70 секунд. Если он спал, он просыпается до минуты: обнови страницу.'), 70000);
  client.on('open', connect);
  client.on('disconnected', () => {
    // An established data channel can survive loss of signaling.
    if (!current() || (conn && conn.open && online)) return;
    fail('Потеряна связь с сервером игры.');
  });
  client.on('error', (e) => {
    if (!current()) return;
    fail(e.type === 'peer-unavailable' ? 'Комната ' + c + ' не найдена на сервере.' : 'Нет связи с сервером игры (' + e.type + ').');
  });
}
function startSolo() {
  mode = 'local'; myPid = null; S = Engine.newGame('local'); S.solo = true; S.opt.timer = 0; lastKey = '';
  Engine.apply(S, { type: 'join', pid: 'solo', name: $('#hname').value.trim() || 'Тестировщик', token: TOKENS[0].id });
  commit();
}
function startDemo() {
  mode='local';myPid=null;S=Engine.newGame('local');S.opt.timer=0;S.opt.ball=false;
  [['demo1','Семён','honda'],['demo2','Маша','isuzu'],['demo3','Алексей','chelsea']].forEach(([pid,name,token])=>Engine.apply(S,{type:'join',pid,name,token}));
  Engine.apply(S,{type:'start',pid:'local'});
  S.players.sort((a,b)=>a.id.localeCompare(b.id));S.turn=0;
  for(const i of [1,3]) {S.owner[i]='demo1';S.houses[i]=1;}
  for(const i of [6,8,9]) {S.owner[i]='demo2';S.houses[i]=2;}
  for(const i of [31,32,34]) S.owner[i]='demo3';
  S.players[0].pos=24;S.players[1].pos=8;S.players[2].pos=32;S.step='buy';
  S.log=['Демонстрационная партия: участки и постройки выданы для проверки интерфейса.'];S.ev=[];lastKey='';commit();
}
function startLocal() { mode = 'local'; myPid = null; S = Engine.newGame('local'); S.opt.timer = 0; lastKey = ''; commit(); }

/* ---------- Очередь состояний: каждое новое состояние сначала проигрывается анимацией ---------- */
function enqueue(ns) { queue.push(ns); pump(); }
async function pump() {
  if (pumping) return; pumping = true;
  while (queue.length) {
    const ns = queue.shift();
    const anim = V && V.phase !== 'lobby' && ns.seq > V.seq && ns.ev && ns.ev.length && queue.length < 3 && !document.hidden && !window.FAST;
    if (anim) { busy = true; $('#actions').classList.add('busy'); try { await playEvents(ns); } catch (e) { console.error(e); } busy = false; }
    else if (V && ns.ev) ns.ev.forEach((e) => { if (e.t === 'join') Snd.play('pop'); if (e.t === 'start') Snd.play('start'); if (e.t === 'chat') noteChat(e, ns); });
    V = ns; render();
  }
  pumping = false;
}
function noteChat(e, ns) {
  const p = ns.players.find((x) => x.id === e.pid);
  if (mode === 'local' || e.pid !== myPid) Snd.play('pop');
  if (!$('#hub') || !$('#hub').classList.contains('feedopen')) { unread++; }
  if (p) bubble(e.pid, e.text);
}
async function playEvents(ns) {
  const mine = (id) => mode !== 'local' && id === myPid;
  for (const e of ns.ev) {
    switch (e.t) {
      case 'roll': {
        Snd.play('dice'); const ds = $$('.die'); ds.forEach((x) => x.classList.add('rolling'));
        for (let k = 0; k < 8; k++) { setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]); await sleep(65); }
        ds.forEach((x) => x.classList.remove('rolling')); setDice(e.d);
        if (e.d[0] === e.d[1]) Snd.play('double');
        await sleep(280); break;
      }
      case 'move': {
        const el = document.getElementById('t_' + e.pid); if (!el) break;
        if (e.mode === 'jump') { el.classList.add('slow'); tokPos[e.pid] = e.to; placeTokens(); Snd.play('whoosh'); await sleep(600); el.classList.remove('slow'); }
        else {
          const dir = e.mode === 'back' ? -1 : 1, n = ((e.to - e.from) * dir + 40) % 40, d = Math.max(55, Math.min(150, 1500 / Math.max(n, 1)));
          for (let k = 1; k <= n; k++) {
            tokPos[e.pid] = (e.from + dir * k + 40) % 40; placeTokens(); markHere(tokPos[e.pid]); Snd.play('step', k);
            el.firstChild.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-28%) scale(1.18)' }, { transform: 'translateY(0) scale(1)' }], { duration: d });
            await sleep(d);
          }
          await sleep(140);
        }
        break;
      }
      case 'lap': Snd.play('lap'); break;
      case 'gain': flo(e.pid, '+' + money(e.amount), 'plus'); Snd.play('coin'); await sleep(300); break;
      case 'pay': flo(e.from, '−' + money(e.amount), 'minus'); if (ns.players.find((p) => p.id === e.to)) flo(e.to, '+' + money(e.amount), 'plus'); Snd.play('pay'); await sleep(420); break;
      case 'card': $('#spot').innerHTML = cardHTML(e, true); Snd.play('card'); await sleep(Math.min(2900, 1300 + e.text.length * 14)); break;
      case 'offer': Snd.play('offer'); break;
      case 'buy': Snd.play('buy'); flo(e.pid, '−' + money(e.amount), 'minus'); flashCell(e.cell); await sleep(380); break;
      case 'auction': Snd.play('gavel'); await sleep(200); break;
      case 'bid': Snd.play('bid'); break;
      case 'apass': case 'nosale': case 'nodeal': Snd.play('pass'); break;
      case 'sold': Snd.play('sold'); flo(e.pid, '−' + money(e.amount), 'minus'); flashCell(e.cell); await sleep(420); break;
      case 'build': Snd.play('build'); flo(e.pid, '−' + money(e.amount), 'minus'); flashCell(e.cell); await sleep(260); break;
      case 'sell': case 'mortgage': Snd.play('coin'); flo(e.pid, '+' + money(e.amount), 'plus'); break;
      case 'unmortgage': Snd.play('pay'); flo(e.pid, '−' + money(e.amount), 'minus'); break;
      case 'jail': Snd.play('honk'); await sleep(450); break;
      case 'ball': Snd.play('boing'); await sleep(220); break;
      case 'fire': Snd.play('fire'); flashCell(e.cell); await sleep(700); break;
      case 'saved': Snd.play('pay'); flashCell(e.cell); await sleep(400); break;
      case 'burned': Snd.play('fire'); Snd.play('sad'); flashCell(e.cell); await sleep(600); break;
      case 'turn': Snd.play(mine(e.pid) ? 'myturn' : 'turn'); break;
      case 'chat': noteChat(e, ns); break;
      case 'emo': flo(e.pid, e.e, 'emo'); Snd.play('pop'); break;
      case 'trade': if (mine(e.to)) Snd.play('myturn'); else Snd.play('offer'); break;
      case 'deal': Snd.play('buy'); break;
      case 'debt': Snd.play('low'); break;
      case 'timeout': flo(e.pid, '⏰', 'minus'); break;
      case 'free': Snd.play('whoosh'); break;
      case 'bankrupt': Snd.play('sad'); await sleep(500); break;
      case 'win': Snd.play('win'); confetti(); break;
      case 'start': Snd.play('start'); break;
    }
  }
}

/* ---------- Эффекты поверх экрана ---------- */
function chipRect(pid) { const el = document.getElementById('pc_' + pid); return el ? el.getBoundingClientRect() : null; }
function flo(pid, text, cls) {
  const r = chipRect(pid); if (!r) return;
  const d = document.createElement('div'); d.className = 'flo ' + cls; d.textContent = text;
  d.style.left = r.left + r.width * (cls === 'emo' ? 0.35 : 0.55) + Math.random() * 14 + 'px'; d.style.top = r.top + (cls === 'emo' ? -8 : r.height / 2 - 12) + 'px';
  $('#fx').appendChild(d); setTimeout(() => d.remove(), 2000);
}
function bubble(pid, text) {
  const r = chipRect(pid); if (!r) return;
  const d = document.createElement('div'); d.className = 'bub'; d.textContent = text;
  d.style.left = Math.max(6, Math.min(r.left + 14, innerWidth - 240)) + 'px'; d.style.top = r.bottom + 2 + 'px';
  $('#fx').appendChild(d); setTimeout(() => d.remove(), 3700);
}
function flashCell(i) { const c = document.getElementById('c' + i); if (c) c.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.12)', filter: 'brightness(1.7)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 450 }); }
function markHere(i) { $$('.cell.here').forEach((c) => c.classList.remove('here')); const c = document.getElementById('c' + i); if (c) c.classList.add('here'); }
function confetti() {
  const cols = ['#ffc24d', '#4fd695', '#ff6b6b', '#4263eb', '#e0569f', '#fff'];
  for (let i = 0; i < 70; i++) { const d = document.createElement('div'); d.className = 'conf'; d.style.left = Math.random() * 100 + 'vw'; d.style.background = cols[i % cols.length]; d.style.animationDuration = 2 + Math.random() * 2.5 + 's'; d.style.animationDelay = Math.random() * 0.8 + 's'; $('#fx').appendChild(d); setTimeout(() => d.remove(), 5600); }
}

/* ---------- Город на горизонте ---------- */
function skyline() {
  let f = '', w = '';
  const house = (x, wd, h) => {
    f += `M${x} 240V${240 - h}l${wd / 2} ${-wd * 0.5} ${wd / 2} ${wd * 0.5}V240z`;
    for (let r = 0; r < Math.floor(h / 36); r++) for (let c = 0; c < Math.floor(wd / 24); c++) if ((x + r * 7 + c * 5) % 3) w += `<rect x="${x + 10 + c * 24}" y="${240 - h + 16 + r * 32}" width="8" height="12" rx="1"/>`;
  };
  [[10, 70, 86], [80, 60, 122], [140, 78, 98], [218, 58, 136], [276, 72, 92], [878, 66, 92], [944, 72, 126], [1016, 60, 100], [1076, 84, 114], [1160, 60, 84]].forEach((a) => house(...a));
  f += 'M510 240V152l62-48 62 48v88zM634 240V86h66v154zM626 86l41-72 41 72zM404 240l11-130h36l11 130zM410 112h46v-9h-46zM417 103V78h32v25zM413 78l20-19 20 19z';
  w += '<circle cx="667" cy="114" r="10"/><rect x="659" y="152" width="16" height="30" rx="8"/><circle cx="572" cy="154" r="12"/><rect x="423" y="83" width="20" height="16"/>';
  const back = 'M770 240V66h11v174zM728 76h140v8H728zM728 84h26v20h-26zM852 84h3v46h-3zM846 130h15v12h-15zM330 240v-40q28-30 56 0v40zM1130 240v-52q22-26 44 0v52z';
  return `<svg class="sky" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="${back}" fill="#18294a"/><path d="${f}" fill="#1c3054"/><g fill="#ffc24d" opacity=".75">${w}</g><path d="M0 232q30-8 60 0t60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0v8H0z" fill="#12203a"/></svg>`;
}

/* ---------- Экраны ---------- */
function render() {
  const show = (id) => ['home', 'lobby', 'game'].forEach((x) => $('#' + x).classList.toggle('hide', x !== id));
  if (!mode) return show('home');
  if (!V || V.phase === 'lobby') { show('lobby'); return renderLobby(); }
  show('game'); renderGame();
  if (modalFn) modalFn();
}
function renderLobby() {
  const box = $('#lobbybox');
  if (!V) { box.innerHTML = `<h2>Комната ${esc(code)}</h2><p class="sub">${esc(statusText)}</p><button class="ghost" onclick="location.hash='';location.reload()">Назад</button>`; return; }
  const mine = mode === 'local' ? null : PL(myPid);
  const taken = (t) => V.players.some((p) => p.token === t && p.id !== (mine && mine.id));
  if (!pickedToken || taken(pickedToken)) pickedToken = mine ? mine.token : (TOKENS.find((t) => !taken(t.id)) || {}).id;
  const link = location.origin + location.pathname + '#' + code;
  const hadFocus = document.activeElement && document.activeElement.id === 'lname';
  const nameVal = hadFocus ? $('#lname').value : mine ? mine.name : mode === 'local' ? '' : LS.get('km_name') || '';
  const o = V.opt, host = isHost();
  const seg = [0, 30, 60, 90].map((t) => `<button class="${o.timer === t ? 'on' : ''}" data-timer="${t}" ${host ? '' : 'disabled'}>${t ? t + ' с' : 'выкл'}</button>`).join('');
  box.innerHTML = `
    ${mode === 'local' ? (V.solo ? '<h2>Комната на одного · тест</h2><p class="sub">Можно начать одному. Таймер выключен — бросайте кубики, покупайте участки и проверяйте игру.</p>' : '<h2>На одном устройстве</h2><p class="sub">Добавьте игроков по очереди и передавайте устройство по кругу</p>') : `
      <p class="sub">Код комнаты</p><div class="codebig">${esc(code)}</div>
      <div class="row"><input readonly value="${esc(link)}" id="llink"><button class="fix" id="bcopy">Копировать</button></div>
      ${statusText ? `<p class="sub">${esc(statusText)}</p>` : ''}`}
    <div class="plist">${V.players.map((p) => `<div class="pl">${tokHTML(tokOf(p.token))}<span class="nm2">${esc(p.name)}${p.id === V.hostId ? ' <small>создатель</small>' : ''}</span>${mode === 'local' ? `<button class="sm ghost" data-rm="${p.id}">убрать</button>` : `<span class="dot ${p.on ? '' : 'off'}"></span>`}</div>`).join('') || '<p class="sub">Пока никого</p>'}</div>
    <input id="lname" maxlength="14" placeholder="${mode === 'local' ? 'Имя игрока' : 'Твоё имя'}" value="${esc(nameVal)}" autocomplete="off">
    <div class="tokens">${TOKENS.map((t) => `<button class="tokpick ${pickedToken === t.id ? 'sel' : ''} ${taken(t.id) ? 'taken' : ''}" data-tok="${t.id}">${tokHTML(t)}${esc(t.name)}</button>`).join('')}</div>
    <button id="bset" class="${mine ? '' : 'primary'}">${mode === 'local' ? 'Добавить игрока' : mine ? 'Сохранить имя и фишку' : 'Сесть за стол'}</button>
    <div class="opts">
      <div class="opt"><span>Таймер хода<small>Не успел — игра сходит за тебя</small></span><div class="seg">${seg}</div></div>
      <div class="opt"><span>Общак на парковке<small>Домашнее правило: штрафы копятся</small></span><button class="sw2 ${o.pot ? 'on' : ''}" data-opt="pot" ${host ? '' : 'disabled'}></button></div>
      <div class="opt"><span>Мячик Челси<small>+${money(DATA.BALL_BONUS)} тому, кто встал на клетку с мячиком</small></span><button class="sw2 ${o.ball ? 'on' : ''}" data-opt="ball" ${host ? '' : 'disabled'}></button></div>
    </div>
    ${host ? `<button class="primary" id="bstart" ${V.players.length < (V.solo ? 1 : 2) ? 'disabled' : ''}>Начать игру (${V.players.length}/6)</button>` : '<p class="sub">Ждём, пока создатель комнаты начнёт игру</p>'}
    <button class="ghost sm" id="brulesL">Правила</button>`;
  if (hadFocus) { const i = $('#lname'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  box.querySelectorAll('[data-tok]').forEach((b) => (b.onclick = () => { if (!taken(b.dataset.tok)) { pickedToken = b.dataset.tok; renderLobby(); } }));
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => act('leave', { pid: b.dataset.rm })));
  box.querySelectorAll('[data-timer]').forEach((b) => (b.onclick = () => act('setOpt', { pid: V.hostId, opt: { timer: +b.dataset.timer } })));
  box.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => act('setOpt', { pid: V.hostId, opt: { [b.dataset.opt]: !o[b.dataset.opt] } })));
  $('#bset').onclick = () => {
    const name = $('#lname').value.trim();
    if (mode !== 'local') LS.set('km_name', name);
    const tok = pickedToken;
    if (mode === 'local') pickedToken = null;
    act('join', { pid: mode === 'local' ? randId() : myPid, name, token: tok });
    if (mode === 'local') renderLobby();
  };
  $('#brulesL').onclick = () => openModal(rulesModal);
  if ($('#bstart')) $('#bstart').onclick = () => act('start', { pid: V.hostId });
  if ($('#bcopy')) $('#bcopy').onclick = copyLink;
}
function copyLink() {
  const link = location.origin + location.pathname + '#' + code;
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).catch(() => { const i = $('#llink'); if (i) { i.select(); document.execCommand('copy'); } });
  const t = $('#toast'); t.textContent = 'Ссылка скопирована, кидай друзьям'; t.classList.remove('hide'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), 2200);
}

/* ---------- Доска ---------- */
function oldCellRC(i) { const C = LC, R = LR; if (i < C) return [R - 1, C - 1 - i]; if (i < C + R - 1) return [R - 1 - (i - (C - 1)), 0]; if (i < 2 * C + R - 2) return [0, i - (C + R - 2)]; return [i - (2 * C + R - 3), C - 1]; }
function cellRC(i) { if (i <= 10) return [0, i]; if (i <= 20) return [i - 10, 10]; if (i <= 30) return [10, 30 - i]; return [40 - i, 0]; }
const IC = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.600 7.100L4 20l1-4.600A8 8 0 1 1 21 12z"/></svg>',
  son: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16.500 9a4 4 0 0 1 0 6M19 6.500a8 8 0 0 1 0 11"/></svg>',
  soff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM17 9.500l5 5M22 9.500l-5 5"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.600 2.200c-.700.400-1.100 1-1.100 1.800M12 17h.010"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path style="stroke-width:3" d="M5 12h.010M12 12h.010M19 12h.010"/></svg>',
};
function buildBoard() {
  const b = $('#board'); b.innerHTML = '';
  BOARD.forEach((c, i) => {
    const d = document.createElement('div');
    d.dataset.kind = c.t; d.dataset.index = i; d.dataset.side = i < 10 ? 'top' : i < 20 ? 'right' : i < 30 ? 'bottom' : 'left';
    d.className = 'cell' + (Engine.buyable(c) || c.t === 'card' ? '' : ' special'); d.id = 'c' + i; d.style.setProperty('--g', cellColor(c));
    const pr = c.price ? money(c.price) : '';  
    d.innerHTML = `<div class="pic">${c.t === 'gotojail' ? '<svg viewBox="0 0 48 48" class="art"><path fill="#597d9b" d="M24 3 42 11v13c0 12-18 21-18 21S6 36 6 24V11z"/><path fill="#f3cc72" d="m24 12 4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z"/></svg>' : c.t === 'jail' ? '<svg viewBox="0 0 80 50" class="art"><g stroke="#52677b" stroke-width="3"><path d="M8 22h25v23H8zM15 22v23M25 22v23" fill="none"/></g><circle cx="59" cy="17" r="13" fill="#d9a46c"/><circle cx="59" cy="16" r="11" fill="#e9a4b6"/><circle cx="59" cy="17" r="4" fill="#fff7e7"/><path d="m51 11 3 1m10-2-1 3m4 6-3 2m-12 0 2 3" stroke="#fff4ba" stroke-width="2"/></svg>' : c.t === 'card' ? '<span class="event-question">?</span>' : Art.cell(i)}</div><div class="meta"><div class="nm">${esc(c.name)}</div></div>${pr ? `<div class="pr" aria-label="Цена покупки ${pr}">${pr}</div>` : `<span class="cell-type">${c.t === 'card' ? 'СОБЫТИЕ' : c.t === 'tax' ? 'ПЛАТЁЖ' : c.t === 'start' ? '+' + money(DATA.LAP) : ''}</span>`}`;
    d.setAttribute('role', 'button'); d.tabIndex = 0; d.setAttribute('aria-label', c.name);
    d.onclick = () => { if ($('#modal').classList.contains('trade-mode')) return selectTradeCell(i); openModal(() => cellModal(i)); };
    d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } };
    b.appendChild(d);
  });
  const hub = document.createElement('div'); hub.id = 'hub';
  hub.innerHTML = `<div class="hubin">
    <div class="hubtop"><div class="brand">Кёниг <b>Магнат</b></div><div class="room" id="room"></div>
      <div class="tools"><button id="bfeed" title="Чат">${IC.chat}<span class="badge hide" id="unread"></span></button><button id="bsound" title="Звук"></button><button id="bhelp" title="Правила">${IC.help}</button><button id="bmenu" title="Меню">${IC.menu}</button></div></div>
    <div id="players"></div>
    <div id="stage"><div id="dice"><div class="die">${'<i></i>'.repeat(9)}</div><div class="die">${'<i></i>'.repeat(9)}</div></div><div id="spot"></div><div id="tradebar" class="hide"></div><div id="actions"></div><div id="timer" class="off"><i></i></div><div id="mini"></div></div>
    <div id="feed"><div class="feedhead"><span>Чат и события</span><button class="sm ghost" id="bfeedx">Закрыть</button></div><div id="feedlist" role="log" aria-label="Чат и события"></div><button id="feednew" class="sm hide">↓ Новые события</button>
      <div id="emos">${Engine.EMO.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>
      <form id="chatform"><input id="chatin" maxlength="140" placeholder="Написать в чат" autocomplete="off"><button class="primary" aria-label="Отправить">➤</button></form></div>
  </div>`;
  b.appendChild(hub);
  $('#bfeed').onclick = () => { hub.classList.add('feedopen'); unread = 0; renderTop(); scrollFeed(true); };
  $('#feednew').onclick = () => scrollFeed(true);
  $('#feedlist').onscroll = () => { const l = $('#feedlist'); if (l.scrollHeight - l.scrollTop - l.clientHeight < 30) $('#feednew').classList.add('hide'); };
  $('#bfeedx').onclick = () => hub.classList.remove('feedopen');
  $('#mini').onclick = () => $('#bfeed').click();
  $('#bsound').onclick = () => { Snd.toggle(); renderTop(); };
  $('#bhelp').onclick = () => openModal(rulesModal);
  $('#bmenu').onclick = () => openModal(menuModal);
  $('#emos').onclick = (e) => { const b2 = e.target.closest('[data-e]'); if (b2) act('emo', { e: b2.dataset.e }); };
  $('#chatform').onsubmit = (e) => { e.preventDefault(); const i = $('#chatin'), t = i.value.trim(); if (t) { act('chat', { text: t }); i.value = ''; } };
  setDice([1, 1]);
  boardBuilt = true; layout();
}
function layout() {
  if (!boardBuilt) return;
  const wrap = $('#boardwrap'), w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
  LC = 11; LR = 11;
  const b = $('#board'); b.style.gridTemplateColumns = '1.35fr repeat(9,minmax(0,1fr)) 1.35fr'; b.style.gridTemplateRows = '1.35fr repeat(9,minmax(0,1fr)) 1.35fr';
  BOARD.forEach((c, i) => { const [r, col] = cellRC(i), d = document.getElementById('c' + i); d.style.gridRow = r + 1; d.style.gridColumn = col + 1; });
  const hub = $('#hub'); hub.style.gridColumn = `2 / ${LC}`; hub.style.gridRow = `2 / ${LR}`;
  wrap.style.setProperty('--ts', Math.max(18, Math.min(w / LC, h / LR) * 0.25) + 'px');
  placeTokens();
}
window.addEventListener('resize', layout);
function placeTokens() {
  if (!V) return;
  const wrap = $('#boardwrap'), ts = parseFloat(wrap.style.getPropertyValue('--ts')) || 30, by = {};
  V.players.forEach((p) => { if (!p.bankrupt) (by[tokPos[p.id]] = by[tokPos[p.id]] || []).push(p.id); });
  V.players.forEach((p) => {
    const t = document.getElementById('t_' + p.id); if (!t) return;
    const pos = tokPos[p.id] || 0, grp = by[pos] || [p.id], k = Math.max(0, grp.indexOf(p.id)), n = grp.length, [r, c] = cellRC(pos);
    const dx = n > 1 ? ((k % 3) - (Math.min(n, 3) - 1) / 2) * ts * 0.62 : 0, dy = n > 3 ? (Math.floor(k / 3) - 0.5) * ts * 0.7 : 0;
    const cell = document.getElementById('c' + pos);
    t.style.left = (cell.offsetLeft + cell.offsetWidth * .8 + dx) + 'px'; t.style.top = (cell.offsetTop + cell.offsetHeight * .25 + dy) + 'px';
  });
}
function setDice(d) {
  const map = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  $$('.die').forEach((el, k) => [...el.children].forEach((i, n) => i.classList.toggle('on', (map[d[k]] || []).includes(n))));
}
function renderBoard() {
  if (!boardBuilt) buildBoard();
  const wrap = $('#boardwrap'), actor = Engine.actor(V), ap = PL(actor);
  BOARD.forEach((c, i) => {
    const d = document.getElementById('c' + i), o = V.owner[i], op = o && PL(o);
    d.classList.toggle('mort', !!V.mort[i]);
    d.classList.toggle('owned', !!op);
    d.classList.toggle('full-group', !!op && c.t === 'prop' && Engine.ownsGroup(V, o, c.g));
    d.title = c.name + (op ? ' · ' + op.name : ' · свободно') + (V.mort[i] ? ' · залог' : '');
    d.classList.toggle('here', V.phase === 'play' && !!ap && ap.pos === i && !V.auction);
    if (op) d.style.setProperty('--o', tokOf(op.token).color);
    let ob = d.querySelector('.ob');
    if (op) { if (!ob) { ob = document.createElement('div'); ob.className = 'ob'; d.firstChild.appendChild(ob); } ob.textContent = op.name; ob.title = 'Владелец: ' + op.name; } else if (ob) ob.remove();
    let hs = d.querySelector('.hs'); const h = V.houses[i];
    if (h) { if (!hs) { hs = document.createElement('div'); hs.className = 'hs'; d.appendChild(hs); } hs.classList.toggle('hotel', h === 5); hs.innerHTML = `<span class="iso-house ${h === 5 ? 'hotel' : ''}"></span><span>${h === 5 ? 'Отель' : '★ ' + h}</span>`; } else if (hs) hs.remove();
    let bm = d.querySelector('.ballm');
    if (V.ball === i) { if (!bm) { bm = document.createElement('div'); bm.className = 'ballm'; bm.innerHTML = Art.art('ball'); d.firstChild.appendChild(bm); } } else if (bm) bm.remove();
  });
  V.players.forEach((p) => {
    let t = document.getElementById('t_' + p.id);
    if (!t) { t = document.createElement('div'); t.className = 'tok'; t.id = 't_' + p.id; t.innerHTML = tokHTML(tokOf(p.token)); wrap.appendChild(t); }
    t.classList.toggle('hide', p.bankrupt); t.classList.toggle('active', p.id === actor);
    tokPos[p.id] = p.pos;
  });
  placeTokens();
  if (V.dice[0]) setDice(V.dice);
}

/* ---------- Центр: игроки, сцена, чат ---------- */
function renderTop() {
  $('#room').innerHTML = mode === 'local' ? (V.solo ? 'Одиночная тестовая игра' : 'Игра на одном устройстве') : `<span class="dot ${online ? '' : 'off'}"></span>Комната <b>${esc(code)}</b> ${esc(statusText)}`;
  $('#bsound').innerHTML = Snd.on ? IC.son : IC.soff;
  const u = $('#unread'); u.textContent = unread; u.classList.toggle('hide', !unread);
  $('#hub').classList.toggle('local', mode === 'local');
}
function renderPlayers() {
  const my = me(), actor = Engine.actor(V);
  $('#players').innerHTML = V.players.map((p) => {
    const props = BOARD.filter((c, i) => V.owner[i] === p.id).length;
    const sub = p.bankrupt ? 'банкрот' : `${props} кл.${p.jail ? ' · в тюрьме' : ''}${p.jailCards ? ' · объезд ×' + p.jailCards : ''}${mode !== 'local' && !p.on ? ' · не в сети' : ''}`;
    return `<div class="chip ${p.id === actor ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}" id="pc_${p.id}" data-p="${p.id}">${tokHTML(tokOf(p.token))}<span class="who"><span class="nm2">${esc(p.name)}${p.id === my && mode !== 'local' ? ' · ты' : ''}</span><small>${sub}</small></span><span class="mn">${p.bankrupt ? '—' : money(p.money)}</span>${p.id === actor ? '<span class="secs"></span>' : ''}</div>`;
  }).join('');
  $$('#players .chip').forEach((c) => (c.onclick = () => openModal(() => playerModal(c.dataset.p))));
}
const cardHTML = (c, pop) => `<div class="gcard ${c.deck} ${pop ? 'pop' : ''}"><b>${c.deck === 'D' ? 'Движ' : 'Сторис'}</b>${esc(c.text)}</div>`;
function deedHead(i) { const c = BOARD[i]; return `<div class="dhead"><div class="dart">${Art.cell(i)}</div><div><h3>${esc(c.name)}</h3><small>${cellKind(c)}</small></div>${c.price ? `<div class="dprice">${money(c.price)}</div>` : ''}</div>`; }
function deedMini(i) {
  const c = BOARD[i];
  const st = c.t === 'prop' ? [['Аренда', c.rent[0]], ['Вся группа', c.rent[0] * 2], ['Отель', c.rent[5]]] : c.t === 'transport' ? [['Один', 25], ['Два', 50], ['Все четыре', 200]] : [['Аренда', c.price * .1], ['Залог', c.price / 2]];
  return `<div class="deed mini" style="--g:${cellColor(c)}" data-cell="${i}">${deedHead(i)}<div class="dstats">${st.map((s) => `<span>${s[0]}<b>${typeof s[1] === 'number' ? money(s[1]) : s[1]}</b></span>`).join('')}</div></div>`;
}
function renderStage() {
  const my = me(), actor = Engine.actor(V), cp = V.players[V.turn], mp = PL(my), local = mode === 'local';
  const btn = (label, a, cls, dis) => `<button class="${cls || ''}" ${dis ? 'disabled' : ''} data-a='${esc(JSON.stringify(a))}'>${label}</button>`;
  let spot = '', h = '', tb = '';
  if (V.phase === 'over') {
    spot = `<div class="wincrown">${Art.art('crown')}</div><h3 style="text-align:center;margin:6px 0 10px">Победил ${esc(PL(V.winner).name)}</h3><div class="rank">${V.final.map((f, k) => { const p = PL(f.id); return `<div class="pl">${tokHTML(tokOf(p.token))}<span class="nm2">${k + 1}. ${esc(p.name)}</span><span class="mn">${money(f.worth)}</span></div>`; }).join('')}</div>`;
    h = '<p>Капитал: деньги, клетки и постройки</p><button class="primary big" id="bnew">Новая игра</button>';
  } else {
    if (V.trade) {
      const t = V.trade, f = PL(t.from), to = PL(t.to), names = (l) => l.map((i) => '«' + esc(BOARD[i].name) + '»').join(', ');
      const side = (l, m) => [names(l), m ? money(m) : ''].filter(Boolean).join(' + ') || 'ничего';
      tb = `<div class="tradebox"><b>🤝 ${esc(f.name)} → ${esc(to.name)}</b><span>Отдаёт: ${side(t.give, t.giveMoney)}</span><span>Хочет: ${side(t.get, t.getMoney)}</span><div class="btns">${local || my === t.to ? btn('Согласиться', { type: 'acceptTrade', pid: t.to }, 'primary') + btn('Отказаться', { type: 'rejectTrade', pid: t.to }) : my === t.from ? btn('Отменить', { type: 'rejectTrade' }) : ''}</div></div>`;
    }
    if (V.auction) {
      const au = V.auction, ap = PL(actor);
      const nextBid = au.bidder ? au.bid + DATA.AUCTION_STEP : BOARD[au.cell].price;
      spot = deedMini(au.cell) + `<div class="auction-info"><b>Аукцион · ${au.bidder ? money(au.bid) : 'от ' + money(nextBid)}</b><span>${au.bidder ? 'Лидирует ' + esc(PL(au.bidder).name) : 'Первая ставка — цена участка'}</span><span>Шаг ${money(DATA.AUCTION_STEP)} · ${esc(PL(au.excluded || cp.id).name)} не участвует</span><span>Очередь: ${au.order.map((id,k) => (k === au.i ? '→ ' : '') + esc(PL(id).name)).join(' · ')}</span>${au.passed?.length ? `<span>Пас: ${au.passed.map(id => esc(PL(id).name)).join(', ')}</span>` : ''}</div>`;
      if (my === actor) h = `<p class="who">Ставит ${esc(ap.name)} · ${money(ap.money)}</p><div class="btns">${btn('Поставить ' + money(nextBid), { type: 'bid', amount: nextBid }, 'primary', ap.money < nextBid)}${btn('Пас', { type: 'auctionPass' })}</div>`;
      else h = `<p>Ожидаем ставку ${esc(ap.name)}</p>`;
    } else if (V.fire) {
      const f = V.fire, fp = PL(f.pid), c = BOARD[f.cell], lack = f.cost - fp.money;
      spot = deedMini(f.cell) + `<div class="hint"><b style="color:var(--bad);font-family:var(--disp)">Пожар на «${esc(c.name)}»</b><br>Владелец ${esc(fp.name)} · на счету ${money(fp.money)}</div>`;
      if (my === f.pid) {
        h = `<p>${local ? esc(fp.name) + ': п' : 'П'}отуши за ${money(f.cost)}, и поле останется у тебя вместе с постройками. Откажешься — постройки снесут, а поле вернётся банку и его сможет купить любой.</p>`;
        if (lack > 0) h += `<p>Не хватает ${money(lack)}: нажимай на другие свои поля, чтобы заложить их или продать постройки.</p>`;
        h += `<div class="btns">${btn('Потушить за ' + money(f.cost), { type: 'fireSave' }, 'primary big', lack > 0)}${btn('Отказаться', { type: 'fireGiveUp' }, 'danger')}</div>`;
      } else h = `<p><span class="who">${esc(fp.name)}</span> решает, тушить ли «${esc(c.name)}»…</p>`;
    } else if (V.debt) {
      const d = V.debt, dp = PL(d.pid);
      spot = `<div class="hint"><b style="color:var(--bad);font-family:var(--disp)">К оплате ${money(d.amount)}</b><br>${esc(dp.name)}: есть ${money(dp.money)}, не хватает ${money(Math.max(0, d.amount - dp.money))}</div>`;
      if (my === d.pid) h = `<p>Нажимай на свои клетки, чтобы продать постройки или заложить их, либо предложи обмен.</p><div class="btns">${btn((d.to && PL(d.to) ? 'Оплатить аренду ' : 'Заплатить ') + money(d.amount), { type: 'payDebt' }, 'primary big', dp.money < d.amount)}${btn('Сдаться', { type: 'bankrupt' }, 'danger')}</div>`;
      else h = `<p>${esc(dp.name)} ищет деньги…</p>`;
    } else {
      const who = local ? esc(cp.name) + ': ' : '';
      if (V.step === 'buy') spot = deedMini(cp.pos);
      else if (V.card) spot = cardHTML(V.card);
      else { const last = [...V.log].reverse().find((l) => typeof l === 'string'); spot = `<div class="landing"><small>Сейчас на поле</small><h3>${esc(BOARD[cp.pos].name)}</h3><p class="hint">${esc(last || '')}</p></div>`; }
      if (my === cp.id) {
        if (V.step === 'roll') {
          h = cp.jail ? `<p class="who">${who}ты в тюрьме, попытка ${cp.jail} из 3</p>` : `<p class="who">${who}${V.again ? 'дубль, бросай ещё раз!' : 'твой ход'}</p>`;
          h += btn('Бросить кубики', { type: 'roll' }, 'primary big');
          if (cp.jail) h += `<div class="btns">${btn('Выйти за ' + money(DATA.JAIL_FEE), { type: 'payJail' }, '', cp.money < DATA.JAIL_FEE)}${cp.jailCards ? btn('Карта «Объезд»', { type: 'useJailCard' }) : ''}</div>`;
        } else if (V.step === 'buy') {
          const c = BOARD[cp.pos], lack = c.price - cp.money;
          h = (lack > 0 ? `<p>${who}не хватает ${money(lack)}. Заложи что-нибудь или отдай на аукцион.</p>` : `<p>После покупки останется ${money(cp.money - c.price)}</p>`) + `<div class="btns">${btn('Купить за ' + money(c.price), { type: 'buy' }, 'primary big', lack > 0)}${btn('На аукцион', { type: 'pass' }, 'big')}</div>`;
        } else h = '<p>Передаём ход следующему игроку…</p>';
      } else h = `<p>Ходит <span class="who">${esc(cp.name)}</span>${V.step === 'buy' ? ', думает о покупке' : ''}…</p>`;
    }
    if (mp && my === cp.id && !mp.bankrupt && !V.trade && !V.auction && V.players.filter(p => !p.bankrupt).length > 1) h += '<button id="btrade" class="ghost">🤝 Предложить обмен</button>';
  }
  if (V.solo && V.phase === 'play' && V.step === 'roll') h += `<details class="test-controls"><summary>Тест: задать кубики</summary><div class="row"><select id="testd1" aria-label="Первый кубик">${[1,2,3,4,5,6].map(n=>`<option>${n}</option>`).join('')}</select><select id="testd2" aria-label="Второй кубик">${[1,2,3,4,5,6].map(n=>`<option>${n}</option>`).join('')}</select><button id="testroll">Бросить заданные</button></div></details>`;
  $('#spot').innerHTML = spot;
  const tbe = $('#tradebar'); tbe.innerHTML = tb; tbe.classList.toggle('hide', !tb);
  const A = $('#actions'); A.innerHTML = h; A.classList.remove('busy');
  A.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { const a = JSON.parse(b.dataset.a); if (a.type === 'bankrupt' && !b.dataset.confirm) { b.dataset.confirm='1'; b.textContent='Подтвердить сдачу'; return; } if (a.type === 'fireGiveUp' && !b.dataset.confirm) { b.dataset.confirm='1'; b.textContent='Точно отдать поле?'; return; } act(a.type, a); }));
  tbe.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { const a = JSON.parse(b.dataset.a); if (a.type === 'acceptTrade' && !b.dataset.confirm) { b.dataset.confirm='1'; b.textContent='Подтвердить обмен'; return; } act(a.type, a); }));
  $$('#spot .deed.mini').forEach((d) => (d.onclick = () => openModal(() => cellModal(+d.dataset.cell))));
  if ($('#btrade')) $('#btrade').onclick = () => { trade = { to: null, give: new Set(), get: new Set() }; openModal(tradeModal); };
  if ($('#testroll')) $('#testroll').onclick = () => act('roll', {dice: [+$('#testd1').value, +$('#testd2').value]});
  if ($('#bnew')) $('#bnew').onclick = leave;
}
function leave() { if (mode === 'local') LS.del('km_local_v2'); if (mode === 'host') { LS.del('km_state_' + code); LS.del('km_last_host'); } V = null; S = null; mode = null; location.hash = ''; location.reload(); }
function scrollFeed(force) { const l = $('#feedlist'); if (force || l.scrollHeight - l.scrollTop - l.clientHeight < 80) { l.scrollTop = l.scrollHeight; $('#feednew').classList.add('hide'); } }
function renderFeed() {
  const l = $('#feedlist'), near = l.scrollHeight - l.scrollTop - l.clientHeight < 80, oldTop = l.scrollTop;
  const content = V.log.map((x) => {
    if (typeof x === 'string') return `<div class="ln event">${esc(x)}</div>`;
    const p = PL(x.c), name = esc(p ? p.name : '?');
    if (x.kind === 'card') return `<div class="ln card-event"><b style="color:${p ? tokOf(p.token).color : '#333'}">${name} · ${x.deck === 'D' ? 'Движ' : 'Сторис'}</b><p>${esc(x.t)}</p></div>`;
    return `<div class="ln chat"><b style="color:${p ? tokOf(p.token).color : '#333'}">${name}</b> ${esc(x.t)}</div>`;
  }).join('');
  if (content !== l.innerHTML) { l.innerHTML = content; if (near) scrollFeed(true); else { l.scrollTop = oldTop; $('#feednew').classList.remove('hide'); } }
  $('#mini').innerHTML = '';
}
function renderGame() { renderBoard(); renderTop(); renderPlayers(); renderStage(); renderFeed(); tickTimer(); }
function tickTimer() {
  if (!V || !boardBuilt) return;
  const bar = $('#timer'), el = $('#players .chip.turn .secs');
  if (V.phase !== 'play') { bar.classList.add('off'); return; }
  if (!V.deadline || !V.dur) { bar.classList.add('off'); if (el) el.textContent = ''; return; }
  const left = Math.max(0, V.deadline - (Date.now() + offset)), secs = Math.ceil(left / 1000), hot = secs <= 10;
  bar.classList.remove('off'); bar.classList.toggle('hot', hot); bar.firstChild.style.width = Math.min(100, (left / V.dur) * 100) + '%';
  if (el) { el.textContent = busy ? '' : secs; el.classList.toggle('hot', hot); }
  if (hot && secs > 0 && secs !== lastTick && !busy && (mode === 'local' || Engine.actor(V) === myPid)) Snd.play('tick');
  lastTick = secs;
}
setInterval(tickTimer, 250);

/* ---------- Окна ---------- */
function actionError(type, cell) {
  const clone = JSON.parse(JSON.stringify(V));
  return Engine.apply(clone, {type, cell, pid: me()});
}
function cellModal(i) {
  const c = BOARD[i], o = V.owner[i], my = me(), h = V.houses[i] || 0;
  let body = '';
  if (Engine.buyable(c)) body += `<div class="ownership" style="--o:${o ? tokOf(PL(o).token).color : '#87929c'}"><b>${o ? esc(PL(o).name) : 'Свободный участок'}</b><span>${V.mort[i] ? 'Заложен · аренда $0' : o ? 'Аренда сейчас: ' + money(Engine.rent(V,i,V.dice[0]+V.dice[1])) : 'Цена: ' + money(c.price)}</span></div>`;
  if (c.t === 'prop') {
    const full = o && Engine.ownsGroup(V,o,c.g);
    body += `<table class="rent"><thead><tr><th>Уровень</th><th>Улучшение</th><th>Аренда</th></tr></thead><tbody><tr class="${!h && !V.mort[i] ? 'cur' : ''}"><td>${full ? 'Вся группа' : 'Без домов'}</td><td>—</td><td>${money(c.rent[0]*(full?2:1))}</td></tr>${[1,2,3,4,5].map(n=>`<tr class="${h===n ? 'cur' : ''}"><td>${n===5 ? 'Отель' : '★'.repeat(n)}</td><td>${money(GROUPS[c.g].house)}</td><td>${money(c.rent[n])}</td></tr>`).join('')}</tbody></table><p class="sub">Каждая следующая ступень оплачивается отдельно. Строй и продавай равномерно по всей группе.</p>`;
  } else if (c.t === 'transport') body += `<table class="rent">${[25,50,100,200].map((n,k)=>`<tr><td>${k+1} транспорт у владельца</td><td>${money(n)}</td></tr>`).join('')}</table>`;
  else if (c.t === 'utility') body += '<p class="sub">Фиксированная аренда: $1 500 за посещение.</p>';
  else if (c.t === 'tax') body += `<p>Платёж ${money(c.amount)} ${V.opt.pot ? 'на парковку' : 'в банк'}.</p>`;
  else if (c.t === 'card') body += '<p>Текст выпавшей карточки и её результат сохраняются в общей истории.</p>';
  else body += `<p>${esc(c.t === 'parking' ? (V.opt.pot ? 'На парковке: ' + money(V.pot) : 'Бесплатная парковка') : c.note || '')}</p>`;
  if (Engine.buyable(c)) {
    body += `<p class="sub">Залог ${money(c.price/2)} · выкуп ${money(Engine.unmortCost(i))}</p>`;
    if (o === my && V.phase === 'play') {
      const button = (type, label, primary='') => { const reason = actionError(type,i); return `<div><button class="${primary}" data-m="${type}" ${reason ? 'disabled' : ''}>${label}</button>${reason ? `<small class="reason">${esc(reason)}</small>` : ''}</div>`; };
      body += '<div class="property-actions">';
      if (c.t === 'prop' && h<5) body += button('build', `${h===4 ? 'Построить отель' : 'Улучшить до ★'+(h+1)} · ${money(GROUPS[c.g].house)}`, 'primary');
      if (h) body += button('sell','Продать уровень · +'+money(GROUPS[c.g].house/2));
      if (!h) body += V.mort[i] ? button('unmortgage','Выкупить · '+money(Engine.unmortCost(i))) : button('mortgage','Заложить · +'+money(c.price/2));
      body += '</div>';
    }
  }
  $('#modal').innerHTML = `<div class="win"><div class="deed" style="--g:${cellColor(c)}">${deedHead(i)}</div>${body}<button class="ghost" id="mclose">Закрыть</button></div>`;
  $('#mclose').onclick = closeModal;
  $$('#modal [data-m]').forEach(b=>b.onclick=()=>{
    if (['mortgage','sell'].includes(b.dataset.m) && !b.dataset.confirm) { b.dataset.confirm='1'; b.textContent='Подтвердить '+(b.dataset.m==='mortgage'?'залог':'продажу'); return; }
    act(b.dataset.m,{cell:i});
  });
}
function playerModal(pid) {
  const p = PL(pid), my = me(); if (!p) return closeModal();
  const props = BOARD.map((c, i) => i).filter((i) => V.owner[i] === pid);
  const list = props.map((i) => { const c = BOARD[i], h = V.houses[i]; return `<span class="chipx ${V.mort[i] ? 'm' : ''}" data-cell="${i}"><i style="background:${cellColor(c)}"></i>${esc(c.name)}${h ? ' ' + (h === 5 ? '★' : '▲' + h) : ''}</span>`; }).join('') || '<span class="sub">Пока ничего не купил</span>';
  $('#modal').innerHTML = `<div class="win"><div class="pl" style="background:none;padding:0">${tokHTML(tokOf(p.token))}<span class="nm2"><h2 style="font-size:20px">${esc(p.name)}</h2><small>${tokOf(p.token).name}</small></span></div>
    <div class="deed"><div class="dstats"><span>Деньги<b>${p.bankrupt ? '—' : money(p.money)}</b></span><span>Капитал<b>${p.bankrupt ? money(0) : money(Engine.netWorth(V, p))}</b></span><span>Клеток<b>${props.length}</b></span></div></div>
    <div>${list}</div>
    <div class="btns">${my && my === V.players[V.turn].id && my !== pid && !p.bankrupt && PL(my) && !PL(my).bankrupt && V.phase === 'play' && !V.trade && !V.auction ? '<button class="primary" id="ptrade">🤝 Предложить обмен</button>' : ''}<button class="ghost" id="mclose">Закрыть</button></div></div>`;
  $('#mclose').onclick = closeModal;
  $('#modal').querySelectorAll('[data-cell]').forEach((b) => (b.onclick = () => openModal(() => cellModal(+b.dataset.cell))));
  if ($('#ptrade')) $('#ptrade').onclick = () => { trade = { to: pid, give: new Set(), get: new Set() }; openModal(tradeModal); };
}
let trade = null;
function selectTradeCell(i) {
  if (!trade) return;
  const owner = V.owner[i], c = BOARD[i];
  if (owner !== me() && owner !== trade.to) return toast('Выбери свой участок или участок партнёра');
  if (c.t === 'prop' && Engine.groupCells(c.g).some(k=>V.houses[k])) return toast('Сначала продай постройки в этой группе');
  const set = owner === me() ? trade.give : trade.get;
  set.has(i) ? set.delete(i) : set.add(i);
  trade.confirm = false; tradeModal();
}
function tradeModal() {
  const my = me(), mp = PL(my);
  if (!mp || V.phase !== 'play') return closeModal();
  const others = V.players.filter(p=>!p.bankrupt && p.id!==my);
  if (!others.length) return closeModal();
  if (!others.some(p=>p.id===trade.to)) trade.to=others[0].id;
  $('#modal').classList.add('trade-mode');
  $$('.cell').forEach((c,i)=>c.classList.toggle('selected-trade',trade.give.has(i)||trade.get.has(i)));
  const list = set => [...set].map(i=>`<button class="chipx on" data-cell="${i}">${esc(BOARD[i].name)}${V.mort[i]?' · залог':''} ×</button>`).join('') || '<span class="sub">Нажми на участок на поле</span>';
  $('#modal').innerHTML = `<div class="win"><h2>Обмен</h2><p class="sub">Выбирай участки прямо на поле. Они остаются видимыми вокруг окна.</p><div class="btns">${others.map(p=>`<button data-to="${p.id}" class="sm ${p.id===trade.to?'primary':''}">${esc(p.name)}</button>`).join('')}</div><div class="trade-columns"><section><b>Отдаю</b><div>${list(trade.give)}</div><label>Доплата, $<input id="tgm" type="number" min="0" step="100" value="${trade.giveMoney||''}"></label></section><section><b>Получаю</b><div>${list(trade.get)}</div><label>Доплата, $<input id="twm" type="number" min="0" step="100" value="${trade.getMoney||''}"></label></section></div><p class="sub">За полученный заложенный участок взимается комиссия 10% залога.</p><div class="btns"><button class="primary" id="tsend">${trade.confirm?'Подтвердить и отправить':'Проверить предложение'}</button><button class="ghost" id="mclose">Отмена</button></div><p id="tradecheck" class="sub">${trade.confirm ? `Доплата от тебя ${money((trade.giveMoney||0)/100)}, тебе ${money((trade.getMoney||0)/100)}. Проверь выбранные участки.` : ''}</p></div>`;
  $('#mclose').onclick = closeModal;
  $$('#modal [data-to]').forEach(b=>b.onclick=()=>{trade.to=b.dataset.to;trade.get.clear();trade.confirm=false;tradeModal();});
  $$('#modal [data-cell]').forEach(b=>b.onclick=()=>selectTradeCell(+b.dataset.cell));
  for (const [id,key] of [['tgm','giveMoney'],['twm','getMoney']]) $('#'+id).oninput=e=>{trade[key]=+e.target.value;trade.confirm=false;$('#tsend').textContent='Проверить предложение';};
  $('#tsend').onclick=()=>{
    const a={type:'proposeTrade',pid:my,to:trade.to,give:[...trade.give],get:[...trade.get],giveMoney:(trade.giveMoney||0)/100,getMoney:(trade.getMoney||0)/100};
    if (![trade.giveMoney||0,trade.getMoney||0].every(n=>Number.isFinite(n)&&n>=0&&n%100===0)) return toast('Суммы должны быть неотрицательными и кратными $100');
    const err=Engine.apply(JSON.parse(JSON.stringify(V)),a); if(err) return toast(err);
    if (!trade.confirm) {trade.confirm=true;tradeModal();return;}
    act(a.type,a);closeModal();
  };
}
function menuModal() {
  const my = me(), mp = PL(my), playing = V && V.phase === 'play';
  $('#modal').innerHTML = `<div class="win"><h2>Меню</h2>
    <button id="msnd">${Snd.on ? 'Выключить звук' : 'Включить звук'}</button>
    ${mode !== 'local' ? '<button id="mlink">Скопировать ссылку на комнату</button>' : ''}
    <button id="mrules">Правила</button>
    ${isHost() && playing ? `<button id="mskip">Пропустить ход игрока ${esc(V.players[V.turn].name)}</button><button class="danger" id="mfin">Закончить игру и подсчитать капитал</button>` : ''}
    ${playing && mp && !mp.bankrupt ? '<button class="danger" id="mgive">Сдаться</button>' : ''}
    <button class="ghost" id="mexit">Выйти в главное меню</button><button class="ghost" id="mclose">Закрыть</button></div>`;
  $('#mclose').onclick = closeModal;
  $('#msnd').onclick = () => { Snd.toggle(); renderTop(); menuModal(); };
  $('#mrules').onclick = () => openModal(rulesModal);
  if ($('#mlink')) $('#mlink').onclick = copyLink;
  const twice = (b, fn) => { if (b.dataset.sure) { fn(); closeModal(); } else { b.dataset.sure = 1; b.textContent = 'Точно? Нажми ещё раз'; } };
  if ($('#mskip')) $('#mskip').onclick = () => { act('hostSkip', { pid: V.hostId }); closeModal(); };
  if ($('#mfin')) $('#mfin').onclick = (e) => twice(e.target, () => act('finishGame', { pid: V.hostId }));
  if ($('#mgive')) $('#mgive').onclick = (e) => twice(e.target, () => act('bankrupt'));
  $('#mexit').onclick = (e) => twice(e.target, () => { location.hash = ''; mode = null; location.reload(); });
}
const RULES = [
  ['dice', '#4263eb', 'Ход', 'Бросаешь два кубика и едешь по кругу. Дубль даёт ещё один бросок, три дубля подряд отправляют в тюрьму. За каждый круг через Площадь Победы получаешь $20 000.'],
  ['house', '#2aa566', 'Покупка и аукцион', 'Встал на свободную клетку — можешь купить её по цене. Отказался или не хватает денег — клетка уходит на аукцион между остальными игроками. Первая ставка равна цене участка; шаг — $2 000. Пас — выход из аукциона.'],
  ['coins', '#e5484d', 'Аренда', 'Встал на чужую клетку — платишь владельцу. Транспорт: $2 500, $5 000, $10 000 или $20 000, смотря сколько его у владельца. Комбинат и маяк: фиксированные $1 500. Нажми «Оплатить аренду», даже если денег хватает. После оплаты ход переходит автоматически.'],
  ['cathedral', '#f08530', 'Группы и постройки', 'Собрал все клетки одного цвета — аренда без построек удваивается и можно ставить дома: до четырёх, потом отель. Строить нужно равномерно. Домов в городе всего 32, отелей 12: кончились — жди, пока кто-то продаст.'],
  ['key', '#5b6b8c', 'Залог', 'Нужны деньги — заложи клетку за половину цены. Аренду она не приносит. Выкуп стоит залог плюс 10%. Постройки банк берёт обратно за полцены.'],
  ['swap', '#e0569f', 'Обмен', 'Только в свой ход можно предложить другому игроку клетки и деньги. За каждую полученную заложенную клетку сразу платишь банку 10% её залога.'],
  ['jam', '#2a3b5f', 'Тюрьма', 'Клетка «Полиция», три дубля подряд или карточка ставят тебя в тюрьму на Эстакадном мосту. Выехать: выбросить дубль, заплатить $5 000 или сыграть карту «Объезд». На третьей попытке платишь $5 000 и едешь.'],
  ['deckD', '#7357e8', 'Движ и Сторис', 'Карточки «Движ» куда-то тебя везут, «Сторис» приносят или забирают деньги. Все они про нашу компанию.'],
  ['timer', '#0f9b94', 'Таймер', 'На каждое решение есть время. Не успел — игра сама бросит кубики, откажется от покупки (клетка уйдёт на аукцион) или спасует на аукционе.'],
  ['ball', '#dba514', 'Мячик и общак', 'Мячик Челси лежит на случайной клетке: встал на неё — получи +$5 000, мячик улетает дальше. Общак на парковке — домашнее правило, его включает создатель комнаты: тогда штрафы копятся и достаются тому, кто встал на парковку.'],
  ['crown', '#a9683f', 'Победа', 'Нечем платить и нечего продать — банкрот: всё уходит тому, кому должен. Последний оставшийся забирает Калининград.'],
];
function rulesModal() {
  $('#modal').innerHTML = `<div class="win wide"><h2>Правила</h2>
    <div class="rules" id="rules">${RULES.map((r) => `<div class="rule" style="--g:${r[1]}"><div class="rpic">${Art.art(r[0])}</div><div class="rtxt"><h3>${r[2]}</h3><p>${r[3]}</p></div></div>`).join('')}</div>
    <div class="dots" id="rdots">${RULES.map((r, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div>
    <div class="btns"><button id="rprev" class="ghost">Назад</button><button id="rnext" class="primary">Дальше</button></div></div>`;
  const el = $('#rules'), idx = () => Math.round(el.scrollLeft / el.clientWidth);
  const upd = () => { const k = idx(); [...$('#rdots').children].forEach((d, n) => d.classList.toggle('on', n === k)); $('#rnext').textContent = k === RULES.length - 1 ? 'Понятно' : 'Дальше'; };
  el.onscroll = upd;
  $('#rprev').onclick = () => el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
  $('#rnext').onclick = () => { if (idx() === RULES.length - 1) closeModal(); else el.scrollBy({ left: el.clientWidth, behavior: 'smooth' }); };
  modalFn = null;
}

/* ---------- Старт ---------- */
$$('.skyslot').forEach((s) => (s.outerHTML = skyline()));
$('#hname').value = LS.get('km_name') || '';
$('#hname').oninput = (e) => LS.set('km_name', e.target.value.trim());
$('#hcode').value = (location.hash || '').replace('#', '').toUpperCase().slice(0, 5);
$('#bcreate').onclick = () => startHost(randCode());
$('#bjoin').onclick = () => { const c = $('#hcode').value.trim().toUpperCase(); if (c.length !== 5) return toast('Код комнаты состоит из 5 символов'); startClient(c); };
$('#blocal').onclick = startLocal;
$('#bsolo').onclick = startSolo;
$('#bdemo').onclick = startDemo;
$('#brules').onclick = () => openModal(rulesModal);
(function () {
  const localRaw = LS.get('km_local_v2');
  if (localRaw) { try { const saved = JSON.parse(localRaw); if (saved.version === 2 && saved.phase !== 'over') { const b = $('#bresume'); b.classList.remove('hide'); b.textContent = 'Продолжить сохранённую игру'; b.onclick = () => { mode = 'local'; myPid = null; S = saved; S.ev = []; lastKey = ''; commit(); }; return; } } catch(e) {} }
  const last = LS.get('km_last_host'), raw = last && LS.get('km_state_' + last);
  if (!raw) return;
  let saved = null; try { saved = JSON.parse(raw); } catch (e) {}
  if (!saved || !saved.opt || saved.phase === 'over') return;
  const b = $('#bresume'); b.classList.remove('hide'); b.textContent = 'Продолжить мою комнату ' + last;
  b.onclick = () => startHost(last, saved);
})();
window.addEventListener('beforeunload', (e) => { if (mode && mode !== 'local' && V && V.phase === 'play') { e.preventDefault(); e.returnValue = ''; } });
render();

window.gameStarted = true;
if (document.getElementById("boot")) document.getElementById("boot").remove();
