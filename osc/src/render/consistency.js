/**
 * render/consistency.js
 * Exports:
 *  - OSC.render.consistency(canvas, state, elements)
 * Renders consistency/stability panel
 */

(function(OSC) {
  'use strict';

  const { setupHiDPICanvas, getCSS, drawText } = OSC.utils;
  const { clamp } = OSC.utils;
  const { OUTER_PAD } = OSC.config;

  function renderConsistency(canvas, state, elements){
    if (!canvas || !state || !state.flat1m || !state.periods) return;

    const ctx = setupHiDPICanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const pad = OUTER_PAD;
    const closes1m = state.flat1m.flat.map(k => k.c);
    const L = clamp(Math.floor(state.detrendHours*60), 30, closes1m.length);
    const resid1m = OSC.detrend.detrendRollingLinear(closes1m, L);
    const stab = OSC.scan.computePeriodStability(resid1m, state.scanWindow, state.periods);

    const txt = getCSS("--muted");
    const fg = getCSS("--fg");

    if (!stab || !stab.windows || !stab.windows.length){
      drawText(ctx, "Rhythm stability: (no data)", pad, pad + 28, {color:txt, font:"12px system-ui"});
      return;
    }

    const dom = (stab.dominantMin != null) ? OSC.scan.fmtPeriodLabel(stab.dominantMin) : "–";
    const domPct = (stab.dominance != null) ? Math.round(stab.dominance*100) : null;

    // Determine verdict based on agreement and changes
    let verdict = "";
    let verdictColor = txt;
    if (domPct != null && stab.flipCount != null) {
      if (domPct >= 70 && stab.flipCount <= 1) {
        verdict = "🟢 Rhythm is stable over time";
        verdictColor = getCSS("--good");
      } else if (domPct >= 50 && stab.flipCount <= 3) {
        verdict = "🟡 Rhythm appears intermittently";
        verdictColor = getCSS("--warn");
      } else {
        verdict = "🔴 Rhythm is inconsistent";
        verdictColor = getCSS("--bad");
      }
    }

    const line1 = `Most common rhythm: ${dom}  • Agreement: ${domPct!=null?domPct+"%":"–"}  • Changes detected: ${stab.flipCount}`;
    const line2 = `Clarity vs alternatives: ${stab.medRatio!=null?stab.medRatio.toFixed(2)+"×":"–"}  • Typical noise level: ${stab.medVol!=null?stab.medVol.toFixed(2):"–"}`;

    let yOffset = pad + 28;
    if (verdict) {
      drawText(ctx, verdict, pad, yOffset, {color:verdictColor, font:"600 12px system-ui"});
      yOffset += 18;
    }
    drawText(ctx, line1, pad, yOffset, {color:fg, font:"12px system-ui"});
    drawText(ctx, line2, pad, yOffset + 16, {color:txt, font:"11px system-ui"});

    const stripY = yOffset + 32;
    const stripH = 10;
    const cellW = Math.max(6, Math.min(18, Math.floor((w - pad*2) / stab.windows.length)));
    const bg = getCSS("--grid");
    const accent = getCSS("--accent");

    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(pad, stripY, cellW*stab.windows.length, stripH);

    for (let i=0; i<stab.windows.length; i++){
      const win = stab.windows[i];
      const isDom = (stab.dominantMin != null && win.bestMin === stab.dominantMin);
      ctx.fillStyle = isDom ? accent : getCSS("--ghost");
      ctx.fillRect(pad + i*cellW, stripY, cellW-1, stripH);
    }
    ctx.restore();

    drawText(ctx, "Agreement across recent windows →", pad + cellW*stab.windows.length + 6, stripY-1, {color:txt, font:"11px system-ui"});
  }

  OSC.render = OSC.render || {};
  OSC.render.consistency = renderConsistency;

})(window.OSC || (window.OSC = {}));

