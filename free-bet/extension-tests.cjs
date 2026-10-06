'use strict';
// Side panel logic (PRD F9). Run with `node free-bet/extension-tests.cjs`; `node free-bet/tests.cjs` runs it too. Kept outside extension/ so it is not shipped.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ext=__dirname+'/extension/',ctx=vm.createContext({});for(const f of ['strategy.js','advisor.js'])vm.runInContext(fs.readFileSync(ext+f,'utf8'),ctx,{filename:f});
const {Strategy:S,Advisor:A}=vm.runInContext('({Strategy,Advisor})',ctx);
// Objects built inside the vm carry its prototypes; compare plain copies.
const plain=x=>JSON.parse(JSON.stringify(x)),same=(a,b,m)=>assert.deepEqual(plain(a),b,m);
let passed=0;const test=(name,fn)=>{try{fn();passed++;}catch(e){console.error(`Failed: ${name}`);throw e;}};
const hand=(ranks,o={})=>({cards:ranks.map(r=>({r:String(r)})),free:false,aces:false,split:false,...o}),up=r=>({r:String(r)});

test('reads hard totals from the original-hand chart',()=>{
 same(A.advise(hand([10,6]),up(10),1),{kind:'action',action:'H',free:false});
 same(A.advise(hand([10,6]),up(2),1),{kind:'action',action:'S',free:false});
});
test('a free hand reads the free-hand chart',()=>{
 same(A.advise(hand([10,7]),up('A'),1),{kind:'action',action:'S',free:false});
 same(A.advise(hand([10,7],{free:true}),up('A'),2),{kind:'action',action:'H',free:false});
});
test('only two-card hard 9-11 doubles are free',()=>{
 same(A.advise(hand([5,6]),up(10),1),{kind:'action',action:'D',free:true});
 same(A.advise(hand([5,5]),up(6),1),{kind:'action',action:'D',free:true});
 same(A.advise(hand(['A',7]),up(5),1),{kind:'action',action:'D',free:false});
 same(A.advise(hand(['A',8],{free:true}),up(5),2),{kind:'action',action:'D',free:false});
 same(A.advise(hand(['A',8]),up(5),1),{kind:'action',action:'S',free:false});
});
test('splits are free and tens stand',()=>{
 same(A.advise(hand([8,8]),up(6),1),{kind:'action',action:'P',free:true});
 same(A.advise(hand([10,10]),up(6),1),{kind:'action',action:'S',free:false});
});
test('reports a gap instead of inventing a fallback',()=>{
 same(A.advise(hand([8,8]),up(6),4),{kind:'gap',reason:'four-hands'});
 same(A.advise(hand([2,3,5]),up(6),1),{kind:'gap',reason:'two-card-double'});
 same(A.advise(hand(['A',2,3]),up(6),1),{kind:'gap',reason:'two-card-double'});
 same(A.advise(hand(['A',2,3]),up(2),1),{kind:'action',action:'H',free:false});
});
test('finished hands are not decisions',()=>{
 same(A.advise(hand([10,6,9]),up(6),1),{kind:'bust'});
 same(A.advise(hand(['A',10]),up(6),1),{kind:'blackjack'});
 same(A.advise(hand(['A',10],{split:true}),up(6),2),{kind:'twentyOne'});
 same(A.advise(hand([7,7,7]),up(6),1),{kind:'twentyOne'});
});
test('split aces take one card unless it is another ace',()=>{
 same(A.advise(hand(['A',7],{aces:true,split:true}),up(6),2),{kind:'done',reason:'split-aces'});
 same(A.advise(hand(['A',10],{aces:true,split:true}),up(6),2),{kind:'done',reason:'split-aces'});
 same(A.advise(hand(['A','A'],{aces:true,split:true}),up(6),2),{kind:'action',action:'P',free:true});
 same(A.advise(hand(['A','A'],{aces:true,split:true}),up(6),4),{kind:'done',reason:'four-hands'});
});
test('waits for two cards and an upcard',()=>{
 assert.equal(A.advise(hand([10]),up(6),1),null);
 assert.equal(A.advise(hand([10,6]),null,1),null);
});
// The contract behind "the trainer and the extension can never disagree": wherever the panel shows a play or a gap, it is exactly the trainer's grade.
test('every decision matches Strategy.best',()=>{
 const ranks=['A','2','3','4','5','6','7','8','9','10'];let checked=0;
 for(const a of ranks)for(const b of ranks)for(const c of [null,...ranks])for(const d of ranks)for(const free of [false,true])for(const count of [1,2,3,4]){
  const h=hand(c?[a,b,c]:[a,b],{free,split:free}),advice=A.advise(h,up(d),count);
  if(advice.kind!=='action'&&advice.kind!=='gap')continue;
  assert.equal(advice.kind==='gap'?null:advice.action,S.best(h,up(d),count),`${h.cards.map(x=>x.r)} vs ${d}, free ${free}, ${count} hands`);checked++;
 }
 // 98 two-card and 756 three-card hands total under 21 (counted separately), times 10 upcards, 2 bet types and 4 hand counts.
 assert.equal(checked,68320,'a decision state was reported as a finished hand');
});

// A round is rebuilt from its events. The panel groups them one keystroke per step, so undo drops a step.
const card=(r,to='hand',at)=>({t:'card',to,r:String(r),at}),deal=(p1,p2,d)=>[card(p1),card(p2),card(d,'dealer')];
const hands=s=>plain(s.hands).map(h=>({cards:h.cards.map(c=>c.r).join(' '),free:h.free,aces:h.aces,split:h.split,status:h.status}));
test('cards land on the hand or the dealer they were typed for',()=>{
 const s=A.replay([...deal(8,8,6),card(5,'dealer')]);
 same(hands(s),[{cards:'8 8',free:false,aces:false,split:false,status:'open'}]);assert.equal(s.dealer.r,'5');assert.equal(s.index,0);
});
test('a split keeps the original bet on the first hand and puts the second on a free bet',()=>{
 same(hands(A.replay([...deal(8,8,6),{t:'split'}])),[{cards:'8',free:false,aces:false,split:true,status:'open'},{cards:'8',free:true,aces:false,split:true,status:'open'}]);
 same(hands(A.replay([...deal('A','A',6),{t:'split'}])),[{cards:'A',free:false,aces:true,split:true,status:'open'},{cards:'A',free:true,aces:true,split:true,status:'open'}]);
});
test('splits the trainer would refuse are ignored',()=>{
 assert.equal(A.replay([...deal(10,10,6),{t:'split'}]).hands.length,1);
 assert.equal(A.replay([...deal(8,6,6),{t:'split'}]).hands.length,1);
 const four=[...deal(8,8,6),{t:'split'},card(8),{t:'split'},card(8),{t:'split'},card(8)];
 assert.equal(A.replay(four).hands.length,4);assert.equal(A.replay([...four,{t:'split'}]).hands.length,4);
});
test('select moves between hands that exist',()=>{
 const split=[...deal(8,8,6),{t:'split'},card(3)];
 assert.equal(A.replay([...split,{t:'select',index:1}]).index,1);
 assert.equal(A.replay([...split,{t:'select',index:5}]).index,0);
});
test('a hand closes where the trainer ends it',()=>{
 const status=events=>A.replay(events).hands.map(h=>h.status).join(' ');
 assert.equal(status([...deal(10,6,2),{t:'stand'}]),'closed');
 assert.equal(status([...deal(5,6,10),{t:'double'}]),'doubling');
 assert.equal(status([...deal(5,6,10),{t:'double'},card(9)]),'closed');
 assert.equal(status([...deal(10,6,2),card(9)]),'closed');
 assert.equal(status([...deal(10,6,2),card(5)]),'closed');
 assert.equal(status(deal('A',10,6)),'closed');
 assert.equal(status([...deal('A','A',6),{t:'split'},card(7)]),'closed open');
 assert.equal(status([...deal('A','A',6),{t:'split'},card('A')]),'open open');
});
test('a closed hand takes no more cards, and a doubled hand takes exactly one',()=>{
 same(hands(A.replay([...deal(10,6,2),{t:'stand'},card(5)])).map(h=>h.cards),['10 6']);
 same(hands(A.replay([...deal(5,6,10),{t:'double'},card(9),card(4)])).map(h=>h.cards),['5 6 9']);
 same(hands(A.replay([...deal('A','A',6),{t:'split'},card('A'),card(7)])).map(h=>h.cards),['A A','A']);
});
test('doubles the trainer would refuse are ignored',()=>{
 assert.equal(A.replay([...deal(10,2,6),card(3),{t:'double'}]).hands[0].status,'open');
 assert.equal(A.replay([...deal('A','A',6),{t:'split'},card('A'),{t:'double'}]).hands[0].status,'open');
});

const log=s=>plain(s.decisions).map(d=>`${d.hand}: ${d.cards.join(' ')} v ${d.dealerUpcard}${d.free?' free':''} [${d.hands}] ${d.optimal??'gap'}${d.advice.free?' free':''} > ${d.action??'?'}${d.verdict?' '+d.verdict:''}`);
test('each answer shown is logged with what the player did',()=>{
 same(log(A.replay(deal(8,8,6))),['1: 8 8 v 6 [1] P free > ?']);
 same(log(A.replay([...deal(8,8,6),{t:'split'}])),['1: 8 8 v 6 [1] P free > P correct']);
 same(log(A.replay([...deal(10,6,2),card(9)])),['1: 10 6 v 2 [1] S > H misplay']);
 same(log(A.replay([...deal(10,6,2),{t:'stand'}])),['1: 10 6 v 2 [1] S > S correct']);
 same(log(A.replay([...deal(5,6,10),{t:'double'},card(9)])),['1: 5 6 v 10 [1] D free > D correct']);
 same(log(A.replay([card(10),card(6)])),[]);
});
test('a correction is not an action, and rewrites the round\'s answers',()=>{
 same(log(A.replay([...deal(10,6,10),card(9,'dealer')])),['1: 10 6 v 9 [1] H > ?']);
 same(log(A.replay([...deal(10,2,10),card(4),card(5,'dealer')])),['1: 10 2 v 5 [1] S > H misplay','1: 10 2 4 v 5 [1] S > ?']);
});
test('a split round logs every decision with its hand number and hand count',()=>{
 same(log(A.replay([...deal(8,8,6),{t:'split'},card(3),{t:'double'},card(5),{t:'select',index:1},card(10),{t:'stand'}])),
  ['1: 8 8 v 6 [1] P free > P correct','1: 8 3 v 6 [2] D free > D correct','2: 8 10 v 6 free [2] S > S correct']);
});
test('a resplit is a second decision, not a correction of the first',()=>{
 same(log(A.replay([...deal(8,8,6),{t:'split'},card(8)])),['1: 8 8 v 6 [1] P free > P correct','1: 8 8 v 6 [2] P free > ?']);
});
test('finished hands are not logged as decisions, but gaps are',()=>{
 same(log(A.replay([...deal(10,6,6),card(9)])),['1: 10 6 v 6 [1] S > H misplay']);
 same(log(A.replay([...deal(2,3,6),card(5),card(4)])),['1: 2 3 v 6 [1] H > H correct','1: 2 3 5 v 6 [1] gap > H gap','1: 2 3 5 4 v 6 [1] S > ?']);
});
test('a logged answer keeps the time it was last shown',()=>{
 same(plain(A.replay([card(10,'hand',1),card(6,'hand',2),card(10,'dealer',3),card(9,'dealer',7)]).decisions).map(d=>d.at),[7]);
});

// A typed card is read as following the advice on screen ("type every card you are dealt"); next() says where it goes, and the prompt line shows the same answer.
const route=(events,aim)=>plain(A.next(A.replay(events),aim)),go=o=>({to:'hand',before:[],newRound:false,hand:1,...o});
test('a round fills your two cards, then the upcard',()=>{
 same(route([]),go({prompt:'first'}));
 same(route([card(8)]),go({prompt:'second'}));
 same(route([card(8),card(8)]),go({to:'dealer',prompt:'dealer'}));
});
test('after hit, or a chart gap, the next card is the one you drew',()=>{
 same(route(deal(10,6,10)),go({prompt:'drawn'}));
 same(route([...deal(2,3,6),card(5)]),go({prompt:'drawn'}));
});
test('after split, the next card is the first hand\'s second card',()=>{
 same(route(deal(8,8,6)),go({before:[{t:'split'}],prompt:'split'}));
});
test('after double, the next card is the double card',()=>{
 same(route(deal(5,6,10)),go({before:[{t:'double'}],prompt:'double-card'}));
 same(route([...deal(5,6,10),{t:'double'}]),go({prompt:'double-card'}));
});
test('after stand or a finished hand, the next card moves on',()=>{
 same(route(deal(10,6,2)),go({before:[{t:'stand'}],newRound:true,prompt:'new-round'}));
 same(route(deal('A',10,6)),go({newRound:true,prompt:'new-round'}));
 same(route([...deal(5,6,10),{t:'double'},card(9)]),go({newRound:true,prompt:'new-round'}));
 same(route([...deal(8,8,6),{t:'split'},card(3),{t:'double'},card(5)]),go({before:[{t:'select',index:1}],prompt:'next-hand',hand:2}));
 same(route([...deal(8,8,6),{t:'split'},card(10)]),go({before:[{t:'stand'},{t:'select',index:1}],prompt:'next-hand',hand:2}));
 same(route([...deal('A','A',6),{t:'split'},card(7)]),go({before:[{t:'select',index:1}],prompt:'next-hand',hand:2}));
});
test('the second hand of a split waits for its own second card',()=>{
 same(route([...deal(8,8,6),{t:'split'},card(3),{t:'double'},card(5),{t:'select',index:1}]),go({prompt:'second',hand:2}));
});
test('aiming overrides the reading of the advice',()=>{
 same(route(deal(10,6,2),'dealer'),go({to:'dealer',prompt:'dealer-change'}));
 same(route([card(8)],'dealer'),go({to:'dealer',prompt:'dealer'}));
 same(route(deal(10,6,2),'hand'),go({prompt:'drawn'}));
 same(route(deal(8,8,6),'hand'),go({prompt:'drawn'}));
 same(route([...deal('A','A',6),{t:'split'},card('A')],'hand'),go({before:[{t:'split'}],prompt:'split'}));
});

const press=(events,input,aim)=>plain(A.press(A.replay(events),input,aim)),none={events:[],aim:null,newRound:false,then:[]};
const keyed=(...keys)=>{let pending=null;return keys.map(k=>{const r=plain(A.input(typeof k==='string'?{key:k,code:''}:k,pending));pending=r.pending;return r.input;}).filter(Boolean);};
test('keys and keypad codes map to ranks; only A types an ace',()=>{
 same(keyed('a','A','2','9','0','t','T','j','q','K'),['A','A','2','9','10','10','10','10','10','10']);
 same(keyed({key:'&',code:'Digit1'},{key:'à',code:'Digit0'}),['10']);
 same(keyed({key:'ArrowRight',code:'Numpad6'},{key:'^',code:'Digit6',shiftKey:true}),['6','6']);
 same(keyed('x','B','Shift',' ','F'),[]);
 same(keyed({key:'k',code:'KeyK',metaKey:true},{key:'t',code:'KeyT',ctrlKey:true},{key:'a',code:'KeyA',altKey:true}),[]);
});
test('a ten typed as 1 then 0 is one ten, and a lone 1 is never an ace',()=>{
 same(keyed('1','0','6','9'),['10','6','9']);
 same(keyed('1','8'),['8']);
 same(plain(A.input({key:'8',code:'Digit8'},'1')),{input:'8',pending:null,hint:'ten'});
 same(plain(A.input({key:'Backspace',code:'Backspace'},'1')),{input:null,pending:null,hint:null});
 same(keyed('1'),[]);
});
test('action and control keys pass through',()=>{
 same(keyed('h','S','d','P','u','n','Enter','Backspace','Escape'),['H','S','D','P','U','N','Enter','Backspace','Escape']);
});
test('only real ranks become cards',()=>{
 same(press([],'8'),{...none,events:[{t:'card',to:'hand',r:'8'}]});
 same(press([],'10'),{...none,events:[{t:'card',to:'hand',r:'10'}]});
 for(const k of ['1','11','T','K','x'])same(press([],k),none,k);
 same(hands(A.replay([card('K'),card(1),card(8)])).map(h=>h.cards),['8']);
});
test('action keys record what you did, when the table allows it',()=>{
 same(press(deal(10,6,2),'S'),{...none,events:[{t:'stand'}]});
 same(press(deal(10,6,2),'Enter'),{...none,events:[{t:'stand'}]});
 same(press(deal(5,6,10),'D'),{...none,events:[{t:'double'}]});
 same(press([...deal(10,2,6),card(3)],'D'),none);
 same(press(deal(8,8,6),'P'),{...none,events:[{t:'split'}]});
 same(press(deal(10,10,6),'P'),none);
 same(press(deal(10,6,2),'H'),{...none,aim:'hand'});
 same(press([...deal('A','A',6),{t:'split'},card('A')],'H'),none);
 same(press([card(8)],'S'),none);
 same(press([],'U'),{...none,aim:'dealer'});
});
test('finishing a hand moves to the next one, or skips a double card',()=>{
 same(press([...deal(8,8,6),{t:'split'},card(3)],'Enter'),{...none,events:[{t:'stand'},{t:'select',index:1}]});
 same(press([...deal(5,6,10),{t:'double'}],'Enter'),{...none,events:[{t:'stand'}]});
});
test('a card typed after the round is over starts the next round',()=>{
 same(press(deal(10,6,2),'9'),{...none,events:[{t:'stand'}],newRound:true,then:[{t:'card',to:'hand',r:'9'}]});
 same(press([...deal(10,6,2),{t:'stand'}],'9'),{...none,newRound:true,then:[{t:'card',to:'hand',r:'9'}]});
});

// Chrome refuses to load the package if a file the manifest names is missing, and F9 forbids page access.
test('the manifest names only files that exist and asks for no page access',()=>{
 const m=JSON.parse(fs.readFileSync(ext+'manifest.json','utf8'));
 for(const f of [m.background.service_worker,m.side_panel.default_path,...Object.values(m.icons),...Object.values(m.action.default_icon)])assert.ok(fs.existsSync(ext+f),`${f} is missing`);
 assert.equal(m.manifest_version,3);
 for(const key of ['host_permissions','optional_host_permissions','content_scripts','externally_connectable','web_accessible_resources'])assert.equal(m[key],undefined,`${key} gives page access`);
 assert.deepEqual([...m.permissions].sort(),['sidePanel','storage']);
 for(const f of fs.readdirSync(ext))assert.ok(!f.startsWith('_'),`Load unpacked rejects ${f}`);
});

console.log(`Passed ${passed} extension checks.`);
