/* ============================================================
   《人造光》 — film engine
   Single global: window.Film
   Architecture: timeline clock -> active shot -> DOM scene layer
   + particle canvas + per-act color grade + subtitles + audio.
   ============================================================ */
(function(){
"use strict";

/* ---------- tiny dom helpers ---------- */
const $  = (s,r=document)=>r.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const rnd=(a,b)=>a+Math.random()*(b-a);
function E(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
function fmt(s){s=Math.max(0,Math.floor(s));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");}

/* ---------- registries (filled below by appended blocks) ---------- */
const SC = {};        // scene renderers: key -> { build(layer,shot)->{update?(p)} }
const SHOTS = [];     // ordered shots {n,frame,act,start,end,scene,data,grade,fx,subs}
const ACTS = [
  {no:"",  name:"档案 · 片名",         grade:{tint:"#000000",tintA:0,  warm:"#5dffa0",sat:1,  con:1,   bri:1,   bloomC:"#5dffa0",bloomA:0,  vig:.82}},
  {no:"一",name:"秋犯的世界",          grade:{tint:"#1a2630",tintA:.14,warm:"#f4c97a",sat:1.0, con:1.02,bri:1.06,bloomC:"#cfe6ff",bloomA:.12,vig:.58}},
  {no:"二",name:"带走",                grade:{tint:"#14110c",tintA:.16,warm:"#e7c887",sat:.96,con:1.04,bri:1.02,bloomC:"#e7c887",bloomA:.08,vig:.64}},
  {no:"三",name:"外面的真相",          grade:{tint:"#15131f",tintA:.14,warm:"#cdb9ff",sat:1.06,con:1.03,bri:1.06,bloomC:"#cdb9ff",bloomA:.12,vig:.6}},
  {no:"四",name:"熄灭",                grade:{tint:"#0e1316",tintA:.2, warm:"#9fb0b5",sat:.5, con:1.05,bri:.98, bloomC:"#9fb0b5",bloomA:.04,vig:.72}},
  {no:"五",name:"崩溃的世界",          grade:{tint:"#161015",tintA:.18,warm:"#ff9d77",sat:.94,con:1.05,bri:1.02,bloomC:"#ff9d77",bloomA:.06,vig:.64}},
  {no:"六",name:"轮回与谎言",          grade:{tint:"#080b0e",tintA:.36,warm:"#8a98a4",sat:.58,con:1.09,bri:.86,bloomC:"#6e8696",bloomA:.05,vig:.8}},
];

/* ---------- particle FX presets ---------- */
const FX = {
  none:   [],
  dustW:  [{mode:"float",n:72,col:"244,201,122",sz:[.5,1.9],vy:-6, drift:7, a:[.04,.5], glow:1}],
  dustC:  [{mode:"float",n:62,col:"185,205,235",sz:[.5,1.7],vy:-5, drift:6, a:[.04,.42],glow:1}],
  sparkC: [{mode:"float",n:86,col:"205,225,255",sz:[.4,1.6],vy:-4, drift:9, a:[.05,.7], glow:1}],
  ash:    [{mode:"fall", n:96,col:"150,150,150",sz:[1,3],  vy:16, drift:12,a:[.08,.5], glow:0}],
  ashHvy: [{mode:"fall", n:150,col:"140,140,140",sz:[1,3.4],vy:20,drift:16,a:[.1,.55],glow:0}],
  ember:  [{mode:"rise", n:150,col:"255,140,55", sz:[.6,2.6],vy:-46,drift:22,a:[.25,.95],glow:1,flick:1},
           {mode:"rise", n:30, col:"120,120,120",sz:[2,5],   vy:-26,drift:18,a:[.05,.2], glow:0}],
  bleed:  [{mode:"fall", n:16,col:"150,20,24",  sz:[1,2.6], vy:30, drift:2, a:[.2,.7],  glow:0}],
};

/* ============================================================
   PARTICLE SYSTEM
   ============================================================ */
const Fxs = (function(){
  let cv,ctx,W=0,H=0,parts=[],emitters=[],last=0,raf=0,scaleRef=1,fadeAlpha=1;
  function init(c){cv=c;ctx=c.getContext("2d");resize();window.addEventListener("resize",resize);}
  function resize(){
    const r=cv.getBoundingClientRect();
    cv.width=Math.max(2,r.width*devicePixelRatio);
    cv.height=Math.max(2,r.height*devicePixelRatio);
    W=cv.width;H=cv.height;scaleRef=H/1080;
  }
  function set(list){emitters=list||[];}
  function spawn(em){
    let x,y;
    if(em.mode==="fall"){x=Math.random()*W;y=-rnd(0,H*.15);}
    else if(em.mode==="rise"){x=rnd(W*.2,W*.8);y=H+rnd(0,H*.12);}
    else {x=Math.random()*W;y=Math.random()*H;}
    const dir=em.mode==="rise"?-1:em.mode==="fall"?1:(Math.random()<.5?-1:1);
    return{em,x,y,
      sz:rnd(em.sz[0],em.sz[1])*Math.max(.7,scaleRef),
      vy:(em.vy)*scaleRef*(em.mode==="float"?dir:1),
      vx:rnd(-em.drift,em.drift)*scaleRef,
      a:rnd(em.a[0],em.a[1]),ph:Math.random()*6.28,
      life:em.mode==="float"?rnd(4,11):rnd(2.5,7),age:0};
  }
  function step(dt){
    // top up populations
    for(const em of emitters){
      let c=0;for(const p of parts)if(p.em===em)c++;
      let need=em.n-c;while(need-->0&&parts.length<900)parts.push(spawn(em));
    }
    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation="lighter";
    for(let i=parts.length-1;i>=0;i--){
      const p=parts[i];p.age+=dt;
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      if(p.em.mode==="rise"){p.vy-=8*scaleRef*dt; p.vx+=Math.sin(p.age*2+p.ph)*4*scaleRef*dt;}
      if(p.em.mode==="float"){p.x+=Math.sin(p.age*.6+p.ph)*3*scaleRef*dt;}
      const dead = p.age>p.life || p.y<-40 || p.y>H+40 || p.x<-40 || p.x>W+40
                 || emitters.indexOf(p.em)<0;
      if(dead){parts.splice(i,1);continue;}
      // alpha envelope (fade in/out across life)
      const lifeT=p.age/p.life, env=Math.sin(Math.min(1,lifeT)*Math.PI);
      let al=p.a*env*fadeAlpha;
      if(p.em.flick)al*=.55+.45*Math.sin(p.age*22+p.ph);
      ctx.globalAlpha=clamp(al,0,1);
      if(p.em.glow){
        const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.sz*4);
        g.addColorStop(0,"rgba("+p.em.col+",1)");
        g.addColorStop(1,"rgba("+p.em.col+",0)");
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,p.sz*4,0,6.283);ctx.fill();
      }else{
        ctx.fillStyle="rgba("+p.em.col+",1)";
        ctx.fillRect(p.x,p.y,p.sz,p.sz*2.2);
      }
    }
    ctx.globalAlpha=1;ctx.globalCompositeOperation="source-over";
  }
  function loop(t){
    const dt=Math.min(.05,(t-last)/1000||0);last=t;
    if(ctx)step(dt);
    raf=requestAnimationFrame(loop);
  }
  function start(){if(!raf){last=performance.now();raf=requestAnimationFrame(loop);}}
  function stop(){cancelAnimationFrame(raf);raf=0;}
  return{init,set,start,stop,resize,setFade:a=>fadeAlpha=a};
})();

/* ============================================================
   AUDIO ENGINE (generative, optional, fully guarded)
   ============================================================ */
const Aud=(function(){
  let actx,master,droneG,osc1,osc2,subOsc,lfo,lfoG,filt,heartTimer=null,ready=false,enabled=false,baseFreq=55;
  function init(){
    if(ready)return;
    try{
      actx=new (window.AudioContext||window.webkitAudioContext)();
      master=actx.createGain();master.gain.value=0.0;
      const comp=actx.createDynamicsCompressor();
      master.connect(comp);comp.connect(actx.destination);
      // drone
      droneG=actx.createGain();droneG.gain.value=.0;
      filt=actx.createBiquadFilter();filt.type="lowpass";filt.frequency.value=320;filt.Q.value=4;
      osc1=actx.createOscillator();osc1.type="triangle";osc1.frequency.value=baseFreq;
      osc2=actx.createOscillator();osc2.type="sine";osc2.frequency.value=baseFreq*1.005;
      subOsc=actx.createOscillator();subOsc.type="sine";subOsc.frequency.value=baseFreq/2;
      lfo=actx.createOscillator();lfo.type="sine";lfo.frequency.value=.06;
      lfoG=actx.createGain();lfoG.gain.value=120;
      lfo.connect(lfoG);lfoG.connect(filt.frequency);
      osc1.connect(filt);osc2.connect(filt);subOsc.connect(filt);
      filt.connect(droneG);droneG.connect(master);
      osc1.start();osc2.start();subOsc.start();lfo.start();
      ready=true;
    }catch(e){ready=false;}
  }
  function on(){init();if(!ready)return;enabled=true;
    try{actx.resume();}catch(e){}
    master.gain.cancelScheduledValues(actx.currentTime);
    master.gain.linearRampToValueAtTime(.9,actx.currentTime+1.2);
    droneG.gain.linearRampToValueAtTime(.10,actx.currentTime+2);
  }
  function off(){enabled=false;if(!ready)return;
    master.gain.linearRampToValueAtTime(0,actx.currentTime+.5);
    heartStop();
  }
  function setMood(act){
    if(!ready||!enabled)return;
    const map={0:[55,.07,.05],1:[55,.10,.07],2:[49,.10,.06],3:[62,.09,.05],4:[41,.13,.02],5:[46,.12,.16],6:[44,.10,.05]};
    const m=map[act]||map[1];baseFreq=m[0];
    const tnow=actx.currentTime;
    osc1.frequency.linearRampToValueAtTime(m[0],tnow+2);
    osc2.frequency.linearRampToValueAtTime(m[0]*1.005,tnow+2);
    subOsc.frequency.linearRampToValueAtTime(m[0]/2,tnow+2);
    droneG.gain.linearRampToValueAtTime(m[1],tnow+2.5);
    filt.frequency.linearRampToValueAtTime(act===4?160:act===5?520:320,tnow+2.5);
  }
  function blip(freq,dur,type,vol,sweep){
    if(!ready||!enabled)return;const t=actx.currentTime;
    const o=actx.createOscillator(),g=actx.createGain();
    o.type=type||"sine";o.frequency.setValueAtTime(freq,t);
    if(sweep)o.frequency.exponentialRampToValueAtTime(Math.max(40,freq*sweep),t+dur);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.3,t+.01);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.05);
  }
  function bell(){ // 六点的钟声
    if(!ready||!enabled)return;[1,2,2.76,5.4].forEach((h,i)=>{
      setTimeout(()=>blip(196*h,2.6,"sine",.16/(i+1)),i*4);});
  }
  function drip(){blip(880,.5,"sine",.16,.34);setTimeout(()=>blip(1200,.3,"sine",.06,.5),60);}
  function reveal(){ // dread swell
    if(!ready||!enabled)return;const t=actx.currentTime;
    const o=actx.createOscillator(),o2=actx.createOscillator(),g=actx.createGain(),bp=actx.createBiquadFilter();
    o.type="sawtooth";o2.type="sawtooth";o.frequency.value=110;o2.frequency.value=110*1.02;
    bp.type="bandpass";bp.Q.value=6;bp.frequency.setValueAtTime(180,t);
    bp.frequency.exponentialRampToValueAtTime(2400,t+5);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.12,t+3.5);
    g.gain.linearRampToValueAtTime(0,t+6.5);
    o.connect(bp);o2.connect(bp);bp.connect(g);g.connect(master);
    o.start(t);o2.start(t);o.stop(t+6.6);o2.stop(t+6.6);
  }
  let rumbleNode=null;
  function rumble(start){
    if(!ready||!enabled)return;
    if(start){
      const buf=actx.createBuffer(1,actx.sampleRate*2,actx.sampleRate);
      const d=buf.getChannelData(0);let lp=0;
      for(let i=0;i<d.length;i++){lp=(lp+ (Math.random()*2-1))*.5;d[i]=lp;}
      const src=actx.createBufferSource();src.buffer=buf;src.loop=true;
      const f=actx.createBiquadFilter();f.type="lowpass";f.frequency.value=120;
      const g=actx.createGain();g.gain.value=0;g.gain.linearRampToValueAtTime(.18,actx.currentTime+3);
      src.connect(f);f.connect(g);g.connect(master);src.start();
      rumbleNode={src,g};
    }else if(rumbleNode){
      rumbleNode.g.gain.linearRampToValueAtTime(0,actx.currentTime+3);
      const r=rumbleNode;setTimeout(()=>{try{r.src.stop();}catch(e){}},3500);rumbleNode=null;
    }
  }
  function heartStart(){if(heartTimer||!ready||!enabled)return;
    const beat=()=>{blip(54,.16,"sine",.5);setTimeout(()=>blip(48,.2,"sine",.35),150);};
    beat();heartTimer=setInterval(beat,900);}
  function heartStop(){if(heartTimer){clearInterval(heartTimer);heartTimer=null;}}
  function cue(name){
    switch(name){
      case"bell":bell();break;
      case"drip":drip();break;
      case"reveal":reveal();break;
      case"rumbleOn":rumble(true);break;
      case"rumbleOff":rumble(false);break;
      case"heartOn":heartStart();break;
      case"heartOff":heartStop();break;
    }
  }
  return{on,off,setMood,cue,isOn:()=>enabled,isReady:()=>ready};
})();

/* ---------- audio cue timeline (fired when clock crosses, forward only) ---------- */
const CUES=[
  [113,"bell"],
  [224,"heartOn"],[236,"heartOff"],
  [363,"reveal"],
  [380,"heartOn"],[398,"heartOff"],
  [452,"drip"],
  [520,"rumbleOn"],[548,"rumbleOff"],
  [574,"reveal"],
];

/* ---------- PA loudspeaker voice (speechSynthesis, cold zh-CN) ---------- */
const PASpk=(function(){
  const ok=(typeof window!=="undefined")&&("speechSynthesis"in window);
  let voice=null;
  function pick(){if(!ok)return;const vs=window.speechSynthesis.getVoices()||[];
    voice=vs.find(v=>/zh[-_]CN/i.test(v.lang))||vs.find(v=>/zh/i.test(v.lang))||vs.find(v=>/Tingting|Mei-?Jia|Sin-?ji/i.test(v.name))||null;}
  if(ok){pick();window.speechSynthesis.onvoiceschanged=pick;}
  function speak(txt){if(!ok||!txt)return;try{
    const u=new SpeechSynthesisUtterance(txt);
    if(voice)u.voice=voice; u.lang="zh-CN"; u.rate=.84; u.pitch=.7; u.volume=.92;
    window.speechSynthesis.speak(u);
  }catch(e){}}
  function stop(){if(ok)try{window.speechSynthesis.cancel();}catch(e){}}
  return{speak,stop};
})();

/* ============================================================
   ENGINE
   ============================================================ */
const Film=(function(){
  const DUR=680;
  let dom={}, t=0, prevT=0, playing=false, speed=1, lastFrame=0, raf=0;
  let curShot=null, curInst=null, curLayer=null, oldLayer=null;
  let subNodes=[], curAct=-1, boarded=false, soundOn=false, uiTimer=0, started=false, curPA=-1;

  function shotAt(time){
    for(let i=0;i<SHOTS.length;i++){if(time<SHOTS[i].end)return SHOTS[i];}
    return SHOTS[SHOTS.length-1]||null;
  }
  function applyGrade(g){
    const r=document.documentElement.style;
    r.setProperty("--tint",g.tint);r.setProperty("--tint-a",g.tintA);
    r.setProperty("--warm",g.warm);r.setProperty("--sat",g.sat);
    r.setProperty("--con",g.con);r.setProperty("--bri",g.bri);
    r.setProperty("--bloom-c",g.bloomC);r.setProperty("--bloom-a",g.bloomA);
    r.setProperty("--vig",g.vig);
  }
  function mountScene(shot){
    // fade out old
    if(oldLayer)oldLayer.remove();
    oldLayer=curLayer;
    if(oldLayer){oldLayer.classList.remove("show");const o=oldLayer;setTimeout(()=>{if(o!==curLayer)o.remove();},650);}
    // build new
    const layer=E("div","scene-layer");
    dom.sceneRoot.appendChild(layer);
    const def=SC[shot.scene]||SC._fallback;
    let inst=null;try{inst=def.build(layer,shot);}catch(e){console.warn("scene err",shot.scene,e);}
    requestAnimationFrame(()=>layer.classList.add("show"));
    curLayer=layer;curInst=inst||{};
    // FX
    Fxs.set((shot.fx&&FX[shot.fx])?FX[shot.fx]:FX.none);
    Fxs.setFade(0);setTimeout(()=>Fxs.setFade(1),120);
    // grade (act default merged with shot override)
    const base=ACTS[shot.act].grade;
    applyGrade(Object.assign({},base,shot.grade||{}));
    // subtitles
    buildSubs(shot);
    // shot tag
    dom.shotTag.textContent=shot.n+" · "+shot.frame+" · "+fmt(shot.start)+"–"+fmt(shot.end);
    // act card + label + mood
    if(shot.act!==curAct){
      curAct=shot.act;
      dom.actLabel.textContent=ACTS[curAct].no?("第"+ACTS[curAct].no+"幕 · "+ACTS[curAct].name):ACTS[curAct].name;
      dom.actName.textContent=ACTS[curAct].no?("第"+ACTS[curAct].no+"幕"):"";
      if(shot.act>=1 && shot===firstOfAct(shot.act))showActCard(shot.act);
      if(soundOn)Aud.setMood(shot.act);
    }
  }
  function firstOfAct(a){return SHOTS.find(s=>s.act===a);}
  function showActCard(a){
    const c=dom.actCard;
    c.innerHTML='<div class="ac-no">第 '+ACTS[a].no+' 幕</div>'+
                '<div class="ac-name">'+ACTS[a].name+'</div><div class="ac-line"></div>';
    c.classList.add("show");
    clearTimeout(c._t);c._t=setTimeout(()=>c.classList.remove("show"),3600);
  }
  function buildSubs(shot){
    dom.subs.innerHTML="";subNodes=[];
    (shot.subs||[]).forEach(s=>{
      const cls="sub "+(s.cls||"");
      const node=E("div",cls,(s.who?'<span class="who">'+s.who+'</span>':'')+s.text);
      dom.subs.appendChild(node);
      subNodes.push({node,a:s.a,b:s.b});
    });
  }
  function renderSubs(rel){
    for(const s of subNodes){
      const on=rel>=s.a&&rel<=s.b;
      s.node.classList.toggle("in",on);
    }
  }
  function updatePA(time, prev, allowSpeak){
    const lines=window.PA_LINES||[]; if(!dom.pa)return;
    let active=-1;
    for(let i=0;i<lines.length;i++){const L=lines[i];if(time>=L.t&&time<=L.t+L.dur){active=i;break;}}
    if(active!==curPA){
      curPA=active;
      if(active<0)dom.pa.classList.remove("in");
      else{dom.pa.querySelector(".pa-text").innerHTML=lines[active].text;dom.pa.classList.add("in");}
    }
    if(allowSpeak&&soundOn){
      for(const L of lines){if(prev<L.t&&time>=L.t)PASpk.speak(L.say||L.text.replace(/<[^>]+>/g,""));}
    }
  }
  function fireCues(p,c){
    if(!soundOn)return;
    for(const [ct,name] of CUES){if(p<ct&&c>=ct)Aud.cue(name);}
  }
  /* ---------- virtual camera: every shot breathes (push/pan + handheld) ---------- */
  const DEFAULTCAM={push:0.06};
  function applyCam(shot,p,t){
    if(!curLayer||!shot)return;
    const c=shot.cam||DEFAULTCAM;
    const ez=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;          // easeInOut narrative move
    const sc=1.06+(c.push!=null?c.push:0.06)*ez;          // 6% overscan + push-in
    const px=(c.panX||0)*ez, py=(c.panY||0)*ez;
    const amp=c.calm?0.4:1;                                // handheld intensity
    const swx=(Math.sin(t*0.7)*0.17+Math.sin(t*1.73+1.3)*0.08)*amp;
    const swy=(Math.cos(t*0.62)*0.14+Math.sin(t*1.29+0.6)*0.06)*amp;
    const rot=(c.rot||0)*ez+Math.sin(t*0.5)*0.05*amp;
    curLayer.style.transformOrigin=c.org||"50% 50%";
    curLayer.style.transform="scale("+sc.toFixed(4)+") translate("+(px+swx).toFixed(3)+"%,"+(py+swy).toFixed(3)+"%) rotate("+rot.toFixed(3)+"deg)";
  }
  function frame(now){
    const dt=Math.min(.1,(now-lastFrame)/1000||0);lastFrame=now;
    if(playing){
      prevT=t; t+=dt*speed;
      if(t>=DUR){t=DUR;playing=false;onEnd();}
      fireCues(prevT,t);
    }
    const shot=shotAt(t);
    if(shot&&shot!==curShot){curShot=shot;mountScene(shot);}
    if(curShot){
      const p=clamp((t-curShot.start)/Math.max(.001,curShot.end-curShot.start),0,1);
      if(curInst&&curInst.update){try{curInst.update(p,t);}catch(e){}}
      applyCam(curShot,p,t);
      renderSubs(t-curShot.start);
    }
    updatePA(t, prevT, playing);
    // ui
    dom.fill.style.width=(t/DUR*100)+"%";
    dom.seek.value=t.toFixed(1);
    dom.time.textContent=fmt(t)+" / "+fmt(DUR);
    dom.root.classList.toggle("playing",playing);
    raf=requestAnimationFrame(frame);
  }
  function onEnd(){dom.root.classList.add("show-ui");}

  /* ---------- transport ---------- */
  function play(){if(t>=DUR)t=0;playing=true;Fxs.start();flashUI();}
  function pause(){playing=false;PASpk.stop();flashUI();}
  function toggle(){playing?pause():play();}
  function seek(time){
    t=clamp(time,0,DUR);prevT=t;
    const shot=shotAt(t);
    if(shot!==curShot){curShot=shot;mountScene(shot);}
    if(curShot){
      const p=clamp((t-curShot.start)/Math.max(.001,curShot.end-curShot.start),0,1);
      if(curInst&&curInst.update){try{curInst.update(p,t);}catch(e){}}
      applyCam(curShot,p,t);
      renderSubs(t-curShot.start);
    }
    PASpk.stop(); updatePA(t,t,false);
  }
  function jumpAct(dir){
    const a=clamp(curAct+dir,0,ACTS.length-1);
    const s=firstOfAct(a)||SHOTS[0];seek(s.start);
  }
  function setSpeed(s){speed=s;dom.speed.textContent=s+"×";}
  function cycleSpeed(){const arr=[1,1.5,2,.5];const i=(arr.indexOf(speed)+1)%arr.length;setSpeed(arr[i]);}
  function toggleBoard(){boarded=!boarded;dom.root.parentElement.classList.toggle("board-on",boarded);dom.board.classList.toggle("active",boarded);}
  function toggleSound(){
    soundOn=!soundOn;
    if(soundOn){Aud.on();Aud.setMood(curAct<0?0:curAct);dom.sound.textContent="声音 开";dom.sound.classList.add("active");}
    else{Aud.off();dom.sound.textContent="声音 关";dom.sound.classList.remove("active");}
  }
  function fullscreen(){const el=dom.cinema;if(!document.fullscreenElement)el.requestFullscreen&&el.requestFullscreen();else document.exitFullscreen();}

  /* ---------- ui autohide ---------- */
  function flashUI(){dom.root.classList.add("show-ui");clearTimeout(uiTimer);
    if(playing)uiTimer=setTimeout(()=>dom.root.classList.remove("show-ui"),2600);}

  /* ---------- boot ---------- */
  function boot(){
    dom={
      poster:$("#poster"),start:$("#startBtn"),cinema:$("#cinema"),root:$("#cinema"),
      sceneRoot:$("#sceneRoot"),fx:$("#fx"),subs:$("#subs"),pa:$("#pa"),
      actLabel:$("#actLabel"),actName:$("#actName"),shotTag:$("#shotTag"),actCard:$("#actCard"),
      controls:$("#controls"),seek:$("#seek"),fill:$("#trackFill"),hover:$("#trackHover"),
      marks:$("#trackMarks"),tip:$("#hoverTip"),time:$("#time"),
      btnPlay:$("#btnPlay"),btnPrev:$("#btnPrev"),btnNext:$("#btnNext"),
      sound:$("#btnSound"),speed:$("#btnSpeed"),board:$("#btnBoard"),full:$("#btnFull"),
    };
    Fxs.init(dom.fx);
    // act marks on timeline
    SHOTS.filter(s=>s===firstOfAct(s.act)&&s.act>=1).forEach(s=>{
      const i=E("i");i.style.left=(s.start/DUR*100)+"%";dom.marks.appendChild(i);
    });
    // start gate
    dom.start.addEventListener("click",()=>{
      if(started)return;started=true;
      dom.poster.classList.add("gone");
      dom.cinema.classList.add("on");dom.cinema.setAttribute("aria-hidden","false");
      setTimeout(()=>{seek(0);play();},700);
    });
    // controls
    dom.btnPlay.onclick=toggle;dom.btnPrev.onclick=()=>jumpAct(-1);dom.btnNext.onclick=()=>jumpAct(1);
    dom.speed.onclick=cycleSpeed;dom.board.onclick=toggleBoard;dom.sound.onclick=toggleSound;dom.full.onclick=fullscreen;
    dom.seek.addEventListener("input",e=>{seek(parseFloat(e.target.value));flashUI();});
    dom.seek.addEventListener("mousemove",e=>{
      const r=dom.seek.getBoundingClientRect();const x=clamp((e.clientX-r.left)/r.width,0,1);
      dom.hover.style.width=(x*100)+"%";dom.tip.style.left=(x*100)+"%";
      dom.tip.style.opacity=1;dom.tip.textContent=fmt(x*DUR);
    });
    dom.seek.addEventListener("mouseleave",()=>{dom.tip.style.opacity=0;dom.hover.style.width=0;});
    dom.cinema.addEventListener("mousemove",flashUI);
    document.addEventListener("keydown",e=>{
      if(!started)return;
      if(e.code==="Space"){e.preventDefault();toggle();}
      else if(e.code==="ArrowRight")seek(t+5);
      else if(e.code==="ArrowLeft")seek(t-5);
      else if(e.key==="b")toggleBoard();
      else if(e.key==="f")fullscreen();
    });
    // idle render so first frame paints even before play
    curShot=null;seek(0);
    lastFrame=performance.now();raf=requestAnimationFrame(frame);
    Fxs.start();
  }

  return{boot,play,pause,toggle,seek,jumpAct,setSpeed,toggleBoard,toggleSound,
         state:()=>({t,playing,act:curAct,shot:curShot&&curShot.n})};
})();

/* fallback scene so engine never crashes on missing keys */
SC._fallback={build(l){l.style.background="#06080a";return{};}};

window.Film=Film;
window.__SC=SC; window.__SHOTS=SHOTS; window.__FX=FX;

/* ============================================================
   SCENE HELPERS + SILHOUETTES
   ============================================================ */
function svg(vb,inner,cls){return '<svg viewBox="'+vb+'" preserveAspectRatio="xMidYMid meet" class="'+(cls||'')+'">'+inner+'</svg>';}

/* ---------- stylized 2D human: lit, readable, riggable ----------
   Local coords: x centered at 0; y=-22 (hair top) .. 200 (feet, standing).
   Returns an SVG <g>. Parts carry ids `${id}-head/-eyeL/-eyeR/-armL/-armR/-torso`. */
function human(o){
  o=o||{};
  const id=o.id||('h'+((Math.random()*1e6)|0));
  const sk=o.skin||'#dcc3a6', skS=o.skinSh||'#b0926f', skL=o.skinHi||'#f0dcc4';
  const hair=o.hair||'#2a241f', hairL=o.hairHi||'#4d4239';
  const top=o.top||'#b9c6cc', topS=o.topSh||'#8b9aa1';
  const bot=o.bottom||'#56616a', botS=o.bottomSh||'#3f474e';
  const sit=o.pose==='sit', ex=o.exp||'neutral';
  const brows={
    neutral:['M-14 13 C-10 12.4 -5 12.4 -2 13','M2 13 C5 12.4 10 12.4 14 13'],
    sad:['M-14 15 C-10 13 -5 12 -2 11.4','M2 11.4 C5 12 10 13 14 15'],
    awe:['M-14 11 C-10 9 -5 9 -2 10','M2 10 C5 9 10 9 14 11'],
    fear:['M-14 12 C-10 10 -5 10 -2 12','M2 12 C5 10 10 10 14 12']
  }[ex]||['M-14 13 C-10 12.4 -5 12.4 -2 13','M2 13 C5 12.4 10 12.4 14 13'];
  const mouthOpen=(ex==='awe'||ex==='fear');
  const mouth={
    neutral:'M-7 33 C-2 35 2 35 7 33', sad:'M-7 35 C-2 32 2 32 7 35',
    awe:'M-4 32 C-3 39 3 39 4 32 C2 30 -2 30 -4 32 Z', fear:'M-5 33 C-3 38 3 38 5 33 C2 31 -2 31 -5 33 Z',
    smile:'M-8 32 C-2 39 2 39 8 32'
  }[ex]||'M-7 33 C-2 35 2 35 7 33';
  const legs= sit?'' :
    '<path d="M-17 112 C-19 150 -17 188 -13 198 L-1 198 C-2 162 -1 132 -1 114 Z" fill="'+bot+'"/>'+
    '<path d="M1 114 C1 132 2 162 1 198 L13 198 C17 188 19 150 17 112 Z" fill="'+bot+'"/>'+
    '<path d="M-17 112 C-19 150 -17 188 -13 198 L-7 198 C-9 160 -8 130 -7 114 Z" fill="'+botS+'" opacity=".6"/>'+
    '<ellipse cx="-9" cy="200" rx="9" ry="5" fill="'+botS+'"/><ellipse cx="9" cy="200" rx="9" ry="5" fill="'+botS+'"/>';
  const lap= sit?'<path d="M-27 106 C-31 132 -20 152 0 152 C20 152 31 132 27 106 Z" fill="'+bot+'"/>':'';
  return '<g class="human" data-id="'+id+'">'+
    (sit?'':'<ellipse cx="0" cy="204" rx="30" ry="6" fill="rgba(0,0,0,.25)"/>')+
    legs+lap+
    '<g id="'+id+'-armL"><path d="M-30 54 C-42 78 -42 104 -37 118 L-27 118 C-30 100 -27 74 -19 56 Z" fill="'+top+'"/><ellipse cx="-32" cy="120" rx="6.5" ry="8" fill="'+sk+'"/></g>'+
    '<g id="'+id+'-armR"><path d="M30 54 C42 78 42 104 37 118 L27 118 C30 100 27 74 19 56 Z" fill="'+top+'"/><ellipse cx="32" cy="120" rx="6.5" ry="8" fill="'+sk+'"/></g>'+
    '<g id="'+id+'-torso"><path d="M-31 52 C-35 72 -31 100 -24 116 L24 116 C31 100 35 72 31 52 C22 42 -22 42 -31 52 Z" fill="'+top+'"/>'+
      '<path d="M-31 52 C-35 72 -31 100 -24 116 L-6 116 C-13 100 -16 72 -12 52 Z" fill="'+topS+'" opacity=".55"/>'+
      '<path d="M0 46 L-9 64 L0 98 L9 64 Z" fill="'+topS+'" opacity=".4"/></g>'+
    '<rect x="-7" y="36" width="14" height="18" rx="3" fill="'+sk+'"/><rect x="-7" y="45" width="14" height="9" fill="'+skS+'" opacity=".5"/>'+
    '<g id="'+id+'-head">'+
      '<path d="M-18 14 C-22 -6 -10 -18 0 -18 C10 -18 22 -6 18 14 C18 30 12 44 0 47 C-12 44 -18 30 -18 14 Z" fill="'+sk+'"/>'+
      '<path d="M-18 14 C-18 26 -14 40 -2 46 C-10 30 -14 22 -16 12 Z" fill="'+skS+'" opacity=".45"/>'+
      '<path d="M14 -4 C18 6 18 20 12 38" stroke="'+skL+'" stroke-width="2" fill="none" opacity=".5"/>'+
      '<path d="M-18 9 C-19 -15 -8 -23 0 -23 C9 -23 19 -15 18 9 C14 -3 9 -6 4 -6 C5 -2 4 1 2 3 C-1 -2 -5 -3 -9 -1 C-9 -4 -13 -5 -18 9 Z" fill="'+hair+'"/>'+
      '<path d="M-11 -11 C-5 -19 7 -19 14 -8" stroke="'+hairL+'" stroke-width="1.5" fill="none" opacity=".5"/>'+
      '<ellipse cx="-8" cy="22.6" rx="4.8" ry="2" fill="'+skS+'" opacity=".34"/><ellipse cx="8" cy="22.6" rx="4.8" ry="2" fill="'+skS+'" opacity=".34"/>'+
      '<g id="'+id+'-eyeL"><ellipse cx="-8" cy="19" rx="4.2" ry="2.9" fill="#efe9e0"/><circle cx="-7.4" cy="19.4" r="2.2" fill="#3a2a20"/><circle cx="-7.4" cy="19.4" r="1" fill="#0b0807"/><circle cx="-6.7" cy="18.6" r=".6" fill="#fff"/></g>'+
      '<g id="'+id+'-eyeR"><ellipse cx="8" cy="19" rx="4.2" ry="2.9" fill="#efe9e0"/><circle cx="8.6" cy="19.4" r="2.2" fill="#3a2a20"/><circle cx="8.6" cy="19.4" r="1" fill="#0b0807"/><circle cx="9.3" cy="18.6" r=".6" fill="#fff"/></g>'+
      '<path d="'+brows[0]+'" stroke="'+hair+'" stroke-width="1.5" fill="none" stroke-linecap="round"/>'+
      '<path d="'+brows[1]+'" stroke="'+hair+'" stroke-width="1.5" fill="none" stroke-linecap="round"/>'+
      '<path d="M0 21 C-1 26 -2 29 -4 31 C-1 33 2 33 4 31" stroke="'+skS+'" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7"/>'+
      (mouthOpen?'<path d="'+mouth+'" fill="#7a3f36"/>':'<path d="'+mouth+'" stroke="#7a3f36" stroke-width="2" fill="none" stroke-linecap="round"/>')+
    '</g>'+
  '</g>';
}

/* ---------- HERO: 秋犯 — gaunt, light-haunted donor (detailed, distinct) ----------
   Local coords: head hair-top y-30 .. chin y150 .. lap y430, x centered 0.
   Rigged ids: qf-head, qf-eyeL, qf-eyeR, qf-brows, qf-mouth, qf-chest, qf-arm. */
function qiufan(){
  return '<g class="hero">'+
   '<g id="qf-chest">'+
     '<path d="M-92 230 C-104 180 -78 150 -20 142 C44 134 96 168 104 226 C112 290 108 392 92 430 L-96 430 C-104 388 -100 296 -92 230 Z" fill="#aeb9bd"/>'+
     '<path d="M-92 230 C-104 180 -78 150 -20 142 L-10 152 C-66 162 -86 196 -80 250 C-74 320 -78 392 -88 430 L-96 430 C-104 388 -100 296 -92 230 Z" fill="#8c9a9f" opacity=".85"/>'+
     '<path d="M104 226 C112 290 108 392 92 430 L78 430 C92 392 96 300 88 232 C84 196 70 168 50 156 C80 162 98 190 104 226 Z" fill="#cdd6d9"/>'+
     '<path d="M-20 146 L4 198 L28 150 C14 142 -6 142 -20 146 Z" fill="#7c8a8f"/>'+
     '<path d="M-44 168 C-20 178 24 178 46 168" stroke="rgba(120,92,72,.4)" stroke-width="3" fill="none"/>'+
     '<path d="M-40 163 C-18 171 22 171 42 163" stroke="rgba(240,222,200,.4)" stroke-width="2" fill="none"/>'+
     '<path d="M-60 232 C-56 300 -58 380 -66 428" stroke="rgba(108,122,126,.5)" stroke-width="4" fill="none"/>'+
     '<path d="M46 226 C56 300 54 380 50 428" stroke="rgba(108,122,126,.4)" stroke-width="4" fill="none"/>'+
     '<path d="M-10 212 C-6 300 -8 380 -10 428" stroke="rgba(150,162,166,.4)" stroke-width="3" fill="none"/>'+
   '</g>'+
   '<g id="qf-arm">'+
     '<path d="M70 232 C108 256 122 330 100 392 C92 414 70 426 44 424 C40 404 64 360 62 318 C60 276 50 244 50 226 Z" fill="#cdb39a"/>'+
     '<path d="M70 232 C92 250 104 300 100 350 C84 300 70 260 58 232 Z" fill="#a98a6e" opacity=".5"/>'+
     '<g fill="#7a201c" opacity=".7"><circle cx="92" cy="320" r="3.4"/><circle cx="102" cy="344" r="3"/><circle cx="86" cy="352" r="2.6"/><circle cx="104" cy="372" r="3.2"/><circle cx="90" cy="384" r="2.6"/></g>'+
     '<rect x="78" y="286" width="34" height="20" rx="5" fill="#e9eef0" transform="rotate(58 95 296)"/>'+
     '<path d="M44 424 C30 426 22 416 24 404 C26 396 38 392 50 396 C58 400 62 414 56 424 Z" fill="#cdb39a"/>'+
     '<path d="M31 408 L27 421 M39 406 L37 421 M47 408 L47 420" stroke="#a98a6e" stroke-width="2"/>'+
   '</g>'+
   '<path d="M-22 120 C-22 158 -18 182 6 190 C30 182 34 158 32 120 Z" fill="#cbb097"/>'+
   '<path d="M-22 122 C-22 152 -18 178 6 188" stroke="rgba(120,92,72,.45)" stroke-width="4" fill="none"/>'+
   '<path d="M14 126 C16 152 16 174 10 186" stroke="rgba(110,84,66,.5)" stroke-width="3" fill="none"/>'+
   '<g id="qf-head">'+
     '<path d="M-52 60 C-64 58 -66 84 -54 92 C-48 88 -48 74 -48 64 Z" fill="#c8ac92"/><path d="M-56 66 C-60 70 -58 82 -52 86" stroke="#9c7f66" stroke-width="2" fill="none"/>'+
     '<path d="M52 58 C64 56 66 82 54 90 C48 86 48 72 48 62 Z" fill="#d8bfa4"/>'+
     '<path d="M-54 50 C-60 4 -34 -30 4 -30 C44 -30 70 2 64 52 C58 18 40 0 4 0 C-32 0 -50 18 -54 50 Z" fill="#211c18"/>'+
     '<path d="M-50 56 C-54 14 -30 -16 4 -16 C38 -16 58 12 56 56 C54 96 38 140 4 150 C-30 140 -46 96 -50 56 Z" fill="#d4ba9f"/>'+
     '<path d="M-50 56 C-50 92 -36 132 0 148 C-24 120 -36 96 -42 60 C-46 36 -42 14 -30 -2 C-44 8 -52 30 -50 56 Z" fill="#ab8c6f" opacity=".5"/>'+
     '<path d="M56 56 C54 90 40 130 8 146 C30 120 44 92 48 58 C50 34 46 12 36 -2 C50 10 58 32 56 56 Z" fill="#ecd6bb" opacity=".5"/>'+
     '<ellipse cx="-30" cy="80" rx="14" ry="9" fill="#e7cfb2" opacity=".4" transform="rotate(-18 -30 80)"/>'+
     '<ellipse cx="34" cy="78" rx="15" ry="10" fill="#f0dcc1" opacity=".45" transform="rotate(18 34 78)"/>'+
     '<path d="M-34 94 C-26 104 -14 108 -4 106" stroke="#a98a6c" stroke-width="5" fill="none" opacity=".3"/>'+
     '<path d="M38 92 C30 102 18 106 8 104" stroke="#a98a6c" stroke-width="5" fill="none" opacity=".28"/>'+
     '<path d="M-30 130 C-12 144 20 144 36 130" stroke="#b2906f" stroke-width="3" fill="none" opacity=".4"/>'+
     '<ellipse cx="4" cy="132" rx="10" ry="6" fill="#ecd6bb" opacity=".35"/>'+
     '<path d="M6 58 C6 78 6 92 10 100" stroke="#f0dcc1" stroke-width="3" fill="none" opacity=".5"/>'+
     '<path d="M-2 58 C-4 78 -6 92 -12 100" stroke="#ad8d6e" stroke-width="3" fill="none" opacity=".4"/>'+
     '<path d="M-12 100 C-8 108 -2 110 2 109 C6 110 12 108 16 100 C18 104 16 110 10 113 C2 116 -6 115 -12 110 C-14 106 -14 102 -12 100 Z" fill="#bf9d7e"/>'+
     '<ellipse cx="-7" cy="108" rx="2.6" ry="1.8" fill="#6e4f3c"/><ellipse cx="13" cy="108" rx="2.6" ry="1.8" fill="#6e4f3c"/>'+
     '<path d="M-4 116 C0 120 6 120 10 116" stroke="#b2906f" stroke-width="2" fill="none" opacity=".4"/>'+
     '<path d="M-42 72 C-32 82 -18 82 -10 76" stroke="#9c7456" stroke-width="5" fill="none" opacity=".3"/>'+
     '<path d="M12 74 C20 82 34 82 44 72" stroke="#9c7456" stroke-width="5" fill="none" opacity=".3"/>'+
     '<g id="qf-eyeL">'+
       '<path d="M-40 56 C-32 48 -18 48 -12 56 C-18 64 -32 64 -40 56 Z" fill="#efe7dc"/>'+
       '<circle cx="-26" cy="56" r="7.5" fill="#5b4326"/><circle cx="-26" cy="56" r="7.5" fill="none" stroke="#3a2a18" stroke-width="1.4"/>'+
       '<circle cx="-26" cy="56" r="3.4" fill="#120b06"/><circle cx="-24" cy="53.5" r="1.6" fill="#fff" opacity=".9"/>'+
       '<path d="M-40 56 C-32 47 -18 47 -12 55" stroke="#33271c" stroke-width="2.4" fill="none"/>'+
       '<path d="M-40 56 C-32 63 -18 63 -12 57" stroke="#b2906f" stroke-width="1.4" fill="none" opacity=".6"/>'+
     '</g>'+
     '<g id="qf-eyeR">'+
       '<path d="M10 56 C18 47 34 47 42 56 C34 65 18 65 10 56 Z" fill="#f2ebe0"/>'+
       '<circle cx="26" cy="56" r="8.5" fill="#5f4628"/><circle cx="26" cy="56" r="8.5" fill="none" stroke="#3a2a18" stroke-width="1.5"/>'+
       '<circle cx="26" cy="56" r="3.8" fill="#120b06"/><circle cx="28.4" cy="53" r="1.9" fill="#fff" opacity=".92"/>'+
       '<path d="M10 56 C18 46 34 46 42 55" stroke="#33271c" stroke-width="2.6" fill="none"/>'+
       '<path d="M10 56 C18 64 34 64 42 57" stroke="#b2906f" stroke-width="1.5" fill="none" opacity=".6"/>'+
       '<path d="M9.5 56 L6 55" stroke="#a07a5a" stroke-width="1.6"/>'+
     '</g>'+
     '<g id="qf-brows" fill="#241d17">'+
       '<path d="M-42 43 C-34 37 -20 37 -12 42 C-20 41 -32 42 -42 47 Z"/>'+
       '<path d="M10 42 C18 37 34 37 44 43 C34 42 20 41 10 45 Z"/>'+
     '</g>'+
     '<g id="qf-mouth">'+
       '<path d="M-16 124 C-6 119 6 119 18 123 C8 121 -6 121 -16 124 Z" fill="#9a5e52"/>'+
       '<path d="M-16 124 C-6 130 8 130 18 123 C10 128 -4 128 -16 124 Z" fill="#b07365"/>'+
       '<path d="M-16 124 C-4 126 8 126 18 123" stroke="#5e3228" stroke-width="1.6" fill="none"/>'+
       '<path d="M-10 129 C-2 131 6 131 12 129" stroke="#caa089" stroke-width="1.6" fill="none" opacity=".6"/>'+
     '</g>'+
     '<path d="M-54 50 C-58 6 -32 -30 4 -30 C44 -30 70 4 64 52 C58 26 44 12 30 12 C34 18 32 26 28 30 C20 16 6 12 -2 16 C0 22 -2 30 -6 32 C-14 18 -28 14 -38 22 C-36 30 -40 40 -46 44 C-48 38 -52 44 -54 50 Z" fill="#231e19"/>'+
     '<path d="M-30 -6 C-14 -22 24 -24 48 -2" stroke="#473c33" stroke-width="2" fill="none" opacity=".6"/>'+
   '</g>'+
  '</g>';
}

/* ---------- lightweight jogging extra for crowds (faces right; flip for left) ---------- */
function runner(o){
  o=o||{};
  const sk=o.skin||'#cdb39a', top=o.top||'#aeb9bd', topS=o.topSh||'#8b979c', bot=o.bottom||'#79858c', hair=o.hair||'#241f1a';
  return '<g class="runner">'+
    '<ellipse cx="0" cy="150" rx="22" ry="5" fill="rgba(0,0,0,.18)"/>'+
    '<path d="M-4 84 C-16 106 -28 128 -38 140 L-28 148 C-18 132 -4 110 6 90 Z" fill="'+bot+'"/>'+
    '<path d="M6 86 C14 108 22 128 26 144 L36 142 C34 124 26 104 16 86 Z" fill="'+bot+'"/>'+
    '<path d="M-12 44 C-26 50 -32 62 -32 72 L-24 74 C-22 64 -16 56 -6 50 Z" fill="'+topS+'"/>'+
    '<path d="M-14 38 C-20 58 -14 80 0 90 L20 84 C26 66 24 46 14 36 C2 30 -8 31 -14 38 Z" fill="'+top+'"/>'+
    '<path d="M12 42 C26 46 34 58 34 70 L26 72 C24 60 16 50 6 46 Z" fill="'+top+'"/>'+
    '<rect x="2" y="16" width="9" height="11" fill="'+sk+'"/>'+
    '<circle cx="8" cy="13" r="13" fill="'+sk+'"/>'+
    '<path d="M-4 11 C-5 -1 6 -7 14 -5 C21 -3 23 9 21 17 C19 7 13 4 6 5 C0 6 -3 9 -4 11 Z" fill="'+hair+'"/>'+
  '</g>';
}

/* ---------- back-view standing figure for queues/processions ---------- */
function walker(o){
  o=o||{};
  const top=o.top||'#aeb9bd', topS=o.topSh||'#8b979c', bot=o.bottom||'#79858c', sk=o.skin||'#cbb097', hair=o.hair||'#241f1a';
  return '<g class="walker">'+
    '<ellipse cx="0" cy="206" rx="26" ry="6" fill="rgba(0,0,0,.2)"/>'+
    '<path d="M-14 116 C-18 150 -16 188 -12 200 L-2 200 C-3 162 -2 134 -3 116 Z" fill="'+bot+'"/>'+
    '<path d="M3 116 C3 134 4 162 3 200 L13 200 C17 188 19 150 15 116 Z" fill="'+bot+'"/>'+
    '<path d="M-30 54 C-38 80 -36 104 -32 116 L-26 116 C-28 100 -26 76 -22 56 Z" fill="'+topS+'"/>'+
    '<path d="M30 54 C38 80 36 104 32 116 L26 116 C28 100 26 76 22 56 Z" fill="'+topS+'"/>'+
    '<path d="M-30 52 C-34 72 -30 100 -24 118 L24 118 C30 100 34 72 30 52 C22 42 -22 42 -30 52 Z" fill="'+top+'"/>'+
    '<path d="M-30 52 C-34 72 -30 100 -24 118 L-8 118 C-14 100 -16 72 -12 52 Z" fill="'+topS+'" opacity=".5"/>'+
    '<rect x="-7" y="38" width="14" height="16" fill="'+sk+'"/>'+
    '<ellipse cx="0" cy="22" rx="18" ry="20" fill="'+sk+'"/>'+
    '<path d="M-18 22 C-19 -10 -8 -20 0 -20 C9 -20 19 -10 18 22 C16 4 9 0 0 0 C-9 0 -16 4 -18 22 Z" fill="'+hair+'"/>'+
    '<path d="M-18 20 C-18 34 -10 44 0 46 C10 44 18 34 18 20 C18 32 10 38 0 38 C-10 38 -18 32 -18 20 Z" fill="'+hair+'"/>'+
  '</g>';
}

/* ---------- HERO: the rich man — well-fed, groomed, sharp suit (opposite of 秋犯) ----------
   Standing, height ~ -24(hair) .. 210(feet). Rigged: rm-head, rm-eyeL, rm-eyeR. */
function richman(){
  return '<g class="hero">'+
    '<ellipse cx="0" cy="210" rx="48" ry="8" fill="rgba(0,0,0,.3)"/>'+
    '<path d="M-28 118 C-32 160 -30 196 -25 208 L-6 208 C-7 168 -6 136 -8 120 Z" fill="#1c2128"/>'+
    '<path d="M8 120 C8 136 9 168 8 208 L27 208 C31 196 33 160 29 118 Z" fill="#1c2128"/>'+
    '<ellipse cx="-16" cy="210" rx="14" ry="5" fill="#0b0d11"/><ellipse cx="17" cy="210" rx="14" ry="5" fill="#0b0d11"/>'+
    '<path d="M-48 48 C-56 82 -50 112 -40 126 L40 126 C50 112 56 82 48 48 C34 34 -34 34 -48 48 Z" fill="#252a31"/>'+
    '<path d="M-48 48 C-56 82 -50 112 -40 126 L-18 126 C-26 110 -32 82 -28 50 Z" fill="#171b21" opacity=".7"/>'+
    '<path d="M-2 42 L-24 60 L-8 122 L0 80 Z" fill="#15181e"/><path d="M2 42 L24 60 L8 122 L0 80 Z" fill="#15181e"/>'+
    '<path d="M-9 48 L9 48 L7 120 L-7 120 Z" fill="#e8e6df"/>'+
    '<path d="M-4 50 L4 50 L3 112 L0 124 L-3 112 Z" fill="#6a1f24"/>'+
    '<g id="rm-armL"><path d="M-48 50 C-60 80 -58 110 -52 126 L-42 126 C-46 108 -44 80 -38 54 Z" fill="#252a31"/><ellipse cx="-52" cy="130" rx="8.5" ry="10" fill="#caa789"/></g>'+
    '<g id="rm-armR"><path d="M48 50 C60 80 58 110 52 126 L42 126 C46 108 44 80 38 54 Z" fill="#252a31"/><ellipse cx="52" cy="130" rx="8.5" ry="10" fill="#caa789"/></g>'+
    '<rect x="-11" y="30" width="22" height="22" rx="5" fill="#caa789"/><rect x="-11" y="40" width="22" height="12" fill="#a98567" opacity=".4"/>'+
    '<g id="rm-head">'+
      '<path d="M-23 12 C-27 -10 -13 -23 0 -23 C13 -23 27 -10 23 12 C23 33 15 47 0 50 C-15 47 -23 33 -23 12 Z" fill="#d6b693"/>'+
      '<path d="M-23 12 C-23 31 -15 45 -3 49 C-13 33 -17 22 -19 10 Z" fill="#a98567" opacity=".4"/>'+
      '<path d="M19 -6 C23 6 22 26 14 44" stroke="#f0d8ba" stroke-width="2" fill="none" opacity=".4"/>'+
      '<path d="M-23 8 C-25 -14 -11 -25 0 -25 C12 -25 26 -14 23 8 C21 -6 14 -11 0 -11 C-14 -11 -21 -6 -23 8 Z" fill="#2a2420"/>'+
      '<path d="M-20 -3 C-10 -13 12 -13 20 -1" stroke="#4a4038" stroke-width="1.6" fill="none" opacity=".5"/>'+
      '<path d="M-16 6 C-11 3 -4 3 -1 6" stroke="#241d17" stroke-width="2.6" fill="none" stroke-linecap="round"/>'+
      '<path d="M1 6 C4 3 11 3 16 6" stroke="#241d17" stroke-width="2.6" fill="none" stroke-linecap="round"/>'+
      '<g id="rm-eyeL"><ellipse cx="-9" cy="12" rx="4.4" ry="2.5" fill="#efe9e0"/><circle cx="-8" cy="12" r="2" fill="#2a1c12"/><circle cx="-7.4" cy="11.4" r=".6" fill="#fff"/></g>'+
      '<g id="rm-eyeR"><ellipse cx="9" cy="12" rx="4.4" ry="2.5" fill="#efe9e0"/><circle cx="10" cy="12" r="2" fill="#2a1c12"/><circle cx="10.6" cy="11.4" r=".6" fill="#fff"/></g>'+
      '<path d="M0 14 C-1 20 -2 25 -5 28 C-1 30 4 30 7 27" stroke="#a98567" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>'+
      '<path d="M-9 37 C-3 39 3 39 9 36" stroke="#3a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>'+
      '<path d="M-9 39 C-4 50 5 50 10 39 C4 44 -4 44 -9 39 Z" fill="#2a2420"/>'+
    '</g>'+
  '</g>';
}

/* ---------- HERO: 北蚕 — the scientist who found the truth (lab coat, glasses, worried) ----------
   Standing upper body, height ~ -25(hair) .. 210(feet). Rigged: bc-head, bc-eyeL, bc-eyeR. */
function beicang(){
  return '<g class="hero">'+
    '<ellipse cx="0" cy="210" rx="46" ry="8" fill="rgba(0,0,0,.28)"/>'+
    '<path d="M-26 120 C-30 160 -28 196 -23 208 L-6 208 C-7 168 -6 138 -8 122 Z" fill="#2a3138"/>'+
    '<path d="M8 122 C8 138 9 168 8 208 L25 208 C29 196 31 160 27 120 Z" fill="#2a3138"/>'+
    '<ellipse cx="-15" cy="210" rx="13" ry="5" fill="#10171c"/><ellipse cx="16" cy="210" rx="13" ry="5" fill="#10171c"/>'+
    '<path d="M-46 48 C-54 86 -48 122 -40 132 L40 132 C48 122 54 86 46 48 C32 34 -32 34 -46 48 Z" fill="#e8ecee"/>'+
    '<path d="M-46 48 C-54 86 -48 122 -40 132 L-20 132 C-26 116 -30 86 -26 50 Z" fill="#c6d0d4" opacity=".7"/>'+
    '<path d="M-2 40 L-22 56 L-10 132 L0 78 Z" fill="#d4dcdf"/><path d="M2 40 L22 56 L10 132 L0 78 Z" fill="#d4dcdf"/>'+
    '<path d="M-8 46 L8 46 L6 102 L-6 102 Z" fill="#aab6bc"/>'+
    '<rect x="-3" y="48" width="6" height="52" fill="#3a6a8a"/>'+
    '<g id="bc-armL"><path d="M-46 50 C-58 80 -56 112 -50 132 L-40 132 C-44 112 -42 82 -36 54 Z" fill="#e8ecee"/><ellipse cx="-52" cy="136" rx="8" ry="9.5" fill="#d8b58f"/></g>'+
    '<g id="bc-armR"><path d="M46 50 C58 80 56 112 50 132 L40 132 C44 112 42 82 36 54 Z" fill="#e8ecee"/><path d="M46 50 C58 80 56 112 50 132 L42 132 C45 112 43 84 38 56 Z" fill="#c6d0d4" opacity=".6"/><ellipse cx="52" cy="136" rx="8" ry="9.5" fill="#d8b58f"/></g>'+
    '<rect x="20" y="92" width="24" height="24" fill="#d4dcdf"/><rect x="29" y="90" width="4" height="17" fill="#3a6a8a"/>'+
    '<rect x="-10" y="28" width="20" height="22" rx="5" fill="#d8b58f"/><rect x="-10" y="38" width="20" height="12" fill="#b89472" opacity=".4"/>'+
    '<g id="bc-head">'+
      '<path d="M-22 12 C-26 -10 -12 -23 0 -23 C12 -23 26 -10 22 12 C22 32 14 46 0 49 C-14 46 -22 32 -22 12 Z" fill="#e1c09c"/>'+
      '<path d="M-22 12 C-22 30 -14 44 -2 48 C-12 32 -16 22 -18 10 Z" fill="#b89472" opacity=".4"/>'+
      '<path d="M18 -6 C22 4 21 22 14 40" stroke="#f0d8ba" stroke-width="2" fill="none" opacity=".4"/>'+
      '<path d="M-22 8 C-24 -14 -10 -25 0 -25 C12 -25 26 -15 23 8 C20 -6 12 -10 -2 -9 C-2 -5 -4 -3 -7 -3 C-9 -7 -16 -7 -22 8 Z" fill="#231b13"/>'+
      '<path d="M-18 -4 C-9 -13 11 -13 19 -2" stroke="#48392a" stroke-width="1.5" fill="none" opacity=".5"/>'+
      '<g stroke="#26221e" stroke-width="2" fill="rgba(180,205,215,.16)">'+
        '<rect x="-19.5" y="6" width="16" height="12" rx="3"/><rect x="3.5" y="6" width="16" height="12" rx="3"/>'+
        '<line x1="-3.5" y1="10" x2="3.5" y2="10"/><line x1="-19.5" y1="9" x2="-23" y2="8"/><line x1="19.5" y1="9" x2="23" y2="8"/></g>'+
      '<g id="bc-eyeL"><ellipse cx="-11" cy="12" rx="4" ry="2.6" fill="#efe9e0"/><circle cx="-10.5" cy="12" r="2" fill="#2a1c12"/><circle cx="-10" cy="11.4" r=".6" fill="#fff"/></g>'+
      '<g id="bc-eyeR"><ellipse cx="11" cy="12" rx="4" ry="2.6" fill="#efe9e0"/><circle cx="11.5" cy="12" r="2" fill="#2a1c12"/><circle cx="12" cy="11.4" r=".6" fill="#fff"/></g>'+
      '<path d="M-18 3 C-13 .6 -6 .6 -3 4" stroke="#231b13" stroke-width="2" fill="none" stroke-linecap="round"/>'+
      '<path d="M3 4 C6 .6 13 .6 18 3" stroke="#231b13" stroke-width="2" fill="none" stroke-linecap="round"/>'+
      '<path d="M0 14 C-1 20 -2 24 -4 27 C-1 29 3 29 6 26" stroke="#b89472" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>'+
      '<path d="M-7 36 C-2 37.6 3 37.6 8 35" stroke="#7a4a3a" stroke-width="2" fill="none" stroke-linecap="round"/>'+
    '</g>'+
  '</g>';
}

/* ===== Act 0 — file & title ===== */
SC.terminal={build(layer){
  const lines=[
    "&gt; 柏林中心医院 · 第 6761 号供体档案",
    "  状态：活跃     采集周期：每 48 小时 / 400cc",
    "  入院时长：自出生起，22 年",
    "  备注：该供体对“光”表现出异常依恋。",
  ];
  layer.innerHTML='<div class="crt"><div class="crt-body">'+
    lines.map(t=>'<div class="line">'+t+'<span class="cursor" style="display:none"></span></div>').join('')+
    '</div></div><div class="crt-scan"></div><div class="crt-flick"></div>';
  const ls=[...layer.querySelectorAll(".line")];
  return{update(p){
    const show=Math.min(ls.length,Math.floor(p*(ls.length+0.4)));
    ls.forEach((l,i)=>{
      l.classList.toggle("on",i<show);
      const cur=l.querySelector(".cursor");
      cur.style.display=(i===show-1)?"inline-block":"none";
    });
  }};
}};

SC.title={build(layer){
  layer.innerHTML='<div class="center"><div class="crt-ghost" style="position:absolute;top:60%;font-family:var(--mono);color:#5dffa0;font-size:clamp(10px,1.6vw,17px);text-shadow:0 0 8px rgba(93,255,160,.7)">备注：该供体对“光”表现出异常依恋。</div>'+
    '<h1 class="bigtitle" style="font-size:clamp(56px,13vw,150px);opacity:0">人造光</h1></div>';
  const ghost=layer.querySelector(".crt-ghost"), title=layer.querySelector(".bigtitle");
  return{update(p){
    // blink twice then vanish in first 35%
    if(p<.35){const b=Math.sin(p*40);ghost.style.opacity=(p<.28?(b>0?1:0.05):lerp(1,0,(p-.28)/.07));}
    else ghost.style.opacity=0;
    const tp=clamp((p-.35)/.5,0,1);
    title.style.opacity=tp;
    title.style.letterSpacing=lerp(.55,.2,tp)+"em";
    title.style.transform="scale("+lerp(1.06,1,tp)+")";
  }};
}};
/* ===== ward environment (reused) ===== */
SC.needle={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs>'+
      '<linearGradient id="bdWall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#33424a"/><stop offset="1" stop-color="#54686d"/></linearGradient>'+
      '<linearGradient id="bdFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a686d"/><stop offset="1" stop-color="#39444a"/></linearGradient>'+
      '<linearGradient id="bdGlove" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6e4ef"/><stop offset="1" stop-color="#9eb5c5"/></linearGradient>'+
      '<linearGradient id="bdBlood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c01a1d"/><stop offset="1" stop-color="#6f0b0e"/></linearGradient>'+
    '</defs>'+
    '<rect width="1600" height="900" fill="url(#bdWall)"/>'+
    '<ellipse cx="1280" cy="280" rx="430" ry="360" fill="rgba(207,230,246,.15)"/>'+
    '<polygon points="0,652 1600,652 1600,900 0,900" fill="url(#bdFloor)"/>'+
    '<g transform="translate(1086,300)"><rect x="-4" y="0" width="8" height="392" rx="4" fill="#aeb8bc"/><rect x="-42" y="-6" width="84" height="14" rx="4" fill="#97a1a5"/>'+
      '<rect x="-36" y="18" width="72" height="124" rx="12" fill="rgba(220,230,235,.4)" stroke="#aeb8bc" stroke-width="2"/>'+
      '<rect id="bdbag" x="-32" y="140" width="64" height="0" rx="8" fill="url(#bdBlood)"/>'+
    '</g>'+
    '<g id="qf" transform="translate(430,250) scale(1.25)">'+qiufan()+'</g>'+
    '<path id="bdtube" d="M566 656 C760 690 950 560 1050 446" stroke="#7a0f12" stroke-width="5" fill="none" opacity=".75"/>'+
    '<g transform="translate(560,640)">'+
      '<rect x="-96" y="22" width="190" height="22" rx="8" fill="#48535a"/>'+
      '<rect x="-9" y="-30" width="18" height="46" rx="4" fill="rgba(232,244,250,.5)" stroke="rgba(245,250,255,.82)" stroke-width="2" transform="rotate(20 0 -7)"/>'+
      '<line x1="6" y1="14" x2="18" y2="36" stroke="rgba(245,250,255,.9)" stroke-width="2.6"/>'+
      '<circle cx="20" cy="40" r="4" fill="#c01a1d"/>'+
      '<path d="M44 124 C22 84 32 42 64 32 C96 22 126 44 128 74 C130 100 104 124 72 128 C58 130 50 128 44 124 Z" fill="url(#bdGlove)"/>'+
      '<path d="M32 64 C10 54 -8 60 -12 80 C-14 96 0 110 20 110 C34 110 44 100 42 86 Z" fill="url(#bdGlove)"/>'+
      '<path d="M62 42 C56 32 38 30 28 40" stroke="#8fa6b6" stroke-width="2" fill="none"/>'+
    '</g>'+
  "")+'</div>';
  const head=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest'),eyeL=layer.querySelector('#qf-eyeL'),eyeR=layer.querySelector('#qf-eyeR'),bag=layer.querySelector('#bdbag');
  return{update(p,t){
    if(head)head.setAttribute('transform','rotate('+lerp(2,-12,clamp(p,0,1)).toFixed(2)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.2)*1.2).toFixed(2)+')');
    const cyc=t%5.0,s=(cyc<0.16?0.1:1);
    if(eyeL)eyeL.setAttribute('transform','translate(-26,56) scale(1,'+s+') translate(26,-56)');
    if(eyeR)eyeR.setAttribute('transform','translate(26,56) scale(1,'+s+') translate(-26,-56)');
    const h=clamp((p-.1)/.8,0,1)*116; if(bag){bag.setAttribute('height',h.toFixed(1));bag.setAttribute('y',(140-h).toFixed(1));}
  }};
}};

SC.armscars={build(layer){
  let scars='';for(let i=0;i<30;i++){const x=rnd(566,700),y=rnd(520,760),r=rnd(3,7),fresh=Math.random()<.3;
    scars+='<circle cx="'+x.toFixed(0)+'" cy="'+y.toFixed(0)+'" r="'+r.toFixed(1)+'" fill="'+(fresh?'#8a201c':'#5a2a22')+'" opacity="'+rnd(.5,.9).toFixed(2)+'"/>';
    if(fresh)scars+='<circle cx="'+x.toFixed(0)+'" cy="'+y.toFixed(0)+'" r="'+(r+3).toFixed(1)+'" fill="none" stroke="#a83b32" stroke-width="1.4" opacity=".5"/>';}
  layer.innerHTML=
    '<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
      '<defs><radialGradient id="aBg" cx="38%" cy="32%" r="82%"><stop offset="0" stop-color="#41525a"/><stop offset="100%" stop-color="#1d282e"/></radialGradient></defs>'+
      '<rect width="1600" height="900" fill="url(#aBg)"/>'+
      '<ellipse cx="290" cy="170" rx="430" ry="330" fill="rgba(207,230,246,.16)"/>'+
      '<g id="qf" transform="translate(490,116) scale(1.6)">'+qiufan()+'</g>'+
      '<g opacity=".95">'+scars+'</g>'+
    "")+'</div>'+
    '<div id="motes" style="position:absolute;inset:0;pointer-events:none"></div>';
  const head=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest'),eyeL=layer.querySelector('#qf-eyeL'),eyeR=layer.querySelector('#qf-eyeR');
  const motes=layer.querySelector('#motes');const M=[];
  for(let i=0;i<12;i++){const m=E('div');m.style.cssText='position:absolute;border-radius:50%;background:rgba(207,230,246,'+rnd(.12,.35).toFixed(2)+');width:'+rnd(2,4).toFixed(1)+'px;height:'+rnd(2,4).toFixed(1)+'px';m._x=rnd(6,46);m._y=rnd(8,60);m._sp=rnd(.3,1);m._ph=rnd(0,6.28);m.style.left=m._x+'%';m.style.top=m._y+'%';motes.appendChild(m);M.push(m);}
  return{update(p,t){
    if(head)head.setAttribute('transform','rotate('+(lerp(7,-1,clamp((p-.35)/.4,0,1))).toFixed(2)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.3)*1).toFixed(2)+')');
    const cyc=t%4.6,s=(cyc<0.14?0.1:1);
    if(eyeL)eyeL.setAttribute('transform','translate(-26,56) scale(1,'+s+') translate(26,-56)');
    if(eyeR)eyeR.setAttribute('transform','translate(26,56) scale(1,'+s+') translate(-26,-56)');
    M.forEach(m=>{m.style.left=(m._x+Math.sin(t*.3*m._sp+m._ph)*1.8).toFixed(2)+'%';m.style.top=(m._y+Math.cos(t*.25*m._sp+m._ph)*2.4).toFixed(2)+'%';m.style.opacity=(.25+Math.sin(t*.7+m._ph)*.2).toFixed(2);});
  }};
}};

SC.yard={build(layer){
  const cols=['#aeb9bd','#b4bcc0','#a6b0b4','#bcc4c7'];
  let runnersHTML='';const N=7;const slots=[];
  for(let i=0;i<N;i++){
    const depth=i/(N-1), sc=lerp(1.1,0.5,depth), footY=lerp(862,598,depth), by=footY-150*sc, dir=(i%2?1:-1);
    slots.push({sc,by,dir,sp:rnd(.05,.1),ph:rnd(0,1)});
    runnersHTML+='<g id="run'+i+'"><g'+(dir<0?' transform="scale(-1,1)"':'')+'>'+runner({top:cols[i%cols.length],topSh:'#8b979c',skin:(i%3?'#c9b094':'#d3b49a'),hair:(i%2?'#2a241f':'#1f1a16')})+'</g></g>';
  }
  layer.innerHTML=
    '<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
      '<defs>'+
        '<linearGradient id="ySky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c8c93"/><stop offset="1" stop-color="#9aa6aa"/></linearGradient>'+
        '<linearGradient id="yGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#717c80"/><stop offset="1" stop-color="#4e585c"/></linearGradient>'+
        '<linearGradient id="oSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0f4"/><stop offset="60%" stop-color="#cdecfb"/><stop offset="100%" stop-color="#e9f6e2"/></linearGradient>'+
        '<linearGradient id="oGrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c1e1a6"/><stop offset="1" stop-color="#8fc47a"/></linearGradient>'+
        '<radialGradient id="oSun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff8e6"/><stop offset="60%" stop-color="rgba(255,244,200,.65)"/><stop offset="100%" stop-color="rgba(255,244,200,0)"/></radialGradient>'+
      '</defs>'+
      '<rect x="980" y="0" width="620" height="640" fill="url(#oSky)"/>'+
      '<circle id="osun" cx="1430" cy="150" r="150" fill="url(#oSun)"/>'+
      '<g id="oclouds" fill="rgba(255,255,255,.7)"><ellipse cx="1150" cy="150" rx="70" ry="20"/><ellipse cx="1320" cy="240" rx="90" ry="24"/></g>'+
      '<g fill="#bcd0e0" opacity=".92"><rect x="1040" y="360" width="60" height="280"/><rect x="1120" y="300" width="44" height="340"/><rect x="1180" y="400" width="70" height="240"/><rect x="1270" y="330" width="50" height="310"/><rect x="1340" y="380" width="80" height="260"/><rect x="1440" y="350" width="56" height="290"/><rect x="1510" y="410" width="70" height="230"/></g>'+
      '<rect x="980" y="600" width="620" height="300" fill="url(#oGrass)"/>'+
      '<rect x="0" y="0" width="1010" height="640" fill="url(#ySky)"/>'+
      '<rect x="0" y="60" width="1010" height="320" fill="#5e696e"/>'+
      '<g fill="#3a4347"><rect x="120" y="150" width="80" height="120"/><rect x="320" y="150" width="80" height="120"/><rect x="520" y="150" width="80" height="120"/><rect x="720" y="150" width="80" height="120"/></g>'+
      '<g stroke="#7c878b" stroke-width="3"><line x1="160" y1="150" x2="160" y2="270"/><line x1="360" y1="150" x2="360" y2="270"/><line x1="560" y1="150" x2="560" y2="270"/><line x1="760" y1="150" x2="760" y2="270"/></g>'+
      '<polygon points="0,560 1010,560 1010,900 0,900" fill="url(#yGround)"/>'+
      '<g stroke="rgba(255,255,255,.16)" stroke-width="4" fill="none"><path d="M-50 660 C300 632 760 632 1010 650"/><path d="M-50 742 C300 706 760 706 1010 720"/><path d="M-50 842 C300 796 760 796 1010 802"/></g>'+
      '<g id="runners">'+runnersHTML+'</g>'+
      '<g transform="translate(980,0)">'+
        '<rect x="0" y="0" width="60" height="900" fill="rgba(120,134,138,.22)"/>'+
        '<rect x="6" y="0" width="10" height="900" fill="#5b676c"/><rect x="44" y="0" width="10" height="900" fill="#5b676c"/>'+
        '<g stroke="rgba(38,46,50,.5)" stroke-width="2">'+(function(){let s='';for(let i=-9;i<14;i++){s+='<line x1="'+(i*42)+'" y1="0" x2="'+(i*42+900)+'" y2="900"/><line x1="'+(i*42)+'" y1="900" x2="'+(i*42+900)+'" y2="0"/>';}return s;})()+'</g>'+
      '</g>'+
      '<g id="qfb" transform="translate(905,470)">'+
        '<path d="M-26 250 C-28 320 -26 400 -22 430 L-4 430 C-6 360 -4 300 -4 252 Z" fill="#7c878c"/>'+
        '<path d="M4 252 C4 300 6 360 4 430 L22 430 C26 400 28 320 26 250 Z" fill="#7c878c"/>'+
        '<path d="M-44 70 C-50 30 -28 6 0 4 C30 2 50 28 48 70 C52 140 50 220 40 256 L-40 256 C-50 218 -48 140 -44 70 Z" fill="#b6c2c6"/>'+
        '<path d="M-44 70 C-50 30 -28 6 0 4 L0 256 L-40 256 C-50 218 -48 140 -44 70 Z" fill="#9aa7ac" opacity=".5"/>'+
        '<path d="M34 80 C58 60 74 30 78 6 L66 0 C60 24 46 50 28 66 Z" fill="#cbb097"/>'+
        '<ellipse cx="76" cy="4" rx="9" ry="11" fill="#cbb097"/>'+
        '<rect x="-9" y="50" width="18" height="22" fill="#cbb097"/>'+
        '<ellipse cx="0" cy="34" rx="26" ry="28" fill="#cbb097"/>'+
        '<path d="M-26 34 C-28 2 -12 -16 0 -16 C12 -16 28 2 26 34 C22 16 12 8 0 8 C-12 8 -22 16 -26 34 Z" fill="#231e19"/>'+
        '<path d="M-26 30 C-26 46 -16 60 0 64 C16 60 26 46 26 30 C26 44 14 52 0 52 C-14 52 -26 44 -26 30 Z" fill="#231e19"/>'+
      '</g>'+
    "")+'</div>'+
    '<div id="motes" style="position:absolute;inset:0;pointer-events:none"></div>';
  const R=[];slots.forEach((s,i)=>{R.push(Object.assign({el:layer.querySelector('#run'+i)},s));});
  const sun=layer.querySelector('#osun'),clouds=layer.querySelector('#oclouds'),qfb=layer.querySelector('#qfb');
  const motes=layer.querySelector('#motes');const M=[];
  for(let i=0;i<16;i++){const m=E('div');m.style.cssText='position:absolute;border-radius:50%;background:rgba(255,255,255,'+rnd(.15,.45).toFixed(2)+');width:'+rnd(2,4).toFixed(1)+'px;height:'+rnd(2,4).toFixed(1)+'px';m._x=rnd(2,62);m._y=rnd(20,80);m._sp=rnd(.3,1);m._ph=rnd(0,6.28);m.style.left=m._x+'%';m.style.top=m._y+'%';motes.appendChild(m);M.push(m);}
  return{update(p,t){
    R.forEach(r=>{
      const x=((t*r.sp+r.ph)%1), px=(r.dir>0? x*980 : 980-x*980);
      const bob=Math.abs(Math.sin((t*r.sp+r.ph)*Math.PI*8))*5*r.sc;
      r.el.setAttribute('transform','translate('+px.toFixed(1)+','+(r.by-bob).toFixed(1)+') scale('+r.sc.toFixed(3)+')');
    });
    if(sun)sun.setAttribute('r',(150+Math.sin(t*.8)*6).toFixed(1));
    if(clouds)clouds.setAttribute('transform','translate('+(Math.sin(t*.1)*30).toFixed(1)+',0)');
    if(qfb)qfb.setAttribute('transform','translate(905,'+(470+Math.sin(t*1.2)*1.6).toFixed(1)+')');
    M.forEach(m=>{m.style.left=(m._x+Math.sin(t*.3*m._sp+m._ph)*2).toFixed(2)+'%';m.style.top=(m._y+Math.cos(t*.26*m._sp+m._ph)*2.6).toFixed(2)+'%';});
  }};
}};

SC.eye={build(layer){
  layer.innerHTML=
    '<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
      '<defs>'+
        '<radialGradient id="e7skin" cx="44%" cy="36%" r="80%"><stop offset="0" stop-color="#e4cdb2"/><stop offset="58%" stop-color="#cbad91"/><stop offset="100%" stop-color="#967a56"/></radialGradient>'+
        '<radialGradient id="e7iris" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#cda662"/><stop offset="42%" stop-color="#8a5e2e"/><stop offset="100%" stop-color="#36230f"/></radialGradient>'+
        '<radialGradient id="e7sun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fffcef"/><stop offset="100%" stop-color="rgba(255,246,210,0)"/></radialGradient>'+
        '<clipPath id="e7clip"><circle cx="800" cy="450" r="152"/></clipPath>'+
      '</defs>'+
      '<rect width="1600" height="900" fill="url(#e7skin)"/>'+
      '<ellipse cx="800" cy="452" rx="640" ry="330" fill="rgba(96,64,42,.2)"/>'+
      '<path d="M250 452 C470 305 1130 305 1352 452 C1130 600 470 600 250 452 Z" fill="#efe9dd"/>'+
      '<path d="M250 452 C360 412 470 404 548 422 C470 442 360 452 300 478 Z" fill="rgba(186,118,108,.3)"/>'+
      '<g stroke="rgba(190,120,110,.26)" stroke-width="2.4" fill="none"><path d="M300 444 C370 448 430 454 470 462"/><path d="M1312 450 C1242 452 1182 458 1142 464"/></g>'+
      '<circle cx="800" cy="450" r="152" fill="url(#e7iris)"/>'+
      '<g stroke="rgba(58,36,16,.5)" stroke-width="2" id="e7fib">'+(function(){let s='';for(let i=0;i<30;i++){const a=i/30*6.283;s+='<line x1="'+(800+Math.cos(a)*70).toFixed(0)+'" y1="'+(450+Math.sin(a)*70).toFixed(0)+'" x2="'+(800+Math.cos(a)*149).toFixed(0)+'" y2="'+(450+Math.sin(a)*149).toFixed(0)+'"/>';}return s;})()+'</g>'+
      '<circle cx="800" cy="450" r="152" fill="none" stroke="#2a1c0d" stroke-width="6"/>'+
      '<circle cx="800" cy="450" r="70" fill="#0c0805"/>'+
      '<g id="e7refl" clip-path="url(#e7clip)" opacity="0">'+
        '<rect x="648" y="318" width="304" height="148" fill="#9fd4f2"/>'+
        '<rect x="648" y="450" width="304" height="150" fill="#bfe0a4"/>'+
        '<g fill="#7fa6c4"><rect x="690" y="404" width="22" height="62"/><rect x="722" y="386" width="16" height="80"/><rect x="748" y="414" width="26" height="52"/><rect x="800" y="392" width="18" height="74"/><rect x="832" y="408" width="24" height="58"/><rect x="872" y="398" width="16" height="68"/></g>'+
        '<circle cx="884" cy="372" r="26" fill="url(#e7sun)"/>'+
      '</g>'+
      '<circle id="e7cat" cx="852" cy="402" r="30" fill="#ffffff" opacity=".88"/>'+
      '<circle cx="772" cy="488" r="12" fill="#fff" opacity=".22"/>'+
      '<g id="e7upper"><path d="M0 0 H1600 V458 C1130 300 470 300 250 458 C160 472 80 466 0 472 Z" fill="url(#e7skin)"/>'+
        '<path d="M250 452 C470 300 1130 300 1352 450" stroke="rgba(120,86,54,.35)" stroke-width="18" fill="none"/>'+
        '<path d="M250 456 C470 306 1130 306 1352 454" stroke="#33271b" stroke-width="6" fill="none" opacity=".7"/>'+
        '<g stroke="#241c12" stroke-width="3" stroke-linecap="round" opacity=".85"><path d="M468 320 l-9 -22"/><path d="M558 312 l-7 -24"/><path d="M658 308 l-4 -25"/><path d="M760 306 l-1 -25"/><path d="M862 308 l3 -25"/><path d="M962 313 l6 -24"/><path d="M1062 322 l9 -22"/><path d="M1150 334 l11 -20"/></g>'+
      '</g>'+
      '<path d="M250 452 C470 600 1130 600 1352 452 L1600 470 L1600 900 L0 900 L0 470 Z" fill="url(#e7skin)"/>'+
      '<path d="M286 470 C470 588 1130 588 1322 470" stroke="rgba(255,240,225,.5)" stroke-width="3" fill="none"/>'+
      '<g id="e7tear" opacity="0"><path d="M0 0 C-11 16 -11 30 0 34 C11 30 11 16 0 0 Z" fill="rgba(202,230,246,.85)"/><ellipse cx="-3" cy="20" rx="3" ry="6" fill="#fff" opacity=".85"/></g>'+
    "")+'</div>';
  const refl=layer.querySelector('#e7refl'),cat=layer.querySelector('#e7cat'),upper=layer.querySelector('#e7upper'),tear=layer.querySelector('#e7tear'),fib=layer.querySelector('#e7fib');
  return{update(p,t){
    refl.setAttribute('opacity',(clamp((p-.1)/.4,0,1)*0.6*(0.85+Math.sin(t*1.6)*0.15)).toFixed(2));
    cat.setAttribute('opacity',(.74+Math.sin(t*2)*0.18).toFixed(2));
    const cyc=t%5.0,bl=cyc<0.16?1:0; upper.setAttribute('transform','translate(0,'+(bl?152:0)+')');
    if(fib)fib.setAttribute('transform','translate('+(Math.sin(t*.5)*3).toFixed(1)+','+(Math.cos(t*.4)*2).toFixed(1)+')');
    const w=clamp((p-.35)/.35,0,1),roll=clamp((p-.72)/.28,0,1);
    tear.setAttribute('opacity',(w>0.05?0.9:0).toFixed(2));
    tear.setAttribute('transform','translate('+(566+roll*26).toFixed(0)+','+(486+roll*340).toFixed(0)+') scale('+(0.8+w*1.5).toFixed(2)+')');
  }};
}};

SC.montage1={build(layer){
  const fr=(h)=>'<div class="m-frame" style="position:absolute;inset:0;opacity:0;transition:opacity .6s ease">'+h+'</div>';
  layer.innerHTML='<div class="env" style="background:#0a1014"></div>'+
    fr('<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
        '<defs><linearGradient id="m1a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5c7076"/><stop offset="1" stop-color="#2e3a40"/></linearGradient></defs>'+
        '<rect width="1600" height="900" fill="url(#m1a)"/>'+
        '<rect x="960" y="70" width="440" height="540" fill="#dcecf8"/>'+
        '<g fill="#2b363b"><rect x="960" y="70" width="440" height="14"/><rect x="960" y="596" width="440" height="14"/><rect x="1174" y="70" width="12" height="540"/><rect x="960" y="334" width="440" height="12"/></g>'+
        '<g fill="rgba(226,242,252,.13)"><polygon points="985,100 1175,100 720,900 320,900"/></g>'+
        '<g transform="translate(560,610)" fill="#cdac86">'+
          '<rect x="-46" y="60" width="120" height="240" rx="30"/>'+
          '<rect x="-44" y="-150" width="22" height="220" rx="11"/><rect x="-14" y="-186" width="22" height="256" rx="11"/><rect x="18" y="-180" width="22" height="250" rx="11"/><rect x="48" y="-150" width="22" height="220" rx="11"/>'+
          '<rect x="-74" y="-30" width="48" height="22" rx="11" transform="rotate(-32 -50 -19)"/>'+
        '</g>'+
        '<g stroke="rgba(246,232,202,.55)" stroke-width="9" opacity=".55"><line x1="540" y1="640" x2="500" y2="300"/><line x1="600" y1="640" x2="586" y2="290"/><line x1="660" y1="640" x2="676" y2="300"/></g>'+
    "")+'</div>')+
    fr('<div class="env" style="background:radial-gradient(60% 60% at 50% 44%,#28323a,#10171c 82%)"></div>'+
       '<div class="center" style="flex-direction:column;gap:2.6%"><div style="font-family:var(--mono);font-size:1.3vw;letter-spacing:.4em;color:#8aa0a6">采 集 记 录</div>'+
       '<div id="m1day" style="font-family:var(--mono);font-size:7vw;color:#cfe0e6;text-shadow:0 0 30px rgba(180,210,220,.4)">第 8003 日</div>'+
       '<div style="font-size:1.2vw;color:#7c8c92;letter-spacing:.2em">两万二千次采血 · 自出生起</div></div>')+
    fr('<div class="env" style="background:linear-gradient(180deg,#0c1217,#05080b)"></div>'+
       '<div style="position:absolute;left:49.2%;top:0;width:1.8%;height:100%;background:linear-gradient(180deg,rgba(244,201,122,.9),rgba(244,201,122,.28));box-shadow:0 0 56px 14px rgba(244,201,122,.4)"></div>'+
       '<div style="position:absolute;inset:0;filter:brightness(.5)">'+svg("0 0 1600 900",'<g transform="translate(470,470) scale(1.2)">'+qiufan()+'</g>')+'</div>');
  const frames=[...layer.querySelectorAll('.m-frame')];const day=layer.querySelector('#m1day');
  const b=[0,.38,.72,1];
  return{update(p,t){
    let idx=0;for(let i=0;i<3;i++)if(p>=b[i])idx=i;
    frames.forEach((f,i)=>f.style.opacity=(i===idx)?1:0);
    if(day&&idx===1){const n=8001+Math.floor(clamp((p-.38)/.34,0,1)*3);day.textContent='第 '+n+' 日';}
  }};
}};

SC.door={build(layer){
  let q='';const qpos=[[720,300,.46],[630,356,.62],[812,356,.62],[560,432,.86],[900,432,.86]];
  qpos.forEach((d,i)=>{q+='<g id="dw'+i+'"><g transform="translate('+d[0]+','+d[1]+') scale('+d[2]+')">'+walker({top:['#aeb9bd','#b4bcc0','#a6b0b4'][i%3],skin:(i%2?'#c9b094':'#d3b49a'),hair:(i%2?'#2a241f':'#1f1a16')})+'</g></g>';});
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="dWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c4950"/><stop offset="1" stop-color="#26302f"/></linearGradient>'+
      '<radialGradient id="dDoor" cx="50%" cy="46%" r="62%"><stop offset="0" stop-color="#fff4da"/><stop offset="58%" stop-color="#f0cf8e"/><stop offset="100%" stop-color="#bd9148"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="#19211f"/>'+
    '<polygon points="0,0 600,250 600,640 0,900" fill="url(#dWall)"/>'+
    '<polygon points="1600,0 1000,250 1000,640 1600,900" fill="url(#dWall)"/>'+
    '<polygon points="0,0 600,250 1000,250 1600,0" fill="#2f3a36"/>'+
    '<polygon points="0,900 600,640 1000,640 1600,900" fill="#222b29"/>'+
    '<rect x="648" y="252" width="304" height="392" fill="url(#dDoor)"/>'+
    '<rect x="648" y="252" width="304" height="392" fill="none" stroke="#5a4a2a" stroke-width="9"/>'+
    '<polygon points="700,644 900,644 1120,900 480,900" fill="rgba(244,201,122,.18)"/>'+
    '<g id="queue">'+q+'</g>'+
    '<g id="qfb" transform="translate(800,452) scale(1.55)">'+walker({top:'#bcc8cd',topSh:'#8b9aa0',skin:'#cbb097',hair:'#231e19'})+'</g>'+
    '<rect id="dDoorL" x="648" y="252" width="152" height="392" fill="#1c2522" opacity="0"/>'+
    '<rect id="dDoorR" x="800" y="252" width="152" height="392" fill="#1c2522" opacity="0"/>'+
  "")+'</div>';
  const W=qpos.map((d,i)=>({el:layer.querySelector('#dw'+i),x:d[0],y:d[1],s:d[2],ph:i/qpos.length}));
  const qfb=layer.querySelector('#qfb'),dl=layer.querySelector('#dDoorL'),dr=layer.querySelector('#dDoorR');
  return{update(p,t){
    W.forEach(w=>{const k=clamp(p*1.1+w.ph*.15,0,1);
      const x=lerp(w.x,800,k*.85), y=lerp(w.y,300,k*.85), s=lerp(w.s,.18,k*.9);
      w.el.setAttribute('transform','translate('+x.toFixed(1)+','+(y-Math.abs(Math.sin((t*.6+w.ph)*6))*3).toFixed(1)+') scale('+s.toFixed(3)+')');
      w.el.style.opacity=(1-k*.7).toFixed(2);});
    if(qfb)qfb.setAttribute('transform','translate(800,'+(452-Math.abs(Math.sin(t*.8))*3).toFixed(1)+') scale('+lerp(1.55,1.2,clamp(p,0,1)).toFixed(3)+')');
    const close=clamp((p-.72)/.26,0,1);
    if(dl)dl.setAttribute('opacity',close.toFixed(2));if(dr)dr.setAttribute('opacity',close.toFixed(2));
  }};
}};

SC.labReport={build(layer){
  let grid='';for(let i=1;i<8;i++)grid+='<line x1="0" y1="'+(i*54)+'" x2="720" y2="'+(i*54)+'"/>';for(let i=1;i<12;i++)grid+='<line x1="'+(i*60)+'" y1="0" x2="'+(i*60)+'" y2="430"/>';
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="lrWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c3138"/><stop offset="1" stop-color="#0e1c20"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#lrWall)"/>'+
    '<g fill="#16282e"><rect x="56" y="120" width="220" height="380" rx="8"/><rect x="1330" y="150" width="214" height="350" rx="8"/></g>'+
    '<g fill="#0c181c"><rect x="78" y="150" width="176" height="40"/><rect x="78" y="208" width="176" height="40"/><rect x="78" y="266" width="176" height="40"/><rect x="78" y="324" width="176" height="40"/></g>'+
    '<polygon points="0,640 1600,640 1600,900 0,900" fill="#13242a"/>'+
    '<rect y="630" width="1600" height="14" fill="#1d343b"/>'+
    '<g transform="translate(430,140)"><rect x="-22" y="-22" width="764" height="474" rx="12" fill="#0a1316"/>'+
      '<rect x="0" y="0" width="720" height="430" fill="#0d1b20"/>'+
      '<g stroke="#1f3b43" stroke-width="1.5">'+grid+'</g>'+
      '<path d="M10 400 L300 398 L360 402 L420 396 L470 400 L500 56 L520 400 L600 398 L710 400" fill="none" stroke="#4fd2e0" stroke-width="4"/>'+
      '<path id="spike" d="M484 400 L500 56 L516 400 Z" fill="#4fd2e0" opacity=".2"/>'+
      '<text x="20" y="40" font-family="monospace" font-size="26" fill="#5fe0ee">OD 450nm</text>'+
      '<text x="430" y="50" font-family="monospace" font-size="34" fill="#ff6a5a">× 700</text>'+
      '<text x="20" y="416" font-family="monospace" font-size="18" fill="#3a6a72">sample #6 / 6 · 复测</text>'+
    '</g>'+
    '<g id="bc" transform="translate(1306,470) scale(1.72)">'+beicang()+'</g>'+
  "")+'</div>';
  const bch=layer.querySelector('#bc-head'),spike=layer.querySelector('#spike');
  return{update(p,t){
    if(bch)bch.setAttribute('transform','rotate('+(-9+Math.sin(t*.5)*3).toFixed(1)+' 0 30)');
    if(spike)spike.setAttribute('opacity',(.2+Math.sin(t*3.2)*.14).toFixed(2));
  }};
}};

SC.labPhone={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="lpWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#52727b"/><stop offset="1" stop-color="#35545d"/></linearGradient>'+
      '<linearGradient id="lpWin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef8ff"/><stop offset="1" stop-color="#bfe0ee"/></linearGradient>'+
      '<linearGradient id="lpFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c585f"/><stop offset="1" stop-color="#263d44"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#lpWall)"/>'+
    '<rect x="78" y="78" width="448" height="386" rx="6" fill="#2c4c54"/>'+
    '<rect x="96" y="96" width="412" height="350" fill="url(#lpWin)"/>'+
    '<g stroke="#2c4c54" stroke-width="10"><line x1="302" y1="96" x2="302" y2="446"/><line x1="96" y1="271" x2="508" y2="271"/></g>'+
    '<polygon points="96,446 508,446 770,900 -120,900" fill="#d4eaf2" opacity=".2"/>'+
    '<rect x="1116" y="118" width="404" height="406" rx="10" fill="#406169"/>'+
    '<g fill="#5a848f"><rect x="1144" y="148" width="348" height="46" rx="3"/><rect x="1144" y="210" width="348" height="46" rx="3"/><rect x="1144" y="272" width="348" height="46" rx="3"/></g>'+
    '<g fill="#274249"><circle cx="1330" cy="432" r="34"/><rect x="1296" y="432" width="68" height="72" rx="4"/><circle cx="1330" cy="432" r="14" fill="#5a848f"/></g>'+
    '<polygon points="0,648 1600,648 1600,900 0,900" fill="url(#lpFloor)"/>'+
    '<rect y="640" width="1600" height="14" fill="#5e848e"/>'+
    '<ellipse cx="800" cy="430" rx="300" ry="320" fill="#d4eaf2" opacity=".12"/>'+
    '<g id="bc" transform="translate(800,404) scale(2.06)">'+beicang()+'</g>'+
    '<g id="phonearm" transform="translate(800,404) scale(2.06)">'+
      '<path d="M33 50 C27 64 32 82 44 97 L57 90 C49 71 45 60 45 50 Z" fill="#e8ecee"/>'+
      '<circle cx="49" cy="95" r="9" fill="#e8ecee"/>'+
      '<path d="M45 98 C47 74 39 46 27 26 L13 34 C25 54 33 80 31 98 Z" fill="#e8ecee"/>'+
      '<path d="M31 98 C33 78 27 52 17 32" stroke="#c6d0d4" stroke-width="2.5" fill="none" opacity=".5"/>'+
      '<ellipse cx="23" cy="24" rx="8" ry="9.5" fill="#d8b58f"/>'+
      '<rect x="12" y="3" width="16" height="36" rx="7" fill="#15242a" transform="rotate(12 20 21)"/>'+
      '<circle cx="18" cy="10" r="2.2" fill="#3e8a6a"/>'+
    '</g>'+
  "")+'</div>';
  const bch=layer.querySelector('#bc-head'),bcAR=layer.querySelector('#bc-armR');if(bcAR)bcAR.setAttribute('display','none');
  return{update(p,t){
    if(bch)bch.setAttribute('transform','rotate('+(Math.sin(t*.6)*3-3).toFixed(1)+' 0 30)');
  }};
}};

SC.montage2={build(layer){
  let rays='';for(let i=0;i<12;i++){const a=(i/12)*6.283;rays+='<line x1="800" y1="120" x2="'+(800+Math.cos(a)*260).toFixed(0)+'" y2="'+(120+Math.sin(a)*260).toFixed(0)+'"/>';}
  let grid='';for(let i=1;i<9;i++)grid+='<line x1="120" y1="'+(120+i*78)+'" x2="1480" y2="'+(120+i*78)+'"/>';for(let i=1;i<16;i++)grid+='<line x1="'+(120+i*85)+'" y1="120" x2="'+(120+i*85)+'" y2="780"/>';
  const A=svg("0 0 1600 900",
    '<rect width="1600" height="900" fill="#d8e6ea"/>'+
    '<rect width="1600" height="900" fill="#bcd2d8" opacity=".4"/>'+
    '<g transform="translate(470,210)"><path d="M150 0 C230 44 320 56 366 56 C366 220 300 396 150 484 C0 396 -66 220 -66 56 C-20 56 70 44 150 0 Z" fill="#4a90a4"/>'+
      '<path d="M150 0 C230 44 320 56 366 56 C366 220 300 396 150 484 L150 0 Z" fill="#3a7888"/>'+
      '<path d="M150 70 L96 180 L186 250 L120 400" stroke="#d8e6ea" stroke-width="9" fill="none" stroke-linecap="round"/>'+
      '<path d="M150 70 L210 170 L120 250 L196 380" stroke="#d8e6ea" stroke-width="5" fill="none" opacity=".6"/></g>'+
    '<g transform="translate(1010,360) rotate(-22)"><rect x="0" y="0" width="300" height="58" rx="12" fill="#eef4f6"/><rect x="0" y="0" width="190" height="58" rx="12" fill="#a9d6e0" opacity=".7"/><rect x="300" y="17" width="64" height="24" rx="4" fill="#8aa0a8"/><rect x="364" y="25" width="130" height="8" fill="#8aa0a8"/></g>'+
    '<g stroke="#1c3a44" stroke-width="7" fill="none" opacity=".45" stroke-linecap="round"><path d="M210 720 l0 -46 m-20 -26 l20 26 l20 -26"/><path d="M360 762 l0 -46 m-20 -26 l20 26 l20 -26"/><path d="M120 800 l0 -38 m-16 -22 l16 22 l16 -22" opacity=".25"/></g>'+
    '<text x="120" y="844" font-family="sans-serif" font-size="42" font-weight="700" fill="#15323a">免疫归零 · 一次暴晒，变回婴儿</text>');
  const B=svg("0 0 1600 900",
    '<defs><linearGradient id="ozSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1a34"/><stop offset="1" stop-color="#21426a"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#ozSky)"/>'+
    '<g stroke="#ffcf7a" stroke-width="6" opacity=".4" stroke-linecap="round">'+rays+'</g>'+
    '<circle cx="800" cy="120" r="132" fill="#ffd27a" opacity=".35"/><circle cx="800" cy="120" r="92" fill="#fff2cc"/>'+
    '<path d="M-100 900 C400 650 1200 650 1700 900 Z" fill="#15324a"/>'+
    '<path d="M-40 706 C400 474 1200 474 1640 706" stroke="#5fd0e0" stroke-width="16" fill="none" opacity=".7"/>'+
    '<path d="M620 548 C720 510 880 510 980 548" stroke="#0c1a34" stroke-width="26" fill="none"/>'+
    '<path d="M624 548 C720 514 880 514 976 548" stroke="#ff5a3a" stroke-width="10" fill="none" opacity=".85"/>'+
    '<text x="90" y="858" font-family="sans-serif" font-size="42" font-weight="700" fill="#bfe0ee">臭氧层 · 全纬度、全季节，逆转</text>');
  const C=svg("0 0 1600 900",
    '<rect width="1600" height="900" fill="#0e171c"/>'+
    '<rect x="100" y="100" width="1400" height="700" rx="12" fill="#0c181d"/>'+
    '<g stroke="#1f3b43" stroke-width="1.4">'+grid+'</g>'+
    '<path d="M120 640 C400 600 800 560 1480 540" fill="none" stroke="#4fd2e0" stroke-width="3" opacity=".6"/>'+
    '<path d="M120 660 C500 640 900 600 1480 470" fill="none" stroke="#7ad27a" stroke-width="3" opacity=".6"/>'+
    '<path d="M120 650 C420 648 720 640 980 600 C1140 560 1240 300 1300 150 L1320 150" fill="none" stroke="#ff6a5a" stroke-width="5"/>'+
    '<circle cx="1300" cy="150" r="9" fill="#ff6a5a"/>'+
    '<text x="150" y="200" font-family="monospace" font-size="34" fill="#ff6a5a">MODEL MISMATCH</text>'+
    '<text x="150" y="250" font-family="sans-serif" font-size="34" fill="#bfe0ee">没有任何模型对得上</text>'+
    '<text x="860" y="730" font-family="sans-serif" font-size="46" font-weight="700" fill="#ff8a6a">这不是人类干的</text>');
  layer.innerHTML='<div id="mA" style="position:absolute;inset:0">'+A+'</div>'+
    '<div id="mB" style="position:absolute;inset:0;opacity:0">'+B+'</div>'+
    '<div id="mC" style="position:absolute;inset:0;opacity:0">'+C+'</div>';
  const mA=layer.querySelector('#mA'),mB=layer.querySelector('#mB'),mC=layer.querySelector('#mC');
  return{update(p){
    const opA=p<.30?1:clamp(1-(p-.30)/.06,0,1);
    const opB=clamp((p-.30)/.06,0,1)*clamp(1-(p-.62)/.06,0,1);
    const opC=clamp((p-.62)/.06,0,1);
    mA.style.opacity=opA.toFixed(2);mB.style.opacity=opB.toFixed(2);mC.style.opacity=opC.toFixed(2);
    const sc=1+ (p<.30?p*.1:p<.62?(p-.30)*.1:(p-.62)*.1);
    [mA,mB,mC].forEach(m=>m.style.transform='scale('+(1.02+ p*0.04).toFixed(3)+')');
  }};
}};

SC.disaster={build(layer){
  const skin=['#e2c6aa','#cba283','#d2b08e','#c8a07a'],hairs=['#2a2018','#3a2a1a','#1f1a14','#4a3526'];
  const tops=['#c14a3a','#3f6fa8','#caa23a','#56885a','#8f5494','#c2783a','#d06a8a','#4aa0a4'];
  let idx=0,peopleHtml='';
  const rowDefs=[{y:606,s:.72,n:6,x0:250,dx:232,off:116},{y:712,s:.96,n:6,x0:150,dx:252,off:0}];
  rowDefs.forEach((r,ri)=>{for(let i=0;i<r.n;i++){const x=r.x0+i*r.dx+r.off;const c=tops[idx%tops.length];const sk=skin[idx%skin.length];const hr=hairs[idx%hairs.length];
    const fs=(0.16+Math.random()*0.46).toFixed(2);const dir=(Math.random()<.5?-1:1);
    peopleHtml+='<g class="vic" data-x="'+x+'" data-y="'+r.y+'" data-s="'+r.s+'" data-fs="'+fs+'" data-dir="'+dir+'" transform="translate('+x+','+r.y+') scale('+r.s+')">'+human({top:c,topSh:'#352f38',skin:sk,hair:hr,bottom:(ri%2?'#3a3a42':'#4a4030'),exp:'smile'})+'</g>';idx++;}});
  const bride='<g class="vic" data-x="742" data-y="556" data-s="0.82" data-fs="0.72" data-dir="-1" transform="translate(742,556) scale(0.82)">'+human({top:'#f3eee6',topSh:'#d2cabd',bottom:'#f3eee6',bottomSh:'#d2cabd',skin:'#e6cbb0',hair:'#2a2018',exp:'smile'})+'</g>';
  const groom='<g class="vic" data-x="862" data-y="556" data-s="0.84" data-fs="0.68" data-dir="1" transform="translate(862,556) scale(0.84)">'+human({top:'#2a2d33',topSh:'#15181d',bottom:'#23262b',skin:'#cba283',hair:'#1f1a14',exp:'smile'})+'</g>';
  let flowers='';const fc=['#d06a8a','#e0859e','#e8b34a','#f0e0e6'];for(let i=0;i<11;i++){const a=i/10;const ax=620+a*360;const ay=300-Math.sin(a*Math.PI)*78;flowers+='<circle cx="'+ax.toFixed(0)+'" cy="'+ay.toFixed(0)+'" r="'+(12+(i%3)*3)+'" fill="'+fc[i%fc.length]+'"/>';}
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="dsSky2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ddd5b2"/><stop offset="1" stop-color="#bcc3ad"/></linearGradient>'+
      '<linearGradient id="dsField2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c7c46"/><stop offset="1" stop-color="#574a2a"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#dsSky2)"/>'+
    '<circle id="dssun" cx="800" cy="148" r="186" fill="#fff4cc" opacity=".45"/><circle cx="800" cy="148" r="122" fill="#fffbe8"/>'+
    '<rect x="0" y="474" width="1600" height="58" fill="#6e7a52" opacity=".7"/>'+
    '<g fill="#5a6442"><polygon points="110,474 178,416 246,474"/><polygon points="1352,474 1420,414 1488,474"/><polygon points="470,476 520,432 570,476"/></g>'+
    '<g fill="#8a7a5a"><rect x="300" y="430" width="84" height="62"/><polygon points="288,430 342,398 396,430"/><rect x="1196" y="436" width="82" height="56"/><polygon points="1186,436 1237,406 1288,436"/></g>'+
    '<polygon points="0,500 1600,500 1600,900 0,900" fill="url(#dsField2)"/>'+
    '<path d="M0 520 C400 506 1200 506 1600 520" stroke="#9a8a52" stroke-width="3" fill="none" opacity=".5"/>'+
    '<path d="M620 558 L620 300 C620 232 980 232 980 300 L980 558" stroke="#9a6a4a" stroke-width="16" fill="none"/>'+
    '<g>'+flowers+'</g>'+
    groom+bride+
    peopleHtml+
  "")+'</div>';
  const vics=[...layer.querySelectorAll('.vic')],sun=layer.querySelector('#dssun');
  return{update(p,t){
    if(sun)sun.setAttribute('opacity',(.45+clamp((p-.2)/.5,0,1)*.4+Math.sin(t*3)*.05).toFixed(2));
    vics.forEach(g=>{const fs=+g.dataset.fs,dir=+g.dataset.dir,x=+g.dataset.x,y=+g.dataset.y,s=+g.dataset.s;
      const f=clamp((p-fs)/.13,0,1),ang=f*dir*94,sink=f*18;
      g.setAttribute('transform','translate('+x+','+(y+sink).toFixed(0)+') scale('+s+') rotate('+ang.toFixed(1)+' 0 198)');
    });
  }};
}};

SC.memo={build(layer){
  let body='';for(let i=0;i<5;i++){const y=118+i*40,w=540-(i%3)*90;body+='<rect x="40" y="'+y+'" width="'+w+'" height="12" rx="4" fill="#b8ad98"/>';}
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="meRoom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26323a"/><stop offset="1" stop-color="#141c22"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#meRoom)"/>'+
    '<ellipse cx="860" cy="540" rx="700" ry="400" fill="#ffe6b0" opacity=".13"/>'+
    '<polygon points="0,556 1600,556 1600,900 0,900" fill="#2a2620"/>'+
    '<rect y="548" width="1600" height="12" fill="#3a342a"/>'+
    '<g id="bc" transform="translate(398,356) scale(1.5)">'+beicang()+'</g>'+
    '<g transform="translate(706,300) rotate(-3)">'+
      '<rect x="-14" y="-14" width="654" height="532" rx="8" fill="#cdc4b0"/>'+
      '<rect x="0" y="0" width="626" height="506" rx="6" fill="#f1ebde"/>'+
      '<rect x="0" y="0" width="626" height="74" fill="#e3d9c5"/>'+
      '<text x="38" y="48" font-family="sans-serif" font-size="30" fill="#3a342a" font-weight="700">柏林市 · 人口调度通知</text>'+
      '<g transform="translate(0,30)">'+body+'</g>'+
      '<rect id="hl" x="34" y="378" width="446" height="50" rx="4" fill="#ffd24a" opacity="0"/>'+
      '<text x="46" y="414" font-family="sans-serif" font-size="33" fill="#1c1812" font-weight="700">……编入 户外作业梯队。</text>'+
      '<ellipse id="ring" cx="404" cy="400" rx="80" ry="34" fill="none" stroke="#c0392b" stroke-width="5" opacity="0"/>'+
      '<rect x="40" y="468" width="500" height="12" rx="4" fill="#b8ad98"/><rect x="40" y="496" width="350" height="12" rx="4" fill="#b8ad98"/>'+
    '</g>'+
  "")+'</div>';
  const bch=layer.querySelector('#bc-head'),hl=layer.querySelector('#hl'),ring=layer.querySelector('#ring');
  return{update(p,t){
    if(bch)bch.setAttribute('transform','rotate('+(8+Math.sin(t*.5)*2).toFixed(1)+' 0 30)');
    if(hl)hl.setAttribute('opacity',(clamp((p-.2)/.25,0,1)*.85).toFixed(2));
    if(ring)ring.setAttribute('opacity',clamp((p-.5)/.2,0,1).toFixed(2));
  }};
}};

SC.manEnters={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs>'+
      '<linearGradient id="meWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#36444b"/><stop offset="1" stop-color="#26323a"/></linearGradient>'+
      '<linearGradient id="meFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#56646a"/><stop offset="1" stop-color="#36424a"/></linearGradient>'+
    '</defs>'+
    '<rect width="1600" height="900" fill="url(#meWall)"/>'+
    '<polygon points="0,640 1600,640 1600,900 0,900" fill="url(#meFloor)"/>'+
    '<rect x="0" y="632" width="1600" height="10" fill="rgba(0,0,0,.2)"/>'+
    '<rect x="1392" y="150" width="200" height="500" fill="#11181d"/>'+
    '<rect x="1392" y="150" width="200" height="500" fill="none" stroke="#202b31" stroke-width="8"/>'+
    '<rect x="1442" y="178" width="100" height="448" fill="rgba(184,204,214,.13)"/>'+
    '<g transform="translate(40,560)"><rect x="0" y="120" width="420" height="120" rx="14" fill="#4a555a"/><rect x="0" y="120" width="420" height="18" fill="#5a666b"/><rect x="-16" y="40" width="30" height="200" rx="8" fill="#3c474c"/><rect x="14" y="90" width="150" height="46" rx="16" fill="#d6dee1"/></g>'+
    '<g id="qf" transform="translate(190,400) scale(.82)">'+qiufan()+'</g>'+
    '<g id="g1" transform="translate(1360,430) scale(1.35)">'+human({pose:'stand',top:'#23282f',topSh:'#15181e',bottom:'#1b1f26',skin:'#c2a081',hair:'#1a1714'})+'</g>'+
    '<g id="g2" transform="translate(1480,448) scale(1.25)">'+human({pose:'stand',top:'#23282f',topSh:'#15181e',bottom:'#1b1f26',skin:'#caa789',hair:'#241f1a'})+'</g>'+
    '<g id="rm" transform="translate(1180,430) scale(1.7)">'+richman()+'</g>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),rm=layer.querySelector('#rm'),g1=layer.querySelector('#g1'),g2=layer.querySelector('#g2');
  return{update(p,t){
    const adv=clamp(p*1.3,0,1);
    if(rm)rm.setAttribute('transform','translate('+lerp(1180,900,adv).toFixed(0)+','+(430-Math.abs(Math.sin(t*1.2))*3).toFixed(1)+') scale(1.7)');
    if(g1)g1.setAttribute('transform','translate('+lerp(1360,1248,adv).toFixed(0)+',430) scale(1.35)');
    if(g2)g2.setAttribute('transform','translate('+lerp(1480,1366,adv).toFixed(0)+',448) scale(1.25)');
    if(qfh)qfh.setAttribute('transform','rotate('+lerp(0,12,clamp((p-.2)/.5,0,1)).toFixed(1)+' 4 128)');
  }};
}};

SC.manExamine={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="x14w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37454c"/><stop offset="1" stop-color="#27333a"/></linearGradient>'+
      '<linearGradient id="x14f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#56646a"/><stop offset="1" stop-color="#36424a"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#x14w)"/>'+
    '<ellipse cx="360" cy="230" rx="430" ry="350" fill="rgba(207,230,246,.14)"/>'+
    '<polygon points="0,648 1600,648 1600,900 0,900" fill="url(#x14f)"/>'+
    '<rect x="0" y="640" width="1600" height="10" fill="rgba(0,0,0,.2)"/>'+
    '<g transform="translate(40,560)"><rect x="0" y="120" width="440" height="120" rx="14" fill="#4a555a"/><rect x="0" y="120" width="440" height="18" fill="#5a666b"/><rect x="-16" y="40" width="30" height="200" rx="8" fill="#3c474c"/><rect x="14" y="92" width="160" height="46" rx="16" fill="#d6dee1"/></g>'+
    '<g id="qf" transform="translate(270,360) scale(.95)">'+qiufan()+'</g>'+
    '<g id="rm" transform="translate(900,346) scale(1.62)">'+richman()+'</g>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),rmh=layer.querySelector('#rm-head'),chest=layer.querySelector('#qf-chest'),eyeL=layer.querySelector('#qf-eyeL'),eyeR=layer.querySelector('#qf-eyeR');
  return{update(p,t){
    if(qfh)qfh.setAttribute('transform','rotate('+(lerp(5,11,clamp(p,0,1))).toFixed(1)+' 4 128)');
    if(rmh)rmh.setAttribute('transform','rotate('+(lerp(-5,-13,clamp(p,0,1))).toFixed(1)+' 0 32)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.2)*1).toFixed(2)+')');
    const cyc=t%4.8,s=(cyc<0.14?0.1:1);
    if(eyeL)eyeL.setAttribute('transform','translate(-26,56) scale(1,'+s+') translate(26,-56)');
    if(eyeR)eyeR.setAttribute('transform','translate(26,56) scale(1,'+s+') translate(-26,-56)');
  }};
}};

SC.lightPatch={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<rect width="1600" height="900" fill="#1f2930"/>'+
    '<polygon points="0,650 1600,650 1600,900 0,900" fill="#28333a"/>'+
    '<g id="lp" transform="translate(840,140) rotate(7)"><rect x="0" y="0" width="380" height="450" fill="#f1ddb0"/>'+
      '<g fill="rgba(30,28,22,.32)"><rect x="0" y="0" width="380" height="13"/><rect x="0" y="219" width="380" height="13"/><rect x="184" y="0" width="13" height="450"/></g></g>'+
    '<g fill="rgba(244,201,122,.17)"><polygon points="870,180 1150,180 1000,900 660,900"/></g>'+
    '<ellipse cx="720" cy="770" rx="370" ry="80" fill="rgba(244,201,122,.13)"/>'+
    '<g id="qf" transform="translate(470,300) scale(1.32)">'+qiufan()+'</g>'+
    '<ellipse cx="600" cy="380" rx="560" ry="380" fill="rgba(244,201,122,.1)"/>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest'),eyeL=layer.querySelector('#qf-eyeL'),eyeR=layer.querySelector('#qf-eyeR'),lp=layer.querySelector('#lp');
  return{update(p,t){
    if(qfh)qfh.setAttribute('transform','rotate('+(lerp(3,7,clamp(p,0,1))).toFixed(1)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.1)*1).toFixed(2)+')');
    if(lp)lp.setAttribute('opacity',(0.92+Math.sin(t*1.4)*0.06).toFixed(3));
    const cyc=t%5.2,s=(cyc<0.16?0.1:1);
    if(eyeL)eyeL.setAttribute('transform','translate(-26,56) scale(1,'+s+') translate(26,-56)');
    if(eyeR)eyeR.setAttribute('transform','translate(26,56) scale(1,'+s+') translate(-26,-56)');
  }};
}};

SC.invite={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="x16w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37454c"/><stop offset="1" stop-color="#27333a"/></linearGradient>'+
      '<linearGradient id="x16f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#56646a"/><stop offset="1" stop-color="#36424a"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#x16w)"/>'+
    '<ellipse cx="360" cy="230" rx="430" ry="350" fill="rgba(207,230,246,.14)"/>'+
    '<polygon points="0,648 1600,648 1600,900 0,900" fill="url(#x16f)"/>'+
    '<rect x="0" y="640" width="1600" height="10" fill="rgba(0,0,0,.2)"/>'+
    '<g transform="translate(40,560)"><rect x="0" y="120" width="440" height="120" rx="14" fill="#4a555a"/><rect x="0" y="120" width="440" height="18" fill="#5a666b"/><rect x="-16" y="40" width="30" height="200" rx="8" fill="#3c474c"/><rect x="14" y="92" width="160" height="46" rx="16" fill="#d6dee1"/></g>'+
    '<g id="qf" transform="translate(280,360) scale(.95)">'+qiufan()+'</g>'+
    '<g id="rm" transform="translate(880,346) scale(1.62)">'+richman()+'</g>'+
  "")+'</div>';
  const qf=layer.querySelector('#qf'),qfh=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest'),eyeL=layer.querySelector('#qf-eyeL'),eyeR=layer.querySelector('#qf-eyeR');
  return{update(p,t){
    const lean=clamp((p-.3)/.5,0,1);
    if(qf)qf.setAttribute('transform','translate('+(280+lean*28).toFixed(0)+','+(360-lean*10).toFixed(0)+') scale(.95)');
    if(qfh)qfh.setAttribute('transform','rotate('+(lerp(6,12,lean)).toFixed(1)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*(2.2+lean*1.6))*1.4).toFixed(2)+')');
    const cyc=t%4.4,s=(cyc<0.12?0.1:1);
    if(eyeL)eyeL.setAttribute('transform','translate(-26,56) scale(1,'+s+') translate(26,-56)');
    if(eyeR)eyeR.setAttribute('transform','translate(26,56) scale(1,'+s+') translate(-26,-56)');
  }};
}};

SC.blindBlack={build(layer){
  layer.innerHTML='<div class="env" style="background:#000"></div>'+
    '<div id="bbs" style="position:absolute;inset:0;overflow:hidden"></div>'+
    '<div style="position:absolute;inset:0;background:radial-gradient(120% 120% at 50% 50%,rgba(0,0,0,0) 26%,#000 80%)"></div>';
  const bbs=layer.querySelector('#bbs');const S=[];
  for(let i=0;i<5;i++){const e=E('div');e.style.cssText='position:absolute;left:0;width:42%;height:'+rnd(2,5).toFixed(0)+'px;background:linear-gradient(90deg,transparent,rgba(150,180,210,.5),transparent);filter:blur(2px);top:'+rnd(18,82).toFixed(0)+'%';e._ph=rnd(0,1);e._sp=rnd(.12,.34);bbs.appendChild(e);S.push(e);}
  return{update(p,t){
    S.forEach(e=>{const x=((t*e._sp+e._ph)%1);e.style.transform='translateX('+(x*170-34).toFixed(1)+'%)';e.style.opacity=(Math.sin(x*Math.PI)*0.6).toFixed(2);});
  }};
}};

SC.blindRemoved={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="brBg" cx="50%" cy="42%" r="72%"><stop offset="0" stop-color="#fbf1d8"/><stop offset="58%" stop-color="#ecd9af"/><stop offset="100%" stop-color="#c8ae82"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#brBg)"/>'+
    '<g fill="rgba(255,250,235,.4)"><rect x="120" y="100" width="110" height="600" rx="20"/><rect x="1370" y="100" width="110" height="600" rx="20"/><rect x="640" y="56" width="320" height="120" rx="20"/></g>'+
    '<g id="spk" fill="#fff">'+(function(){let s='';for(let i=0;i<24;i++)s+='<circle cx="'+rnd(100,1500).toFixed(0)+'" cy="'+rnd(80,600).toFixed(0)+'" r="'+rnd(2,5).toFixed(1)+'"/>';return s;})()+'</g>'+
    '<g id="qf" transform="translate(800,300) scale(1.5)">'+qiufan()+'</g>'+
  "")+'</div>'+
    '<div id="brflash" style="position:absolute;inset:0;background:#fff;pointer-events:none"></div>';
  const qfh=layer.querySelector('#qf-head'),spk=layer.querySelector('#spk'),flash=layer.querySelector('#brflash');
  return{update(p,t){
    if(flash)flash.style.opacity=clamp(1-p/.32,0,1).toFixed(2);
    if(qfh)qfh.setAttribute('transform','rotate('+(Math.sin(t*.6)*8).toFixed(1)+' 4 128)');
    if(spk)spk.setAttribute('opacity',(.5+Math.sin(t*3)*0.4).toFixed(2));
  }};
}};

SC.palace={build(layer){
  let crowd='';const cc=['#b9472f','#3f6fa8','#c7a23a','#56885a','#8f5494','#c2783a','#4a8a94'];
  const cp=[[230,486,.66],[420,468,.6],[1190,486,.66],[1380,468,.6],[1280,536,.78],[150,536,.82],[560,476,.58]];
  cp.forEach((d,i)=>{crowd+='<g transform="translate('+d[0]+','+d[1]+') scale('+d[2]+')">'+human({pose:'stand',top:cc[i%cc.length],topSh:'#352f38',bottom:'#2a2730',skin:(i%2?'#e2c6aa':'#d2b08e'),hair:(i%2?'#2a2018':'#3a2a1a')})+'</g>';});
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="pWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5e34"/><stop offset="50%" stop-color="#ceac6a"/><stop offset="100%" stop-color="#8a6e40"/></linearGradient>'+
      '<linearGradient id="pFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cab78a"/><stop offset="1" stop-color="#86714c"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#pWall)"/>'+
    '<g fill="#b6975a"><rect x="110" y="70" width="80" height="580"/><rect x="1410" y="70" width="80" height="580"/><rect x="430" y="110" width="56" height="540"/><rect x="1114" y="110" width="56" height="540"/></g>'+
    '<g fill="rgba(255,250,228,.3)"><rect x="120" y="70" width="18" height="580"/><rect x="1420" y="70" width="18" height="580"/><rect x="438" y="110" width="14" height="540"/><rect x="1122" y="110" width="14" height="540"/></g>'+
    '<g transform="translate(800,28)"><rect x="-5" y="0" width="10" height="70" fill="#6a5026"/><ellipse cx="0" cy="96" rx="86" ry="38" fill="rgba(255,238,196,.55)"/><g fill="#fff6da"><circle cx="-50" cy="100" r="7"/><circle cx="-20" cy="116" r="8"/><circle cx="16" cy="116" r="8"/><circle cx="48" cy="100" r="7"/><circle cx="0" cy="124" r="9"/></g></g>'+
    '<polygon points="0,644 1600,644 1600,900 0,900" fill="url(#pFloor)"/>'+
    '<g stroke="rgba(255,255,255,.14)" stroke-width="2"><line x1="500" y1="644" x2="260" y2="900"/><line x1="800" y1="644" x2="800" y2="900"/><line x1="1100" y1="644" x2="1340" y2="900"/></g>'+
    crowd+
    '<g id="qf" transform="translate(720,300) scale(1.42)">'+qiufan()+'</g>'+
    '<g id="spk" fill="#fff8e0">'+(function(){let s='';for(let i=0;i<18;i++)s+='<circle cx="'+rnd(120,1480).toFixed(0)+'" cy="'+rnd(120,560).toFixed(0)+'" r="'+rnd(1.5,4).toFixed(1)+'"/>';return s;})()+'</g>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest'),spk=layer.querySelector('#spk');
  return{update(p,t){
    if(qfh)qfh.setAttribute('transform','rotate('+(Math.sin(t*.5)*9-3).toFixed(1)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.2)*1).toFixed(2)+')');
    if(spk)spk.setAttribute('opacity',(.55+Math.sin(t*2.5)*0.4).toFixed(2));
  }};
}};

SC.auction={build(layer){
  let portraits='';for(let i=0;i<8;i++){const x=(i%4)*172, y=Math.floor(i/4)*172;
    portraits+='<g transform="translate('+x+','+y+')"><rect width="150" height="150" rx="6" fill="#243038"/><circle cx="75" cy="56" r="28" fill="#5a6a72"/><path d="M40 98 C40 80 110 80 110 98 L110 118 L40 118 Z" fill="#4a5862"/><rect x="6" y="122" width="138" height="22" fill="#0c1417"/><text x="16" y="139" font-family="monospace" font-size="15" fill="#e2b85a">¥ '+((rnd(40,990)|0))+'k</text></g>';}
  let bidders='';['#34303a','#42404a','#2c3840','#3a3038'].forEach((c,i)=>{const d=[[280,800,.8],[560,810,.74],[1040,800,.8],[1320,810,.74]][i];bidders+='<g transform="translate('+d[0]+','+d[1]+') scale('+d[2]+')">'+walker({top:c,topSh:'#1c1a20',skin:'#cbb097',hair:'#241f1a'})+'</g>';});
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<rect width="1600" height="900" fill="#1b242a"/>'+
    '<rect x="0" y="0" width="1600" height="660" fill="#212d35"/>'+
    '<g transform="translate(150,108)"><rect x="-24" y="-24" width="736" height="392" rx="12" fill="#0c1417"/>'+portraits+'</g>'+
    '<rect x="980" y="430" width="150" height="230" fill="#2a2018"/>'+
    '<g transform="translate(1055,300) scale(1.35)">'+human({pose:'stand',top:'#34303a',topSh:'#1f1c24',bottom:'#1b1820',skin:'#d2b08e',hair:'#2a2018'})+'</g>'+
    '<text id="aucnum" x="1240" y="220" font-family="monospace" font-size="62" fill="#e23b3b">¥ 740k</text>'+
    '<polygon points="0,660 1600,660 1600,900 0,900" fill="#141c20"/>'+
    bidders+
  "")+'</div>';
  const num=layer.querySelector('#aucnum');
  return{update(p,t){ if(num)num.textContent='¥ '+(700+Math.floor((t*45)%320))+'k'; }};
}};

SC.lifezone={build(layer){
  let crowd='';const cc=['#c0492f','#3f8fb8','#caa23a','#56a05a','#9a5aa0','#d07a3a','#4aa0a4','#b85070'];
  const cp=[[180,500,.74],[400,540,.86],[640,486,.64],[980,540,.86],[1200,500,.74],[1400,540,.8]];
  cp.forEach((d,i)=>{crowd+='<g transform="translate('+d[0]+','+d[1]+') scale('+d[2]+')">'+human({pose:'sit',top:cc[i%cc.length],topSh:'#352f38',bottom:'#3a3a42',skin:(i%2?'#e2c6aa':'#cba283'),hair:(i%2?'#2a2018':'#3a2a1a'),exp:(i%2?'smile':'neutral')})+'</g>';});
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="lzW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2caa2"/><stop offset="1" stop-color="#b89a70"/></linearGradient>'+
      '<linearGradient id="lzF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdb98e"/><stop offset="1" stop-color="#9a8460"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#lzW)"/>'+
    '<g><rect x="80" y="200" width="240" height="184" rx="10" fill="#c0492f"/><rect x="380" y="220" width="240" height="164" rx="10" fill="#3f8fb8"/><rect x="980" y="220" width="240" height="164" rx="10" fill="#56a05a"/><rect x="1280" y="200" width="240" height="184" rx="10" fill="#caa23a"/></g>'+
    '<g fill="rgba(255,255,255,.22)"><rect x="80" y="200" width="240" height="20"/><rect x="380" y="220" width="240" height="18"/><rect x="980" y="220" width="240" height="18"/><rect x="1280" y="200" width="240" height="20"/></g>'+
    '<g fill="rgba(255,255,255,.1)"><circle cx="500" cy="120" r="40"/><circle cx="1120" cy="110" r="46"/></g>'+
    '<polygon points="0,520 1600,520 1600,900 0,900" fill="url(#lzF)"/>'+
    crowd+
    '<g id="qf" transform="translate(740,300) scale(1.4)">'+qiufan()+'</g>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest');
  return{update(p,t){
    if(qfh)qfh.setAttribute('transform','rotate('+(Math.sin(t*.5)*8).toFixed(1)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.2)*1).toFixed(2)+')');
  }};
}};

SC.coldBeam={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs>'+
      '<linearGradient id="cbWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a8158"/><stop offset="1" stop-color="#6c5a3a"/></linearGradient>'+
      '<linearGradient id="cbBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbeaff"/><stop offset="100%" stop-color="rgba(176,206,246,0)"/></linearGradient>'+
      '<radialGradient id="cbDisc" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#f3f9ff"/><stop offset="55%" stop-color="#cfe2ff"/><stop offset="100%" stop-color="#9bbcec"/></radialGradient>'+
    '</defs>'+
    '<rect width="1600" height="900" fill="url(#cbWall)"/>'+
    '<g fill="#7d683f"><rect x="116" y="50" width="74" height="600"/><rect x="1410" y="50" width="74" height="600"/></g>'+
    '<g fill="rgba(255,248,224,.18)"><rect x="126" y="50" width="16" height="600"/><rect x="1420" y="50" width="16" height="600"/></g>'+
    '<ellipse cx="800" cy="40" rx="154" ry="46" fill="#0c1622"/>'+
    '<polygon points="700,54 900,54 1124,830 476,830" fill="url(#cbBeam)" opacity=".92"/>'+
    '<polygon points="748,54 852,54 980,830 620,830" fill="#eef6ff" opacity=".5"/>'+
    '<ellipse id="cbsource" cx="800" cy="46" rx="124" ry="36" fill="url(#cbDisc)"/>'+
    '<polygon points="0,648 1600,648 1600,900 0,900" fill="#5a4a2e"/>'+
    '<ellipse cx="800" cy="690" rx="220" ry="40" fill="#cfe2ff" opacity=".25"/>'+
    '<g id="qf" transform="translate(800,332) scale(1.5)">'+qiufan()+'</g>'+
    '<g id="reach" transform="translate(800,332) scale(1.5)">'+
      '<g id="reacharm">'+
        '<path d="M-58 202 C-96 130 -100 50 -86 -28 L-62 -22 C-78 50 -72 130 -38 196 Z" fill="#cbb097"/>'+
        '<path d="M-58 202 C-90 134 -94 58 -82 -14" stroke="#a98a6e" stroke-width="4" fill="none" opacity=".5"/>'+
        '<rect x="-104" y="70" width="40" height="22" rx="5" fill="#e9eef0" transform="rotate(-78 -84 81)"/>'+
        '<path d="M-86 -28 C-96 -40 -94 -58 -82 -62 C-72 -66 -60 -62 -58 -50 C-54 -58 -44 -56 -44 -46 C-46 -34 -54 -22 -70 -18 C-82 -16 -90 -20 -86 -28 Z" fill="#cbb097"/>'+
        '<path d="M-84 -58 L-86 -80 M-74 -62 L-72 -84 M-62 -58 L-58 -78 M-52 -50 L-46 -68" stroke="#cbb097" stroke-width="7" stroke-linecap="round"/>'+
        '<path d="M-84 -58 L-86 -80 M-74 -62 L-72 -84 M-62 -58 L-58 -78" stroke="#b89a7e" stroke-width="2" stroke-linecap="round" opacity=".45"/>'+
      '</g>'+
    '</g>'+
  "")+'</div>'+
    '<div id="cbcool" style="position:absolute;inset:0;background:rgba(150,190,240,0);mix-blend-mode:screen;pointer-events:none"></div>';
  const qfh=layer.querySelector('#qf-head'),reach=layer.querySelector('#reacharm'),src=layer.querySelector('#cbsource'),cool=layer.querySelector('#cbcool');
  return{update(p,t){
    if(qfh)qfh.setAttribute('transform','rotate('+(-7+Math.sin(t*.5)*4).toFixed(1)+' 4 128)');
    if(reach)reach.setAttribute('transform','translate('+(Math.sin(t*.8)*2).toFixed(1)+','+lerp(24,-12,clamp(p/.6,0,1)).toFixed(1)+')');
    if(src)src.setAttribute('opacity',(.85+Math.sin(t*2)*.12).toFixed(2));
    if(cool)cool.style.background='rgba(150,190,240,'+(clamp((p-.5)/.4,0,1)*.16).toFixed(3)+')';
  }};
}};

SC.manExplains={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="meWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c7548"/><stop offset="1" stop-color="#5c4b2e"/></linearGradient>'+
      '<pattern id="meScan" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="2.4" fill="rgba(0,0,0,.22)"/></pattern></defs>'+
    '<rect width="1600" height="900" fill="url(#meWall)"/>'+
    '<g fill="rgba(255,236,190,.45)"><circle cx="250" cy="110" r="48"/><circle cx="690" cy="86" r="38"/></g>'+
    '<g transform="translate(1010,140)"><rect x="-22" y="-22" width="536" height="396" rx="10" fill="#0a1014"/>'+
      '<rect x="0" y="0" width="492" height="352" fill="#39424a"/>'+
      '<rect x="0" y="0" width="492" height="150" fill="#46535c"/>'+
      '<g fill="#2a3036"><rect x="38" y="120" width="74" height="232"/><rect x="128" y="74" width="58" height="278"/><rect x="206" y="150" width="84" height="202"/><rect x="306" y="56" width="52" height="296"/><rect x="376" y="128" width="92" height="224"/></g>'+
      '<rect x="0" y="0" width="492" height="352" fill="url(#meScan)" opacity=".5"/>'+
      '<text x="16" y="338" font-family="monospace" font-size="19" fill="#5a6a72">· 实时 · 外界 ·</text>'+
    '</g>'+
    '<polygon points="0,664 1600,664 1600,900 0,900" fill="#4c3e27"/>'+
    '<g stroke="rgba(255,244,214,.12)" stroke-width="2"><line x1="520" y1="664" x2="300" y2="900"/><line x1="980" y1="664" x2="1180" y2="900"/></g>'+
    '<g transform="translate(382,448) scale(1.66)">'+richman()+'</g>'+
    '<g id="qf" transform="translate(912,500) scale(1.24)">'+qiufan()+'</g>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),rmh=layer.querySelector('#rm-head'),rmAR=layer.querySelector('#rm-armR');
  return{update(p,t){
    if(qfh)qfh.setAttribute('transform','rotate('+(9+Math.sin(t*.5)*4).toFixed(1)+' 4 128)');
    if(rmh)rmh.setAttribute('transform','rotate('+(Math.sin(t*.6)*5-2).toFixed(1)+' 0 32)');
    if(rmAR)rmAR.setAttribute('transform','rotate('+(-100+Math.sin(t*.8)*3).toFixed(1)+' 44 52)');
  }};
}};
SC.deadStreet={build(layer){
  const corpse=(x,y,s,rot,tone)=>'<g transform="translate('+x+','+y+') scale('+s+') rotate('+rot+')">'+
    '<ellipse cx="0" cy="12" rx="66" ry="10" fill="rgba(0,0,0,.3)"/>'+
    '<path d="M-60 0 C-60 -15 -30 -19 0 -19 C40 -19 72 -12 72 -2 C72 9 40 13 0 13 C-30 13 -60 9 -60 0 Z" fill="'+tone+'"/>'+
    '<path d="M-60 0 C-60 -15 -30 -19 0 -19 L0 13 C-30 13 -60 9 -60 0 Z" fill="#000" opacity=".14"/>'+
    '<circle cx="-66" cy="-5" r="15" fill="'+tone+'"/><circle cx="-66" cy="-5" r="15" fill="#000" opacity=".12"/>'+
    '<path d="M8 -16 C30 -30 50 -30 62 -20" stroke="'+tone+'" stroke-width="11" stroke-linecap="round" fill="none"/>'+
    '<path d="M48 8 C72 20 92 20 108 12" stroke="'+tone+'" stroke-width="13" stroke-linecap="round" fill="none"/>'+
  '</g>';
  let bodies='';
  const B=[[290,772,1.5,-8,'#43484d'],[770,808,1.72,6,'#3b4045'],[1200,776,1.5,-14,'#45494e'],
           [520,694,1.06,12,'#3e4348'],[1000,690,1.0,-7,'#40454a'],[768,648,.72,4,'#3c4145'],
           [610,612,.5,-10,'#3a3e43'],[916,606,.46,9,'#393d42'],[772,582,.34,0,'#373b40']];
  B.forEach(b=>bodies+=corpse(b[0],b[1],b[2],b[3],b[4]));
  let win='';for(let r=0;r<5;r++)for(let c=0;c<4;c++){win+='<rect x="'+(34+c*82)+'" y="'+(248+r*72)+'" width="42" height="48"/>';win+='<rect x="'+(1524-c*82-42)+'" y="'+(248+r*72)+'" width="42" height="48"/>';}
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="dsSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c7277"/><stop offset="1" stop-color="#494e53"/></linearGradient>'+
      '<linearGradient id="dsRoad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3e43"/><stop offset="1" stop-color="#565a5f"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#dsSky)"/>'+
    '<g id="zoom">'+
      '<g fill="#33373b"><polygon points="0,118 366,210 366,646 0,646"/><polygon points="366,210 566,252 566,604 366,604"/></g>'+
      '<g fill="#2b2f33"><polygon points="1600,118 1234,210 1234,646 1600,646"/><polygon points="1234,210 1034,252 1034,604 1234,604"/></g>'+
      '<g fill="#1c2024">'+win+'</g>'+
      '<polygon points="596,556 1004,556 1346,900 254,900" fill="url(#dsRoad)"/>'+
      '<g stroke="#6b7075" stroke-width="4" stroke-dasharray="26 30"><line x1="800" y1="556" x2="800" y2="900"/></g>'+
      '<rect x="566" y="600" width="468" height="6" fill="#2a2e32" opacity=".5"/>'+
      bodies+
    '</g>'+
  "")+'</div>';
  const zoom=layer.querySelector('#zoom');
  return{update(p){ if(zoom)zoom.setAttribute('transform','translate(800,520) scale('+lerp(1,1.34,clamp(p,0,1)).toFixed(3)+') translate(-800,-520)'); }};
}};

SC.searching={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="seBg" cx="50%" cy="38%" r="72%"><stop offset="0" stop-color="#2c3137"/><stop offset="100%" stop-color="#0d1115"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#seBg)"/>'+
    '<g id="qf" transform="translate(800,150) scale(4.3)">'+qiufan()+'</g>'+
  "")+'</div>'+
    '<div id="glint" style="position:absolute;left:50%;top:42%;width:54%;height:34%;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(207,226,255,.55),transparent 70%);mix-blend-mode:screen;opacity:0;pointer-events:none"></div>';
  const qfh=layer.querySelector('#qf-head'),el=layer.querySelector('#qf-eyeL'),er=layer.querySelector('#qf-eyeR'),gl=layer.querySelector('#glint');
  return{update(p,t){
    const up=clamp((p-.18)/.6,0,1);
    if(qfh)qfh.setAttribute('transform','rotate('+(7-up*13).toFixed(1)+' 4 128)');
    const dx=Math.sin(t*1.7)*3.2, dy=(-up*4).toFixed(1);
    if(el)el.setAttribute('transform','translate('+dx.toFixed(1)+','+dy+')');
    if(er)er.setAttribute('transform','translate('+dx.toFixed(1)+','+dy+')');
    if(gl){gl.style.opacity=(clamp((p-.1)/.3,0,1)*.5).toFixed(2);gl.style.left=(50+Math.sin(t*.7)*16).toFixed(1)+'%';}
  }};
}};

SC.burning={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="buGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34383d"/><stop offset="1" stop-color="#181b1f"/></linearGradient>'+
      '<linearGradient id="buSun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d6"/><stop offset="100%" stop-color="rgba(255,210,140,0)"/></linearGradient>'+
      '<radialGradient id="buFire" cx="50%" cy="76%" r="64%"><stop offset="0" stop-color="#fff0c0"/><stop offset="38%" stop-color="#ffac4a"/><stop offset="72%" stop-color="#e0431a"/><stop offset="100%" stop-color="rgba(120,20,8,0)"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="#22262b"/>'+
    '<g fill="#1b1f23"><rect x="50" y="250" width="210" height="244"/><rect x="300" y="176" width="150" height="318"/><rect x="1190" y="208" width="180" height="286"/><rect x="1410" y="268" width="150" height="226"/></g>'+
    '<rect y="470" width="1600" height="430" fill="url(#buGround)"/>'+
    '<polygon id="sunbeam" points="700,0 900,0 1014,566 586,566" fill="url(#buSun)" opacity="0"/>'+
    '<g transform="translate(800,552)">'+
      '<ellipse cx="0" cy="24" rx="156" ry="24" fill="rgba(0,0,0,.42)"/>'+
      '<path d="M-150 0 C-150 -30 -70 -40 0 -40 C90 -40 160 -24 160 -2 C160 20 90 28 0 28 C-70 28 -150 18 -150 0 Z" fill="#3a3438"/>'+
      '<path d="M-150 0 C-150 -30 -70 -40 0 -40 L0 28 C-70 28 -150 18 -150 0 Z" fill="#000" opacity=".18"/>'+
      '<circle cx="-166" cy="-10" r="34" fill="#3a3438"/>'+
      '<path d="M22 -34 C72 -62 112 -62 140 -44" stroke="#3a3438" stroke-width="26" stroke-linecap="round" fill="none"/>'+
    '</g>'+
    '<g id="flame" opacity="0">'+
      '<path d="M0 40 C-72 0 -60 -122 -20 -204 C-30 -122 10 -112 6 -182 C42 -122 66 -40 40 32 Z" fill="url(#buFire)"/>'+
      '<path d="M0 34 C-38 8 -30 -72 -8 -132 C-12 -78 14 -72 12 -122 C32 -72 40 -10 24 28 Z" fill="#ffd884" opacity=".9"/>'+
    '</g>'+
  "")+'</div>';
  const sun=layer.querySelector('#sunbeam'),flame=layer.querySelector('#flame');
  return{update(p,t){
    if(sun)sun.setAttribute('opacity',(clamp((p-.05)/.25,0,1)*.92).toFixed(2));
    const f=clamp((p-.32)/.5,0,1);
    if(flame){flame.setAttribute('opacity',f.toFixed(2));
      const sx=lerp(.4,1.25,f)*(1+Math.sin(t*9)*.08), sy=lerp(.4,1.55,f)*(1+Math.sin(t*11)*.06);
      flame.setAttribute('transform','translate(800,524) scale('+sx.toFixed(3)+','+sy.toFixed(3)+')');}
  }};
}};

SC.pupilFlame={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="pfIris" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3a2410"/><stop offset="70%" stop-color="#6b4a22"/><stop offset="100%" stop-color="#281809"/></radialGradient>'+
      '<radialGradient id="pfFire" cx="50%" cy="64%" r="62%"><stop offset="0" stop-color="#fff2c4"/><stop offset="34%" stop-color="#ffac46"/><stop offset="70%" stop-color="#d63914"/><stop offset="100%" stop-color="#190904"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="#0b0a08"/>'+
    '<g id="eb">'+
      '<path d="M120 452 C420 250 1180 250 1480 452 C1180 692 420 692 120 452 Z" fill="#c9ad90"/>'+
      '<path d="M210 452 C460 302 1140 302 1390 452 C1140 614 460 614 210 452 Z" fill="#efe6d8"/>'+
      '<path d="M250 472 C520 362 900 362 1050 422" stroke="#d8b6a0" stroke-width="3" fill="none" opacity=".4"/>'+
      '<circle cx="800" cy="454" r="180" fill="url(#pfIris)"/>'+
      '<circle cx="800" cy="454" r="180" fill="none" stroke="#241407" stroke-width="6"/>'+
      '<g stroke="#8a6336" stroke-width="3" opacity=".5">'+(function(){let s='';for(let i=0;i<28;i++){const a=i/28*6.283;s+='<line x1="'+(800+Math.cos(a)*112).toFixed(0)+'" y1="'+(454+Math.sin(a)*112).toFixed(0)+'" x2="'+(800+Math.cos(a)*172).toFixed(0)+'" y2="'+(454+Math.sin(a)*172).toFixed(0)+'"/>';}return s;})()+'</g>'+
      '<circle cx="800" cy="454" r="106" fill="#0a0704"/>'+
      '<g id="fire"><ellipse cx="800" cy="472" rx="92" ry="102" fill="url(#pfFire)"/>'+
        '<path d="M800 544 C760 472 770 382 800 320 C792 386 816 386 812 332 C842 392 852 472 820 540 Z" fill="#ffd884" opacity=".92"/></g>'+
      '<circle cx="752" cy="406" r="22" fill="#fff" opacity=".45"/>'+
      '<path d="M120 452 C420 250 1180 250 1480 452 C1180 332 420 332 120 452 Z" fill="#a9906f"/>'+
      '<path d="M120 452 C420 652 1180 652 1480 452 C1180 662 420 662 120 452 Z" fill="#b89a78"/>'+
      '<path d="M210 452 C460 302 1140 302 1390 452" stroke="#3a2a1c" stroke-width="9" fill="none"/>'+
      '<path d="M236 446 C300 430 360 432 410 444" stroke="#2a1d12" stroke-width="5" fill="none" stroke-linecap="round"/>'+
    '</g>'+
  "")+'</div>';
  const eb=layer.querySelector('#eb'),fire=layer.querySelector('#fire');
  return{update(p,t){
    const z=p<.7?lerp(1,1.5,p/.7):lerp(1.5,1.36,(p-.7)/.3);
    if(eb)eb.setAttribute('transform','translate(800,454) scale('+z.toFixed(3)+') translate(-800,-454)');
    if(fire){fire.setAttribute('opacity',(.78+Math.sin(t*11)*.22).toFixed(2));
      fire.setAttribute('transform','translate(800,454) scale('+(1+Math.sin(t*13)*.07).toFixed(3)+') translate(-800,-454)');}
  }};
}};

SC.collarGrab={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="cgBg" cx="44%" cy="42%" r="74%"><stop offset="0" stop-color="#3a2218"/><stop offset="58%" stop-color="#1c120e"/><stop offset="100%" stop-color="#0c0807"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#cgBg)"/>'+
    '<ellipse cx="800" cy="912" rx="720" ry="300" fill="#7a2a10" opacity=".5"/>'+
    '<g id="cg">'+
      '<g transform="translate(1044,300) scale(2.36)">'+richman()+'</g>'+
      '<g id="grip">'+
        '<path d="M588 582 C730 548 840 552 926 578 L928 616 C842 596 738 596 596 624 Z" fill="#cbb097"/>'+
        '<path d="M588 582 C710 552 814 556 902 576" stroke="#a98a6e" stroke-width="4" fill="none" opacity=".5"/>'+
        '<rect x="692" y="560" width="42" height="30" rx="6" fill="#e9eef0" transform="rotate(-6 713 575)"/>'+
        '<path d="M918 554 C952 546 980 564 980 594 C980 622 948 634 918 626 C900 620 894 604 902 592 C888 594 880 582 890 574 C902 566 912 560 918 554 Z" fill="#cbb097"/>'+
        '<path d="M926 572 L976 574 M922 592 L970 598 M916 608 L958 618" stroke="#a98a6e" stroke-width="3"/>'+
      '</g>'+
      '<g id="qf" transform="translate(498,486) scale(1.82)">'+qiufan()+'</g>'+
      '<g id="screamg" transform="translate(498,486) scale(1.82)"><g id="screamr">'+
        '<path d="M-26 120 C-26 106 -14 100 0 100 C14 100 26 106 26 120 C26 146 14 162 0 162 C-14 162 -26 146 -26 120 Z" fill="#3a1410"/>'+
        '<path d="M-20 118 C-12 112 12 112 20 118" stroke="#e2c4ad" stroke-width="4" fill="none"/>'+
        '<path d="M-9 150 C-3 157 3 157 9 150 C3 154 -3 154 -9 150 Z" fill="#7a2a22"/>'+
      '</g></g>'+
    '</g>'+
  "")+'</div>';
  const cg=layer.querySelector('#cg'),qfh=layer.querySelector('#qf-head'),sr=layer.querySelector('#screamr');
  return{update(p,t){
    const amp=clamp((p-.08)/.3,0,1)*7;
    if(cg)cg.setAttribute('transform','translate('+(Math.sin(t*22)*amp).toFixed(1)+','+(Math.cos(t*19)*amp*.5).toFixed(1)+')');
    const rot='rotate('+(-11+Math.sin(t*9)*2).toFixed(1)+' 4 128)';
    if(qfh)qfh.setAttribute('transform',rot);
    if(sr)sr.setAttribute('transform',rot);
  }};
}};
SC.collapseSit={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="csWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f6048"/><stop offset="1" stop-color="#493e30"/></linearGradient>'+
      '<linearGradient id="csFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a5040"/><stop offset="1" stop-color="#383228"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#csWall)"/>'+
    '<g fill="#5c4e38"><rect x="120" y="40" width="64" height="600"/><rect x="1416" y="40" width="64" height="600"/></g>'+
    '<g fill="rgba(255,246,220,.1)"><rect x="128" y="40" width="14" height="600"/><rect x="1424" y="40" width="14" height="600"/></g>'+
    '<polygon points="0,612 1600,612 1600,900 0,900" fill="url(#csFloor)"/>'+
    '<ellipse cx="752" cy="742" rx="250" ry="44" fill="#000" opacity=".24"/>'+
    '<ellipse cx="1124" cy="744" rx="130" ry="32" fill="#000" opacity=".24"/>'+
    '<g id="rm" transform="translate(1126,398) scale(1.72)">'+richman()+'</g>'+
    '<g id="qf" transform="translate(724,440) scale(1.5)">'+qiufan()+'</g>'+
  "")+'</div>';
  const qf=layer.querySelector('#qf'),qfh=layer.querySelector('#qf-head'),rmh=layer.querySelector('#rm-head');
  return{update(p,t){
    const k=clamp(p/.6,0,1);
    if(qf)qf.setAttribute('transform','translate(724,'+lerp(440,486,k).toFixed(0)+') scale('+lerp(1.5,1.4,k).toFixed(3)+')');
    if(qfh)qfh.setAttribute('transform','rotate('+lerp(3,17,clamp(p/.7,0,1)).toFixed(1)+' 4 128)');
    if(rmh)rmh.setAttribute('transform','rotate('+(9+Math.sin(t*.5)*2).toFixed(1)+' 0 32)');
  }};
}};

SC.extinguished={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="exBg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#23282c"/><stop offset="100%" stop-color="#0b0e11"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#exBg)"/>'+
    '<g id="qf" transform="translate(800,236) scale(3.4)">'+qiufan()+'</g>'+
    '<g id="exg" transform="translate(800,236) scale(3.4)"><g id="exr">'+
      '<circle id="g1" cx="-27" cy="52" r="2.6" fill="#e6f1fc"/>'+
      '<circle id="g2" cx="27" cy="52" r="2.9" fill="#e6f1fc"/>'+
    '</g></g>'+
  "")+'</div>';
  const qfh=layer.querySelector('#qf-head'),exr=layer.querySelector('#exr'),el=layer.querySelector('#qf-eyeL'),er=layer.querySelector('#qf-eyeR'),g1=layer.querySelector('#g1'),g2=layer.querySelector('#g2');
  return{update(p,t){
    const a=lerp(.9,0,clamp(p/.72,0,1)),fl=p<.55?(.7+Math.sin(t*5)*.3):1;
    if(g1)g1.setAttribute('opacity',(a*fl).toFixed(3));
    if(g2)g2.setAttribute('opacity',(a*fl).toFixed(3));
    const rot='rotate('+(11+Math.sin(t*.4)*1.5).toFixed(1)+' 4 128)';
    if(qfh)qfh.setAttribute('transform',rot);
    if(exr)exr.setAttribute('transform',rot);
    const bk=Math.max(0,1-Math.abs((p-.5)*13)),sy=(1-bk*.92).toFixed(2);
    if(el)el.setAttribute('transform','translate(-26,56) scale(1,'+sy+') translate(26,-56)');
    if(er)er.setAttribute('transform','translate(26,56) scale(1,'+sy+') translate(-26,-56)');
  }};
}};

SC.manSilent={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="msBg" cx="50%" cy="42%" r="72%"><stop offset="0" stop-color="#24282d"/><stop offset="100%" stop-color="#0c0f12"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#msBg)"/>'+
    '<g id="rm" transform="translate(800,300) scale(7)">'+richman()+'</g>'+
    '<g id="msg" transform="translate(800,300) scale(7)"><g id="flatr" opacity="0">'+
      '<path d="M-13 33 C-5 36 5 36 13 33 L13 42 C5 45 -5 45 -13 42 Z" fill="#d6b693"/>'+
      '<path d="M-9 38.6 C-3 39.4 3 39.4 9 38.4" stroke="#3a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>'+
    '</g></g>'+
  "")+'</div>';
  const rmh=layer.querySelector('#rm-head'),msg=layer.querySelector('#msg'),flatr=layer.querySelector('#flatr');
  return{update(p,t){
    const rot='rotate('+(Math.sin(t*.4)*1.4).toFixed(2)+' 0 32)';
    if(rmh)rmh.setAttribute('transform',rot);
    if(flatr){flatr.setAttribute('transform',rot);flatr.setAttribute('opacity',clamp((p-.18)/.4,0,1).toFixed(2));}
  }};
}};

SC.blindAgain={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="baBg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#1c2024"/><stop offset="100%" stop-color="#060809"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#baBg)"/>'+
    '<g id="qf" transform="translate(800,252) scale(3.2)">'+qiufan()+'</g>'+
    '<g transform="translate(800,252) scale(3.2)"><g id="bandr" transform="translate(0,-150)">'+
      '<rect x="-62" y="40" width="124" height="34" rx="4" fill="#0e1418"/>'+
      '<rect x="-62" y="40" width="124" height="7" fill="#000" opacity=".45"/>'+
      '<rect x="-62" y="66" width="124" height="6" fill="#000" opacity=".3"/>'+
      '<path d="M-62 48 L-78 42 L-78 72 L-62 66 Z" fill="#0e1418"/>'+
    '</g></g>'+
  "")+'</div>'+
    '<div id="badark" style="position:absolute;inset:0;background:#000;opacity:0;pointer-events:none"></div>';
  const el=layer.querySelector('#qf-eyeL'),er=layer.querySelector('#qf-eyeR'),bandr=layer.querySelector('#bandr'),dark=layer.querySelector('#badark'),qfh=layer.querySelector('#qf-head');
  return{update(p){
    const drop=clamp(p/.45,0,1);
    if(bandr)bandr.setAttribute('transform','translate(0,'+lerp(-150,0,drop).toFixed(0)+')');
    const sy=(1-clamp((p-.2)/.3,0,1)*.9).toFixed(2);
    if(el)el.setAttribute('transform','translate(-26,56) scale(1,'+sy+') translate(26,-56)');
    if(er)er.setAttribute('transform','translate(26,56) scale(1,'+sy+') translate(-26,-56)');
    if(qfh)qfh.setAttribute('transform','rotate('+lerp(2,9,clamp(p,0,1)).toFixed(1)+' 4 128)');
    if(dark)dark.style.opacity=clamp((p-.55)/.4,0,1).toFixed(2);
  }};
}};

SC.teardropBlack={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><radialGradient id="tdG" cx="40%" cy="28%" r="72%"><stop offset="0" stop-color="#eaf4ff"/><stop offset="55%" stop-color="#9fb4c0"/><stop offset="100%" stop-color="#34424b"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="#050607"/>'+
    '<path d="M560 280 C470 420 480 640 620 782 C770 882 1000 852 1040 690 C1070 540 1040 360 930 286 C830 232 650 236 560 280 Z" fill="#0a0e12" opacity=".55"/>'+
    '<path d="M662 472 C702 454 762 454 802 470" stroke="#141b20" stroke-width="10" fill="none" opacity=".6"/>'+
    '<g id="teardrop" opacity="0"><ellipse id="tdrop" cx="726" cy="500" rx="13" ry="17" fill="url(#tdG)"/>'+
      '<circle cx="722" cy="494" r="4" fill="#fff" opacity=".7"/></g>'+
    '<g id="trip" opacity="0"><ellipse cx="726" cy="812" rx="10" ry="4" fill="none" stroke="#9fb4c0" stroke-width="2"/></g>'+
  "")+'</div>';
  const td=layer.querySelector('#teardrop'),drop=layer.querySelector('#tdrop'),trip=layer.querySelector('#trip');
  return{update(p){
    if(p<.64){td.setAttribute('opacity',clamp(p/.14,0,1).toFixed(2));
      td.setAttribute('transform','translate(0,'+lerp(0,306,clamp(p/.64,0,1)).toFixed(0)+')');
      drop.setAttribute('ry',lerp(16,20,clamp((p-.4)/.24,0,1)).toFixed(1));}
    else{td.setAttribute('opacity','0');const k=clamp((p-.64)/.3,0,1);
      trip.setAttribute('opacity',((1-k)*.7).toFixed(2));
      trip.setAttribute('transform','translate(726,812) scale('+(1+k*5).toFixed(2)+') translate(-726,-812)');}
  }};
}};

SC.ruinedCity={build(layer){
  let faces='';const cols=5,rows=3,fw=132,fh=140,gx=20,gy=20,ox=96,oy=140;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const x=ox+c*(fw+gx),y=oy+r*(fh+gy);
    const tone=['#3a4047','#444a51','#363c43','#4a4138'][(r*cols+c)%4];
    faces+='<g transform="translate('+x+','+y+')"><rect width="'+fw+'" height="'+fh+'" rx="6" fill="#e9e2d4"/><rect x="6" y="6" width="'+(fw-12)+'" height="'+(fh-44)+'" fill="'+tone+'"/><circle cx="'+(fw/2)+'" cy="52" r="27" fill="#79828a"/><path d="M'+(fw/2-40)+' '+(fh-44)+' C'+(fw/2-40)+' 88 '+(fw/2+40)+' 88 '+(fw/2+40)+' '+(fh-44)+' Z" fill="#69727a"/></g>';}
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="rcWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5c6064"/><stop offset="1" stop-color="#3a3e42"/></linearGradient>'+
      '<linearGradient id="rcTox" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a9a7e"/><stop offset="1" stop-color="#54584e"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#rcWall)"/>'+
    '<g stroke="#4a4e52" stroke-width="2" opacity=".45"><line x1="0" y1="300" x2="1100" y2="300"/><line x1="0" y1="600" x2="1100" y2="600"/><line x1="540" y1="0" x2="540" y2="700"/></g>'+
    faces+
    '<rect x="1112" y="0" width="488" height="900" fill="url(#rcTox)"/>'+
    '<rect x="1088" y="0" width="28" height="900" fill="#2a2d30"/>'+
    '<circle cx="1370" cy="172" r="92" fill="#eef0dc" opacity=".55"/><circle cx="1370" cy="172" r="140" fill="#dfe0c8" opacity=".18"/>'+
    '<g fill="#454a44" opacity=".85"><rect x="1140" y="430" width="80" height="270"/><rect x="1238" y="362" width="70" height="338"/><rect x="1340" y="452" width="92" height="248"/><rect x="1452" y="398" width="70" height="302"/></g>'+
    '<polygon points="0,700 1112,700 1112,900 0,900" fill="#2e3236"/>'+
    '<polygon points="1112,700 1600,700 1600,900 1112,900" fill="#3a3e38"/>'+
    '<g id="bc" transform="translate(840,506) scale(1.62)">'+beicang()+'</g>'+
    '<g id="bcarm" transform="translate(840,506) scale(1.62)">'+
      '<path d="M40 60 C74 22 72 -28 58 -70 L40 -64 C54 -26 54 20 26 56 Z" fill="#e8ecee"/>'+
      '<path d="M40 60 C70 24 68 -22 54 -60" stroke="#c6d0d4" stroke-width="3" fill="none" opacity=".6"/>'+
      '<rect x="38" y="-106" width="42" height="46" rx="3" fill="#e9e2d4" transform="rotate(6 59 -83)"/>'+
      '<rect x="44" y="-100" width="30" height="26" fill="#5a626a" transform="rotate(6 59 -83)"/>'+
      '<ellipse cx="52" cy="-66" rx="8" ry="9.5" fill="#d8b58f"/>'+
    '</g>'+
  "")+'</div>';
  const bch=layer.querySelector('#bc-head'),bcAR=layer.querySelector('#bc-armR');if(bcAR)bcAR.setAttribute('display','none');
  return{update(p,t){ if(bch)bch.setAttribute('transform','rotate('+(-7+Math.sin(t*.5)*3).toFixed(1)+' 0 30)'); }};
}};

/* shared wall text for 镜37/38 */
const WALLTEXT='<div class="chalk" style="position:absolute;left:10%;top:14%;width:80%">'+
  '<div class="wl ask">「他们对我们说，抽血是为了治病。」</div>'+
  '<div class="wl ask">「他们对我们说，等有害的血抽光，我们就能出去。」</div>'+
  '<div class="wl ask">「他们对我们说，外面的光还是好的。」</div>'+
  '<div class="wl ask" style="margin-top:.6em">「他们在说谎吗？」</div>'+
  '<div id="ans" class="ans" style="margin-top:.5em;clip-path:inset(0 0 100% 0);opacity:0">是。</div>'+
  '</div>';

SC.corridorWall={build(layer){
  let faces='';const fp=[[90,560],[208,560],[90,688],[208,688],[326,624]];fp.forEach(d=>{faces+='<g transform="translate('+d[0]+','+d[1]+')" opacity=".72"><rect width="104" height="116" rx="5" fill="#e3dccd"/><rect x="5" y="5" width="94" height="78" fill="#40464d"/><circle cx="52" cy="40" r="19" fill="#79828a"/><path d="M26 83 C26 60 78 60 78 83 Z" fill="#69727a"/></g>';});
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="cwWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#565a5e"/><stop offset="1" stop-color="#34383c"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#cwWall)"/>'+
    '<g stroke="#464b4f" stroke-width="2" opacity=".4"><line x1="0" y1="248" x2="1600" y2="248"/><line x1="0" y1="556" x2="1600" y2="556"/></g>'+
    faces+
    '<polygon points="0,792 1600,792 1600,900 0,900" fill="#2a2e32"/>'+
    '<g id="bc" transform="translate(1332,648) scale(1.18)">'+beicang()+'</g>'+
  "")+'</div>'+WALLTEXT;
  const wls=[...layer.querySelectorAll('.wl')];wls.forEach(w=>{w.style.opacity=0;w.style.transition='opacity .5s';});
  const bch=layer.querySelector('#bc-head');
  return{update(p,t){wls.forEach((w,i)=>w.style.opacity=(p>i*0.18+0.05)?1:0); if(bch)bch.setAttribute('transform','rotate('+(-10+Math.sin(t*.5)*2).toFixed(1)+' 0 30)');}};
}};

SC.writeYes={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="wyWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#585c60"/><stop offset="1" stop-color="#34383c"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#wyWall)"/>'+
    '<g stroke="#464b4f" stroke-width="2" opacity=".32"><line x1="0" y1="540" x2="1600" y2="540"/></g>'+
  "")+'</div>'+WALLTEXT+
    '<div id="penwrap" style="position:absolute;left:9%;top:40%;width:7%;height:15%">'+svg("0 0 120 240",
      '<g transform="rotate(-12 60 120)"><rect x="48" y="0" width="20" height="118" rx="6" fill="#2a2d33"/>'+
      '<rect x="50" y="6" width="7" height="104" fill="#4a4e55"/>'+
      '<path d="M44 112 L60 152 L74 112 Z" fill="#15181d"/>'+
      '<ellipse cx="60" cy="150" rx="26" ry="20" fill="#d8b58f"/>'+
      '<path d="M40 150 C42 172 80 172 82 150" stroke="#b8946f" stroke-width="3" fill="none"/></g>')+'</div>';
  const wls=[...layer.querySelectorAll('.wl')];wls.forEach(w=>w.style.opacity=1);
  const ans=layer.querySelector('#ans'),pen=layer.querySelector('#penwrap');
  return{update(p){
    const k=clamp((p-.2)/.55,0,1);
    if(ans){ans.style.opacity=k>0?1:0;ans.style.clipPath='inset(0 '+(100-k*100).toFixed(0)+'% 0 0)';}
    if(pen){pen.style.left=lerp(8.2,14,k).toFixed(1)+'%';pen.style.opacity=k<1?1:0;}
  }};
}};

SC.domeRising={build(layer){
  let far='';for(let i=0;i<22;i++){const x=i*74,h=80+((i*53)%140),y=640-h;far+='<rect x="'+x+'" y="'+y+'" width="60" height="'+h+'" fill="#16202e"/>';}
  let near='';let wins='';for(let i=0;i<11;i++){const x=20+i*150,h=160+((i*97)%200),y=640-h;near+='<rect x="'+x+'" y="'+y+'" width="120" height="'+h+'" fill="#1e2a3a"/>';
    for(let r=0;r<Math.floor(h/46);r++)for(let c=0;c<3;c++){if((i*7+r*3+c)%3===0)wins+='<rect x="'+(x+18+c*36)+'" y="'+(y+20+r*46)+'" width="20" height="24" fill="#cfe2f4" opacity=".8"/>';}}
  layer.innerHTML='<div id="pull" style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="drSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16203a"/><stop offset="1" stop-color="#3c4c68"/></linearGradient>'+
      '<radialGradient id="drDome" cx="50%" cy="100%" r="75%"><stop offset="0" stop-color="rgba(184,217,246,.5)"/><stop offset="68%" stop-color="rgba(120,165,210,.2)"/><stop offset="100%" stop-color="rgba(120,165,210,0)"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#drSky)"/>'+
    '<g fill="#bcd2ec">'+(function(){let s='';for(let i=0;i<40;i++)s+='<circle cx="'+((i*137)%1600)+'" cy="'+((i*89)%420)+'" r="'+(0.8+(i%3)*0.5).toFixed(1)+'" opacity="'+(0.3+(i%4)*0.15).toFixed(2)+'"/>';return s;})()+'</g>'+
    '<g>'+far+'</g>'+
    '<g>'+near+'</g>'+
    '<g>'+wins+'</g>'+
    '<polygon points="0,640 1600,640 1600,900 0,900" fill="#10182a"/>'+
    '<g id="domeg"><path d="M100 642 A700 700 0 0 1 1500 642 Z" fill="url(#drDome)"/>'+
      '<path d="M100 642 A700 700 0 0 1 1500 642" fill="none" stroke="#a8d4f0" stroke-width="5" opacity=".75"/>'+
      '<path d="M170 560 A640 640 0 0 1 1430 560" fill="none" stroke="#cfe6fa" stroke-width="2" opacity=".4"/></g>'+
    '<rect x="80" y="638" width="1440" height="6" fill="#a8d4f0" opacity=".5"/>'+
  "")+'</div>';
  const pull=layer.querySelector('#pull'),domeg=layer.querySelector('#domeg');
  return{update(p){
    if(pull)pull.style.transform='scale('+lerp(1.14,.9,clamp(p,0,1)).toFixed(3)+')';
    if(domeg)domeg.setAttribute('transform','translate(0,'+lerp(440,0,clamp(p/.85,0,1)).toFixed(0)+')');
  }};
}};

SC.newWard={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="nwWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c373f"/><stop offset="1" stop-color="#151c22"/></linearGradient>'+
      '<linearGradient id="nwLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef6fc"/><stop offset="1" stop-color="#a6c0d0"/></linearGradient>'+
      '<linearGradient id="nwFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#212a30"/><stop offset="1" stop-color="#0e151a"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#nwWall)"/>'+
    '<polygon points="0,642 1600,642 1600,900 0,900" fill="url(#nwFloor)"/>'+
    '<rect x="1060" y="86" width="430" height="476" rx="6" fill="#0e151a"/>'+
    '<rect x="1080" y="106" width="188" height="440" fill="url(#nwLight)"/>'+
    '<rect x="1272" y="106" width="200" height="440" fill="#36444e"/>'+
    '<rect x="1262" y="106" width="16" height="440" fill="#fbfdff" opacity=".95"/>'+
    '<polygon points="1080,546 1268,546 1360,900 540,900" fill="#cfe6f2" opacity=".15"/>'+
    '<polygon points="1120,544 1250,544 1180,900 720,900" fill="#e6f3fb" opacity=".10"/>'+
    '<rect x="120" y="498" width="86" height="214" rx="8" fill="#28323a"/>'+
    '<rect x="150" y="556" width="640" height="156" rx="12" fill="#3e4c56"/>'+
    '<rect x="150" y="556" width="640" height="42" rx="12" fill="#52616c"/>'+
    '<g transform="translate(252,520)">'+
      '<path d="M30 56 C140 46 360 52 470 68 L470 122 C360 112 140 110 30 112 Z" fill="#384650"/>'+
      '<ellipse cx="0" cy="46" rx="40" ry="40" fill="#c2a888"/>'+
      '<path d="M-36 30 C-40 6 -20 -8 0 -8 C20 -8 40 6 36 30 C30 14 18 8 0 8 C-18 8 -30 14 -36 30 Z" fill="#1f1812"/>'+
      '<path d="M-30 50 C-22 60 -10 62 -2 60" stroke="#977858" stroke-width="2.5" fill="none" opacity=".5"/>'+
    '</g>'+
    '<g id="arm" transform="translate(556,560) rotate(50)">'+
      '<rect x="-17" y="-224" width="36" height="244" rx="16" fill="#c8b196"/>'+
      '<rect x="-17" y="-224" width="14" height="244" rx="14" fill="#a98c70" opacity=".5"/>'+
      '<g fill="#7a2f2c"><circle cx="2" cy="-184" r="4"/><circle cx="-2" cy="-134" r="4"/><circle cx="4" cy="-90" r="3.4"/><circle cx="0" cy="-44" r="4"/><circle cx="3" cy="-158" r="3"/></g>'+
      '<ellipse cx="1" cy="-232" rx="18" ry="22" fill="#cdb79b"/>'+
      '<path d="M-12 -244 L-10 -260 M-2 -248 L-2 -266 M8 -246 L12 -262" stroke="#cdb79b" stroke-width="7" stroke-linecap="round"/>'+
    '</g>'+
    '<g transform="translate(910,468) scale(1.2)">'+human({top:'#3a464e',topSh:'#222c32',bottom:'#283036',bottomSh:'#171d22',skin:'#b89876',hair:'#1f1812',exp:'neutral'})+'</g>'+
  "")+'</div>';
  const arm=layer.querySelector('#arm');
  return{update(p){ if(arm)arm.setAttribute('transform','translate(556,560) rotate('+lerp(46,66,clamp(p/.6,0,1)).toFixed(1)+')'); }};
}};

SC.artLight={build(layer){
  let grid='';for(let i=1;i<16;i++)grid+='<line x1="'+(320+i*60)+'" y1="140" x2="'+(320+i*60)+'" y2="660"/>';for(let i=1;i<9;i++)grid+='<line x1="320" y1="'+(140+i*58)+'" x2="1280" y2="'+(140+i*58)+'"/>';
  let leds='';for(let r=0;r<8;r++)for(let c=0;c<16;c++)leds+='<circle cx="'+(352+c*60)+'" cy="'+(172+r*58)+'" r="5" fill="#eef6fb"/>';
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="alPanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfdff"/><stop offset="1" stop-color="#e2ecf2"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="#aab2b6"/>'+
    '<rect x="294" y="114" width="1012" height="572" rx="12" fill="#8e989e"/>'+
    '<rect x="318" y="138" width="964" height="524" rx="6" fill="url(#alPanel)"/>'+
    '<g stroke="#cbd6dc" stroke-width="2" opacity=".7">'+grid+'</g>'+
    '<g opacity=".55">'+leds+'</g>'+
    '<rect x="0" y="0" width="118" height="900" fill="#c7d0d6"/>'+
    '<rect x="1482" y="0" width="118" height="900" fill="#c7d0d6"/>'+
    '<rect x="318" y="138" width="964" height="120" fill="#ffffff" opacity=".25"/>'+
    '<rect id="buzz" x="318" y="138" width="964" height="524" fill="#ffffff" opacity="0"/>'+
    '<text x="800" y="730" text-anchor="middle" font-family="monospace" font-size="22" fill="#6a747a" opacity=".7">SPECTRUM · 5600K · ARRAY-Ⅶ</text>'+
  "")+'</div>';
  const buzz=layer.querySelector('#buzz');
  return{update(p,t){ if(buzz)buzz.setAttribute('opacity',(0.05+Math.abs(Math.sin(t*28))*0.07).toFixed(3)); }};
}};

SC.finalTitle={build(layer){
  layer.innerHTML=
    '<div class="env" style="background:#000"></div>'+
    '<div class="center" style="flex-direction:column;gap:6%">'+
      '<div id="poem" class="sub poem" style="opacity:0;max-width:74%;position:static">因为相信谎言，比相信这杀人的阳光，曾经温柔过，要容易得多。</div>'+
      '<div id="credit" style="opacity:0;text-align:center;font-family:var(--serif);letter-spacing:.2em;color:#cfc8b8">'+
        '<div style="font-size:2.2vw">人造光</div></div>'+
    '</div>';
  const poem=layer.querySelector("#poem"),credit=layer.querySelector("#credit");
  return{update(p){
    poem.style.opacity=clamp((p-.05)/.3,0,1)*(p>.66?lerp(1,0,(p-.66)/.14):1);
    credit.style.opacity=clamp((p-.78)/.18,0,1);
  }};
}};
/* ===== NEW: prologue + expanded Act 1 + conspiracy beat ===== */
SC.coldOpenSun={build(layer){
  const tops=['#9a6a52','#5a6a82','#7a7a52','#6a7a6a','#8a5a6a'];
  let folks='';const fp=[[520,648,.52],[720,668,.6],[980,650,.54],[1140,674,.62],[860,694,.66],[1280,656,.5]];
  fp.forEach((d,i)=>folks+='<g transform="translate('+d[0]+','+d[1]+') scale('+d[2]+')">'+human({top:tops[i%tops.length],topSh:'#3a3530',bottom:'#41414a',skin:(i%2?'#d2b08e':'#cba283'),hair:'#2a2018',exp:'neutral'})+'</g>');
  let far='';for(let i=0;i<16;i++){const x=i*104,h=120+((i*61)%190),y=636-h;far+='<rect x="'+x+'" y="'+y+'" width="86" height="'+h+'" fill="#6b7178"/>';}
  let near='',win='';const nb=[[40,300,360],[180,220,440],[1240,250,400],[1430,330,330]];nb.forEach(b=>{const x=b[0],w=b[1],h=b[2],y=636-h;near+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="#535962"/>';for(let r=0;r<Math.floor(h/64);r++)for(let c=0;c<Math.floor(w/64);c++)win+='<rect x="'+(x+20+c*64)+'" y="'+(y+24+r*64)+'" width="30" height="38" fill="#c2c6bc" opacity="'+(0.4+((r+c)%3)*0.2)+'"/>';});
  layer.innerHTML='<div id="world" style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="coSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6cabf"/><stop offset="1" stop-color="#9ba19a"/></linearGradient>'+
      '<radialGradient id="coSun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff"/><stop offset="46%" stop-color="#fbfaf0"/><stop offset="100%" stop-color="rgba(244,246,236,0)"/></radialGradient>'+
      '<linearGradient id="coGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c8c80"/><stop offset="1" stop-color="#5c5c52"/></linearGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#coSky)"/>'+
    '<circle cx="800" cy="188" r="156" fill="url(#coSun)"/><circle id="sun" cx="800" cy="188" r="88" fill="#ffffff"/>'+
    '<g opacity=".85">'+far+'</g>'+
    '<g>'+near+'</g><g>'+win+'</g>'+
    '<polygon points="0,636 1600,636 1600,900 0,900" fill="url(#coGround)"/>'+
    '<g stroke="rgba(255,255,255,.12)" stroke-width="2"><line x1="800" y1="636" x2="800" y2="900"/><line x1="500" y1="636" x2="300" y2="900"/><line x1="1100" y1="636" x2="1300" y2="900"/></g>'+
    folks+
  "")+'</div>';
  const world=layer.querySelector("#world"),sun=layer.querySelector("#sun");
  return{update(p){ if(world)world.style.transform="scale("+lerp(1.0,1.08,p).toFixed(3)+")"; if(sun)sun.setAttribute("opacity",lerp(.82,1,p).toFixed(2)); }};
}};

SC.wardWake={build(layer){
  layer.innerHTML=
    '<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
      '<defs>'+
        '<linearGradient id="wwall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#36454c"/><stop offset="1" stop-color="#5d7176"/></linearGradient>'+
        '<linearGradient id="wfloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#627074"/><stop offset="1" stop-color="#3b454a"/></linearGradient>'+
        '<radialGradient id="wwin" cx="50%" cy="42%" r="64%"><stop offset="0" stop-color="#f2f9ff"/><stop offset="52%" stop-color="#d6eaf8"/><stop offset="100%" stop-color="#a8c8de"/></radialGradient>'+
        '<linearGradient id="wsheet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8db"/><stop offset="1" stop-color="#9eabb1"/></linearGradient>'+
      '</defs>'+
      '<rect width="1600" height="900" fill="url(#wwall)"/>'+
      '<g stroke="rgba(255,255,255,.05)" stroke-width="2"><line x1="0" y1="250" x2="1600" y2="250"/><line x1="0" y1="470" x2="1600" y2="470"/></g>'+
      '<polygon points="0,628 1600,628 1600,900 0,900" fill="url(#wfloor)"/>'+
      '<rect x="0" y="620" width="1600" height="12" fill="rgba(0,0,0,.2)"/>'+
      '<g stroke="rgba(0,0,0,.14)" stroke-width="2"><line x1="430" y1="628" x2="180" y2="900"/><line x1="900" y1="628" x2="940" y2="900"/><line x1="1280" y1="628" x2="1520" y2="900"/></g>'+
      '<ellipse cx="1240" cy="350" rx="440" ry="390" fill="rgba(212,234,248,.22)"/>'+
      '<rect x="1070" y="120" width="360" height="450" rx="6" fill="url(#wwin)"/>'+
      '<g fill="#283238"><rect x="1070" y="120" width="360" height="15"/><rect x="1070" y="555" width="360" height="15"/><rect x="1070" y="120" width="15" height="450"/><rect x="1415" y="120" width="15" height="450"/><rect x="1243" y="120" width="13" height="450"/><rect x="1070" y="335" width="360" height="12"/></g>'+
      '<g fill="rgba(224,240,251,.10)"><polygon points="1090,150 1180,150 540,900 220,900"/><polygon points="1210,180 1290,180 980,900 720,900"/></g>'+
      '<ellipse cx="980" cy="720" rx="430" ry="84" fill="rgba(214,234,247,.12)"/>'+
      '<g transform="translate(1120,452)">'+
        '<rect x="0" y="70" width="250" height="64" rx="10" fill="#4f5a60"/>'+
        '<rect x="-4" y="64" width="92" height="20" rx="8" fill="#c7d0d3"/>'+
        '<g transform="translate(46,40) scale(1.3)">'+human({id:'pb1',pose:'sit',skin:'#cdb79c',skinSh:'#a4866b',hair:'#2c2620',top:'#aeb9bd',topSh:'#84939a',bottom:'#9caab0',exp:'sad'})+'</g>'+
        '<path d="M70 84 C150 70 248 76 256 96 C258 120 130 124 70 112 Z" fill="url(#wsheet)"/>'+
      '</g>'+
      '<g transform="translate(300,300)"><rect x="-3" y="0" width="6" height="360" rx="3" fill="#aeb8bc"/><rect x="-30" y="-6" width="60" height="14" rx="4" fill="#97a1a5"/>'+
        '<rect x="-24" y="14" width="46" height="72" rx="10" fill="rgba(120,30,34,.5)" stroke="#aeb8bc" stroke-width="2"/>'+
        '<line x1="0" y1="86" x2="44" y2="300" stroke="#9aa4a8" stroke-width="2"/></g>'+
      '<g transform="translate(120,150)"><rect x="0" y="0" width="156" height="92" rx="8" fill="#0c1412" stroke="#243430" stroke-width="3"/>'+
        '<text x="16" y="44" font-family="monospace" font-size="32" fill="#7fe0b0">07:00</text>'+
        '<polyline points="16,70 40,70 50,56 60,84 70,70 150,70" stroke="#7fe0b0" stroke-width="2.5" fill="none" opacity=".85"/></g>'+
      '<g transform="translate(330,560)">'+
        '<rect x="-22" y="40" width="36" height="270" rx="8" fill="#3c474c"/>'+
        '<rect x="0" y="180" width="700" height="130" rx="14" fill="#4a555a"/>'+
        '<rect x="0" y="180" width="700" height="20" fill="#5a666b"/>'+
        '<rect x="16" y="134" width="220" height="62" rx="20" fill="#d6dee1"/>'+
      '</g>'+
      '<g id="qf" transform="translate(490,206) scale(1.4)">'+qiufan()+'</g>'+
      '<path d="M330 870 C330 740 900 734 1030 806 L1030 870 Z" fill="url(#wsheet)" transform="translate(0,0)"/>'+
    "")+'</div>'+
    '<div id="motes" style="position:absolute;inset:0;pointer-events:none"></div>';
  const motes=layer.querySelector("#motes");const M=[];
  for(let i=0;i<22;i++){const m=E("div");m.style.cssText="position:absolute;border-radius:50%;background:rgba(224,240,251,"+rnd(.2,.6).toFixed(2)+");width:"+rnd(2,5).toFixed(1)+"px;height:"+rnd(2,5).toFixed(1)+"px;filter:blur(.5px)";m._x=rnd(40,82);m._y=rnd(14,80);m._sp=rnd(.3,1);m._ph=rnd(0,6.28);m.style.left=m._x+"%";m.style.top=m._y+"%";motes.appendChild(m);M.push(m);}
  const root=layer.querySelector("#qf"),head=layer.querySelector("#qf-head"),chest=layer.querySelector("#qf-chest"),eyeL=layer.querySelector("#qf-eyeL"),eyeR=layer.querySelector("#qf-eyeR");
  return{update(p,t){
    const wake=clamp(p/.5,0,1);
    root.setAttribute("transform","translate(490,"+lerp(214,206,wake).toFixed(1)+") scale(1.4)");
    if(head)head.setAttribute("transform","rotate("+lerp(-5,7,wake).toFixed(2)+" 4 128)");
    if(chest)chest.setAttribute("transform","translate("+(Math.sin(t*1.3)*0.6).toFixed(2)+","+(Math.sin(t*1.3)*1.4).toFixed(2)+")");
    const cyc=t%4.6,s=(cyc<0.14?0.1:1);
    if(eyeL)eyeL.setAttribute("transform","translate(-26,56) scale(1,"+s+") translate(26,-56)");
    if(eyeR)eyeR.setAttribute("transform","translate(26,56) scale(1,"+s+") translate(-26,-56)");
    M.forEach(m=>{m.style.left=(m._x+Math.sin(t*.32*m._sp+m._ph)*2.2).toFixed(2)+"%";m.style.top=(m._y+Math.cos(t*.26*m._sp+m._ph)*3.2).toFixed(2)+"%";m.style.opacity=(.3+Math.sin(t*.7+m._ph)*.3).toFixed(2);});
  }};
}};

SC.natureScreen={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs>'+
      '<linearGradient id="nWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a474e"/><stop offset="1" stop-color="#26323a"/></linearGradient>'+
      '<linearGradient id="nScr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c4a32"/><stop offset="45%" stop-color="#2f6b42"/><stop offset="100%" stop-color="#719c4c"/></linearGradient>'+
      '<linearGradient id="nFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#54626a"/><stop offset="1" stop-color="#323d43"/></linearGradient>'+
    '</defs>'+
    '<rect width="1600" height="900" fill="url(#nWall)"/>'+
    '<polygon points="0,642 1600,642 1600,900 0,900" fill="url(#nFloor)"/>'+
    '<rect x="0" y="636" width="1600" height="10" fill="rgba(0,0,0,.2)"/>'+
    '<g id="nscreen" transform="translate(96,150)">'+
      '<rect x="-16" y="-16" width="632" height="512" rx="10" fill="#0d1512"/>'+
      '<rect x="0" y="0" width="600" height="480" fill="url(#nScr)"/>'+
      '<g fill="rgba(12,26,16,.5)"><rect x="44" y="0" width="34" height="480"/><rect x="150" y="0" width="24" height="480"/><rect x="262" y="0" width="42" height="480"/><rect x="384" y="0" width="22" height="480"/><rect x="484" y="0" width="34" height="480"/></g>'+
      '<circle cx="420" cy="120" r="72" fill="rgba(232,246,202,.5)"/>'+
      '<rect x="0" y="300" width="600" height="180" fill="rgba(212,232,192,.28)"/>'+
      '<rect x="0" y="0" width="600" height="32" fill="rgba(0,0,0,.32)"/>'+
      '<text x="14" y="23" font-family="monospace" font-size="19" fill="rgba(202,234,202,.85)">SIM-FOREST v9 · 06:58 · 鸟鸣 ●</text>'+
    '</g>'+
    '<g transform="translate(1080,120)">'+
      '<rect x="-12" y="-12" width="344" height="444" rx="6" fill="#2b2a24"/>'+
      '<rect x="0" y="0" width="320" height="420" fill="#f1e4c2"/>'+
      '<g fill="#2b2a24"><rect x="0" y="0" width="320" height="14"/><rect x="0" y="406" width="320" height="14"/><rect x="0" y="0" width="14" height="420"/><rect x="306" y="0" width="14" height="420"/><rect x="153" y="0" width="12" height="420"/><rect x="0" y="203" width="320" height="12"/></g>'+
    '</g>'+
    '<g fill="rgba(244,201,122,.16)"><polygon points="1092,150 1262,150 1180,900 860,900"/></g>'+
    '<ellipse cx="1130" cy="770" rx="330" ry="72" fill="rgba(244,201,122,.14)"/>'+
    '<g id="qfb" transform="translate(1150,418) scale(1.65)" style="filter:drop-shadow(0 0 14px rgba(244,201,122,.55))">'+walker({top:'#7e8a90',topSh:'#5e6a70',skin:'#b89a7e',hair:'#1f1a16'})+'</g>'+
  "")+'</div>'+
  '<div id="motes" style="position:absolute;inset:0;pointer-events:none"></div>';
  const scr=layer.querySelector('#nscreen'),qfb=layer.querySelector('#qfb');
  const motes=layer.querySelector('#motes');const M=[];
  for(let i=0;i<16;i++){const m=E('div');m.style.cssText='position:absolute;border-radius:50%;background:rgba(244,222,180,'+rnd(.15,.4).toFixed(2)+');width:'+rnd(2,4).toFixed(1)+'px;height:'+rnd(2,4).toFixed(1)+'px';m._x=rnd(58,80);m._y=rnd(20,80);m._sp=rnd(.3,1);m._ph=rnd(0,6.28);m.style.left=m._x+'%';m.style.top=m._y+'%';motes.appendChild(m);M.push(m);}
  return{update(p,t){
    if(scr)scr.setAttribute('opacity',(0.78+Math.sin(t*9)*0.05+Math.sin(t*23)*0.02).toFixed(3));
    if(qfb)qfb.setAttribute('transform','translate(1150,'+(418+Math.sin(t*1.1)*2).toFixed(1)+') scale(1.65)');
    M.forEach(m=>{m.style.left=(m._x+Math.sin(t*.3*m._sp+m._ph)*2).toFixed(2)+'%';m.style.top=(m._y+Math.cos(t*.26*m._sp+m._ph)*2.6).toFixed(2)+'%';m.style.opacity=(.3+Math.sin(t*.7+m._ph)*.25).toFixed(2);});
  }};
}};

SC.meal={build(layer){
  let diners='';const dcols=['#aeb9bd','#b4bcc0','#a6b0b4'];
  const dpos=[[300,452,.66],[540,440,.6],[1090,452,.66],[1320,440,.6],[1200,500,.74]];
  dpos.forEach((d,i)=>{diners+='<g transform="translate('+d[0]+','+d[1]+') scale('+d[2]+')">'+human({pose:'sit',top:dcols[i%3],topSh:'#8b979c',skin:(i%2?'#c9b094':'#d3b49a'),hair:(i%2?'#2a241f':'#1f1a16')})+'</g>';});
  layer.innerHTML=
    '<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
      '<defs>'+
        '<linearGradient id="cWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#47565c"/><stop offset="1" stop-color="#384650"/></linearGradient>'+
        '<linearGradient id="cFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b686d"/><stop offset="1" stop-color="#3c474c"/></linearGradient>'+
        '<linearGradient id="cTable" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a949a"/><stop offset="1" stop-color="#5c666c"/></linearGradient>'+
      '</defs>'+
      '<rect width="1600" height="900" fill="url(#cWall)"/>'+
      '<g fill="#cfe0e6" opacity=".5"><rect x="240" y="40" width="200" height="26" rx="6"/><rect x="700" y="40" width="200" height="26" rx="6"/><rect x="1160" y="40" width="200" height="26" rx="6"/></g>'+
      '<g fill="rgba(207,224,230,.12)"><polygon points="240,66 440,66 520,310 180,310"/><polygon points="700,66 900,66 940,310 660,310"/><polygon points="1160,66 1360,66 1420,310 1100,310"/></g>'+
      '<rect x="0" y="300" width="1600" height="56" fill="#3f4a50"/>'+
      '<polygon points="0,520 1600,520 1600,900 0,900" fill="url(#cFloor)"/>'+
      '<g fill="#5c666c"><rect x="180" y="498" width="520" height="22"/><rect x="900" y="498" width="540" height="22"/></g>'+
      diners+
      '<g id="qf" transform="translate(560,330) scale(1.15)">'+qiufan()+'</g>'+
      '<rect x="0" y="648" width="1600" height="252" fill="url(#cTable)"/>'+
      '<rect x="0" y="648" width="1600" height="10" fill="#9aa4aa"/>'+
      '<g transform="translate(600,604)">'+
        '<ellipse cx="0" cy="44" rx="150" ry="20" fill="rgba(0,0,0,.18)"/>'+
        '<rect x="-118" y="6" width="236" height="56" rx="8" fill="#7e888e"/><rect x="-118" y="6" width="236" height="9" rx="4" fill="#a8b2b8"/>'+
        '<g transform="translate(-6,-30) scale(.82)">'+
          '<ellipse cx="0" cy="58" rx="96" ry="20" fill="#36280f"/>'+
          '<path d="M-88 58 C-88 12 -40 -10 0 -10 C40 -10 88 12 88 58 Z" fill="#6e5126"/>'+
          '<ellipse cx="0" cy="20" rx="76" ry="28" fill="#4a3a22"/>'+
          '<circle cx="0" cy="18" r="16" fill="#0b0b0b"/><circle cx="6" cy="11" r="5.4" fill="#2a2622"/><circle cx="-5" cy="13" r="3" fill="#fff" opacity=".85"/>'+
          '<path d="M-34 18 q-20 -5 -34 7" stroke="#7a1714" stroke-width="2.4" fill="none" opacity=".6"/>'+
        '</g>'+
        '<rect x="86" y="18" width="40" height="44" rx="6" fill="#aab4ba"/>'+
      '</g>'+
    "")+'</div>'+
    '<div id="motes" style="position:absolute;inset:0;pointer-events:none"></div>';
  const head=layer.querySelector('#qf-head'),chest=layer.querySelector('#qf-chest'),eyeL=layer.querySelector('#qf-eyeL'),eyeR=layer.querySelector('#qf-eyeR');
  const motes=layer.querySelector('#motes');const M=[];
  for(let i=0;i<12;i++){const m=E('div');m.style.cssText='position:absolute;border-radius:50%;background:rgba(210,225,230,'+rnd(.1,.3).toFixed(2)+');width:'+rnd(2,4).toFixed(1)+'px;height:'+rnd(2,4).toFixed(1)+'px';m._x=rnd(20,80);m._y=rnd(10,60);m._sp=rnd(.3,1);m._ph=rnd(0,6.28);m.style.left=m._x+'%';m.style.top=m._y+'%';motes.appendChild(m);M.push(m);}
  return{update(p,t){
    if(head)head.setAttribute('transform','rotate('+(3+Math.sin(t*.6)*1.4).toFixed(2)+' 4 128)');
    if(chest)chest.setAttribute('transform','translate(0,'+(Math.sin(t*1.3)*1.1).toFixed(2)+')');
    const cyc=t%4.6,s=(cyc<0.14?0.1:1);
    if(eyeL)eyeL.setAttribute('transform','translate(-26,56) scale(1,'+s+') translate(26,-56)');
    if(eyeR)eyeR.setAttribute('transform','translate(26,56) scale(1,'+s+') translate(-26,-56)');
    M.forEach(m=>{m.style.left=(m._x+Math.sin(t*.3*m._sp+m._ph)*1.8).toFixed(2)+'%';m.style.top=(m._y+Math.cos(t*.25*m._sp+m._ph)*2.4).toFixed(2)+'%';m.style.opacity=(.2+Math.sin(t*.7+m._ph)*.2).toFixed(2);});
  }};
}};

SC.patent={build(layer){
  layer.innerHTML='<div style="position:absolute;inset:0">'+svg("0 0 1600 900",
    '<defs><linearGradient id="ptRoom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232c31"/><stop offset="1" stop-color="#10171b"/></linearGradient>'+
      '<radialGradient id="ptDome" cx="50%" cy="100%" r="80%"><stop offset="0" stop-color="#cfe8f4"/><stop offset="100%" stop-color="#5a8aa0"/></radialGradient></defs>'+
    '<rect width="1600" height="900" fill="url(#ptRoom)"/>'+
    '<ellipse cx="800" cy="450" rx="720" ry="430" fill="#dfeefc" opacity=".1"/>'+
    '<g transform="translate(360,118)">'+
      '<rect x="-16" y="-16" width="904" height="694" rx="10" fill="#cdc4b0"/>'+
      '<rect x="0" y="0" width="872" height="662" rx="8" fill="#f3eee2"/>'+
      '<text x="40" y="66" font-family="serif" font-size="42" fill="#2a2620" font-weight="700">专 利 证 书</text>'+
      '<line x1="40" y1="86" x2="832" y2="86" stroke="#9a8e74" stroke-width="2"/>'+
      '<text x="40" y="142" font-family="sans-serif" font-size="33" fill="#3a342a">名称：天穹滤光膜（城市级光毒过滤穹顶）</text>'+
      '<text x="40" y="190" font-family="monospace" font-size="25" fill="#6a6048">专利号 ZL 20·· ······· · X</text>'+
      '<g transform="translate(436,440)">'+
        '<rect x="-300" y="40" width="600" height="20" fill="#7a8a6a"/>'+
        '<path d="M-300 50 A300 300 0 0 1 300 50 Z" fill="url(#ptDome)" opacity=".45"/>'+
        '<path d="M-300 50 A300 300 0 0 1 300 50" fill="none" stroke="#3a6a82" stroke-width="4"/>'+
        '<g fill="#4a5a52"><rect x="-160" y="-10" width="40" height="60"/><rect x="-100" y="-50" width="36" height="100"/><rect x="-40" y="-20" width="44" height="70"/><rect x="30" y="-60" width="34" height="110"/><rect x="90" y="-30" width="48" height="80"/></g>'+
        '<g stroke="#ffd27a" stroke-width="3" opacity=".55"><line x1="-120" y1="-250" x2="-120" y2="-118"/><line x1="0" y1="-270" x2="0" y2="-138"/><line x1="120" y1="-250" x2="120" y2="-118"/></g>'+
      '</g>'+
      '<g id="stamp" transform="translate(648,560) rotate(-14)" opacity="0">'+
        '<rect x="-156" y="-56" width="312" height="112" rx="8" fill="none" stroke="#c0392b" stroke-width="5"/>'+
        '<text x="0" y="-12" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#c0392b" font-weight="700">登记生效</text>'+
        '<text x="0" y="32" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#c0392b" font-weight="700">灾难前 · 两年</text>'+
      '</g>'+
    '</g>'+
  "")+'</div>';
  const stamp=layer.querySelector('#stamp');
  return{update(p){
    if(stamp){const k=clamp((p-.4)/.18,0,1);stamp.setAttribute('opacity',k.toFixed(2));
      stamp.setAttribute('transform','translate(648,560) rotate(-14) scale('+lerp(1.5,1,k).toFixed(3)+')');}
  }};
}};

/*__APPEND_SCENES__*/
/* ============================================================
   SHOT TIMELINE  (n, frame, act, start, end, scene, fx, grade, subs)
   subtitle times are relative to the shot's start.
   ============================================================ */
function S(a,b,who,text,cls){return{a,b,who,text,cls:cls||""};}

SHOTS.push(
/* ===== Act 0 — 序幕 · 档案 · 片名 ===== */
{n:"镜1",frame:"序幕 · 远景",act:0,start:0,end:14,scene:"coldOpenSun",fx:"ash",
  grade:{tint:"#1a1f1c",tintA:.3,warm:"#c8ccbe",sat:.42,con:1.06,bri:1.04,bloomC:"#e8ead8",bloomA:.06,vig:.9},
  subs:[S(2,7,"","起初，没人相信，阳光会杀人。","vo"),
        S(8,13,"","他们只说——今天的紫外线，有点高。","vo")]},
{n:"镜2",frame:"黑屏+字幕",act:0,start:14,end:24,scene:"terminal",fx:"none",subs:[]},
{n:"镜3",frame:"黑屏 · 片名",act:0,start:24,end:32,scene:"title",fx:"none",subs:[]},

/* ===== Act 1 — 秋犯的世界（由广播结构的一日） ===== */
{n:"镜4",frame:"晨 · 中景",act:1,start:32,end:47,scene:"wardWake",fx:"dustW",
  subs:[S(10,14.5,"秋犯（自语）","……唉，又是一天。","")]},
{n:"镜5",frame:"中景",act:1,start:47,end:64,scene:"natureScreen",fx:"dustW",
  subs:[S(2,8,"","巨型屏幕模拟着清晨的森林，鸟鸣清脆。他看都没看一眼。","sfx"),
        S(9.5,16,"秋犯（自语）","只有这扇窗里的光……才是真的。","")]},
{n:"镜6",frame:"全景→近景",act:1,start:64,end:88,scene:"yard",fx:"dustW",grade:{bloomC:"#bfe3ff",bloomA:.2,sat:1},
  subs:[S(10,18,"","栅栏之外——阳光、绿树、高楼。一个干净、明亮、有秩序的世界。","sfx")]},
{n:"镜7",frame:"大特写",act:1,start:88,end:98,scene:"eye",fx:"none",grade:{bloomC:"#bfe3ff",bloomA:.22},
  subs:[S(3,8,"秋犯（气声）","外面……真美。","")]},
{n:"镜8",frame:"特写",act:1,start:98,end:113,scene:"meal",fx:"dustW",
  subs:[S(8,14,"秋犯","哈，今天的补给里，竟有这种——节日才有的特殊食材。","")]},
{n:"镜9",frame:"特写",act:1,start:113,end:127,scene:"needle",fx:"none",
  subs:[S(2,6,"","针头刺入。暗红的血，流进针筒。","sfx")]},
{n:"镜10",frame:"移动特写",act:1,start:127,end:141,scene:"armscars",fx:"dustW",
  subs:[S(2,12,"秋犯","你看，这些都是我努力的证明。积累这么多了，我是不是很快就能出去了？","")]},
{n:"镜11",frame:"蒙太奇 · 叠化",act:1,start:141,end:160,scene:"montage1",fx:"dustW",subs:[]},
{n:"镜12",frame:"近景",act:1,start:160,end:180,scene:"door",fx:"none",
  subs:[S(3,15,"秋犯（画外音）","医生说，等所有有害的血都被抽光，就能出去了。总会出去的，对吧？","vo")]},

/* ===== Act 2 — 带走 ===== */
{n:"镜13",frame:"中景",act:2,start:180,end:196,scene:"manEnters",fx:"dustW",
  subs:[S(6,9,"男人","你叫什么？",""),S(10,14,"秋犯","秋犯。","")]},
{n:"镜14",frame:"近景",act:2,start:196,end:208,scene:"manExamine",fx:"dustW",
  subs:[S(1,4,"男人","你就不怕死吗？",""),S(5,10,"秋犯","我没有不把你放在眼里。我只是……在看光。","")]},
{n:"镜15",frame:"特写",act:2,start:208,end:220,scene:"lightPatch",fx:"dustW",
  subs:[S(2,10,"秋犯","你看，它多美呀。等我出了这地方，被阳光全身拥抱，会是什么样呢？","")]},
{n:"镜16",frame:"中景",act:2,start:220,end:236,scene:"invite",fx:"none",
  subs:[S(3,8,"男人","有意思。你想出去看看吗？",""),
        S(9,12,"秋犯（心跳如鼓）","出去……？",""),
        S(12.5,15,"男人","现在。","")]},
{n:"镜17",frame:"黑屏+声音",act:2,start:236,end:248,scene:"blindBlack",fx:"none",
  subs:[S(1,9,"","眼罩蒙上。脚步声。车门。引擎。呼吸急促而压抑。","sfx")]},

/* ===== Act 3 — 外面的真相 ===== */
{n:"镜18",frame:"近景",act:3,start:248,end:260,scene:"blindRemoved",fx:"sparkC",grade:{bloomA:0},
  subs:[S(2,9,"","真正的风，带着甜味。人声——嘈杂、真实、日常。","sfx")]},
{n:"镜19",frame:"主观 · 全景",act:3,start:260,end:274,scene:"palace",fx:"sparkC",grade:{bloomC:"#cdb9ff",bloomA:.16},
  subs:[S(6,12,"秋犯（手抚墙壁）","这里……真的好美呀。","")]},
{n:"镜20",frame:"跟拍",act:3,start:274,end:286,scene:"auction",fx:"none",
  subs:[S(2,9,"","屏幕滚动着人像与价格——一场人体拍卖。他没看懂。","sfx")]},
{n:"镜21",frame:"中景",act:3,start:286,end:298,scene:"lifezone",fx:"sparkC",
  subs:[S(5,11,"秋犯","哈哈，这地方真美好！","")]},
{n:"镜22",frame:"特写",act:3,start:298,end:316,scene:"coldBeam",fx:"dustC",
  subs:[S(9,17,"秋犯（困惑）","为什么……这所谓的光，却这么冰冷，没有一点温度？","")]},
{n:"镜23",frame:"中景",act:3,start:316,end:332,scene:"manExplains",fx:"none",
  subs:[S(1,7,"男人","你想要有温度的阳光？这世界上，早就没有真正的光了。",""),
        S(8,11,"秋犯","那……外面的世界呢？",""),
        S(11.5,15.5,"男人","你说外面？喏，那块屏幕上放的，就是。","")]},
{n:"镜24",frame:"中景→推近",act:3,start:332,end:354,scene:"deadStreet",fx:"ash",grade:{tint:"#0e1113",tintA:.5,sat:.5,warm:"#9aa6ac",bloomA:.02},
  subs:[S(8,12,"秋犯（气声）","这……这是……",""),
        S(13,21,"男人（画外音）","都是被采走器官和血的。都是货币。太多了，埋不过来，就丢这儿了。","vo")]},
{n:"镜25",frame:"大特写",act:3,start:354,end:364,scene:"searching",fx:"none",
  subs:[S(1,8,"","他艰难地咽下唾沫，抬头在屏幕上寻找——寻找光。","sfx")]},
{n:"镜26",frame:"特写",act:3,start:364,end:380,scene:"burning",fx:"ember",grade:{tint:"#140a06",tintA:.4,sat:.9,warm:"#ff8a4a",bloomC:"#ff6a2a",bloomA:.22},
  subs:[S(6,13,"秋犯（气若游丝）","阳光……还是存在的……","")]},
{n:"镜27",frame:"快速推近",act:3,start:380,end:390,scene:"pupilFlame",fx:"ember",grade:{bloomC:"#ff7a33",bloomA:.2,sat:.95},subs:[]},
{n:"镜28",frame:"近景",act:3,start:390,end:398,scene:"collarGrab",fx:"none",grade:{bloomC:"#ff6a2a",bloomA:.1,sat:.9},
  subs:[S(.5,5,"秋犯（嘶吼，破音）","高科技的高楼呢！美丽的风景呢！温柔的阳光呢！","")]},

/* ===== Act 4 — 熄灭 ===== */
{n:"镜29",frame:"俯拍中景",act:4,start:398,end:408,scene:"collapseSit",fx:"none",subs:[]},
{n:"镜30",frame:"近景",act:4,start:408,end:428,scene:"extinguished",fx:"none",
  subs:[S(8,16,"秋犯（声音平静）","送……送我回去吧。我该去上日课了。","")]},
{n:"镜31",frame:"特写",act:4,start:428,end:438,scene:"manSilent",fx:"none",
  subs:[S(2,8,"","男人收起笑容。没有说话。","sfx")]},
{n:"镜32",frame:"近景",act:4,start:438,end:450,scene:"blindAgain",fx:"none",
  subs:[S(3,10,"秋犯（内心独白）","秋犯在黑暗里闭着眼，却觉得自己，再也看不见光了。","vo")]},
{n:"镜33",frame:"黑屏",act:4,start:450,end:462,scene:"teardropBlack",fx:"none",
  subs:[S(2,9,"","黑暗中，一滴眼泪落下的声音。微弱。清晰。","sfx")]},

/* ===== Act 5 — 崩溃的世界（北蚕：真相的来处） ===== */
{n:"镜34",frame:"切入 · 特写",act:5,start:462,end:478,scene:"labReport",fx:"none",
  subs:[S(2,8,"北蚕（画外音）","起初，我也以为，只是紫外线高了一点。","vo"),
        S(9,15,"","OD 值偏离正常范围 700 倍。同样的样本，他测了六遍。","sfx")]},
{n:"镜35",frame:"中景",act:5,start:478,end:494,scene:"labPhone",fx:"none",
  subs:[S(1,9.5,"北蚕","陈望秋，我今天没出过门。我血里的光毒浓度，是正常暴晒的六十七倍。",""),
        S(10.5,15,"陈望秋（画外音）","我现在去实验室。等着。","vo")]},
{n:"镜36",frame:"快速蒙太奇",act:5,start:494,end:520,scene:"montage2",fx:"none",
  subs:[S(2,10,"陈望秋（画外音）","免疫系统被重置——一次暴晒，就忘掉所有疫苗，变回婴儿。普通感冒，就能致命。","vo"),
        S(11.5,15,"北蚕","臭氧层……还能恢复吗？",""),
        S(16,24.5,"陈望秋（画外音，绝望的笑）","所有纬度、所有季节，全部逆转。没有任何模型对得上……这不是人类干的。","vo")]},
{n:"镜37",frame:"灾难蒙太奇",act:5,start:520,end:550,scene:"disaster",fx:"ashHvy",
  subs:[S(11,19,"","一场户外婚礼。同一天，整个村庄，都倒在了泥土里。","sfx")]},
{n:"镜38",frame:"中景",act:5,start:550,end:572,scene:"memo",fx:"none",
  subs:[S(2,9,"","“……编入户外作业梯队。”——他在“梯队”二字上停住。","sfx"),
        S(10,20,"北蚕（画外音）","千分之三点二的人，暴晒后不会立刻死。他们要这些人，去日光下采矿、献血。","vo")]},
{n:"镜39",frame:"特写 · 文件",act:5,start:572,end:590,scene:"patent",fx:"none",
  subs:[S(2,9,"","天穹滤光膜的核心专利——登记于灾难前，整整两年。","sfx"),
        S(10,17,"北蚕（画外音）","在没人相信阳光会杀人之前，有人，已经把穹顶造好了。……我没有再查下去。","vo")]},

/* ===== Act 6 — 轮回与谎言 ===== */
{n:"镜40",frame:"全景",act:6,start:590,end:602,scene:"ruinedCity",fx:"ashHvy",
  subs:[S(2,9,"","他把逝者的脸，一张张，贴上掩体的墙。","sfx")]},
{n:"镜41",frame:"近景",act:6,start:602,end:618,scene:"corridorWall",fx:"ash",subs:[]},
{n:"镜42",frame:"特写",act:6,start:618,end:628,scene:"writeYes",fx:"none",
  subs:[S(1,7,"","他在那行字下面，写下一个字。","sfx")]},
{n:"镜43",frame:"全景→拉远",act:6,start:628,end:640,scene:"domeRising",fx:"dustC",grade:{bloomC:"#8aa6bc",bloomA:.1,sat:.62},subs:[]},
{n:"镜44",frame:"中景",act:6,start:640,end:660,scene:"newWard",fx:"dustC",grade:{tint:"#16202a",tintA:.24,sat:.46,bri:1.0,vig:.88,bloomC:"#bcd6e6",bloomA:.07},
  subs:[S(3,16,"旁白（北蚕）","病人躺在床上，看着窗帘里漏进来的人造光，以为那是太阳。他们举起布满伤口的手臂，骄傲地说：看，这都是我努力的证明。","vo")]},
{n:"镜45",frame:"大特写",act:6,start:660,end:668,scene:"artLight",fx:"none",grade:{tint:"#283036",tintA:.32,sat:.34,bri:.96,vig:.92,bloomC:"#cfe2f0",bloomA:.05},subs:[]},
{n:"镜46",frame:"黑屏+字幕",act:6,start:668,end:680,scene:"finalTitle",fx:"none",grade:{tint:"#000",tintA:0,bloomA:0,vig:.98,sat:.7},subs:[]}
);

/* ============================================================
   BOOT
   ============================================================ */
if(document.readyState!=="loading")Film.boot();
else document.addEventListener("DOMContentLoaded",Film.boot);
/*__APPEND_SHOTS__*/

})();
