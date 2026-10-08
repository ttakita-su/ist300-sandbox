'use strict';
// Side panel UI. Hand logic lives in advisor.js and the charts and games in strategy.js; this file draws, listens and stores. Each round carries its own
// game, and the game switch always shows the current round's.
const $=id=>document.getElementById(id),plays={H:'Hit',S:'Stand',D:'Double',P:'Split'},did={H:'Hit',S:'Stood',D:'Doubled',P:'Split'};
const LIMIT=500,RESUME_MS=5*60e3,inExtension=typeof chrome!=='undefined'&&!!chrome.storage?.local;
const keyDocs=[['A','Ace'],['2 – 9','Number cards'],['0 T J Q K','Any ten-value card. 1 then 0 types a ten too.'],['U','The next card is the dealer’s upcard'],['H S D P','What you did, when it wasn’t the play shown: hit, stood, doubled or split'],['Enter','Finish this hand'],['⌫','Undo the last entry, even a new round'],['N','Start a new round'],['G','Switch between Free Bet and Blackjack'],['Esc','Cancel U, or a 1 waiting for its 0']];
let round=blank('freebet'),undoStack=[],rounds=[],aim=null,pending=null,saving=true,canWrite=true,shown='';
const dirty=new Set();

// chrome.storage.local in the extension. Opened as a plain page (a preview), the panel falls back to localStorage.
const store=inExtension?{all:()=>chrome.storage.local.get(null),set:o=>chrome.storage.local.set(o),remove:k=>chrome.storage.local.remove(k)}:{
 async all(){const o={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('freebet.panel.'))o[k.slice(14)]=JSON.parse(localStorage.getItem(k));}return o;},
 async set(o){for(const [k,v] of Object.entries(o))localStorage.setItem('freebet.panel.'+k,JSON.stringify(v));},
 async remove(keys){for(const k of keys)localStorage.removeItem('freebet.panel.'+k);}};

function blank(game){return{id:'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),game,started:Date.now(),updated:Date.now(),open:true,steps:[]};}
const state=()=>Advisor.replay(round.steps.flat(),round.game);
const spoken=r=>r==='A'?'ace':r==='10'?'ten':r,article=r=>r==='A'?'an ace':r==='8'?'an 8':`a ${r}`,plural=r=>r==='A'?'aces':r==='10'?'tens':`${r}s`;

// One input: a card rank, H S D P for what the player did, Enter, U, N, G, Backspace or Escape. Each change is one undo step, even when it starts a new round.
function act(input,o={}){pending=null;
 if(input==='N')return newRound();
 if(input==='G'){const ids=Object.keys(Games);return setGame(ids[(ids.indexOf(round.game)+1)%ids.length]);}
 if(input==='Backspace')return undo();
 if(input==='Escape'){aim=null;pending=null;return draw();}
 const before=state(),r=Advisor.press(before,input,o.aim??aim),at=Date.now(),stamp=list=>list.map(e=>({...e,at}));
 aim=r.aim;hideInfo();
 if(r.newRound){const prev=round;if(r.events.length)prev.steps.push(stamp(r.events));prev.open=false;touch(prev);round=blank(prev.game);round.steps.push(stamp(r.then));undoStack.push({kind:'new',prev,carried:r.events.length>0});}
 else if(r.events.length){round.steps.push(stamp(r.events));undoStack.push({kind:'step'});}
 else{draw();return say(r.aim==='dealer'?'The next card is the dealer’s upcard.':r.aim==='hand'?'The next card is one you drew.':input in did?`${did[input]} isn’t possible on this hand.`:'Nothing to change yet.');}
 touch(round);draw();say(narrate(r,input));
}
function newRound(){if(!round.steps.length)return;const prev=round;prev.open=false;touch(prev);round=blank(prev.game);undoStack.push({kind:'new',prev,carried:false});aim=null;pending=null;draw();say('New round. Type your first card.');}
function undo(){const u=undoStack.pop(),was=round.game;
 if(u?.kind==='new'){round.gone=true;touch(round);round=u.prev;round.open=true;if(u.carried)round.steps.pop();}
 else if(round.steps.length)round.steps.pop();else return;
 round.gone=false;touch(round);aim=null;pending=null;if(round.game!==was)remember();draw();say('Undone. '+(round.game!==was?`Back to ${Games[round.game].name}. `:'')+answerFor(state()).why);
}
// The game switch. An empty round just changes game. One in progress is regraded in place: the same events give the same cards, and only the answers and
// verdicts change. A finished round, or one the other game would deal differently (a split of tens), is closed and a new round starts in the new game,
// as N would, so Backspace brings it back with its own game.
function setGame(game){pending=null;if(game===round.game||!Object.hasOwn(Games,game))return draw();hideInfo();const name=Games[game].name,done=Advisor.next(state(),null).newRound;let note;
 if(!round.steps.length){round.game=game;note=`${name}. ${Games[game].rules.short}`;}
 else if(!done&&Advisor.sameHands(round.steps.flat(),round.game,game)){round.game=game;touch(round);const a=answerFor(state());note=`${name}. This round’s answers are regraded. `+(a.play?`${a.play}${a.chip?', free':''}. ${a.why} ${a.about}.`:a.why);}
 else{const prev=round;prev.open=false;touch(prev);round=blank(game);undoStack.push({kind:'new',prev,carried:false});aim=null;
  note=done?`${name}. New round. Type your first card.`:`${name} doesn’t split tens, so this round stays as it was and a new ${name} round has started. Backspace brings it back.`;}
 remember();draw();say(note);}
// Settings are one stored object, so the save switch and the game are always written together.
function remember(){store.set({settings:{save:saving,game:round.game}}).catch(err=>notice(`The setting couldn’t be saved (${err.message}).`));}

// Answers in words: the play, why, and the hand it is for. The hand description is the quickest way to spot a mistyped card.
function describe(h,s){const c=h.cards,v=Engine.value(c),pair=c.length===2&&Engine.rank(c[0])===Engine.rank(c[1]);
 let d=pair?(c[0].r==='5'?'Hard 10, a pair of 5s':`Pair of ${plural(c[0].r)}`):`${v.soft&&v.total<=21?'Soft':'Hard'} ${v.total}`;
 if(s.dealer)d+=` against ${article(s.dealer.r)}`;
 if(s.hands.length>1)d=`Hand ${s.index+1}${h.free?' (free bet)':''}: ${d[0].toLowerCase()}${d.slice(1)}`;
 else if(s.dealer?.r==='A'&&c.length===2)d+='. No insurance advice';
 return d;}
function answerFor(s){const h=s.hands[s.index],n=s.hands.length;
 if(!h.cards.length)return{tone:'empty',why:s.dealer?'Now your two cards.':'Type or tap your two cards, then the dealer’s upcard.',about:s.dealer?`The dealer shows ${article(s.dealer.r)}.`:'This panel can’t see the casino tab.'};
 if(h.cards.length<2)return{tone:'empty',why:n>1?`Hand ${s.index+1}: type its second card.`:'Now your second card.',about:s.dealer?`The dealer shows ${article(s.dealer.r)}.`:''};
 const total=Engine.value(h.cards).total,about=describe(h,s);
 if(!s.dealer)return total===21&&n===1?{tone:'quiet',play:'Blackjack',why:'Pays 3 to 2. Nothing to decide.',about:'Type the dealer’s upcard, or N for a new round.'}:{tone:'empty',why:'Now the dealer’s upcard.',about};
 if(h.status==='doubling')return{tone:'quiet',play:'Doubled',why:'Type your one double card, or press Enter to skip it.',about};
 const a=Advisor.advise(h,s.dealer,n,s.game),charged=Games[s.game].free?'Not a free double':'Double';
 if(a.kind==='bust')return{tone:'quiet',play:'Bust',why:'Nothing left to decide on this hand.',about};
 if(a.kind==='blackjack')return{tone:'quiet',play:'Blackjack',why:'Pays 3 to 2. Nothing to decide.',about};
 if(a.kind==='twentyOne')return{tone:'quiet',play:'21',why:'Nothing left to decide on this hand.',about};
 if(a.kind==='done')return{tone:'quiet',play:'Hand done',why:a.reason==='four-hands'?'Split aces get one card, and four hands is the limit.':'Split aces get one card each.',about};
 if(h.status==='closed')return{tone:'quiet',play:h.doubled?'Doubled':'Stood',why:'This hand is finished.',about};
 if(a.kind==='gap')return{tone:'gap',play:'No chart answer',why:a.reason==='four-hands'?'The chart says split, but four hands is the limit, and it gives no other play for this pair.':'The chart says double, but you can’t double after drawing. One more card can’t bust this hand.',about};
 // In Free Bet every split is free; in Blackjack nothing is, and the copy says what the play costs.
 const why={H:'Take another card.',S:'Keep this hand.',D:a.free?'Free double: the extra bet is on the house.':`${charged}: add a bet equal to your first.`,P:h.cards[0].r==='A'?`${a.free?'Free split':'Split'}. Each ace gets one more card.`:a.free?'Free split. The new hand plays on a free bet.':'Split. Each hand gets a bet equal to your first.'}[a.action];
 return{tone:'action',play:plays[a.action],chip:a.free,why,about,action:a.action};}
function promptFor(s,route){if(pending)return'type 0 to make it a ten';const n=route.hand,many=s.hands.length>1;
 return{first:'your first card',second:many?`hand ${n}’s second card`:'your second card',dealer:'the dealer’s upcard','dealer-change':'a new dealer upcard',drawn:many?`the card hand ${n} drew`:'the card you drew','double-card':'your double card',split:`hand ${n}’s second card`,'next-hand':`hand ${n}’s second card`,'new-round':'first card of a new round'}[route.prompt];}
function narrate(r,input){const s=state(),parts=[],c=[...r.events,...r.then].filter(e=>e.t==='card').pop();
 if(r.newRound)parts.push('New round.');
 if(r.events.some(e=>e.t==='split'))parts.push('Split.');
 if(c)parts.push(`${spoken(c.r)} to ${c.to==='dealer'?'the dealer':s.hands.length>1?`hand ${s.index+1}`:'your hand'}.`);
 else if(input in did)parts.push(`Marked as ${did[input].toLowerCase()}.`);
 const a=answerFor(s);if(a.play)parts.push(`${a.play}${a.chip?', free':''}. ${a.why} ${a.about}.`);else parts.push(a.why);
 return parts.join(' ');}

function cardEl(r){const e=document.createElement('span');e.className='card';e.textContent=r;e.setAttribute('aria-hidden','true');return e;}
function slotEl(next){const e=document.createElement('span');e.className='slot'+(next?' next':'');e.textContent=next?'next':'';e.setAttribute('aria-hidden','true');return e;}
function draw(){const s=state(),route=Advisor.next(s,aim),h=s.hands[s.index],a=answerFor(s),toHand=route.to==='hand'&&!route.newRound&&!route.before.some(e=>e.t==='select'||e.t==='split');
 // Game switch. The rules line and About follow it, and are rebuilt only when the game changes.
 for(const i of $('game').querySelectorAll('input'))i.checked=i.value===round.game;
 if($('game').dataset.game!==round.game)showGame();
 // Dealer seat
 $('dealerCards').replaceChildren(s.dealer?cardEl(s.dealer.r):slotEl(route.to==='dealer'));
 $('dealerSeat').classList.toggle('aimed',aim==='dealer');$('dealerSeat').setAttribute('aria-pressed',String(aim==='dealer'));
 $('dealerSeat').setAttribute('aria-label',`Dealer’s upcard: ${s.dealer?spoken(s.dealer.r):'not entered'}. ${aim==='dealer'?'The next card replaces it.':'Select to change it.'}`);
 $('dealerHint').textContent=aim==='dealer'?'next card':s.dealer?'U to change':'';
 // Answer
 const key=[a.tone,a.play,a.why,a.about].join('|'),fresh=key!==shown;shown=key;
 $('answer').className=`answer ${a.tone}${fresh&&a.play?' fresh':''}${document.hasFocus()?'':' stale'}`;
 $('play').textContent=a.play||'';$('lammer').hidden=!a.chip;$('why').textContent=a.why;$('aboutHand').textContent=a.about||'';
 // Hands
 const list=$('handList');list.replaceChildren();
 if(s.hands.length>1)s.hands.forEach((x,i)=>{const li=document.createElement('li');li.className=i===s.index?'now':'';li.textContent=`Hand ${i+1}${i===s.index?' now':x.status==='closed'?' done':''}`;list.append(li);});
 $('handName').textContent=s.hands.length>1?`Hand ${s.index+1}`:'You';
 const cards=$('handCards');cards.replaceChildren(...h.cards.map(c=>cardEl(c.r)));if(toHand)cards.append(slotEl(true));cards.classList.toggle('tight',h.cards.length>4);
 const v=Engine.value(h.cards),pair=h.cards.length===2&&Engine.rank(h.cards[0])===Engine.rank(h.cards[1]);$('handTotal').textContent=h.cards.length?(v.total>21?'Bust':`${pair?'Pair':`${v.soft?'Soft ':''}${v.total}`}${h.free?', free bet':''}`):'';
 $('handSeat').setAttribute('aria-label',`${s.hands.length>1?`Hand ${s.index+1}`:'Your hand'}: ${h.cards.length?h.cards.map(c=>spoken(c.r)).join(', '):'no cards yet'}`);
 // Prompt, dealer row, what-you-did row, controls
 $('prompt').replaceChildren('Next card: ',Object.assign(document.createElement('b'),{textContent:promptFor(s,route)}));
 for(const b of $('dealerStrip').querySelectorAll('button'))b.setAttribute('aria-pressed',String(s.dealer?.r===b.dataset.rank));
 const deciding=a.tone==='action'||a.tone==='gap',L=Advisor.legal(s),implied=route.before.some(e=>e.t==='split')?'P':route.before.some(e=>e.t==='double')?'D':route.before.some(e=>e.t==='stand')?'S':'H';
 $('did').classList.toggle('off',!deciding);
 for(const b of $('did').querySelectorAll('button')){b.hidden=b.dataset.act===implied;b.disabled=!deciding||!L[b.dataset.act];}
 $('undo').disabled=!undoStack.length&&!round.steps.length;$('newRound').disabled=!round.steps.length;
 if(!$('history').hidden)drawHistory();
}

// Storage: one key per round, written shortly after a change, so the answer never waits on a write and two windows can't overwrite each other's rounds.
function record(r){const s=Advisor.replay(r.steps.flat(),r.game);return{id:r.id,game:r.game,started:r.started,updated:r.updated,open:r.open,source:'extension',version:version(),assisted:true,steps:r.steps,
 dealer:s.dealer?.r??null,dealerFinalTotal:null,hands:s.hands.map(h=>({cards:h.cards.map(c=>c.r),free:h.free})),
 decisions:s.decisions.map(d=>({hand:d.hand,cards:d.cards.map(r=>({r,s:''})),free:d.free,dealerUpcard:{r:d.dealerUpcard,s:''},hands:d.hands,action:d.action,optimal:d.optimal,verdict:d.verdict,freePlay:!!d.advice.free,reason:d.advice.reason??null,assisted:true,timestamp:new Date(d.at??r.updated).toISOString()}))};}
// Rounds saved before there were two games have no game field, and are Free Bet.
const valid=r=>!!r&&typeof r==='object'&&typeof r.id==='string'&&typeof r.started==='number'&&Array.isArray(r.steps)&&Array.isArray(r.decisions)&&(r.game===undefined||Object.hasOwn(Games,r.game));
let timer,saved=Promise.resolve();function touch(r){r.updated=Date.now();dirty.add(r);clearTimeout(timer);timer=setTimeout(()=>{saved=saved.then(flush);},200);}
async function flush(){if(!canWrite){dirty.clear();return;}const set={},remove=[],batch=[...dirty];dirty.clear();
 for(const r of batch){const rec=record(r);if(!r.gone&&saving&&rec.decisions.length)set['round:'+r.id]=rec;else if(r.saved&&(r.gone||!rec.decisions.length))remove.push('round:'+r.id);}
 try{if(Object.keys(set).length)await store.set(set);if(remove.length)await store.remove(remove);
  for(const r of batch){const k='round:'+r.id;if(set[k]){r.saved=true;rounds=[set[k],...rounds.filter(x=>x.id!==r.id)];}else if(remove.includes(k)){r.saved=false;rounds=rounds.filter(x=>x.id!==r.id);}}
  rounds.sort((x,y)=>y.started-x.started);
  if(rounds.length>LIMIT){const old=rounds.slice(LIMIT);rounds=rounds.slice(0,LIMIT);await store.remove(old.map(x=>'round:'+x.id));}
 }catch(e){notice(`The last hand couldn’t be saved (${e.message}). It stays in this panel until you close it.`);}
 if(!$('history').hidden)drawHistory();}
async function load(){
 try{const all=await store.all(),recs=Object.keys(all).filter(k=>k.startsWith('round:')).map(k=>all[k]),ok=recs.filter(valid);
  saving=all.settings?.save!==false;rounds=ok.sort((x,y)=>y.started-x.started);
  if(Object.hasOwn(Games,all.settings?.game)&&!round.steps.length)round.game=all.settings.game;
  if(ok.length<recs.length)notice(`${recs.length-ok.length} saved round${recs.length-ok.length>1?'s':''} couldn’t be read. ${recs.length-ok.length>1?'They are':'It is'} left in storage unchanged.`);
  // Pick up a hand left open in the last few minutes; older or finished rounds stay in History.
  const last=rounds.find(r=>r.open);
  if(last&&!round.steps.length&&Date.now()-last.updated<RESUME_MS&&!(await otherPanel())){const r={id:last.id,game:last.game??'freebet',started:last.started,updated:last.updated,open:true,steps:last.steps,saved:true},s=Advisor.replay(r.steps.flat(),r.game);
   if(!Advisor.next(s,null).newRound&&!round.steps.length){round=r;info(`Continuing your ${Games[r.game].name} hand from ${new Date(last.updated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}. Press N for a new round.`);}}
 }catch(e){canWrite=false;notice('Saved hands can’t be read right now, so nothing new is saved and nothing stored is changed. The advisor still works.');}
 draw();}
async function otherPanel(){if(!inExtension||!chrome.runtime.getContexts)return false;const open=await chrome.runtime.getContexts({});return open.filter(c=>(c.documentUrl||'').split(/[?#]/)[0].endsWith('/sidepanel.html')).length>1;}
function onStorage(changes,area){if(area!=='local')return;let changed=false;
 for(const [k,{newValue}] of Object.entries(changes)){if(!k.startsWith('round:')||k==='round:'+round.id)continue;changed=true;rounds=rounds.filter(x=>'round:'+x.id!==k);if(valid(newValue))rounds.push(newValue);}
 if(changed){rounds.sort((x,y)=>y.started-x.started);if(!$('history').hidden)drawHistory();}}

function drawHistory(){const list=$('historyList'),cur=record(round),all=[...(cur.decisions.length&&saving?[cur]:[]),...rounds.filter(r=>r.id!==round.id)];
 $('limit').textContent=LIMIT;$('saveToggle').checked=saving;$('clearHistory').hidden=!rounds.length;list.replaceChildren();
 if(!all.length){const p=document.createElement('p');p.className='history-empty';p.textContent=saving?'No hands yet. Hands you look up in the Advisor appear here.':'Saving is off, so new hands aren’t kept.';list.append(p);return;}
 const today=new Date().toDateString();
 for(const r of all){const d0=r.decisions[0],off=r.decisions.filter(d=>d.verdict==='misplay').length,gaps=r.decisions.filter(d=>d.optimal===null).length,el=document.createElement('details'),sum=document.createElement('summary'),meta=document.createElement('span'),ol=document.createElement('ol');
  el.className='round'+(off||gaps?' flagged':'');
  const t=new Date(r.started),time=document.createElement('time');time.dateTime=t.toISOString();time.textContent=(t.toDateString()===today?'':t.toLocaleDateString()+', ')+t.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  // The game tag sits in the summary so it shows while the round is collapsed. A round saved before there were two games is Free Bet.
  const game=Object.assign(document.createElement('span'),{className:'tag',textContent:Games[r.game??'freebet'].name});
  sum.append(`${d0.cards.map(c=>c.r).join(' ')} against ${d0.dealerUpcard.r}: ${d0.optimal?plays[d0.optimal]:'no chart answer'}`,game,time);meta.className='meta';
  for(const [show,text] of [[r.id===round.id,'In progress'],[off,`${off} not the chart’s play`],[gaps,'No chart answer']])if(show){const tag=document.createElement('span');tag.className='tag';tag.textContent=text;meta.append(' ',tag);}
  for(const d of r.decisions){const li=document.createElement('li'),b=document.createElement('b');
   b.textContent=d.optimal?`${plays[d.optimal]}${d.freePlay?' (free)':''}`:'no chart answer';
   li.append(`${r.decisions.length>1||d.hand>1?`Hand ${d.hand}: `:''}${d.cards.map(c=>c.r).join(' ')} against ${d.dealerUpcard.r}. Chart: `,b,`. You: ${d.action?did[d.action].toLowerCase():'not entered'}${d.verdict==='misplay'?', not the chart’s play':''}.`);ol.append(li);}
  const fin=document.createElement('p');fin.className='meta';fin.textContent='Final cards: '+r.hands.map(h=>h.cards.join(' ')).join(' / ');
  el.append(sum,meta,ol,fin);list.append(el);}}

const version=()=>inExtension?chrome.runtime.getManifest().version:'preview';
function notice(t){const n=$('notice');n.textContent=t;n.setAttribute('role','alert');n.dataset.kind='error';n.hidden=false;}
function info(t){const n=$('notice');n.textContent=t;n.setAttribute('role','status');n.dataset.kind='info';n.hidden=false;}
function hideInfo(){if($('notice').dataset.kind==='info')$('notice').hidden=true;}
function say(t){const s=$('status');s.textContent='';requestAnimationFrame(()=>{s.textContent=t;});}
function showTab(name){for(const t of ['advisor','history','about']){const on=t===name,tab=$('tab-'+t);tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;$(t).hidden=!on;}if(name==='history')drawHistory();}
// The game shown everywhere: the rules line under the felt, and About's rules, house edge and source. All of it comes from Games in strategy.js.
function showGame(){const g=Games[round.game];$('game').dataset.game=round.game;
 // One short caution for both games, so the Blackjack line still fits three lines at the narrowest panel; About gives the full caution.
 $('assumes').textContent=`${g.rules.short} Other rules can change the play.`;
 $('rulesGame').textContent=g.title;$('rulesList').replaceChildren(...g.rules.full.map(t=>Object.assign(document.createElement('li'),{textContent:t})));$('edge').textContent=g.edge;
 Object.assign($('sourceLink'),{href:g.source.url,textContent:g.source.label});$('sourceText').textContent=`: ${g.source.covers}, checked ${g.source.checked}. ${g.source.note}`;}
function focusState(){const f=document.hasFocus(),e=$('focusState');e.textContent=f?'Keyboard ready':'Click here to type';e.classList.toggle('away',!f);$('answer').classList.toggle('stale',!f);}

function init(){
 for(const r of Advisor.ranks){const k=document.createElement('button');k.type='button';k.dataset.rank=r;
  if(r==='10'){k.append('10',Object.assign(document.createElement('small'),{textContent:'J Q K'}));k.setAttribute('aria-label','10, J, Q or K: any ten-value card');}else{k.textContent=r;if(r==='A')k.setAttribute('aria-label','A, ace');}
  k.addEventListener('mousedown',e=>e.preventDefault());k.addEventListener('click',()=>act(r));$('keypad').append(k);
  const d=document.createElement('button');d.type='button';d.dataset.rank=r;d.textContent=r;d.setAttribute('aria-label',`Dealer shows ${r==='10'?'10, J, Q or K':r==='A'?'A, ace':r}`);
  d.addEventListener('mousedown',e=>e.preventDefault());d.addEventListener('click',()=>act(r,{aim:'dealer'}));$('dealerStrip').append(d);}
 for(const x of ['H','S','D','P']){const b=document.createElement('button');b.type='button';b.dataset.act=x;b.textContent=did[x];b.title=`Press ${x}`;b.addEventListener('click',()=>act(x));$('did').append(b);}
 $('dealerSeat').addEventListener('click',()=>{aim=aim==='dealer'?null:'dealer';draw();say(aim?'The next card replaces the dealer’s upcard.':'Cancelled.');});
 $('handSeat').addEventListener('click',()=>{if(aim){aim=null;draw();}});
 $('undo').addEventListener('click',()=>act('Backspace'));$('newRound').addEventListener('click',()=>act('N'));
 // The game switch: real radios, one per game, for Tab, the arrow keys and screen readers. A pointer click on a label skips the label's default, which
 // would focus the radio and ring it on the next typed card, so typing carries on where it was.
 for(const [id,g] of Object.entries(Games)){const l=document.createElement('label'),i=Object.assign(document.createElement('input'),{type:'radio',name:'game',value:id});
  l.addEventListener('mousedown',e=>e.preventDefault());l.addEventListener('click',e=>{if(e.target!==i){e.preventDefault();setGame(id);}});i.addEventListener('change',()=>{if(i.checked)setGame(id);});l.append(i,Object.assign(document.createElement('span'),{textContent:g.name}));$('gameSeg').append(l);}
 $('keys').replaceChildren(...keyDocs.flatMap(([k,t])=>[Object.assign(document.createElement('dt'),{textContent:k}),Object.assign(document.createElement('dd'),{textContent:t})]));
 $('version').textContent=version();
 if(inExtension&&chrome.commands?.getAll)chrome.commands.getAll().then(list=>{const c=list.find(x=>x.name==='_execute_action');$('shortcut').textContent=c?.shortcut?`Open or close the panel with ${c.shortcut}.`:'To open the panel from the keyboard, choose a shortcut at chrome://extensions/shortcuts.';});
 const tabs=[...document.querySelectorAll('[role=tab]')];
 tabs.forEach((t,i)=>{t.addEventListener('click',()=>showTab(t.id.slice(4)));t.addEventListener('keydown',e=>{const j={ArrowLeft:i-1,ArrowRight:i+1,Home:0,End:tabs.length-1}[e.key];if(j===undefined)return;e.preventDefault();const n=tabs[(j+tabs.length)%tabs.length];n.focus();showTab(n.id.slice(4));});});
 $('saveToggle').addEventListener('change',e=>{saving=e.target.checked;remember();if(saving)touch(round);drawHistory();});
 $('clearHistory').addEventListener('click',async e=>{const b=e.currentTarget;
  if(!b.dataset.armed){b.dataset.armed='1';b.textContent=`Delete ${rounds.length} saved round${rounds.length>1?'s':''}? Select again`;setTimeout(()=>{delete b.dataset.armed;b.textContent='Clear history';},4000);return;}
  try{await store.remove(rounds.map(x=>'round:'+x.id));rounds=[];round.saved=false;undoStack=[];delete b.dataset.armed;b.textContent='Clear history';drawHistory();say('History cleared.');}catch(err){notice(`History couldn’t be cleared (${err.message}).`);}});
 // Keys: digits are read from the physical key; Enter and Space stay with a focused button; arrow keys stay with the tabs and the game switch. A radio
 // has no use for Enter, so Enter on the switch still finishes the hand.
 document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.target.closest('[role=tablist]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  if(e.target.type==='radio'&&e.key.startsWith('Arrow'))return;
  if(e.key===' '&&e.target.closest('button,a,input,summary')||e.key==='Enter'&&e.target.closest('button,a,input:not([type=radio]),summary'))return;
  const r=Advisor.input(e,pending);if(!r.input&&r.pending===pending&&!r.hint)return;
  e.preventDefault();pending=r.pending;
  // G switches game from any tab; About shows the new game's rules in place.
  if(r.input&&r.input!=='Escape'&&r.input!=='G'&&$('advisor').hidden)showTab('advisor');
  if(r.input)act(r.input);else draw();
  if(r.hint)say('For a ten, type 0, T, J, Q or K, or 1 then 0. For an ace, type A.');});
 addEventListener('focus',focusState);addEventListener('blur',focusState);
 if(inExtension)chrome.storage.onChanged.addListener(onStorage);
 focusState();draw();load();
}
init();
