const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');const script=html.split('<script>')[1].split('</script>')[0];
const context=vm.createContext({});vm.runInContext(script.slice(0,script.indexOf('const $='))+';globalThis.api={Engine,Strategy};',context);const {Engine:E,Strategy:S}=context.api;
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
console.log(`Passed ${count} chart regression cases plus engine and gap checks.`);
