// Headless driver study: how fast can different "human models" lap the track?
// Usage: node tools/driver-study.js [runs]   (reads the Sim straight out of ../index.html)
const fs=require('fs'),vm=require('vm'),nodePath=require('path');
const html=fs.readFileSync(nodePath.join(__dirname,'..','index.html'),'utf8');
const src=html.slice(html.indexOf('const Sim = (() => {'),html.indexOf('if (typeof module'));
const Sim=vm.runInNewContext(src+';Sim',{Math,Float32Array});
const {T,N,HALF_W,angDiff,clamp}=Sim;
function gauss(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
// ideal pure-pursuit steer toward centre lane (what a perfect human "wants")
function want(c){const sp=Math.hypot(c.vx,c.vy),i=c.idx,ti=(i+3+Math.floor(sp/75))%N;
  return angDiff(c.a,Math.atan2(T.y[ti]-c.y,T.x[ti]-c.x));}
const MODELS={
  // keys: binary steer, 0.1s reaction, lifts off gas in corners (a good desktop player)
  keyboard:{mk:()=>({q:[]}),f:(c,m,dt,S)=>{const da=want(c);const s=Math.abs(da)<0.06?0:Math.sign(da);m.q.push(s);if(m.q.length>6)m.q.shift();
    const vf=c.vx*Math.cos(c.a)+c.vy*Math.sin(c.a);return{steer:m.q[0],thr:vf<T.vsafe[c.idx]*1.12?1:0,brk:0}}},
  // thumb: analog, noisy, 0.2s delay, understeers (gain .6), gas ALWAYS on
  thumb:{mk:()=>({q:[],n:0}),f:(c,m,dt)=>{m.n+=(gauss()*0.35-m.n)*Math.min(1,dt*6);const da=want(c);
    m.q.push(clamp(da*1.6*0.6+m.n*0.5,-1,1));if(m.q.length>12)m.q.shift();return{steer:m.q[0],thr:1,brk:0}}},
};
function run(model,seed,opts={}){
  const S=Sim.create();Sim.reset(S,'race');S.player.auto=false;S.assist=!!opts.assist;
  const P=S.player,m=MODELS[model].mk();let wall=0,hp0=P.hp,t=0;
  const dt=1/60;
  for(;t<240&&S.state!=='over';t+=dt){
    if(S.state==='race'){const o=MODELS[model].f(P,m,dt,S);S.input.steer=o.steer;S.input.thr=o.thr;S.input.brk=o.brk;S.input.fire=0;}
    Sim.step(S,dt);
    for(const e of S.events)if(e.t==='crash')wall++;S.events.length=0;
  }
  const r=S.result;return{kind:r&&r.kind,place:r&&r.place,time:r&&r.kind==='finish'?+r.time.toFixed(1):null,crashes:wall,hp:Math.round(P.hp),ai:Sim.ranking(S).filter(c=>c.finished&&!c.isPlayer).length};
}
const N_RUNS=+process.argv[2]||12;
for(const [name,opts] of [['keyboard',{}],['thumb',{}],['thumb',{assist:true}],['keyboard',{assist:true}]]){
  const rs=[];for(let i=0;i<N_RUNS;i++)rs.push(run(name,i,opts));
  const fin=rs.filter(r=>r.kind==='finish');
  const avg=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):null;
  console.log((name+(opts.assist?'+ASSIST':'')).padEnd(16),'finished',fin.length+'/'+N_RUNS,'avg time',avg(fin.map(r=>r.time)),'avg place',avg(rs.map(r=>r.place)),'wins',rs.filter(r=>r.place===1).length,'avg wall/car crashes',avg(rs.map(r=>r.crashes)),'avg hp left',avg(rs.map(r=>r.hp)),'AIs finished before player(avg)',avg(rs.map(r=>r.ai)));
}
