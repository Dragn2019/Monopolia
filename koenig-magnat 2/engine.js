// Правила игры. Чистая логика без интерфейса: состояние + действие = новое состояние.
// Каждое действие дополнительно пишет список событий s.ev, по которым интерфейс играет анимации и звук.
(function (root) {
  const DATA = typeof module !== 'undefined' ? require('./data.js') : root.DATA;
  const { BOARD, GROUPS, CARDS, TOKENS } = DATA;
  const E = { rng: Math.random, HOUSES: 32, HOTELS: 12 };
  const rnd = (n) => Math.floor(E.rng() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const buyable = (c) => c.t === 'prop' || c.t === 'transport' || c.t === 'utility';
  const BUYABLE = BOARD.map((c, i) => (buyable(c) ? i : -1)).filter((i) => i >= 0);
  const EMO = ['😂', '😡', '🤝', '💀', '🔥', '😭', '🤑', '👏'];

  E.newGame = (hostId) => ({
    phase: 'lobby', hostId, players: [], turn: 0, step: 'roll', dice: [0, 0], doubles: 0, again: false, rolls: 0,
    owner: {}, houses: {}, mort: {}, pot: 0, ball: -1, decks: { D: [], S: [] },
    opt: { timer: 60, pot: false, ball: true },
    auction: null, trade: null, debt: null, card: null, log: [], ev: [], seq: 0, winner: null, final: null, afk: null, deadline: 0,
  });

  const P = (s, id) => s.players.find((p) => p.id === id);
  const cur = (s) => s.players[s.turn];
  const alive = (s) => s.players.filter((p) => !p.bankrupt);
  const log = (s, m) => { s.log.push(m); if (s.log.length > 80) s.log.shift(); };
  const ev = (s, e) => s.ev.push(e);
  const groupCells = (g) => BOARD.map((c, i) => (c.t === 'prop' && c.g === g ? i : -1)).filter((i) => i >= 0);
  const ownsGroup = (s, pid, g) => groupCells(g).every((i) => s.owner[i] === pid);
  const groupHouses = (s, g) => groupCells(g).map((i) => s.houses[i] || 0);
  const countType = (s, pid, t) => BOARD.filter((c, i) => c.t === t && s.owner[i] === pid).length;
  const mortVal = (i) => BOARD[i].price / 2;
  const mortFee = (i) => Math.ceil(mortVal(i) * 0.1);

  // Сколько домиков и сетей осталось в банке (по официальным правилам их 32 и 12)
  E.bank = (s) => {
    let h = 0, H = 0;
    Object.values(s.houses).forEach((n) => { if (n === 5) H++; else h += n; });
    return { houses: E.HOUSES - h, hotels: E.HOTELS - H };
  };
  E.rent = (s, i, diceSum) => {
    const c = BOARD[i], o = s.owner[i];
    if (!o || s.mort[i]) return 0;
    if (c.t === 'transport') return 25 * 2 ** (countType(s, o, 'transport') - 1);
    if (c.t === 'utility') return (countType(s, o, 'utility') === 2 ? 10 : 4) * (diceSum || 7);
    const h = s.houses[i] || 0;
    if (h) return c.rent[h];
    return ownsGroup(s, o, c.g) ? c.rent[0] * 2 : c.rent[0];
  };
  E.netWorth = (s, p) => {
    let w = p.money;
    BOARD.forEach((c, i) => {
      if (s.owner[i] !== p.id) return;
      w += s.mort[i] ? c.price / 2 : c.price;
      if (s.houses[i]) w += (s.houses[i] * GROUPS[c.g].house) / 2;
    });
    return w;
  };
  E.unmortCost = (i) => mortVal(i) + mortFee(i);
  E.actor = (s) => {
    if (s.phase !== 'play') return null;
    if (s.auction) return s.auction.order[s.auction.i];
    if (s.debt) return s.debt.pid;
    return cur(s).id;
  };
  // Ключ «чей сейчас выбор»: когда он меняется, таймер хода запускается заново
  E.turnKey = (s) => (s.phase !== 'play' ? '' : [E.actor(s), s.step, s.rolls, s.auction ? s.auction.bid + ':' + s.auction.order.length : '', s.debt ? 1 : 0].join('|'));

  function transfer(s, p, amount, to) {
    p.money -= amount;
    if (to === 'pot') { if (s.opt.pot) s.pot += amount; }
    else if (to === 'each') { const o = alive(s).filter((x) => x.id !== p.id); o.forEach((x) => (x.money += Math.floor(amount / o.length))); }
    else if (to) P(s, to).money += amount;
    ev(s, { t: 'pay', from: p.id, to: to || 'bank', amount });
  }
  function gain(s, p, amount) { p.money += amount; ev(s, { t: 'gain', pid: p.id, amount }); }
  function pay(s, p, amount, to, then) {
    if (amount <= 0) return true;
    if (p.money >= amount) { transfer(s, p, amount, to); return true; }
    s.debt = { pid: p.id, amount, to: to || null, then: then || null };
    s.step = 'debt';
    ev(s, { t: 'debt', pid: p.id });
    log(s, `${p.name} не хватает ${amount - p.money}: нужно продать, заложить или сдаться`);
    return false;
  }
  function moveTo(s, p, to, lap, mode) {
    const from = p.pos;
    ev(s, { t: 'move', pid: p.id, from, to, mode: mode || 'walk' });
    p.pos = to;
    if (lap && to < from) { log(s, `${p.name} проходит старт: +${DATA.LAP}`); ev(s, { t: 'lap', pid: p.id }); gain(s, p, DATA.LAP); }
  }
  function toJail(s, p) {
    ev(s, { t: 'move', pid: p.id, from: p.pos, to: DATA.JAIL, mode: 'jump' });
    ev(s, { t: 'jail', pid: p.id });
    p.pos = DATA.JAIL; p.jail = 1; s.again = false; s.doubles = 0;
    log(s, `${p.name} встал в пробку на Эстакадном мосту`);
  }
  function moveBall(s, not) {
    if (!s.opt.ball) { s.ball = -1; return; }
    const opts = BUYABLE.filter((i) => i !== not);
    s.ball = opts[rnd(opts.length)];
  }
  function finishMove(s) {
    if (s.phase !== 'play') return;
    const p = cur(s);
    if (p.bankrupt) return nextTurn(s);
    s.step = s.again && !p.jail ? 'roll' : 'end';
  }
  function nextTurn(s) {
    s.again = false; s.doubles = 0;
    do { s.turn = (s.turn + 1) % s.players.length; } while (cur(s).bankrupt);
    s.step = 'roll';
    ev(s, { t: 'turn', pid: cur(s).id });
  }

  function land(s, p, mult) {
    const i = p.pos, c = BOARD[i];
    if (i === s.ball) {
      log(s, `${p.name} нашёл мячик Челси: +${DATA.BALL_BONUS}`);
      ev(s, { t: 'ball', pid: p.id });
      gain(s, p, DATA.BALL_BONUS);
      moveBall(s, i);
    }
    if (buyable(c)) {
      const o = s.owner[i];
      if (!o) { s.step = 'buy'; ev(s, { t: 'offer', pid: p.id, cell: i }); return false; }
      if (o === p.id || s.mort[i]) return true;
      const r = E.rent(s, i, s.dice[0] + s.dice[1]) * (mult || 1);
      log(s, `${p.name} платит ${r} игроку ${P(s, o).name} за «${c.name}»`);
      return pay(s, p, r, o);
    }
    if (c.t === 'tax') { log(s, `${p.name}: ${c.name}, −${c.amount}`); return pay(s, p, c.amount, 'pot'); }
    if (c.t === 'gotojail') { toJail(s, p); return true; }
    if (c.t === 'parking') {
      if (s.pot > 0) { log(s, `${p.name} забирает общак с парковки: +${s.pot}`); gain(s, p, s.pot); s.pot = 0; }
      return true;
    }
    if (c.t === 'card') return drawCard(s, p, c.deck);
    return true;
  }
  function drawCard(s, p, deck) {
    if (!s.decks[deck].length) s.decks[deck] = shuffle(CARDS[deck].map((_, k) => k));
    const k = s.decks[deck].shift(), card = CARDS[deck][k], fx = card.fx;
    s.card = { deck, text: card.text, by: p.id, n: s.seq };
    ev(s, { t: 'card', deck, text: card.text, pid: p.id });
    log(s, `${p.name} тянет «${deck === 'D' ? 'Движ' : 'Сторис'}»: ${card.text}`);
    if (fx.money > 0) { gain(s, p, fx.money); return true; }
    if (fx.money < 0) return pay(s, p, -fx.money, 'pot');
    if (fx.to !== undefined) { moveTo(s, p, fx.to, true); return land(s, p); }
    if (fx.by) { moveTo(s, p, (p.pos + fx.by + 40) % 40, fx.by > 0, fx.by > 0 ? 'walk' : 'back'); return land(s, p); }
    if (fx.jail) { toJail(s, p); return true; }
    if (fx.jailCard) { p.jailCards++; return true; }
    if (fx.collectEach) {
      alive(s).forEach((x) => { if (x.id !== p.id) { const m = Math.min(x.money, fx.collectEach); x.money -= m; p.money += m; if (m) ev(s, { t: 'pay', from: x.id, to: p.id, amount: m }); } });
      return true;
    }
    if (fx.payEach) return pay(s, p, fx.payEach * (alive(s).length - 1), 'each');
    if (fx.repairs) {
      let sum = 0;
      BOARD.forEach((c, i) => { const h = s.owner[i] === p.id ? s.houses[i] || 0 : 0; sum += h === 5 ? fx.repairs[1] : h * fx.repairs[0]; });
      if (!sum) { log(s, 'Ремонтировать нечего, повезло'); return true; }
      return pay(s, p, sum, 'pot');
    }
    if (fx.nearest) {
      const hit = (i) => (fx.nearest === 'club' ? DATA.CLUBS.includes(i) : BOARD[i].t === 'transport');
      let i = p.pos; do { i = (i + 1) % 40; } while (!hit(i));
      moveTo(s, p, i, true);
      return land(s, p, 2);
    }
    if (fx.lumen) {
      const h = s.houses[DATA.LUMEN] || 0, o = s.owner[DATA.LUMEN];
      if (h && o) { delete s.houses[DATA.LUMEN]; ev(s, { t: 'fire', cell: DATA.LUMEN }); gain(s, P(s, o), h * 50); log(s, `«Люмен» сгорел: ${P(s, o).name} получает ${h * 50} страховки`); }
      else log(s, 'На «Люмене» гореть нечему, обошлось');
      return true;
    }
    if (fx.swap) {
      const o = alive(s).filter((x) => x.id !== p.id && !x.jail);
      if (o.length) {
        const x = o[rnd(o.length)], a = p.pos, b = x.pos;
        ev(s, { t: 'move', pid: p.id, from: a, to: b, mode: 'jump' }); ev(s, { t: 'move', pid: x.id, from: b, to: a, mode: 'jump' });
        p.pos = b; x.pos = a; log(s, `${p.name} и ${x.name} поменялись местами`);
      }
      return true;
    }
    if (fx.ball) { if (s.ball < 0) return true; moveTo(s, p, s.ball, true); return land(s, p); }
    return true;
  }

  function doBankrupt(s, p) {
    const d = s.debt && s.debt.pid === p.id ? s.debt : null;
    const cred = d && d.to && d.to !== 'pot' && d.to !== 'each' ? P(s, d.to) : null;
    let fee = 0;
    BOARD.forEach((c, i) => {
      if (s.owner[i] !== p.id) return;
      if (s.houses[i]) { if (cred) cred.money += (s.houses[i] * GROUPS[c.g].house) / 2; delete s.houses[i]; }
      if (cred) { s.owner[i] = cred.id; if (s.mort[i]) fee += mortFee(i); } else { delete s.owner[i]; delete s.mort[i]; }
    });
    if (cred) { cred.money += Math.max(0, p.money); cred.jailCards += p.jailCards; cred.money -= Math.min(fee, cred.money); }
    p.money = 0; p.jailCards = 0; p.bankrupt = true; p.jail = 0;
    if (d) s.debt = null;
    if (s.trade && (s.trade.from === p.id || s.trade.to === p.id)) s.trade = null;
    ev(s, { t: 'bankrupt', pid: p.id });
    log(s, `${p.name} банкрот${cred ? `, всё имущество уходит игроку ${cred.name}` : ', имущество возвращается в город'}`);
    if (alive(s).length <= 1) return endGame(s);
    if (cur(s).id === p.id) nextTurn(s);
  }
  function endGame(s) {
    s.final = s.players.map((p) => ({ id: p.id, worth: p.bankrupt ? 0 : E.netWorth(s, p) })).sort((a, b) => b.worth - a.worth);
    s.winner = s.final[0].id; s.phase = 'over'; s.auction = null; s.trade = null; s.debt = null;
    ev(s, { t: 'win', pid: s.winner });
    log(s, `Игра окончена. Победил ${P(s, s.winner).name}!`);
  }
  function endAuction(s) {
    const a = s.auction, c = BOARD[a.cell];
    if (a.bidder) {
      const w = P(s, a.bidder);
      w.money -= a.bid; s.owner[a.cell] = w.id;
      ev(s, { t: 'sold', pid: w.id, cell: a.cell, amount: a.bid });
      log(s, `${w.name} забирает «${c.name}» с аукциона за ${a.bid}`);
    } else { ev(s, { t: 'nosale', cell: a.cell }); log(s, `«${c.name}» никому не нужна`); }
    s.auction = null;
    finishMove(s);
  }
  // Комиссия за полученные заложенные клетки: 10% от залога сразу, как в официальных правилах
  const tradeFee = (list, s) => list.reduce((x, i) => x + (s.mort[i] ? mortFee(i) : 0), 0);
  function tradeErr(s, t) {
    const a = P(s, t.from), b = P(s, t.to);
    if (!a || !b || a.bankrupt || b.bankrupt || a === b) return 'Некому предлагать';
    const ok = (list, pid) => Array.isArray(list) && list.every((i) => s.owner[i] === pid && (BOARD[i].t !== 'prop' || groupHouses(s, BOARD[i].g).every((h) => !h)));
    if (!ok(t.give, a.id) || !ok(t.get, b.id)) return 'Нельзя менять клетки с постройками в группе или чужие клетки';
    if (!(t.giveMoney >= 0) || !(t.getMoney >= 0)) return 'Неверная сумма';
    if (a.money + t.getMoney < t.giveMoney + tradeFee(t.get, s) || b.money + t.giveMoney < t.getMoney + tradeFee(t.give, s)) return 'Не хватает денег на обмен (за заложенные клетки сразу платится 10% залога)';
    if (!t.give.length && !t.get.length && !t.giveMoney && !t.getMoney) return 'Пустой обмен';
    return null;
  }
  const myTurn = (s, a) => (s.phase === 'play' && cur(s).id === a.pid ? null : 'Сейчас не твой ход');
  const canManage = (s, a) => s.phase === 'play' && !s.auction && (cur(s).id === a.pid || (s.debt && s.debt.pid === a.pid));

  const H = {
    join(s, a) {
      if (s.phase !== 'lobby') return 'Игра уже идёт';
      const name = String(a.name || '').trim().slice(0, 14);
      if (!name) return 'Введи имя';
      if (!TOKENS.find((t) => t.id === a.token)) return 'Выбери фишку';
      if (s.players.find((p) => p.id !== a.pid && p.token === a.token)) return 'Эта фишка уже занята';
      if (s.players.find((p) => p.id !== a.pid && p.name.toLowerCase() === name.toLowerCase())) return 'Такое имя уже есть';
      const p = P(s, a.pid);
      if (p) { p.name = name; p.token = a.token; return; }
      if (s.players.length >= 6) return 'Комната заполнена';
      s.players.push({ id: a.pid, name, token: a.token, money: DATA.START_MONEY, pos: 0, jail: 0, jailCards: 0, bankrupt: false, on: true });
      ev(s, { t: 'join' });
    },
    leave(s, a) {
      if (s.phase !== 'lobby') return 'Игра уже идёт';
      s.players = s.players.filter((p) => p.id !== a.pid);
    },
    setOpt(s, a) {
      if (s.phase !== 'lobby' || a.pid !== s.hostId) return 'Настройки меняет создатель комнаты до начала игры';
      const o = a.opt || {};
      if ([0, 30, 60, 90, 120].includes(o.timer)) s.opt.timer = o.timer;
      if (typeof o.pot === 'boolean') s.opt.pot = o.pot;
      if (typeof o.ball === 'boolean') s.opt.ball = o.ball;
    },
    start(s, a) {
      if (s.phase !== 'lobby') return 'Игра уже идёт';
      if (a.pid !== s.hostId) return 'Начать может только создатель комнаты';
      if (s.players.length < 2) return 'Нужно минимум 2 игрока';
      shuffle(s.players);
      s.phase = 'play'; s.turn = 0; s.step = 'roll';
      moveBall(s, 0);
      ev(s, { t: 'start' }); ev(s, { t: 'turn', pid: cur(s).id });
      log(s, `Игра началась. Первым ходит ${cur(s).name}`);
    },
    roll(s, a) {
      const e = myTurn(s, a); if (e) return e;
      if (s.step !== 'roll') return 'Сейчас нельзя бросать кубики';
      const p = cur(s), d = [1 + rnd(6), 1 + rnd(6)], sum = d[0] + d[1], dbl = d[0] === d[1];
      s.dice = d; s.card = null; s.rolls++;
      ev(s, { t: 'roll', pid: p.id, d });
      log(s, `${p.name} выбрасывает ${d[0]} и ${d[1]}`);
      if (p.jail) {
        s.again = false;
        if (dbl) { p.jail = 0; log(s, `Дубль! ${p.name} выезжает из пробки`); }
        else if (p.jail >= 3) {
          p.jail = 0;
          log(s, `${p.name} стоял слишком долго и платит ${DATA.JAIL_FEE} за выезд`);
          if (!pay(s, p, DATA.JAIL_FEE, 'pot', { move: sum })) return;
        } else { p.jail++; s.step = 'end'; return; }
      } else if (dbl) {
        s.doubles++;
        if (s.doubles === 3) { log(s, 'Три дубля подряд, это уже превышение'); toJail(s, p); s.step = 'end'; return; }
        s.again = true;
      } else s.again = false;
      moveTo(s, p, (p.pos + sum) % 40, true);
      if (land(s, p)) finishMove(s);
    },
    buy(s, a) {
      const e = myTurn(s, a); if (e) return e;
      if (s.step !== 'buy') return 'Здесь нечего покупать';
      const p = cur(s), c = BOARD[p.pos];
      if (p.money < c.price) return 'Не хватает денег. Заложи что-нибудь или выставь на аукцион';
      p.money -= c.price; s.owner[p.pos] = p.id;
      ev(s, { t: 'buy', pid: p.id, cell: p.pos, amount: c.price });
      log(s, `${p.name} покупает «${c.name}» за ${c.price}`);
      finishMove(s);
    },
    pass(s, a) {
      const e = myTurn(s, a); if (e) return e;
      if (s.step !== 'buy') return 'Здесь нечего выставлять';
      const order = [];
      for (let k = 0; k < s.players.length; k++) { const p = s.players[(s.turn + k) % s.players.length]; if (!p.bankrupt) order.push(p.id); }
      s.auction = { cell: cur(s).pos, bid: 0, bidder: null, order, i: 0 };
      s.step = 'auction';
      ev(s, { t: 'auction', cell: cur(s).pos });
      log(s, `«${BOARD[cur(s).pos].name}» уходит на аукцион`);
    },
    bid(s, a) {
      const au = s.auction;
      if (!au || au.order[au.i] !== a.pid) return 'Сейчас не твоя ставка';
      const amt = Math.floor(a.amount), p = P(s, a.pid);
      if (!(amt >= au.bid + 10)) return `Минимальная ставка ${au.bid + 10}`;
      if (amt > p.money) return 'Столько у тебя нет';
      au.bid = amt; au.bidder = p.id; au.i = (au.i + 1) % au.order.length;
      ev(s, { t: 'bid', pid: p.id, amount: amt });
      log(s, `${p.name} ставит ${amt}`);
      if (au.order.length === 1) endAuction(s);
    },
    auctionPass(s, a) {
      const au = s.auction;
      if (!au || au.order[au.i] !== a.pid) return 'Сейчас не твоя ставка';
      au.order.splice(au.i, 1);
      if (au.i >= au.order.length) au.i = 0;
      ev(s, { t: 'apass', pid: a.pid });
      log(s, `${P(s, a.pid).name} пасует`);
      if (!au.order.length || (au.order.length === 1 && au.bidder === au.order[0])) endAuction(s);
    },
    build(s, a) {
      if (!canManage(s, a) || s.debt) return 'Строить можно только в свой ход';
      const i = a.cell, c = BOARD[i], p = P(s, a.pid);
      if (!c || c.t !== 'prop' || !ownsGroup(s, p.id, c.g)) return 'Сначала собери всю цветную группу';
      if (groupCells(c.g).some((k) => s.mort[k])) return 'В группе есть заложенные клетки';
      const h = s.houses[i] || 0;
      if (h >= 5) return 'Здесь уже сеть, дальше некуда';
      if (h > Math.min(...groupHouses(s, c.g))) return 'Строй равномерно по всей группе';
      const bank = E.bank(s);
      if (h < 4 && bank.houses < 1) return 'В городе кончились свободные точки: их всего 32. Жди, пока кто-нибудь продаст';
      if (h === 4 && bank.hotels < 1) return 'В городе кончились сети: их всего 12';
      const cost = GROUPS[c.g].house;
      if (p.money < cost) return 'Не хватает денег';
      p.money -= cost; s.houses[i] = h + 1;
      ev(s, { t: 'build', pid: p.id, cell: i, amount: cost });
      log(s, `${p.name} ${h === 4 ? 'открывает сеть' : 'ставит точку'} на «${c.name}»`);
    },
    sell(s, a) {
      if (!canManage(s, a)) return 'Сейчас нельзя';
      const i = a.cell, c = BOARD[i], h = s.houses[i] || 0;
      if (s.owner[i] !== a.pid || !h) return 'Здесь нечего продавать';
      if (h < Math.max(...groupHouses(s, c.g))) return 'Продавай равномерно по всей группе';
      // Сеть разбирается обратно на точки, но только на столько, сколько их есть в банке
      const to = h === 5 ? Math.min(4, E.bank(s).houses) : h - 1, back = ((h - to) * GROUPS[c.g].house) / 2;
      if (to) s.houses[i] = to; else delete s.houses[i];
      P(s, a.pid).money += back;
      ev(s, { t: 'sell', pid: a.pid, cell: i, amount: back });
      log(s, `${P(s, a.pid).name} продаёт постройку на «${c.name}» за ${back}`);
    },
    mortgage(s, a) {
      if (!canManage(s, a)) return 'Сейчас нельзя';
      const i = a.cell, c = BOARD[i];
      if (s.owner[i] !== a.pid || s.mort[i]) return 'Нельзя заложить';
      if (c.t === 'prop' && groupHouses(s, c.g).some((h) => h)) return 'Сначала продай постройки в группе';
      s.mort[i] = true; P(s, a.pid).money += mortVal(i);
      ev(s, { t: 'mortgage', pid: a.pid, cell: i, amount: mortVal(i) });
      log(s, `${P(s, a.pid).name} закладывает «${c.name}»`);
    },
    unmortgage(s, a) {
      if (!canManage(s, a)) return 'Сейчас нельзя';
      const i = a.cell, p = P(s, a.pid), cost = E.unmortCost(i);
      if (s.owner[i] !== a.pid || !s.mort[i]) return 'Клетка не заложена';
      if (p.money < cost) return 'Не хватает денег';
      p.money -= cost; delete s.mort[i];
      ev(s, { t: 'unmortgage', pid: p.id, cell: i, amount: cost });
      log(s, `${p.name} выкупает «${BOARD[i].name}»`);
    },
    payDebt(s, a) {
      const d = s.debt;
      if (!d || d.pid !== a.pid) return 'У тебя нет долга';
      const p = P(s, a.pid);
      if (p.money < d.amount) return `Нужно ещё ${d.amount - p.money}`;
      s.debt = null; transfer(s, p, d.amount, d.to);
      if (d.then && d.then.move) { moveTo(s, p, (p.pos + d.then.move) % 40, true); if (!land(s, p)) return; }
      finishMove(s);
    },
    bankrupt(s, a) {
      const p = P(s, a.pid);
      if (s.phase !== 'play' || !p || p.bankrupt) return 'Нельзя';
      if (s.auction) return 'Дождись конца аукциона';
      if (s.debt && s.debt.pid !== p.id) return 'Подожди, пока другой игрок разберётся с долгом';
      doBankrupt(s, p);
    },
    payJail(s, a) {
      const e = myTurn(s, a); if (e) return e;
      const p = cur(s);
      if (s.step !== 'roll' || !p.jail) return 'Ты не в пробке';
      if (p.money < DATA.JAIL_FEE) return 'Не хватает денег';
      transfer(s, p, DATA.JAIL_FEE, 'pot'); p.jail = 0;
      log(s, `${p.name} платит ${DATA.JAIL_FEE} и объезжает пробку`);
    },
    useJailCard(s, a) {
      const e = myTurn(s, a); if (e) return e;
      const p = cur(s);
      if (s.step !== 'roll' || !p.jail || !p.jailCards) return 'Нет карты «Объезд»';
      p.jailCards--; p.jail = 0;
      ev(s, { t: 'free', pid: p.id });
      log(s, `${p.name} использует «Объезд»`);
    },
    endTurn(s, a) {
      const e = myTurn(s, a); if (e) return e;
      if (s.step !== 'end') return 'Ход ещё не закончен';
      nextTurn(s);
    },
    proposeTrade(s, a) {
      if (s.phase !== 'play') return 'Игра не идёт';
      if (s.trade) return 'Сначала закончите текущий обмен';
      if (s.auction) return 'Дождись конца аукциона';
      const t = { from: a.pid, to: a.to, give: a.give || [], get: a.get || [], giveMoney: Math.floor(a.giveMoney || 0), getMoney: Math.floor(a.getMoney || 0), n: s.seq };
      const e = tradeErr(s, t); if (e) return e;
      s.trade = t;
      ev(s, { t: 'trade', from: t.from, to: t.to });
      log(s, `${P(s, t.from).name} предлагает обмен игроку ${P(s, t.to).name}`);
    },
    acceptTrade(s, a) {
      const t = s.trade;
      if (!t || t.to !== a.pid) return 'Нет предложения';
      const e = tradeErr(s, t); if (e) { s.trade = null; return; }
      const x = P(s, t.from), y = P(s, t.to);
      x.money += t.getMoney - t.giveMoney - tradeFee(t.get, s); y.money += t.giveMoney - t.getMoney - tradeFee(t.give, s);
      t.give.forEach((i) => (s.owner[i] = y.id)); t.get.forEach((i) => (s.owner[i] = x.id));
      s.trade = null;
      ev(s, { t: 'deal', from: x.id, to: y.id });
      log(s, `${x.name} и ${y.name} ударили по рукам`);
    },
    rejectTrade(s, a) {
      const t = s.trade;
      if (!t || (t.to !== a.pid && t.from !== a.pid && a.pid !== s.hostId)) return 'Нет предложения';
      s.trade = null;
      ev(s, { t: 'nodeal' });
      log(s, a.pid === t.to ? `${P(s, t.to).name} отказался от обмена` : 'Обмен отменён');
    },
    chat(s, a) {
      const p = P(s, a.pid), text = String(a.text || '').trim().slice(0, 140);
      if (!p || !text) return 'Пустое сообщение';
      log(s, { c: p.id, t: text });
      ev(s, { t: 'chat', pid: p.id, text });
    },
    emo(s, a) {
      if (!P(s, a.pid) || !EMO.includes(a.e)) return 'Нет такой эмоции';
      ev(s, { t: 'emo', pid: a.pid, e: a.e });
    },
    finishGame(s, a) {
      if (s.phase !== 'play' || a.pid !== s.hostId) return 'Завершить может только создатель комнаты';
      endGame(s);
    },
    hostSkip(s, a) {
      if (s.phase !== 'play' || a.pid !== s.hostId) return 'Только создатель комнаты';
      log(s, `Ход игрока ${cur(s).name} пропущен`);
      if (s.debt) return void doBankrupt(s, P(s, s.debt.pid));
      s.auction = null; nextTurn(s);
    },
    // Время вышло: игра сама делает ход за игрока. Кубики бросаются, от покупки отказ с аукционом, ставка = пас
    timeout(s, a) {
      if (s.phase !== 'play' || a.pid !== s.hostId) return 'Только создатель комнаты';
      const id = E.actor(s), p = P(s, id);
      s.afk = id;
      ev(s, { t: 'timeout', pid: id });
      if (s.auction) return H.auctionPass(s, { pid: id });
      if (s.debt) {
        for (let guard = 0; guard < 200 && s.debt && p.money < s.debt.amount; guard++) {
          const mine = BOARD.map((c, i) => i).filter((i) => s.owner[i] === id);
          const sold = mine.filter((i) => s.houses[i]).some((i) => !H.sell(s, { pid: id, cell: i }));
          if (sold) continue;
          if (!mine.filter((i) => !s.mort[i]).some((i) => !H.mortgage(s, { pid: id, cell: i }))) break;
        }
        return s.debt && p.money >= s.debt.amount ? H.payDebt(s, { pid: id }) : H.bankrupt(s, { pid: id });
      }
      if (s.step === 'roll') return H.roll(s, { pid: id });
      if (s.step === 'buy') return H.pass(s, { pid: id });
      return H.endTurn(s, { pid: id });
    },
  };

  E.apply = (s, a) => {
    const h = H[a.type];
    if (!h) return 'Неизвестное действие';
    s.ev = [];
    const err = h(s, a);
    if (err) return err;
    if (s.afk && a.pid === s.afk && a.type !== 'timeout' && a.type !== 'chat' && a.type !== 'emo') s.afk = null;
    s.seq++;
    return null;
  };
  E.groupCells = groupCells; E.ownsGroup = ownsGroup; E.buyable = buyable; E.EMO = EMO; E.mortFee = mortFee;
  if (typeof module !== 'undefined') module.exports = E;
  root.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
