'use strict';
// Side panel logic with no DOM or storage, so tests.cjs can run it in node. Every play comes from the round's game in strategy.js (Games), Free Bet
// unless a game is named. A round's state carries its game, so nothing here is global.
const Advisor={
 ranks:['A','2','3','4','5','6','7','8','9','10'],
 // A keyboard event to a panel input: a rank, or an action or control key (G switches games). Suits never change the play, so 0, T, J, Q and K all mean a ten.
 // Digits are read from the physical key so AZERTY and the numpad work. A 1 waits for a 0 (a ten typed as 10); only A types an ace.
 input(e,pending){const none={input:null,pending:null,hint:null};if(e.ctrlKey||e.metaKey||e.altKey)return none;
  const d=/^(?:Digit|Numpad)(\d)$/.exec(e.code||'')?.[1]??(/^\d$/.test(e.key)?e.key:null),k=String(e.key).toUpperCase();
  if(pending==='1'){if(d==='0')return{...none,input:'10'};if(k==='BACKSPACE'||k==='ESCAPE')return none;return{...this.input(e,null),hint:'ten'};}
  if(d)return d==='1'?{...none,pending:'1'}:{...none,input:d==='0'?'10':d};
  if(k==='A')return{...none,input:'A'};
  if(['T','J','Q','K'].includes(k))return{...none,input:'10'};
  if(['H','S','D','P','U','N','G'].includes(k))return{...none,input:k};
  return{...none,input:{ENTER:'Enter',BACKSPACE:'Backspace',ESCAPE:'Escape'}[k]??null};
 },
 // Plays the trainer never asks for (it ends hands at 21 or more, and after split aces) are reported as finished hands, not decisions.
 advise(hand,up,count,game='freebet'){const cards=hand.cards;if(!up||cards.length<2)return null;
  const total=Engine.value(cards).total;
  if(total>21)return{kind:'bust'};
  if(hand.aces&&!(cards[1].r==='A'&&count<4))return{kind:'done',reason:cards[1].r==='A'?'four-hands':'split-aces'};
  if(total===21)return{kind:!hand.split&&!hand.free&&cards.length===2?'blackjack':'twentyOne'};
  const g=Games[game],action=g.strategy.best(hand,up,count);
  if(action===null)return{kind:'gap',reason:cards.length===2&&Engine.rank(cards[0])===Engine.rank(cards[1])?'four-hands':'two-card-double'};
  // Only Free Bet puts a split or a two-card hard 9-11 double on the house.
  return{kind:'action',action,free:g.free&&(action==='P'||action==='D'&&Engine.freeDouble(hand))};
 },
 hand(id,cards=[],o={}){return{id,cards,free:false,aces:false,split:false,status:'open',...o};},
 // The trainer's legal(), for the active hand. A regular blackjack table also lets tens split.
 legal(s){const h=s.hands[s.index],c=h.cards;return{H:!h.aces,S:true,D:c.length===2&&!h.aces,P:c.length===2&&Engine.rank(c[0])===Engine.rank(c[1])&&(Engine.rank(c[0])!==10||Games[s.game].splitTens)&&s.hands.length<4};},
 // The trainer's advance(): a hand ends at 21 or more, and split aces end after one card unless it is another ace that can still be split.
 settle(s,h){if(Engine.value(h.cards).total>=21||h.aces&&h.cards.length===2&&!(h.cards[1].r==='A'&&s.hands.length<4))h.status='closed';},
 // Rebuilds a round from its events in one game. A split mirrors the trainer's execute('P'): the first hand keeps its bet and the new hand plays on a
 // free bet in Free Bet, or on a bet equal to the first in Blackjack. The same events in another game give the same cards, regraded (but see sameHands).
 replay(events,game='freebet'){const s={game,dealer:null,hands:[this.hand(0)],index:0},seen=new Map();let ids=1,shown=null;
  for(const e of events){const h=s.hands[s.index],L=this.legal(s),open=h.status==='open';let act=null;
   if(e.t==='card'&&e.to==='dealer'){if(!this.ranks.includes(e.r))continue;s.dealer={r:e.r};}
   else if(e.t==='card'){if(!this.ranks.includes(e.r)||h.status==='closed'||h.aces&&h.cards.length>=2)continue;if(open&&h.cards.length>=2)act='H';h.cards.push({r:e.r});if(h.status==='doubling')h.status='closed';this.settle(s,h);}
   else if(e.t==='stand'){if(h.status==='closed'||h.cards.length<2)continue;if(open)act='S';h.status='closed';}
   else if(e.t==='double'){if(!open||!L.D)continue;act='D';h.status='doubling';h.doubled=true;}
   else if(e.t==='split'){if(!open||!L.P)continue;act='P';const second=h.cards.pop();h.split=true;h.aces=second.r==='A';s.hands.splice(s.index+1,0,this.hand(ids++,[second],{free:Games[s.game].free,aces:h.aces,split:true}));}
   else if(e.t==='select'){if(!s.hands[e.index])continue;s.index=e.index;}
   else continue;
   // An action taken while an answer is on screen is what the player did with that answer.
   if(act&&shown&&!seen.get(shown).action)seen.get(shown).action=act;
   const a=s.hands[s.index];shown=null;
   if(a.status==='open'&&a.cards.length>=2&&s.dealer){const advice=this.advise(a,s.dealer,s.hands.length,s.game);
    if(advice.kind==='action'||advice.kind==='gap'){shown=`${a.id}|${s.hands.length}|${a.cards.map(c=>c.r)}`;const d=seen.get(shown);
     if(d)d.at=e.at;else seen.set(shown,{id:a.id,cards:a.cards.map(c=>c.r),free:a.free,aces:a.aces,split:a.split,hands:s.hands.length,action:null,at:e.at});}}
  }
  // A round has one dealer upcard, so a correction applies to every answer logged for the round. Field names follow the trainer's decision log.
  s.decisions=[...seen.values()].map(d=>{const advice=this.advise({cards:d.cards.map(r=>({r})),free:d.free,aces:d.aces,split:d.split},s.dealer,d.hands,s.game),optimal=advice.kind==='gap'?null:advice.action;
   return{hand:s.hands.findIndex(x=>x.id===d.id)+1,cards:d.cards,dealerUpcard:s.dealer.r,free:d.free,hands:d.hands,advice,optimal,action:d.action,verdict:d.action&&(optimal===null?'gap':optimal===d.action?'correct':'misplay'),at:d.at};});
  return s;
 },
 // Whether a round's events give the same hands in another game. Only a split of tens differs: Blackjack makes it and a Free Bet table ignores it.
 sameHands(events,from,to){const cards=g=>JSON.stringify(this.replay(events,g).hands.map(h=>h.cards));return cards(from)===cards(to);},
 // Ends the active hand (a stand, or skipping a double card) and moves to the next hand still open.
 finish(s){const before=s.hands[s.index].status==='closed'?[]:[{t:'stand'}];
  for(let j=s.index+1;j<s.hands.length;j++)if(s.hands[j].status!=='closed')return{before:[...before,{t:'select',index:j}],newRound:false,hand:j+1};
  return{before,newRound:true,hand:s.index+1};},
 // Where the next typed card goes. Players type every card they are dealt, and a card typed on an answer means they followed it: drew after a hit, split after a split, doubled after a double, and moved on after a stand.
 next(s,aim){const h=s.hands[s.index],go=(o,hand=s.index+1)=>({to:'hand',before:[],newRound:false,hand,...o});
  if(aim==='dealer')return go({to:'dealer',prompt:s.dealer?'dealer-change':'dealer'});
  if(h.cards.length<2)return go({prompt:h.cards.length?'second':'first'});
  if(!s.dealer)return go({to:'dealer',prompt:'dealer'});
  if(h.status==='doubling')return go({prompt:'double-card'});
  if(h.status==='open'){
   if(aim==='hand'&&this.legal(s).H)return go({prompt:'drawn'});
   const a=this.advise(h,s.dealer,s.hands.length,s.game);
   if(a.kind==='gap'||a.action==='H')return go({prompt:'drawn'});
   if(a.action==='P')return go({before:[{t:'split'}],prompt:'split'});
   if(a.action==='D')return go({before:[{t:'double'}],prompt:'double-card'});
  }
  const f=this.finish(s);return f.newRound?go({before:f.before,newRound:true,prompt:'new-round'}):go({before:f.before,prompt:'next-hand'},f.hand);
 },
 // One input: a card; H, S, D or P for what the player did when it differs from the answer; Enter to finish a hand; U to aim the next card at the dealer.
 press(s,input,aim){const none={events:[],aim:null,newRound:false,then:[]};
  if(this.ranks.includes(input)){const n=this.next(s,aim),c={t:'card',to:n.to,r:input};return n.newRound?{...none,events:n.before,newRound:true,then:[c]}:{...none,events:[...n.before,c]};}
  const h=s.hands[s.index],L=this.legal(s),ready=h.status==='open'&&h.cards.length>=2&&!!s.dealer;
  if(input==='U')return{...none,aim:'dealer'};
  if(input==='H')return ready&&L.H?{...none,aim:'hand'}:none;
  if(input==='D')return ready&&L.D?{...none,events:[{t:'double'}]}:none;
  if(input==='P')return ready&&L.P?{...none,events:[{t:'split'}]}:none;
  if(input==='S'||input==='Enter')return ready||h.status==='doubling'?{...none,events:this.finish(s).before}:none;
  return none;
 },
};
