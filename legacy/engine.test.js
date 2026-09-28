const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('./engine.js');
const char=(id,role,main=true,willing=true)=>({id,role,main,willing});
const person=(id,characters,availability=[0,1,2,3])=>({id,characters,availability,submitted:true});
test('one player with multiple alts can never fill multiple slots',()=>{
 const players=[person(1,[char('a','Tank'),char('b','Healer')])];
 assert.equal(E.compose(players,0,0,4,[1,1,0]).team.length,1);
});
test('flexible player is assigned to the role needed for a complete team',()=>{
 const players=[person(1,[char('a','Tank'),char('b','Healer',false)]),person(2,[char('c','Tank')])];
 const result=E.compose(players,0,0,4,[1,1,0]);
 assert.equal(result.team.length,2);assert.equal(result.team.find(e=>e.player===1).character,'b');
});
test('partial attendance, drafts, and unoffered characters are excluded',()=>{
 const players=[person(1,[char('a','Tank')],[0,1,2]),{...person(2,[char('b','Tank')]),submitted:false},person(3,[char('c','Tank',true,false)])];
 assert.equal(E.compose(players,0,0,4,[1,0,0]).team.length,0);
});
test('main character wins a tie and role counts stay within caps',()=>{
 const result=E.compose([person(1,[char('a','DPS',false),char('b','DPS')]),person(2,[char('c','DPS')])],0,0,4,[0,0,1]);
 assert.equal(result.team.length,1);assert.equal(result.score,1);
});
test('manual overrides expose attendance, willingness and role conflicts',()=>{
 const p=person(1,[char('a','DPS',true,false)],[0]);
 assert.deepEqual(E.conflicts({player:1,character:'a',role:'Tank'},[p],0,0,4),['Unavailable for full session','Character not offered','Role mismatch']);
});
test('empty guild produces empty roster',()=>assert.deepEqual(E.compose([],0,0,4,[2,4,14]).team,[]));
test('availability uses the requested day and complete interval',()=>{
 const p=person(1,[char('a','Tank')],[24,25,26,27]);assert.equal(E.available(p,0,0,4),false);assert.equal(E.available(p,1,0,4),true);assert.equal(E.available(p,1,1,4),false);
});

test('late-night sessions may end at midnight but cannot cross into another day',()=>{
 const p=person(1,[char('a','Tank')],[22,23,24]);
 assert.equal(E.available(p,0,22,2),true);
 assert.equal(E.available(p,0,23,2),false);
 assert.equal(E.available(p,1,0,1),true);
});
