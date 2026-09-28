(function(root){
const roles=['Tank','Healer','DPS'];
const slotsPerDay=24, startHour=12;
function available(p,day,start,duration){return p.submitted && Number.isInteger(day) && day>=0 && day<7 && Number.isInteger(start) && start>=0 && Number.isInteger(duration) && duration>0 && start+duration<=slotsPerDay && Array.from({length:duration},(_,i)=>day*slotsPerDay+start+i).every(k=>p.availability.includes(k));}
// Dynamic programming: one choice per person. Maximize filled role slots, then
// preference (main character). Gear is deliberately not a proxy for skill.
function compose(players,day,start,duration,targets){
 let states=new Map([['0,0,0',{counts:[0,0,0],score:0,team:[]}]]);
 for(const p of players.filter(p=>available(p,day,start,duration))){
  const next=new Map(states);
  for(const state of states.values()) for(const c of p.characters.filter(c=>c.willing)){
   const r=roles.indexOf(c.role);if(r<0||state.counts[r]>=targets[r])continue;
   const counts=state.counts.slice();counts[r]++;const score=state.score+(c.main?1:0),key=counts.join(',');
   if(!next.has(key)||next.get(key).score<score)next.set(key,{counts,score,team:[...state.team,{player:p.id,character:c.id,role:c.role}]});
  }states=next;
 }
 return [...states.values()].sort((a,b)=>b.team.length-a.team.length||b.score-a.score)[0];
}
function conflicts(entry,players,day,start,duration){const p=players.find(p=>p.id===entry.player),c=p?.characters.find(c=>c.id===entry.character);return !p||!c?['Character missing']:[...(!available(p,day,start,duration)?['Unavailable for full session']:[]),...(!c.willing?['Character not offered']:[]),...(c.role!==entry.role?['Role mismatch']:[])];}
root.RaidEngine={roles,slotsPerDay,startHour,available,compose,conflicts};if(typeof module!=='undefined')module.exports=root.RaidEngine;
})(typeof window==='undefined'?globalThis:window);
