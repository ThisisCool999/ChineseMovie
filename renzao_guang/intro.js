/* ============================================================
   INTRO — a watchable cold open before the choose-version page.
   A giant backlit donor stands, pricks his hand with a needle,
   a drop of blood wells and falls; the camera plunges after it;
   the blood blooms into red light that becomes the title page.
   Skippable (click). Hands off to #poster, then removes itself.
   ============================================================ */
(function(){
"use strict";
const root=document.getElementById("intro");
if(!root)return;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const eOut=t=>1-Math.pow(1-t,3);
const eInOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;

const MAN_SVG=
'<svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">'+
  '<g fill="#04060c" stroke="#04060c" stroke-linecap="round" stroke-linejoin="round">'+
    '<path d="M462 558 L452 730 L460 902" stroke-width="62" fill="none"/>'+
    '<path d="M538 558 L548 730 L540 902" stroke-width="62" fill="none"/>'+
    '<path d="M384 266 C 420 246 580 246 616 266 L 574 558 C 545 580 455 580 426 558 Z"/>'+
    '<path d="M406 286 L372 432 L486 504" stroke-width="52" fill="none"/>'+
    '<path d="M594 286 L628 432 L514 504" stroke-width="52" fill="none"/>'+
    '<circle cx="404" cy="282" r="32"/><circle cx="596" cy="282" r="32"/>'+
    '<circle cx="500" cy="506" r="36"/>'+
    '<rect x="470" y="196" width="60" height="54" rx="20"/>'+
    '<circle cx="500" cy="150" r="64"/>'+
  '</g>'+
  '<g id="introSyr" transform="rotate(34 500 500)">'+
    '<rect x="506" y="492" width="86" height="15" rx="4" fill="#9fb0c2"/>'+
    '<rect x="586" y="486" width="15" height="27" rx="3" fill="#cdd9e6"/>'+
    '<line x1="506" y1="500" x2="466" y2="500" stroke="#e4eef6" stroke-width="3.4"/>'+
    '<circle id="introGlint" cx="466" cy="500" r="3.4" fill="#ffffff"/>'+
  '</g>'+
'</svg>';

root.innerHTML=
  '<div class="intro-layer intro-man" id="introMan"><div class="intro-back"></div>'+MAN_SVG+'<div class="intro-floor"></div></div>'+
  '<div class="intro-layer intro-fall" id="introFall"><div class="intro-streak"></div></div>'+
  '<div class="intro-trail" id="introTrail"></div>'+
  '<div class="intro-drop" id="introDrop"></div>'+
  '<div class="intro-bloom" id="introBloom"></div>'+
  '<div class="intro-flash" id="introFlash"></div>'+
  '<div class="intro-skip">点击跳过 ▸</div>';

const man=root.querySelector("#introMan"),fall=root.querySelector("#introFall"),streak=root.querySelector(".intro-streak"),
      trail=root.querySelector("#introTrail"),drop=root.querySelector("#introDrop"),bloom=root.querySelector("#introBloom"),
      flash=root.querySelector("#introFlash"),syr=root.querySelector("#introSyr"),glint=root.querySelector("#introGlint");
let clock=0,last=0,running=true,handed=false,raf=0;
const END=6.5;

function tick(T){
  const vh=window.innerHeight||root.clientHeight||800;
  // man slides in from the top, then the camera descends (man scrolls up) after the drop
  let manY;
  if(T<1.1)manY=lerp(-100,0,eOut(clamp(T/1.1,0,1)));
  else manY=lerp(0,-116,eInOut(clamp((T-3.3)/2.3,0,1)));
  man.style.transform="translateY("+manY.toFixed(2)+"%)";
  man.style.opacity=(clamp(T/0.6,0,1)*(1-clamp((T-3.9)/1.5,0,1))).toFixed(3);

  // needle pushes in; glint; prick flash at the hand
  const pr=clamp((T-2.0)/0.5,0,1);
  if(syr)syr.setAttribute("transform","translate("+lerp(0,-12,pr).toFixed(1)+","+lerp(0,7,pr).toFixed(1)+") rotate(34 500 500)");
  if(glint)glint.setAttribute("opacity",(0.4+0.6*Math.abs(Math.sin(T*4))).toFixed(2));
  flash.style.opacity=clamp((T>2.2&&T<2.8)?(1-Math.abs(T-2.45)/0.2):0,0,1).toFixed(2);

  // the drop wells at the fingertip, then FALLS — visibly, accelerating, with a trail
  const well=clamp((T-2.45)/0.55,0,1);
  const fallP=clamp((T-3.05)/2.75,0,1);     // fall window 3.05s -> 5.8s
  const fe=Math.pow(fallP,1.8);             // gravity: starts slow, accelerates
  const land=clamp((T-5.6)/0.5,0,1);
  const wob=Math.sin(T*6.5)*(1.5+4*fallP);
  const fallPx=fe*vh*0.46;                  // drop travels ~46vh down the screen
  const ds=Math.max(0,well*(1-land));
  drop.style.transform="translate(-50%,-50%) translate("+wob.toFixed(1)+"px,"+fallPx.toFixed(1)+"px) scale("+ds.toFixed(3)+")";
  drop.style.opacity=(Math.min(1,well*1.2)*(1-land)).toFixed(2);
  const th=fallP*(70+60*fallP);             // motion-blur trail grows with speed
  trail.style.height=Math.max(0,th).toFixed(0)+"px";
  trail.style.transform="translate(-50%,-100%) translate("+wob.toFixed(1)+"px,"+fallPx.toFixed(1)+"px)";
  trail.style.opacity=(clamp(fallP*1.4,0,1)*(1-land)).toFixed(2);

  // the void we plunge through
  fall.style.opacity=clamp((T-3.2)/1.0,0,1).toFixed(2);
  streak.style.opacity=(clamp((T-3.3)/0.8,0,1)*0.85).toFixed(2);

  // landing -> blood bloom rises from where the drop lands, then fills the frame
  const bp=clamp((T-5.6)/0.7,0,1),be=eOut(bp);
  bloom.style.transform="translate(-50%,-50%) translate(0px,"+lerp(vh*0.46,0,be).toFixed(0)+"px) scale("+lerp(0,9.5,be).toFixed(2)+")";
  bloom.style.opacity=clamp((T-5.6)/0.3,0,1).toFixed(2);
}

function handoff(reason){
  if(handed)return;handed=true;
  try{console.log("[intro] handoff:",reason||"?","@",clock.toFixed(2)+"s");}catch(e){}
  const poster=document.getElementById("poster");
  if(poster){
    poster.classList.add("revealed");                 // fire the poster entrance exactly once
    const rw=document.createElement("div");rw.className="poster-redwash";poster.appendChild(rw);
    requestAnimationFrame(()=>requestAnimationFrame(()=>rw.classList.add("fade")));
    setTimeout(()=>{try{rw.remove();}catch(e){}},2100);
  }
  root.classList.add("done");
  setTimeout(()=>{running=false;if(raf)cancelAnimationFrame(raf);try{root.remove();}catch(e){}},1100);
}
function frame(ts){
  if(!running)return;
  if(last)clock+=Math.min(0.05,Math.max(0,(ts-last)/1000));   // clamp dt: a hidden tab / load jank can't skip the intro
  last=ts;
  try{tick(clock);}catch(e){try{console.log("[intro] tick error:",e&&e.message);}catch(_){}}
  if(clock>=END&&!handed){handoff("end");return;}
  raf=requestAnimationFrame(frame);
}
const _skip=root.querySelector(".intro-skip");
if(_skip)_skip.addEventListener("click",e=>{e.stopPropagation();handoff("skip");});

const _t=/#t=([\d.]+)/.exec(location.hash);
if(_t){running=false;tick(parseFloat(_t[1]));}        // test hook: freeze at a given second
else{raf=requestAnimationFrame(frame);}               // always play — incl. macOS Reduce Motion
window.__intro={running:()=>running,skip:handoff,seek:T=>{running=false;if(raf)cancelAnimationFrame(raf);tick(T);}};
})();
