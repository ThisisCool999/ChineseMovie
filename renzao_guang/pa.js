/* ============================================================
   《人造光》 — 广播稿 / PA loudspeaker script
   ------------------------------------------------------------
   Diegetic facility announcements. This is the voice of the
   institution that structures the donors' day. It drives the
   on-screen 广播 banner, and — when sound is ON — a synthesized
   loudspeaker voice (zh-CN, cold and slow).

   Each line:
     t    absolute time in seconds (matches the shot timeline)
     dur  how long the banner stays up
     text banner HTML (may contain <br>)
     say  plain text spoken aloud (no markup)
   Edit freely; the film reads window.PA_LINES.
   ============================================================ */
window.PA_LINES = [
  /* — morning: establish the hospital, the donors, the harvest — */
  {t:35,  dur:5.5, text:"早安，各位供体。这里是柏林中心医院 · 供体区。",
                    say:"早安，各位供体。这里是柏林中心医院，供体区。"},
  {t:41,  dur:6.5, text:"今日为第 8003 日。今日采集目标：每位 400 毫升。",
                    say:"今日为第八千零三日。今日采集目标，每位四百毫升。"},

  /* — they are sent OUTSIDE to the yard to run (why 秋犯 sees 'outside') — */
  {t:66,  dur:6.5, text:"晨跑时间到。全体供体，前往中央操场，完成八百米。",
                    say:"晨跑时间到。全体供体，前往中央操场，完成八百米。"},
  {t:74,  dur:6,   text:"健康的身体，是承受日课的基础。",
                    say:"健康的身体，是承受日课的基础。"},

  /* — the meal: the 'holiday ration' (the eyeball) — */
  {t:100, dur:7,   text:"午间补给开始。今日为配给日 —— 节日特供，已发放。",
                    say:"午间补给开始。今日为配给日。节日特供，已发放。"},

  /* — day-class = the blood draw, dressed up as salvation — */
  {t:114, dur:6,   text:"日课时间到。请各位供体在采集室外，按编号排队。",
                    say:"日课时间到。请各位供体，在采集室外，按编号排队。"},
  {t:121, dur:6.5, text:"您献出的每一滴，都让世界更接近光明。",
                    say:"您献出的每一滴，都让世界，更接近光明。"},

  /* — THE LOOP: the same morning announcement, a new dome, day one — */
  {t:644, dur:8.5, text:"早安，各位供体。这里是 柏林中心医院 · 供体区。<br/>今日为第 1 日。",
                    say:"早安，各位供体。这里是柏林中心医院，供体区。今日，为第一日。"},
];
