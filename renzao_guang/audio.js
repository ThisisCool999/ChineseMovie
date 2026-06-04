/* ============================================================
   TRAX — voice narration + 6-cue music score + SFX
   Loaded before film.js; driven by Film's clock via hooks.
   Voice clips map 1:1 to the film's subtitle cues, in order.
   Music is a 6-cue score that crossfades at the act boundaries
   and ducks under the voice. Drop files in audio/music/01..06.mp3.

   Two playback paths, chosen automatically:
     • http(s)  -> full Web Audio graph (gain boost, limiter, EQ, reverb, crossfades)
     • file://  -> direct <audio> playback (a MediaElementSource is tainted
                   by the opaque file:// origin and would be SILENT)
   ============================================================ */
(function(){
"use strict";
const BASE="audio/voice/";

/* clips in caption order — EDIT THIS to fix the line<->clip mapping.
   lines 1-54 = school session, lines 55-57 = home session. */
const CLIPS=[];
for(let n=1;n<=54;n++)CLIPS.push("concordia-"+String(n).padStart(2,"0")+".m4a");
CLIPS.push("huangyang-01.m4a","huangyang-02.m4a","huangyang-03.m4a");

/* per-line playback rate (1 = normal, <1 = slower & clearer, pitch kept). */
const RATE={};
/* per-line voice gain override (default DEFAULT_GAIN). only applies on http(s).
   key = caption order, 0-based. line 3 (index 2) ~ 0:43 is boosted. */
const GAIN={2:2.8};
const DEFAULT_GAIN=1.9;        // voice boost — louder than music (http only; file:// caps at 1.0)

/* ---- 6-cue music score: file enters at time t (sec) and crossfades the previous out ---- */
const MUSIC_DIR="audio/music/";
const MUSICCUES=[
  {t:0,   file:"01.mp3", vol:1.0},   // 序章 + 一「秋犯的世界」 fragile false-dawn
  {t:180, file:"02.mp3", vol:1.25},  // 二「带走」 the stranger / quiet menace
  {t:248, file:"03.mp3", vol:0.9},   // 三「外面的真相」 horror reveal -> climax
  {t:398, file:"04.mp3", vol:1.15},  // 四「熄灭」 grief
  {t:462, file:"05.mp3", vol:1.4},   // 五「崩溃的世界」 cold conspiracy
  {t:590, file:"06.mp3", vol:0.95},  // 六「轮回与谎言」+ 日落 tragic finale
];
const MUSIC_VOL=0.16;          // quiet, constant background bed (well under the voice)
const MUSIC_DUCK=1;            // 1 = no ducking (music stays the same volume under voice)
const MUSIC_XFADE=2.5;         // crossfade seconds between cues

/* tone shaping — pull the whole mix darker & sadder (less bright/harsh).
   only applies on the http(s) graph path; file:// plays elements raw. */
const DARK_SHELF_HZ=3400, DARK_SHELF_DB=-6;   // shelve down the bright highs
const DARK_LP_HZ=6200;                          // roll off air/sizzle -> warm, veiled
const REVERB_WET=0.20, REVERB_SEC=2.4, REVERB_DECAY=2.4;  // melancholic space on the voice
const SFX_VOL=0.5;             // sound-effects level

/* synthesized SFX at key beats: [absTime, name] */
const SFXCUES=[[115,"tick"],[345,"swell"],[390,"impact"],[398,"impact"],[628,"swell"],[668,"swell"]];

/* Web Audio media routing only works on http(s); file:// taints to silence. */
const GRAPH=/^https?:$/.test(location.protocol);

let actx=null,master=null,voiceBus=null,sfxGain=null,ready=false,enabled=false;
let clips=[],cues=[],lastClip=null,voiceOn=true;
let musicEls=[],musicBus=null,curMusic=-1,ducked=false;

function buildCues(){
  cues=[];(window.__SHOTS||[]).forEach(sh=>(sh.subs||[]).forEach(s=>cues.push(sh.start+s.a)));
  cues.sort((a,b)=>a-b);
}
function setRate(el,r){ el.playbackRate=r;
  if('preservesPitch'in el)el.preservesPitch=true;
  if('webkitPreservesPitch'in el)el.webkitPreservesPitch=true; }

function init(){
  if(ready)return;
  try{
    actx=new (window.AudioContext||window.webkitAudioContext)();
    master=actx.createGain();master.gain.value=0;
    const lim=actx.createDynamicsCompressor();
    lim.threshold.value=-8;lim.knee.value=8;lim.ratio.value=12;lim.attack.value=.003;lim.release.value=.25;
    const shelf=actx.createBiquadFilter();shelf.type="highshelf";shelf.frequency.value=DARK_SHELF_HZ;shelf.gain.value=DARK_SHELF_DB;
    const lp=actx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=DARK_LP_HZ;lp.Q.value=.5;
    master.connect(shelf);shelf.connect(lp);lp.connect(lim);lim.connect(actx.destination);
    sfxGain=actx.createGain();sfxGain.gain.value=SFX_VOL;sfxGain.connect(master);
    if(GRAPH){
      voiceBus=actx.createGain();voiceBus.gain.value=1;voiceBus.connect(master);
      const conv=actx.createConvolver();conv.buffer=makeIR(REVERB_SEC,REVERB_DECAY);
      const send=actx.createGain();send.gain.value=REVERB_WET;
      voiceBus.connect(send);send.connect(conv);conv.connect(master);
      musicBus=actx.createGain();musicBus.gain.value=MUSIC_VOL;musicBus.connect(master);
    }
    buildCues();
    clips=CLIPS.map((file,i)=>{
      const el=new Audio(BASE+file);el.preload="auto";
      const rate=(RATE[i]!=null?RATE[i]:1);setRate(el,rate);
      const gain=(GAIN[i]!=null?GAIN[i]:DEFAULT_GAIN);
      let g=null;
      if(GRAPH){try{const src=actx.createMediaElementSource(el);g=actx.createGain();g.gain.value=gain;src.connect(g);g.connect(voiceBus);}catch(e){g=null;}}
      if(!g)el.volume=Math.min(1,gain);
      return{el,g,t:cues[i],rate,gain,line:i+1,file};
    });
    musicEls=MUSICCUES.map(c=>{
      const el=new Audio(MUSIC_DIR+c.file);el.loop=true;el.preload="auto";
      el.addEventListener("error",()=>{});   // missing cue file -> silently skip
      let g=null;
      if(GRAPH){try{const src=actx.createMediaElementSource(el);g=actx.createGain();g.gain.value=0;src.connect(g);g.connect(musicBus);}catch(e){g=null;}}
      else el.volume=0;
      return{el,g,t:c.t,file:c.file,vol:(c.vol!=null?c.vol:1)};
    });
    ready=true;
  }catch(e){ready=false;}
}

/* ---- voice ---- */
function duck(on){ ducked=on;
  if(GRAPH&&musicBus){const t=actx.currentTime;musicBus.gain.cancelScheduledValues(t);musicBus.gain.linearRampToValueAtTime((on?MUSIC_DUCK:1)*MUSIC_VOL,t+.4);}
  else{const m=musicEls[curMusic];if(m&&m.el){try{m.el.volume=(on?MUSIC_DUCK:1)*MUSIC_VOL;}catch(e){}}} }
function stopClip(){ if(lastClip&&lastClip.el&&!lastClip.el.paused){try{lastClip.el.pause();}catch(e){}} duck(false); }
function playClip(c){ if(!c||!c.el)return; stopClip();
  try{c.el.currentTime=0;c.el.playbackRate=c.rate;if(!c.g)c.el.volume=Math.min(1,c.gain);c.el.play().catch(()=>{});}catch(e){}
  lastClip=c; duck(true);
  c.el.onended=()=>{ if(lastClip===c)duck(false); }; }

/* ---- music score ---- */
function cueIndexAt(t){ let idx=-1; for(let i=0;i<musicEls.length;i++){if(t>=musicEls[i].t)idx=i;} return idx; }
function gotoMusic(i){
  if(i===curMusic)return;
  const prev=curMusic; curMusic=i;
  if(prev>=0&&musicEls[prev]){const p=musicEls[prev];
    if(GRAPH&&p.g){const n=actx.currentTime;p.g.gain.cancelScheduledValues(n);p.g.gain.setValueAtTime(p.g.gain.value,n);p.g.gain.linearRampToValueAtTime(0,n+MUSIC_XFADE);}
    const pe=p.el;setTimeout(()=>{if(curMusic!==prev){try{pe.pause();}catch(e){}}},(GRAPH?MUSIC_XFADE*1000:0)+60);
    if(!GRAPH){try{pe.pause();}catch(e){}}
  }
  if(i<0)return;
  const m=musicEls[i];if(!m||!m.el)return;
  try{m.el.currentTime=0;}catch(e){}
  m.el.play().catch(()=>{});
  if(GRAPH&&m.g){const n=actx.currentTime;m.g.gain.cancelScheduledValues(n);m.g.gain.setValueAtTime(0,n);m.g.gain.linearRampToValueAtTime(m.vol,n+MUSIC_XFADE);}
  else m.el.volume=Math.min(1,(ducked?MUSIC_DUCK:1)*MUSIC_VOL*m.vol);
}
function applyMusicAt(t){
  if(!enabled)return;
  const i=cueIndexAt(t);
  if(i!==curMusic){gotoMusic(i);return;}
  const m=musicEls[i];                       // self-heal: same cue but element got paused (after pause/seek)
  if(i>=0&&m&&m.el&&m.el.paused){
    m.el.play().catch(()=>{});
    if(GRAPH&&m.g){const n=actx.currentTime;m.g.gain.cancelScheduledValues(n);m.g.gain.setValueAtTime(0,n);m.g.gain.linearRampToValueAtTime(m.vol,n+.5);}
    else m.el.volume=Math.min(1,(ducked?MUSIC_DUCK:1)*MUSIC_VOL*m.vol);
  }
}
function pauseMusicAll(){ musicEls.forEach(m=>{if(m.el&&!m.el.paused){try{m.el.pause();}catch(e){}}}); }

/* ---- synthesized SFX ---- */
function noise(dur){const n=actx.sampleRate*dur,b=actx.createBuffer(1,n,actx.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);const s=actx.createBufferSource();s.buffer=b;return s;}
function makeIR(sec,decay){const rate=actx.sampleRate,len=Math.max(1,(rate*sec)|0),buf=actx.createBuffer(2,len,rate);
  for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);}return buf;}
function sfx(name){
  if(!ready||!enabled)return;const t=actx.currentTime;
  if(name==="impact"){
    const o=actx.createOscillator(),g=actx.createGain();o.type="sine";
    o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(28,t+.7);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.9,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.9);
    o.connect(g);g.connect(sfxGain);o.start(t);o.stop(t+.95);
    const nz=noise(.5),ng=actx.createGain(),bp=actx.createBiquadFilter();bp.type="lowpass";bp.frequency.value=400;
    ng.gain.setValueAtTime(.5,t);ng.gain.exponentialRampToValueAtTime(.001,t+.5);nz.connect(bp);bp.connect(ng);ng.connect(sfxGain);nz.start(t);
  }else if(name==="swell"){
    const nz=noise(3.2),bp=actx.createBiquadFilter(),g=actx.createGain();bp.type="bandpass";bp.Q.value=1.4;
    bp.frequency.setValueAtTime(120,t);bp.frequency.exponentialRampToValueAtTime(1300,t+3);
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.30,t+2.2);g.gain.linearRampToValueAtTime(.0001,t+3.2);
    nz.connect(bp);bp.connect(g);g.connect(sfxGain);nz.start(t);
  }else if(name==="tick"){
    const o=actx.createOscillator(),g=actx.createGain();o.type="sine";o.frequency.value=720;
    g.gain.setValueAtTime(.3,t);g.gain.exponentialRampToValueAtTime(.0001,t+.18);o.connect(g);g.connect(sfxGain);o.start(t);o.stop(t+.2);
  }
}

const Trax={
  enable(on){ enabled=!!on;
    if(on){ init(); if(!ready)return; try{actx.resume();}catch(e){}
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.linearRampToValueAtTime(1,actx.currentTime+.3);
    }else{ if(!ready)return;
      master.gain.linearRampToValueAtTime(0,actx.currentTime+.3);
      pauseMusicAll(); stopClip();
    } },
  update(t,prevT,playing){ if(!ready||!enabled||!playing)return;
    if(voiceOn)for(let i=0;i<clips.length;i++){const c=clips[i];if(c&&c.t!=null&&prevT<c.t&&t>=c.t)playClip(c);}
    for(const [ct,nm] of SFXCUES){if(prevT<ct&&t>=ct)sfx(nm);}
    applyMusicAt(t);
  },
  setVoice(on){ voiceOn=!!on; if(!on)stopClip(); },
  seek(){ if(!ready)return; stopClip(); },   // music self-heals to the right cue on next update()
  pause(){ if(!ready)return;
    if(lastClip&&lastClip.el&&!lastClip.el.paused){try{lastClip.el.pause();}catch(e){}}
    if(curMusic>=0&&musicEls[curMusic]&&!musicEls[curMusic].el.paused){try{musicEls[curMusic].el.pause();}catch(e){}} },
  resume(){ if(!ready||!enabled)return; try{actx.resume();}catch(e){}
    if(lastClip&&lastClip.el&&lastClip.el.paused&&lastClip.el.currentTime>0&&!lastClip.el.ended)lastClip.el.play().catch(()=>{}); },
  /* console helpers */
  report(){ return clips.map((c,i)=>({line:i+1,file:CLIPS[i],at:c.t,dur:+(c.el&&c.el.duration||0).toFixed(2),rate:c.rate,path:c.g?"graph":"direct"})); },
  musicReport(){ return musicEls.map(m=>({file:m.file,at:m.t,ready:m.el.readyState,dur:+(m.el.duration||0).toFixed(2)||0})); },
  status(){ return {ready,enabled,voiceOn,graph:GRAPH,ctx:actx&&actx.state,master:master?+master.gain.value.toFixed(2):null,clips:clips.length,cues:cues.length,
    music:{cur:curMusic,file:curMusic>=0?musicEls[curMusic].file:null,playing:curMusic>=0&&musicEls[curMusic]?!musicEls[curMusic].el.paused:false,count:musicEls.length,
      level:GRAPH?(musicBus?+musicBus.gain.value.toFixed(2):null):(curMusic>=0&&musicEls[curMusic]?+musicEls[curMusic].el.volume.toFixed(2):null),ducked:ducked},
    now:lastClip?{line:lastClip.line,file:lastClip.file,cur:+(lastClip.el.currentTime||0).toFixed(2),paused:lastClip.el.paused,dur:+(lastClip.el.duration||0).toFixed(2)}:null}; }
};
window.Trax=Trax;
})();
