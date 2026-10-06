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
