const assert = require('node:assert/strict');
const E = require('./engine.js'), D = require('./data.js');
let tests=0;
function test(name, fn){fn(); console.log('✓ '+name); tests++;}
function game(n=3){const s=E.newGame('host'); for(let i=0;i<n;i++)assert.equal(E.apply(s,{type:'join',pid:'p'+i,name:'Игрок '+i,token:D.TOKENS[i].id}),null); s.solo=n===1; assert.equal(E.apply(s,{type:'start',pid:'host'}),null);s.opt.ball=false;return s;}
function act(s,type,extra={}){const a={type,pid:E.actor(s),...extra};assert.equal(E.apply(s,a),null,JSON.stringify(a));}
function auction(n=3){const s=game(n);s.players[s.turn].pos=3;s.step='buy';const excluded=E.actor(s);act(s,'pass');return {s,excluded};}
test('Dollar scale and classic group counts',()=>{assert.equal(D.money(1500),'$15,000k');assert.equal(D.money(25),'$250k');assert.equal(D.money(6),'$60k');assert.deepEqual(D.GROUPS.map((_,g)=>E.groupCells(g).length),[2,3,3,3,3,3,3,2]);});
test('Solo: chosen dice, purchase, next turn, no auto-win',()=>{const s=game(1);act(s,'roll',{dice:[1,2]});assert.equal(s.players[0].pos,3);act(s,'buy');assert.equal(s.owner[3],s.players[0].id);assert.equal(s.phase,'play');assert.equal(s.step,'roll');});
test('Chosen dice rejected outside solo and on invalid input',()=>{const s=game();assert.ok(E.apply(s,{type:'roll',pid:E.actor(s),dice:[1,2]}));const t=game(1);assert.ok(E.apply(t,{type:'roll',pid:E.actor(t),dice:[0,7]}));});
test('Solo auction has no bidders and closes',()=>{const {s}=auction(1);assert.equal(s.auction,null);assert.equal(s.step,'roll');assert.equal(s.owner[3],undefined);});
test('Auction excludes initiator, starts at price and enforces exact step',()=>{const {s,excluded}=auction();assert.ok(!s.auction.order.includes(excluded));assert.ok(E.apply(s,{type:'bid',pid:excluded,amount:60}));assert.ok(E.apply(s,{type:'bid',pid:E.actor(s),amount:20}));act(s,'bid',{amount:60});assert.ok(E.apply(s,{type:'bid',pid:E.actor(s),amount:100}));act(s,'bid',{amount:80});const winner=s.auction.bidder;act(s,'auctionPass');assert.equal(s.auction,null);assert.equal(s.owner[3],winner);assert.equal(s.players.find(p=>p.id===winner).money,1420);});
test('Everyone passes, property remains unowned',()=>{const {s}=auction();while(s.auction)act(s,'auctionPass');assert.equal(s.owner[3],undefined);});
test('Single eligible bidder must bid the list price',()=>{const {s}=auction(2);act(s,'bid',{amount:60});assert.equal(s.auction,null);assert.ok(s.owner[3]);});
test('Buildings require whole group and even building/selling',()=>{const s=game(1),pid=E.actor(s);s.owner[1]=pid;assert.ok(E.apply(s,{type:'build',pid,cell:1}));s.owner[3]=pid;act(s,'build',{cell:1});s.built={};assert.ok(E.apply(s,{type:'build',pid,cell:1}));act(s,'build',{cell:3});s.built={};act(s,'build',{cell:1});assert.ok(E.apply(s,{type:'sell',pid,cell:3}));act(s,'sell',{cell:1});assert.equal(s.houses[1],1);assert.equal(s.houses[3],1);});
test('Mortgage blocks group building and produces zero rent',()=>{const s=game(1),pid=E.actor(s);s.owner[1]=s.owner[3]=pid;act(s,'mortgage',{cell:3});assert.equal(E.rent(s,3,7),0);assert.ok(E.apply(s,{type:'build',pid,cell:1}));act(s,'unmortgage',{cell:3});act(s,'build',{cell:1});assert.ok(E.apply(s,{type:'mortgage',pid,cell:3}));});
test('Card text remains in shared history and effects apply',()=>{const s=game(1);s.decks.S=[0];act(s,'roll',{dice:[1,1]});const c=s.log.find(x=>x.kind==='card');assert.equal(c.t,D.CARDS.S[0].text);assert.ok(c.t.includes('$'));assert.equal(s.players[0].money,1460);assert.ok(!s.log.some(x=>typeof x==='string'&&x.includes('Баланс')));});
test('Save roundtrip preserves board and next actor',()=>{const s=game(1);act(s,'roll',{dice:[1,2]});act(s,'buy');const saved=JSON.parse(JSON.stringify(s));assert.equal(saved.owner[3],saved.players[0].id);assert.equal(saved.step,'roll');});
test('Police sends token to jail',()=>{const s=game(1);s.players[0].pos=27;act(s,'roll',{dice:[1,2]});assert.equal(s.players[0].pos,10);assert.equal(s.players[0].jail,1);});
test('Trade transfers selected properties and money',()=>{const s=game(2),from=E.actor(s),to=s.players.find(p=>p.id!==from).id;s.owner[1]=from;s.owner[3]=to;act(s,'proposeTrade',{to,give:[1],get:[3],giveMoney:20,getMoney:0});act(s,'acceptTrade',{pid:to});assert.equal(s.owner[1],to);assert.equal(s.owner[3],from);assert.equal(s.players.find(p=>p.id===from).money,1480);});
test('Rent requires payment even with sufficient funds and then advances',()=>{const s=game(2),payer=E.actor(s),owner=s.players.find(p=>p.id!==payer).id;s.owner[3]=owner;s.players[s.turn].pos=0;let dice=[0,.2];E.rng=()=>dice.shift()??0;act(s,'roll');assert.equal(s.step,'debt');assert.equal(E.actor(s),payer);assert.equal(s.players.find(p=>p.id===payer).money,1500);act(s,'payDebt');assert.equal(s.players.find(p=>p.id===payer).money,1496);assert.equal(E.actor(s),owner);assert.equal(s.step,'roll');E.rng=Math.random;});
test('Trade rejected outside current turn',()=>{const s=game(2),other=s.players.find(p=>p.id!==E.actor(s)).id;assert.ok(E.apply(s,{type:'proposeTrade',pid:other,to:E.actor(s),giveMoney:10}));});

// ---- Пожар ----
const FIRE = D.CARDS.D.findIndex(c => c.fx.fire), DCELL = D.BOARD.findIndex(c => c.t === 'card' && c.deck === 'D');
function fireGameSolo(m) { const s = game(3); s.solo = true; const drawer = E.actor(s), owner = s.players.find(p => p.id === drawer); const cells = E.groupCells(D.BOARD[1].g); cells.forEach(i => { s.owner[i] = owner.id; s.houses[i] = 2; }); if (m !== undefined) owner.money = m; s.decks.D = [FIRE]; s.players[s.turn].pos = (DCELL - 3 + 40) % 40; act(s, 'roll', { dice: [1, 2] }); return { s, drawer, owner, cells }; }
test('Fire with no buildings anywhere does nothing and turn moves on', () => {
  const s = game(2); s.solo = true; s.decks.D = [FIRE]; s.players[s.turn].pos = (DCELL - 3 + 40) % 40; const first = E.actor(s);
  act(s, 'roll', { dice: [1, 2] }); assert.equal(s.fire, null); assert.notEqual(E.actor(s), first);
});
test('Fire hits a built property and the owner decides', () => {
  const { s, owner, cells } = fireGameSolo();
  assert.ok(s.fire); assert.equal(E.actor(s), owner.id); assert.ok(cells.includes(s.fire.cell));
});
test('Owner saves for 80% of the value (min FIRE_COST) and keeps buildings', () => {
  const { s, owner, drawer } = fireGameSolo(); const cell = s.fire.cell, before = owner.money, cost = s.fire.cost;
  assert.equal(cost, Math.max(D.FIRE_COST, Math.round((D.BOARD[cell].price + 2 * D.GROUPS[D.BOARD[cell].g].house) * 0.8 / 10) * 10));
  act(s, 'fireSave'); assert.equal(owner.money, before - cost); assert.equal(s.houses[cell], 2); assert.equal(s.owner[cell], owner.id); assert.equal(s.fire, null); assert.notEqual(E.actor(s), drawer);
});
test('Owner refuses: buildings demolished, group houses sold back, property back to bank', () => {
  const { s, owner, cells } = fireGameSolo(); const cell = s.fire.cell, other = cells.find(i => i !== cell);
  const m = owner.money; act(s, 'fireGiveUp'); assert.equal(s.owner[cell], undefined); assert.equal(s.houses[cell], undefined); assert.ok(!s.houses[other]); assert.equal(owner.money, m + 2 * D.GROUPS[D.BOARD[other].g].house * D.SELL_RATE);
  assert.ok(E.apply(s, { type: 'build', pid: owner.id, cell: other }));
});
test('Not enough money: must raise it by mortgaging, then can save', () => {
  const { s, owner } = fireGameSolo(210); s.owner[5] = owner.id; assert.ok(E.apply(s, { type: 'fireSave', pid: owner.id }));
  act(s, 'mortgage', { cell: 5 }); assert.equal(owner.money, 310); act(s, 'fireSave'); assert.equal(s.fire, null);
});
test('While fire is pending others cannot act', () => {
  const { s, drawer } = fireGameSolo(); const other = s.players.find(p => p.id !== drawer).id; assert.ok(E.apply(s, { type: 'proposeTrade', pid: other, to: drawer, giveMoney: 10 })); assert.ok(E.apply(s, { type: 'roll', pid: other })); assert.ok(E.apply(s, { type: 'roll', pid: drawer }));
});
test('Timeout: saves when affordable, otherwise the property burns', () => {
  const a = fireGameSolo(); const ca = a.s.fire.cell; assert.equal(E.apply(a.s, { type: 'timeout', pid: 'host' }), null); assert.equal(a.s.owner[ca], a.owner.id);
  const b = fireGameSolo(20); const cb = b.s.fire.cell; assert.equal(E.apply(b.s, { type: 'timeout', pid: 'host' }), null); assert.equal(b.s.owner[cb], undefined);
});
test('Trade: only before rolling, sides within 50%, no mortgage fee',()=>{
  const s=game(2),from=E.actor(s),to=s.players.find(p=>p.id!==from).id; s.owner[1]=from; s.owner[39]=to; s.owner[3]=to; s.mort[3]=true;
  assert.ok(E.apply(s,{type:'proposeTrade',pid:from,to,give:[1],get:[39]}),'too uneven');
  assert.ok(E.apply(s,{type:'proposeTrade',pid:from,to,giveMoney:10}),'gift blocked');
  const m=s.players.find(p=>p.id===from).money; act(s,'proposeTrade',{to,give:[1],get:[3]}); act(s,'acceptTrade',{pid:to}); assert.equal(s.owner[3],from); assert.equal(s.players.find(p=>p.id===from).money,m);
  s.step='buy'; assert.ok(E.apply(s,{type:'proposeTrade',pid:from,to,give:[3],get:[1]}),'after roll');
});
test('One house per colour group per turn',()=>{
  const s=game(2),me=E.actor(s); E.groupCells(1).forEach(i=>s.owner[i]=me); const [x,y]=E.groupCells(1);
  act(s,'build',{cell:x}); assert.ok(E.apply(s,{type:'build',pid:me,cell:y}),'second house same group');
});
test('Taxi: pay, get random cells, ride to one of them',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; p.pos=15; act(s,'roll',{dice:[2,3]}); assert.equal(s.step,'taxi');
  const m=p.money; act(s,'taxiBuy',{n:3}); assert.equal(s.taxi.cells.length,3); assert.equal(p.money,m-80);
  s.taxi.cells[0]=39; const to=39; act(s,'taxiGo',{cell:to}); assert.equal(s.step,'buy'); assert.equal(p.pos,to); assert.equal(s.taxi,null);
  const s2=game(2),p2=s2.players[s2.turn]; s2.solo=true; p2.pos=15; act(s2,'roll',{dice:[2,3]}); act(s2,'taxiStay'); assert.equal(p2.pos,20); assert.notEqual(E.actor(s2),p2.id);
});
test('Utilities: dice x4, both owned x10',()=>{
  const s=game(2),o=s.players[0].id,u=DATA.BOARD.map((c,i)=>i).filter(i=>DATA.BOARD[i].t==='utility');
  s.owner[u[0]]=o; assert.equal(E.rent(s,u[0],9),36); s.owner[u[1]]=o; assert.equal(E.rent(s,u[0],9),90);
});
test('Mortgage returns to bank after 15 own turns',()=>{
  const s=game(2),p=s.players[s.turn]; s.owner[1]=p.id; act(s,'mortgage',{cell:1}); assert.equal(s.mortT[1],15);
  for(let k=0;k<14;k++){ s.turn=s.players.indexOf(p); s.step='end'; act(s,'endTurn'); }
  assert.equal(s.mortT[1],1); assert.equal(s.owner[1],p.id);
  s.turn=s.players.indexOf(p); s.step='end'; act(s,'endTurn'); assert.equal(s.owner[1],undefined); assert.ok(!s.mort[1]);
});
test('Landing exactly on Start pays double',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; p.pos=35; const m=p.money; act(s,'roll',{dice:[2,3]}); assert.equal(p.pos,0); assert.equal(p.money,m+D.LAP_EXACT);
  const s2=game(2),p2=s2.players[s2.turn]; s2.solo=true; p2.pos=35; const m2=p2.money; act(s2,'roll',{dice:[3,4]}); assert.equal(p2.pos,2); assert.ok(p2.money>=m2+200-200);
});
const drawFx=(s,deck,pred)=>{s.decks[deck]=[D.CARDS[deck].findIndex(pred)];};
test('Repair card closes own cell for 3 own turns, no rent',()=>{
  const s=game(2),p=s.players[s.turn],o=s.players.find(x=>x!==p); s.solo=true; s.owner[39]=p.id; p.pos=0;
  drawFx(s,'S',c=>c.fx.repair); act(s,'roll',{dice:[1,1]}); assert.equal(s.closed[39].left,3); assert.equal(E.rent(s,39,7),0);
  for(let k=0;k<3;k++){ s.turn=s.players.indexOf(p); s.step='end'; s.debt=null; s.card=null; act(s,'endTurn'); }
  assert.ok(!s.closed[39]); assert.ok(E.rent(s,39,7)>0);
});
test('Inspection closes a cell of the richest player',()=>{
  const s=game(2),p=s.players[s.turn],o=s.players.find(x=>x!==p); s.solo=true; s.owner[37]=o.id; o.money=5000; p.pos=0;
  drawFx(s,'S',c=>c.fx.check); act(s,'roll',{dice:[1,1]}); assert.equal(s.closed[37].kind,'check');
});
test('Half-price house, skip turn',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; p.pos=0; drawFx(s,'S',c=>c.fx.halfHouse); act(s,'roll',{dice:[1,1]}); assert.ok(p.halfHouse);
  E.groupCells(1).forEach(i=>s.owner[i]=p.id); const m=p.money; s.step='roll'; s.card=null; act(s,'build',{cell:E.groupCells(1)[0]}); assert.equal(m-p.money,DATA.GROUPS[1].house/2); assert.ok(!p.halfHouse);
  const s2=game(3),a=s2.players[s2.turn],b=s2.players[(s2.turn+1)%3],c=s2.players[(s2.turn+2)%3]; b.skip=1; s2.step='end'; act(s2,'endTurn'); assert.equal(E.actor(s2),c.id); assert.ok(!b.skip);
});
test('Drunk swap only with the lobby option',()=>{
  const s=game(2); s.decks.S=[]; const p=s.players[s.turn]; s.solo=true; p.pos=0; s.opt.drunk=false;
  act(s,'roll',{dice:[1,1]}); assert.ok(!s.decks.S.concat([]).some(k=>D.CARDS.S[k].fx.drunk));
  const s2=game(2),a=s2.players[s2.turn],b=s2.players.find(x=>x!==a); s2.solo=true; s2.opt.drunk=true; s2.owner[39]=a.id; s2.owner[5]=b.id; a.pos=0;
  drawFx(s2,'S',c=>c.fx.drunk); act(s2,'roll',{dice:[1,1]}); assert.equal(s2.owner[39],b.id); assert.equal(s2.owner[5],a.id);
});
test('Fire can hit an unbuilt plot: half its price to save',()=>{
  const s=game(2); s.solo=true; const o=s.players.find(p=>p.id===E.actor(s)); s.owner[39]=o.id; s.decks.D=[FIRE]; s.players[s.turn].pos=(DCELL-3+40)%40;
  act(s,'roll',{dice:[1,2]}); assert.equal(s.fire.cell,39); assert.equal(s.fire.cost,Math.max(D.FIRE_COST,Math.round(D.BOARD[39].price*0.8/10)*10));
});
test('Start pays only the first PAID_LAPS laps',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; p.laps=D.PAID_LAPS; p.pos=38; s.ball=-1; const m=p.money; act(s,'roll',{dice:[1,2]}); assert.equal(p.laps,D.PAID_LAPS+1); assert.equal(p.money,m);
});
test('After a double you may build again in the same group',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; E.groupCells(1).forEach(i=>s.owner[i]=p.id); const [x,y]=E.groupCells(1);
  act(s,'build',{cell:x}); assert.ok(E.apply(s,{type:'build',pid:p.id,cell:y}));
  p.pos=6; act(s,'roll',{dice:[2,2]}); assert.equal(p.pos,10); assert.equal(s.step,'roll'); assert.equal(E.actor(s),p.id);
  act(s,'build',{cell:y}); assert.equal(s.houses[y],1); assert.ok(E.apply(s,{type:'build',pid:p.id,cell:x}),'still one per group per move');
});
test('Third jail turn: pay the fine even on a double',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; p.jail=3; p.pos=10; s.ball=-1; const m=p.money; act(s,'roll',{dice:[3,3]});
  if(s.debt) act(s,'payDebt'); assert.equal(p.jail,0); assert.equal(p.money<=m-D.JAIL_FEE||p.pos===16,true); assert.equal(p.pos,16); assert.ok(!s.again);
});
test('Fire never hits other players',()=>{
  const s=game(2); s.solo=true; const other=s.players.find(p=>p.id!==E.actor(s)); s.owner[39]=other.id; s.houses[39]=0; s.decks.D=[FIRE]; s.players[s.turn].pos=(DCELL-3+40)%40;
  act(s,'roll',{dice:[1,2]}); assert.equal(s.fire,null); assert.equal(s.owner[39],other.id);
});
test('Taxi through Start pays the lap money',()=>{
  const s=game(2),p=s.players[s.turn]; s.solo=true; s.ball=-1; p.pos=15; act(s,'roll',{dice:[2,3]}); act(s,'taxiBuy',{n:1}); s.taxi.cells=[3]; const m=p.money; act(s,'taxiGo',{cell:3}); assert.equal(p.pos,3); assert.equal(p.money,m+D.LAP);
});
test('Surrender: all fields become empty and free',()=>{
  const s=game(3),p=s.players[s.turn]; E.groupCells(1).forEach(i=>{s.owner[i]=p.id;s.houses[i]=2;}); s.owner[5]=p.id; s.mort[5]=true;
  act(s,'bankrupt'); assert.ok(p.bankrupt); [...E.groupCells(1),5].forEach(i=>{assert.equal(s.owner[i],undefined);assert.ok(!s.houses[i]);assert.ok(!s.mort[i]);});
});

// ---- Режим 2×2 ----
function teamGame(pair=0){const s=E.newGame('host');for(let i=0;i<4;i++)assert.equal(E.apply(s,{type:'join',pid:'p'+i,name:'Игрок '+i,token:D.TOKENS[i].id}),null);assert.equal(E.apply(s,{type:'setOpt',pid:'host',opt:{teams:true,pair}}),null);return s;}
test('2x2 needs exactly 4 players and pairs teams by choice',()=>{
  const s=E.newGame('host');for(let i=0;i<3;i++)E.apply(s,{type:'join',pid:'p'+i,name:'И'+i,token:D.TOKENS[i].id});E.apply(s,{type:'setOpt',pid:'host',opt:{teams:true}});
  assert.ok(E.apply(s,{type:'start',pid:'host'}));
  const t=teamGame(1);assert.equal(E.apply(t,{type:'start',pid:'host'}),null);
  assert.ok(E.mate(t,'p0','p2'));assert.ok(E.mate(t,'p1','p3'));assert.ok(!E.mate(t,'p0','p1'));
  // Очерёдность: команды чередуются
  assert.notEqual(t.team[t.players[0].id],t.team[t.players[1].id]);assert.equal(t.team[t.players[0].id],t.team[t.players[2].id]);
});
test('2x2: no rent on teammate field, rent on opponent field',()=>{
  const s=teamGame(0);E.apply(s,{type:'start',pid:'host'});const p=s.players[s.turn],mate=s.players.find(x=>x!==p&&E.mate(s,p.id,x.id)),opp=s.players.find(x=>x!==p&&!E.mate(s,p.id,x.id));
  s.solo=true;s.ball=-1;s.owner[3]=mate.id;p.pos=0;const m=p.money;act(s,'roll',{dice:[1,2]});
  assert.equal(s.debt,null);assert.equal(p.money,m);
  const s2=teamGame(0);E.apply(s2,{type:'start',pid:'host'});const q=s2.players[s2.turn],o2=s2.players.find(x=>x!==q&&!E.mate(s2,q.id,x.id));
  s2.solo=true;s2.ball=-1;s2.owner[3]=o2.id;q.pos=0;act(s2,'roll',{dice:[1,2]});assert.ok(s2.debt&&s2.debt.to===o2.id);
});
test('2x2: unequal trade allowed with teammate only',()=>{
  const s=teamGame(0);E.apply(s,{type:'start',pid:'host'});const p=s.players[s.turn],mate=s.players.find(x=>x!==p&&E.mate(s,p.id,x.id)),opp=s.players.find(x=>x!==p&&!E.mate(s,p.id,x.id));
  s.owner[39]=p.id;assert.equal(E.apply(s,{type:'proposeTrade',pid:p.id,to:mate.id,give:[39],get:[],giveMoney:0,getMoney:0}),null);
  act(s,'acceptTrade',{pid:mate.id});assert.equal(s.owner[39],mate.id);
  s.owner[37]=p.id;assert.ok(E.apply(s,{type:'proposeTrade',pid:p.id,to:opp.id,give:[37],get:[],giveMoney:0,getMoney:0}));
});
test('2x2: game ends when a whole team is out, other team wins',()=>{
  const s=teamGame(0);E.apply(s,{type:'start',pid:'host'});const p=s.players[s.turn],mate=s.players.find(x=>x!==p&&E.mate(s,p.id,x.id));
  act(s,'bankrupt');assert.equal(s.phase,'play');
  mate.bankrupt=true;const left=s.players.find(x=>!x.bankrupt&&x.id!==mate.id);
  // Второй игрок команды сдаётся в свой ход
  while(E.actor(s)!==mate.id&&s.players[s.turn].id!==mate.id){s.turn=(s.turn+1)%4;} mate.bankrupt=false;
  assert.equal(E.apply(s,{type:'bankrupt',pid:mate.id}),null);
  assert.equal(s.phase,'over');assert.notEqual(s.winTeam,s.team[p.id]);assert.equal(s.team[s.winner],s.winTeam);
});
console.log(`${tests} checks passed`);
