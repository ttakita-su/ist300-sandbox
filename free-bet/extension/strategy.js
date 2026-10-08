'use strict';
// Loaded by both the trainer (free-bet/index.html) and the Chrome extension's side panel, so the two can never disagree (PRD F9).
// Strategy facts transcribed from the three cited Wizard of Odds charts.
const Strategy={
 realHard:{12:'HHHSSHHHHH',13:'HSSSSHHHHH',14:'SSSSSHHHHH',15:'SSSSSHHHHH',16:'SSSSSHHHHH',17:'SSSSSSSSSS'},
 freeHard:{12:'HHHSSHHHHH',13:'HSSSSHHHHH',14:'HSSSSHHHHH',15:'SSSSSHHHHH',16:'SSSSSHHHHH',17:'SSSSSHHHSH'},
 realSoft:{16:'HHHHDHHHHH',17:'HHHDDHHHHH',18:'SSSDDSSHHH'},
 freeSoft:{16:'HHHHDHHHHH',17:'HHHDDHHHHH',18:'HHDDDSHHHH',19:'SSSDDSSSSS',20:'SSSSDSSSSS'},
 best(hand,up,count){const {total,soft}=Engine.value(hand.cards),i=Engine.rank(up)-2;
 if(hand.aces)return hand.cards[1].r==='A'&&count<4?'P':null;
 if(hand.cards.length===2&&Engine.rank(hand.cards[0])===Engine.rank(hand.cards[1])){const r=Engine.rank(hand.cards[0]);if(r!==10&&r!==5){if(count>=4)return null;return 'P';}if(r===10)return 'S';}
 if(!soft&&total>=9&&total<=11)return hand.cards.length===2?'D':null;
 const rows=soft?(hand.free?this.freeSoft:this.realSoft):(hand.free?this.freeHard:this.realHard);
 let a=rows[total]?.[i]||((soft?total>=19:total>=18)?'S':'H');
 if(a==='D'&&hand.cards.length!==2)return null;
 return a;
 }};
const Engine={
 rank:c=>c.r==='A'?11:['J','Q','K'].includes(c.r)?10:Number(c.r),
 value(cards){let total=0,aces=0;for(const c of cards){total+=this.rank(c);if(c.r==='A')aces++;}while(total>21&&aces){total-=10;aces--;}return{total,soft:aces>0};},
 shoe(){let a=[];for(let d=0;d<6;d++)for(const s of ['♠','♥','♣','♦'])for(const r of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'])a.push({r,s});for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;},
 freeDouble:h=>h.cards.length===2&&!Engine.value(h.cards).soft&&[9,10,11].includes(Engine.value(h.cards).total),
 payout(h,dealer,natural=false){const t=this.value(h.cards).total,d=this.value(dealer).total,bj=natural&&t===21,dbj=dealer.length===2&&d===21;if(t>21)return h.risk ? -h.risk : 0;if(dbj)return bj?0:(h.risk ? -h.risk : 0);if(bj)return 1.5;if(d===22||t===d)return 0;if(d>21||t>d)return h.units;return h.risk ? -h.risk : 0;}
};
// Table rules the charts above assume (STRATEGY.md). The side panel prints the short line beside every answer and the full list in About.
const Rules={
 short:'Assumes 6 decks, dealer hits soft 17 and peeks, no surrender.',
 full:['Six decks','Dealer hits soft 17','Dealer peeks for blackjack','Blackjack pays 3 to 2','Free doubles on two-card hard 9, 10 and 11; other two-card doubles cost a bet, after splits too','Free splits on every pair except tens, up to four hands, aces included','Split aces get one card each, unless it is another ace','No surrender','A dealer 22 pushes every hand still in play, except a blackjack','No advice on insurance, even money or side bets'],
};

// Regular blackjack, "Blackjack" in the side panel; the trainer page grades Free Bet only. Cells run dealer 2 to A, space-separated as printed in the
// cited chart: Dh doubles else hits, Ds doubles else stands, - plays the pair as its total. Hard 8 covers 8 or less and hard 17 covers 17 or more;
// soft 20 and up stand. Every playable state has an answer, so best() never returns a gap. Checked three ways (STRATEGY.md).
const Classic={
 hard:{8:'H H H H H H H H H H',9:'H Dh Dh Dh Dh H H H H H',10:'Dh Dh Dh Dh Dh Dh Dh Dh H H',11:'Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh',12:'H H S S S H H H H H',13:'S S S S S H H H H H',14:'S S S S S H H H H H',15:'S S S S S H H H H H',16:'S S S S S H H H H H',17:'S S S S S S S S S S'},
 soft:{13:'H H H Dh Dh H H H H H',14:'H H H Dh Dh H H H H H',15:'H H Dh Dh Dh H H H H H',16:'H H Dh Dh Dh H H H H H',17:'H Dh Dh Dh Dh H H H H H',18:'Ds Ds Ds Ds Ds S S H H H',19:'S S S S Ds S S S S S',20:'S S S S S S S S S S'},
 pairs:{2:'P P P P P P - - - -',3:'P P P P P P - - - -',4:'- - - P P - - - - -',5:'- - - - - - - - - -',6:'P P P P P - - - - -',7:'P P P P P P - - - -',8:'P P P P P P P P P P',9:'P P P P P - P P - -',10:'- - - - - - - - - -',A:'P P P P P P P P P P'},
 best(hand,up,count){const c=hand.cards,{total,soft}=Engine.value(c),i=Engine.rank(up)-2,two=c.length===2,r=Engine.rank(c[0]);
 // Split aces stand on their one card, and A,A resplits while there is room.
 if(hand.aces)return c[1].r==='A'&&count<4?'P':'S';
 if(two&&r===Engine.rank(c[1])&&count<4&&this.pairs[r===11?'A':r].split(' ')[i]==='P')return 'P';
 // A pair that shouldn't or can't split plays its total. Soft 12 (A,A that can't split) is below the chart and hits.
 const a=soft?(total<13?'H':this.soft[Math.min(total,20)].split(' ')[i]):this.hard[Math.min(Math.max(total,8),17)].split(' ')[i];
 return a==='Dh'?(two?'D':'H'):a==='Ds'?(two?'D':'S'):a;
 }};
const ClassicRules={
 short:'Assumes 6 decks, dealer hits soft 17 and peeks, double after splits, no surrender.',
 full:['Six decks','Dealer hits soft 17','Dealer peeks for blackjack','Blackjack pays 3 to 2','Double on any first two cards, after splits too','Split any pair up to four hands, aces included; tens may be split, but the chart never does','Split aces get one card each, unless it is another ace','No surrender','No advice on insurance, even money or side bets'],
};
// The games the side panel advises on. free: splits and two-card hard 9-11 doubles are on the house. splitTens: the table lets tens split.
const Games={
 freebet:{name:'Free Bet',title:'Free Bet Blackjack',strategy:Strategy,rules:Rules,free:true,splitTens:false,edge:'about 1%',
  source:{label:'Wizard of Odds, Free Bet Blackjack',url:'https://wizardofodds.com/games/free-bet-blackjack/',covers:'the original-hand, free-hand and pair charts',checked:'28 September 2026',note:'An independent second-source check is still to come. Where the chart has no answer, the panel says so instead of guessing.'}},
 classic:{name:'Blackjack',title:'Regular blackjack',strategy:Classic,rules:ClassicRules,free:false,splitTens:true,edge:'about 0.6%',
  source:{label:'Wizard of Odds, 4–8 deck basic strategy',url:'https://wizardofodds.com/games/blackjack/strategy/4-decks/',covers:'the chart for a dealer who hits soft 17',checked:'6 October 2026',note:'Each cell was cross-checked three ways: against Wizard of Odds’ six-deck hand-by-hand tables, Ken Smith’s Blackjack Info strategy engine, and an exact six-deck calculation. Where a double isn’t possible, the panel shows the chart’s fallback.'}},
};
