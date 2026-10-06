const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
// The trainer and the Chrome extension both load extension/strategy.js (PRD F9), so the regression runs against that file.
const strategySource=fs.readFileSync(__dirname+'/extension/strategy.js','utf8');
const context=vm.createContext({});vm.runInContext(strategySource+';globalThis.api={Engine,Strategy};',context);const {Engine:E,Strategy:S}=context.api;
const cards=(...rs)=>rs.map(r=>({r:String(r),s:'♠'}));
// Independent fixture rows: ten original and ten free-hand situations, all ten upcards.
const fixtures=[
 [false,[10,2],'HHHSSHHHHH'],[false,[10,3],'HSSSSHHHHH'],[false,[10,4],'SSSSSHHHHH'],[false,[10,7],'SSSSSSSSSS'],
 [false,['A',6],'HHHDDHHHHH'],[false,['A',7],'SSSDDSSHHH'],[false,[4,5],'DDDDDDDDDD'],[false,[5,5],'DDDDDDDDDD'],[false,[8,8],'PPPPPPPPPP'],[false,[10,'K'],'SSSSSSSSSS'],
 [true,[10,2],'HHHSSHHHHH'],[true,[10,4],'HSSSSHHHHH'],[true,[10,7],'SSSSSHHHSH'],[true,['A',7],'HHDDDSHHHH'],[true,['A',8],'SSSDDSSSSS'],[true,['A',9],'SSSSDSSSSS'],[true,[4,5],'DDDDDDDDDD'],[true,[5,5],'DDDDDDDDDD'],[true,[9,9],'PPPPPPPPPP'],[true,[10,'J'],'SSSSSSSSSS']
];let count=0;for(const [free,rs,expected] of fixtures)for(let i=0;i<10;i++){assert.equal(S.best({cards:cards(...rs),free},cards(i===9?'A':i+2)[0],1),expected[i],`${free?'free':'original'} ${rs} vs ${i+2}`);count++;}
assert.equal(S.best({cards:cards(3,3,3)},cards(6)[0],1),null);
assert.equal(S.best({cards:cards(8,8)},cards(6)[0],4),null);
assert.equal(E.value(cards('A','A',9)).total,21);assert.equal(E.value(cards('A',6)).soft,true);assert.equal(E.value(cards('A',6,10)).soft,false);
for(const total of [9,10,11])assert.equal(E.freeDouble({cards:cards(2,total-2)}),true);
assert.equal(E.freeDouble({cards:cards('A',8)}),false);assert.equal(E.freeDouble({cards:cards(2,3,4)}),false);
const h=(rs,risk=1,units=1)=>({cards:cards(...rs),risk,units});
assert.equal(E.payout(h([10,9]),cards(10,6,6)),0);assert.equal(E.payout(h([10,9,5]),cards(10,6,6)),-1);
assert.equal(E.payout(h(['A','K']),cards(10,9),true),1.5);assert.equal(E.payout(h(['A','K']),cards('A','Q'),true),0);
assert.equal(E.payout(h([10,9],1,2),cards(10,8)),2);assert.equal(E.payout(h([10,9],1,2),cards(10,10)),-1);
assert.equal(E.payout(h([10,9],0,1),cards(10,10)),0);assert.equal(E.payout(h([10,9],0,1),cards(10,8)),1);
assert.equal(E.payout(h([10,9],1,2),cards(10,7,6)),2);assert.equal(E.payout(h(['A','K']),cards(10,9),false),1);
const shoe=E.shoe();assert.equal(shoe.length,312);const counts={};for(const c of shoe)counts[c.r+c.s]=(counts[c.r+c.s]||0)+1;assert.equal(Object.keys(counts).length,52);assert.ok(Object.values(counts).every(n=>n===6));
// The trainer page grades with whatever extension/strategy.js says. Run its script tags as a browser would, against a stub DOM.
const mulberry=a=>()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
function trainer(strategyCode,seed){const html=fs.readFileSync(__dirname+'/index.html','utf8'),node=()=>({dataset:{},style:{},hidden:false,open:false,disabled:false,textContent:'',innerHTML:'',className:'',focus(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},replaceChildren(){},append(){}}),nodes={},buttons=['H','S','D','P'].map(a=>Object.assign(node(),{dataset:{action:a}})),store={'freebet.primer.v1':'yes'};
 const ctx=vm.createContext({document:{getElementById:id=>nodes[id]??=node(),querySelectorAll:()=>buttons,createElement:node},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}},innerWidth:1200});
 if(seed!==undefined)vm.runInContext(`Math.random=(${mulberry})(${seed});`,ctx);
 for(const [,src,code] of html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g))vm.runInContext(src?(src==='extension/strategy.js'?strategyCode:fs.readFileSync(__dirname+'/'+src,'utf8')):code,ctx);
 return ctx;}
function trainerOptimal(strategyCode,[p1,p2],[up,hole]){const tail=[hole,p2,up,p1].map(r=>({r:String(r),s:'♠'}));return vm.runInContext(`shoe=Array.from({length:80},()=>({r:'2',s:'♣'})).concat(${JSON.stringify(tail)});deal();choose('S');game.decisions[0].optimal`,trainer(strategyCode));}
assert.equal(trainerOptimal(strategySource,[10,6],[2,5]),'S','trainer grades hard 16 vs 2 from the shared chart');
const altered=strategySource.replace("16:'SSSSSHHHHH'","16:'HHHHHHHHHH'");assert.notEqual(altered,strategySource);
assert.equal(trainerOptimal(altered,[10,6],[2,5]),'H','trainer must read its chart from extension/strategy.js, not a copy of its own');

// Round-level agreement with the side panel (PRD F9: "the trainer and the extension can never disagree"). The real trainer plays seeded rounds with
// random legal actions. Each round's cards and actions are then typed into the panel, once with action keys only where the player departs from the
// panel's answer and once with an action key every time. The panel must log exactly the decisions the trainer graded, with the same plays and verdicts.
vm.runInContext(fs.readFileSync(__dirname+'/extension/advisor.js','utf8')+';globalThis.api.Advisor=Advisor;',context);const Adv=context.api.Advisor;
const table=trainer(strategySource,20261006);
// Tag hands in creation order (as the panel numbers them) and record the cards each hand is dealt, in order: a later split moves a hand's second card away.
vm.runInContext(`var nextId=0,arrivals;{const make=hand;hand=(...a)=>Object.assign(make(...a),{id:nextId++});}
 {const run=execute;execute=()=>{const a=pending,h=active(),ids=game.hands.map(x=>x.id);run();
  if(a==='H'||a==='D')arrivals[h.id].push(h.cards[h.cards.length-1].r);
  if(a==='P'){arrivals[h.id].push(h.cards[1].r);const y=game.hands.find(x=>!ids.includes(x.id));arrivals[y.id]=[y.cards[1].r];}};}`,table);
// A second batch deals from a shoe of aces, fives, eights, nines and tens and usually splits, to reach resplits, split aces and the four-hand limit.
const play=(n,splitFirst)=>`(()=>{const out=[];for(let k=0;k<${n};k++){nextId=0;deal();arrivals={0:game.hands[0].cards.map(c=>c.r)};
 while(!game.done){const L=legal(active()),acts=Object.keys(L).filter(a=>L[a]);choose(L.P&&Math.random()<${splitFirst}?'P':acts[Math.floor(Math.random()*acts.length)]);execute();}
 out.push({arrivals,up:game.dealer[0].r,dealerNatural:Engine.value(game.dealer.slice(0,2)).total===21,hands:game.hands.length,
  decisions:game.decisions.map(d=>({hand:d.hand,cards:d.cards.map(c=>c.r),free:d.free,up:d.dealerUpcard.r,action:d.action,optimal:d.optimal,verdict:d.verdict}))});}
 return JSON.stringify(out);})()`;
const rounds=JSON.parse(vm.runInContext(play(1500,0),table));
vm.runInContext(`Engine.shoe=()=>{const a=[];for(let d=0;d<6;d++)for(const s of ['♠','♥','♣','♦'])for(const r of ['A','5','8','9','10'])a.push({r,s});for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};shoe=[];`,table);
rounds.push(...JSON.parse(vm.runInContext(play(1500,0.85),table)));
const ten=r=>['J','Q','K'].includes(r)?'10':r;
function panelRound(round,policy){const typed={},events=[];let aim=null,standing=false;
 const state=()=>Adv.replay(events),press=k=>{const r=Adv.press(state(),k,aim);assert.ok(!r.newRound,'the panel ended the round early');aim=r.aim;events.push(...r.events);};
 // The table deals the next card to whichever hand the panel is on; the panel routes it (an implied split, double or stand, or a move to the next hand).
 const deal=id=>{typed[id]=(typed[id]??0)+1;press(ten(round.arrivals[id][typed[id]-1]));};
 const dealt=()=>{const s=state(),n=Adv.next(s,aim);if(n.newRound||n.to==='dealer')return false;const sel=n.before.find(e=>e.t==='select'),id=s.hands[sel?sel.index:s.index].id;if((typed[id]??0)>=(round.arrivals[id]?.length??0))return false;deal(id);return true;};
 const deciding=()=>{const s=state(),h=s.hands[s.index];if(h.status!=='open'||h.cards.length<2||!s.dealer)return false;const a=Adv.advise(h,s.dealer,s.hands.length);return a.kind==='action'||a.kind==='gap';};
 deal(0);deal(0);press(ten(round.up));
 for(const d of round.decisions){
  for(let guard=0;standing||!deciding();guard++){assert.ok(guard<30&&dealt(),'the panel missed a decision the trainer graded');standing=false;}
  const n=Adv.next(state(),aim),implied=n.before.some(e=>e.t==='split')?'P':n.before.some(e=>e.t==='double')?'D':n.before.some(e=>e.t==='stand')?'S':'H';
  if(policy==='explicit'||implied!==d.action)press(d.action);
  if(d.action==='S')standing=policy==='minimal'&&implied==='S';else assert.ok(dealt(),'no card for the action');
 }
 while(dealt());
 const end=Adv.press(state(),'2',aim);assert.ok(end.newRound,'the panel still expects cards after the trainer finished the round');events.push(...end.events);
 return JSON.parse(JSON.stringify(Adv.replay(events).decisions)).map(d=>({hand:d.hand,cards:d.cards,free:d.free,up:d.dealerUpcard,action:d.action,optimal:d.optimal,verdict:d.verdict}));}
const seen={rounds:0,decisions:0,splits:0,resplits:0,aces:0,fourHands:0,doubles:0,gaps:0,misplays:0};
for(const round of rounds){if(round.dealerNatural)continue;const want=round.decisions.map(d=>({...d,cards:d.cards.map(ten),up:ten(d.up)}));
 for(const policy of ['minimal','explicit'])assert.deepEqual(panelRound(round,policy),want,`${policy} entry of ${JSON.stringify(round)}`);
 seen.rounds++;seen.decisions+=want.length;seen.splits+=round.hands>1;seen.resplits+=round.hands>2;seen.aces+=want.some(d=>d.action==='P'&&d.cards[0]==='A');seen.fourHands+=round.hands===4;
 seen.doubles+=want.some(d=>d.action==='D');seen.gaps+=want.some(d=>d.verdict==='gap');seen.misplays+=want.some(d=>d.verdict==='misplay');}
// Guards against the comparison going vacuous; the seeds are fixed, so the counts are too.
for(const [k,n] of Object.entries(seen))assert.ok(n>=10,`only ${n} rounds exercised ${k}`);
console.log(`Passed ${count} chart regression cases plus engine, gap, and shared-strategy checks; the side panel matched all ${seen.decisions} trainer decisions in ${seen.rounds} rounds (${seen.splits} with splits, ${seen.resplits} resplits, ${seen.aces} split aces, ${seen.fourHands} at four hands, ${seen.gaps} with chart gaps).`);
require('./extension-tests.cjs');
