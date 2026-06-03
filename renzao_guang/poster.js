/* ============================================================
   Poster atmosphere — DARK. No glow light.
   Sparse red claw-scratches flicker across the black and a
   faint pool of blood sits at the bottom. The horror lives in
   the scratched red words (CSS); this just breathes underneath.
   Stops when the poster is dismissed.
   ============================================================ */
(function(){
"use strict";
const cv=document.getElementById("posterFx");
const poster=document.getElementById("poster");
if(!cv||!poster)return;
const ctx=cv.getContext("2d");
let W=0,H=0,DPR=1,running=false,frames=0,t0=0,scratches=[],nextAt=0.6;

function resize(){
  const r=poster.getBoundingClientRect();
  W=Math.max(1,r.width);H=Math.max(1,r.height);DPR=Math.min(2,window.devicePixelRatio||1);
  cv.width=W*DPR;cv.height=H*DPR;cv.style.width=W+"px";cv.style.height=H+"px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
function makeScratch(){
  const x=50+Math.random()*(W-100), y=70+Math.random()*(H-160);
  const ang=(-0.45+Math.random()*0.9)+(Math.random()<0.45?Math.PI/2:0);
  const len=70+Math.random()*200, segs=4+((Math.random()*4)|0), pts=[];
  for(let i=0;i<=segs;i++){const t=i/segs;
    pts.push([x+Math.cos(ang)*len*t+(Math.random()-0.5)*11, y+Math.sin(ang)*len*t+(Math.random()-0.5)*11]);}
  return {pts, born:0, life:0.32+Math.random()*0.45, w:0.7+Math.random()*1.7, a:0.14+Math.random()*0.2, set:false};
}
function draw(t){
  ctx.clearRect(0,0,W,H);
  const hz=ctx.createLinearGradient(0,H*0.66,0,H);
  hz.addColorStop(0,"rgba(80,0,8,0)");hz.addColorStop(1,"rgba(86,2,10,0.13)");
  ctx.fillStyle=hz;ctx.fillRect(0,H*0.66,W,H*0.34);
  for(const s of scratches){
    if(!s.set){s.born=t;s.set=true;}
    const p=(t-s.born)/s.life; if(p>1)continue;
    const al=s.a*(p<0.18?p/0.18:1-(p-0.18)/0.82);
    ctx.strokeStyle="rgba(150,14,20,"+Math.max(0,al).toFixed(3)+")";
    ctx.lineWidth=s.w;ctx.lineCap="round";ctx.beginPath();
    ctx.moveTo(s.pts[0][0],s.pts[0][1]);
    for(let i=1;i<s.pts.length;i++)ctx.lineTo(s.pts[i][0],s.pts[i][1]);
    ctx.stroke();
  }
  scratches=scratches.filter(s=>!s.set||t-s.born<s.life);
  if(t>nextAt){scratches.push(makeScratch());nextAt=t+0.9+Math.random()*2.0;}
}
function loop(ts){
  if(!running)return;
  if(poster.classList.contains("gone")){running=false;return;}
  if(!t0)t0=ts;
  draw((ts-t0)/1000);frames++;
  requestAnimationFrame(loop);
}
resize();
window.addEventListener("resize",resize);
running=true;requestAnimationFrame(loop);
window.__poster={get frames(){return frames;},get running(){return running;}};
})();
