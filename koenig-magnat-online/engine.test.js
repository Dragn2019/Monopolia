const assert = require('node:assert/strict');
const E = require('./engine.js'), D = require('./data.js');
let tests=0;
function test(name, fn){fn(); console.log('✓ '+name); tests++;}
function game(n=3){const s=E.newGame('host'); for(let i=0;i<n;i++)assert.equal(E.apply(s,{type:'join',pid:'p'+i,name:'Игрок '+i,token:D.TOKENS[i].id}),null); s.solo=n===1; assert.equal(E.apply(s,{type:'start',pid:'host'}),null);s.opt.ball=false;return s;}
function act(s,type,extra={}){const a={type,pid:E.actor(s),...extra};assert.equal(E.apply(s,a),null,JSON.stringify(a));}
function auction(n=3){const s=game(n);s.players[s.turn].pos=3;s.step='buy';const excluded=E.actor(s);act(s,'pass');return {s,excluded};}
test('Dollar scale and classic group counts',()=>{assert.equal(D.money(1500).replace(/\s/g,''),'$150000');assert.deepEqual(D.GROUPS.map((_,g)=>E.groupCells(g).length),[2,3,3,3,3,3,3,2]);});
test('Solo: chosen dice, purchase, next turn, no auto-win',()=>{const s=game(1);act(s,'roll',{dice:[1,2]});assert.equal(s.players[0].pos,3);act(s,'buy');assert.equal(s.owner[3],s.players[0].id);assert.equal(s.phase,'play');assert.equal(s.step,'roll');});
test('Chosen dice rejected outside solo and on invalid input',()=>{const s=game();assert.ok(E.apply(s,{type:'roll',pid:E.actor(s),dice:[1,2]}));const t=game(1);assert.ok(E.apply(t,{type:'roll',pid:E.actor(t),dice:[0,7]}));});
test('Solo auction has no bidders and closes',()=>{const {s}=auction(1);assert.equal(s.auction,null);assert.equal(s.step,'roll');assert.equal(s.owner[3],undefined);});
test('Auction excludes initiator, starts at price and enforces exact step',()=>{const {s,excluded}=auction();assert.ok(!s.auction.order.includes(excluded));assert.ok(E.apply(s,{type:'bid',pid:excluded,amount:80}));assert.ok(E.apply(s,{type:'bid',pid:E.actor(s),amount:20}));act(s,'bid',{amount:80});assert.ok(E.apply(s,{type:'bid',pid:E.actor(s),amount:120}));act(s,'bid',{amount:100});const winner=s.auction.bidder;act(s,'auctionPass');assert.equal(s.auction,null);assert.equal(s.owner[3],winner);assert.equal(s.players.find(p=>p.id===winner).money,1400);});
test('Everyone passes, property remains unowned',()=>{const {s}=auction();while(s.auction)act(s,'auctionPass');assert.equal(s.owner[3],undefined);});
test('Single eligible bidder must bid the list price',()=>{const {s}=auction(2);act(s,'bid',{amount:80});assert.equal(s.auction,null);assert.ok(s.owner[3]);});
test('Buildings require whole group and even building/selling',()=>{const s=game(1),pid=E.actor(s);s.owner[1]=pid;assert.ok(E.apply(s,{type:'build',pid,cell:1}));s.owner[3]=pid;act(s,'build',{cell:1});assert.ok(E.apply(s,{type:'build',pid,cell:1}));act(s,'build',{cell:3});act(s,'build',{cell:1});assert.ok(E.apply(s,{type:'sell',pid,cell:3}));act(s,'sell',{cell:1});assert.equal(s.houses[1],1);assert.equal(s.houses[3],1);});
test('Mortgage blocks group building and produces zero rent',()=>{const s=game(1),pid=E.actor(s);s.owner[1]=s.owner[3]=pid;act(s,'mortgage',{cell:3});assert.equal(E.rent(s,3,7),0);assert.ok(E.apply(s,{type:'build',pid,cell:1}));act(s,'unmortgage',{cell:3});act(s,'build',{cell:1});assert.ok(E.apply(s,{type:'mortgage',pid,cell:3}));});
test('Card text remains in shared history and effects apply',()=>{const s=game(1);s.decks.S=[0];act(s,'roll',{dice:[1,1]});const c=s.log.find(x=>x.kind==='card');assert.equal(c.t,D.CARDS.S[0].text);assert.ok(c.t.includes('$'));assert.equal(s.players[0].money,1460);assert.ok(s.log.some(x=>typeof x==='string'&&x.includes('Баланс')));});
test('Save roundtrip preserves board and next actor',()=>{const s=game(1);act(s,'roll',{dice:[1,2]});act(s,'buy');const saved=JSON.parse(JSON.stringify(s));assert.equal(saved.owner[3],saved.players[0].id);assert.equal(saved.step,'roll');});
test('Police sends token to jail',()=>{const s=game(1);s.players[0].pos=27;act(s,'roll',{dice:[1,2]});assert.equal(s.players[0].pos,10);assert.equal(s.players[0].jail,1);});
test('Trade transfers selected properties and money',()=>{const s=game(2),from=E.actor(s),to=s.players.find(p=>p.id!==from).id;s.owner[1]=from;s.owner[3]=to;act(s,'proposeTrade',{to,give:[1],get:[3],giveMoney:20,getMoney:0});act(s,'acceptTrade',{pid:to});assert.equal(s.owner[1],to);assert.equal(s.owner[3],from);assert.equal(s.players.find(p=>p.id===from).money,1480);});
test('Rent requires payment even with sufficient funds and then advances',()=>{const s=game(2),payer=E.actor(s),owner=s.players.find(p=>p.id!==payer).id;s.owner[3]=owner;s.players[s.turn].pos=0;let dice=[0,.2];E.rng=()=>dice.shift()??0;act(s,'roll');assert.equal(s.step,'debt');assert.equal(E.actor(s),payer);assert.equal(s.players.find(p=>p.id===payer).money,1500);act(s,'payDebt');assert.equal(s.players.find(p=>p.id===payer).money,1496);assert.equal(E.actor(s),owner);assert.equal(s.step,'roll');E.rng=Math.random;});
test('Trade rejected outside current turn',()=>{const s=game(2),other=s.players.find(p=>p.id!==E.actor(s)).id;assert.ok(E.apply(s,{type:'proposeTrade',pid:other,to:E.actor(s),giveMoney:10}));});
test('Utility rent independent of dice',()=>{const s=game(2);s.owner[12]=s.players[1].id;assert.equal(E.rent(s,12,2),15);assert.equal(E.rent(s,12,12),15);});

// ---- Пожар ----
const FIRE = D.CARDS.D.findIndex(c => c.fx.fire), DCELL = D.BOARD.findIndex(c => c.t === 'card' && c.deck === 'D');
function fireGameSolo(m) { const s = game(3); s.solo = true; const drawer = E.actor(s), owner = s.players.find(p => p.id !== drawer); const cells = E.groupCells(D.BOARD[1].g); cells.forEach(i => { s.owner[i] = owner.id; s.houses[i] = 2; }); s.owner[5] = owner.id; if (m !== undefined) owner.money = m; s.decks.D = [FIRE]; s.players[s.turn].pos = (DCELL - 3 + 40) % 40; act(s, 'roll', { dice: [1, 2] }); return { s, drawer, owner, cells }; }
test('Fire with no buildings anywhere does nothing and turn moves on', () => {
  const s = game(2); s.solo = true; s.decks.D = [FIRE]; s.players[s.turn].pos = (DCELL - 3 + 40) % 40; const first = E.actor(s);
  act(s, 'roll', { dice: [1, 2] }); assert.equal(s.fire, null); assert.notEqual(E.actor(s), first);
});
test('Fire hits a built property and the owner decides', () => {
  const { s, owner, cells } = fireGameSolo();
  assert.ok(s.fire); assert.equal(E.actor(s), owner.id); assert.ok(cells.includes(s.fire.cell));
});
test('Owner saves for $30 000 and keeps buildings', () => {
  const { s, owner, drawer } = fireGameSolo(); const cell = s.fire.cell, before = owner.money;
  act(s, 'fireSave'); assert.equal(owner.money, before - D.FIRE_COST); assert.equal(s.houses[cell], 2); assert.equal(s.owner[cell], owner.id); assert.equal(s.fire, null); assert.notEqual(E.actor(s), drawer);
});
test('Owner refuses: buildings demolished, property back to bank, group frozen', () => {
  const { s, owner, cells } = fireGameSolo(); const cell = s.fire.cell, other = cells.find(i => i !== cell);
  act(s, 'fireGiveUp'); assert.equal(s.owner[cell], undefined); assert.equal(s.houses[cell], undefined); assert.equal(s.houses[other], 2);
  assert.ok(E.apply(s, { type: 'build', pid: owner.id, cell: other }));
});
test('Not enough money: must raise it by mortgaging, then can save', () => {
  const { s, owner } = fireGameSolo(100); assert.ok(E.apply(s, { type: 'fireSave', pid: owner.id }));
  act(s, 'mortgage', { cell: 5 }); assert.equal(owner.money, 200); assert.ok(E.apply(s, { type: 'fireSave', pid: owner.id }));
  owner.money = 300; act(s, 'fireSave'); assert.equal(s.fire, null);
});
test('While fire is pending others cannot act', () => {
  const { s, drawer } = fireGameSolo(); assert.ok(E.apply(s, { type: 'proposeTrade', pid: drawer, to: s.fire.pid, giveMoney: 10 })); assert.ok(E.apply(s, { type: 'roll', pid: drawer }));
});
test('Timeout: saves when affordable, otherwise the property burns', () => {
  const a = fireGameSolo(); const ca = a.s.fire.cell; assert.equal(E.apply(a.s, { type: 'timeout', pid: 'host' }), null); assert.equal(a.s.owner[ca], a.owner.id);
  const b = fireGameSolo(50); const cb = b.s.fire.cell; assert.equal(E.apply(b.s, { type: 'timeout', pid: 'host' }), null); assert.equal(b.s.owner[cb], undefined);
});
console.log(`${tests} checks passed`);
