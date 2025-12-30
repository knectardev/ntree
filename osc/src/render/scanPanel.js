/**
 * render/scanPanel.js
 * Exports:
 *  - OSC.render.scanPanel(canvas, state, elements)
 * Renders Pattern Finder scan panel + bar hitboxes
 */

(function(OSC) {
  'use strict';

  const { setupHiDPICanvas, getCSS, drawText } = OSC.utils;
  const { OUTER_PAD } = OSC.config;

  function renderScanPanel(canvas, state, elements){
    if (!canvas || !state || !state.flat1m || !state.periods) return;

    const ctx = setupHiDPICanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const pad = OUTER_PAD;
    const closes1m = state.flat1m.flat.map(k => k.c);
    const L = Math.max(30, Math.floor(state.detrendHours*60));
    const resid1m = OSC.detrend.detrendRollingLinear(closes1m, L);

    const scan = OSC.scan.computeOscillationScanOnResidual(resid1m, state.scanWindow, state.periods);
    if (!scan || !scan.scores || !scan.scores.length) return;

    const activeMin = (state.selectedPeriodMin != null) ? state.selectedPeriodMin : (scan.best ? scan.best.min : null);
    const bestLbl = scan.best ? `Best: ${scan.best.label}` : "Best: –";
    const ratioTxt = (scan.bestRatio != null) ? ` • ${scan.bestRatio.toFixed(2)}×` : "";
    const sel = (state.selectedPeriodMin != null) ? OSC.scan.fmtPeriodLabel(state.selectedPeriodMin) : "Auto";
    const bestLabel = `${bestLbl}${ratioTxt} • Sel: ${sel}`;

    // Draw label
    if (bestLabel){
      ctx.save();
      ctx.font = "11px system-ui";
      ctx.fillStyle = getCSS("--fg");
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(bestLabel, pad, pad);
      ctx.restore();
    }

    const top = pad + 18;
    const rowH = 12;
    const labelW = 34;
    const barH = 7;
    const maxRaw = Math.max(1e-9, ...scan.scores.map(s=>s.raw));

    const bg = getCSS("--grid");
    const fill = getCSS("--accent");
    const txt = getCSS("--muted");
    const fillDim = OSC.utils.colorWithAlpha(fill, 0.30);

    const hit = [];

    for (let i=0; i<scan.scores.length; i++){
      const s = scan.scores[i];
      const yy = top + i*(rowH);
      const bx = pad + labelW;
      const bw = w - labelW - pad*2;

      const frac = Math.max(0, Math.min(1, s.raw / maxRaw));
      const barW = Math.max(0, Math.floor(frac * bw));

      drawText(ctx, s.label, pad, yy-1, {font:"11px ui-monospace", color:txt});

      ctx.save();
      ctx.fillStyle = bg;
      ctx.fillRect(bx, yy+2, bw, barH);

      const isActive = (activeMin != null && Number(activeMin) === Number(s.min));
      ctx.fillStyle = isActive ? fill : fillDim;
      ctx.fillRect(bx, yy+2, barW, barH);
      ctx.restore();

      hit.push({x:bx, y:yy, w:bw, h:rowH, periodMin:s.min, label:s.label});
    }

    state.scanHitboxes = hit;
    state.scanHitboxesScan = hit;

    drawText(ctx, "Hover or click a bar to analyze that rhythm", pad, top + scan.scores.length*rowH + 6, 
      {font:"11px system-ui", color:txt});
  }

  OSC.render = OSC.render || {};
  OSC.render.scanPanel = renderScanPanel;

})(window.OSC || (window.OSC = {}));
