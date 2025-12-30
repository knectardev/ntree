/**
 * render/spectrum.js
 * Exports:
 *  - OSC.render.spectrum(canvas, state, elements)
 * Renders Projection Spectrum (diagnostic): histogram + Top-K table
 */

(function(OSC) {
  'use strict';

  const { setupHiDPICanvas, getCSS, drawText, colorWithAlpha } = OSC.utils;
  const { clamp } = OSC.utils;

  function computeFourierCached(state, resid1m){
    const N = resid1m.length;
    const k = Math.max(1, Math.floor(Number(state.fourierK) || 5));
    const periodsKey = `${state.scanMinPeriod}|${state.scanMaxPeriod}|${state.scanStepPeriod}|${state.scanLogSpacing ? 1 : 0}`;
    const fourierKey = `projSpec:v1|N=${N}|win=${Math.floor(Number(state.scanWindow)||0)}|detr=${Number(state.detrendHours||0).toFixed(4)}|K=${k}|grid=${periodsKey}`;

    if (state._fourierCacheKey === fourierKey && state._fourierCacheData) return state._fourierCacheData;
    const f = OSC.scan.computeFourierDecompositionOnResidual(resid1m, state.scanWindow, state.periods, k, 1);
    state._fourierCacheKey = fourierKey;
    state._fourierCacheData = f;
    return f;
  }

  function renderSpectrum(canvas, state, elements){
    if (!canvas || !state || !state.flat1m || !state.periods) return;

    const ctx = setupHiDPICanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    // Compute detrended residual (same as analysis panel)
    const closes1m = state.flat1m.flat.map(k => k.c);
    const L = clamp(Math.floor(state.detrendHours*60), 30, closes1m.length);
    const resid1m = OSC.detrend.detrendRollingLinear(closes1m, L);

    const fourier = computeFourierCached(state, resid1m);
    if (!fourier || !fourier.spectrum || !fourier.spectrum.length) {
      drawText(ctx, "Projection spectrum: –", 10, 10, {font:"12px system-ui", color:getCSS("--muted")});
      return;
    }

    const spec = fourier.spectrum;
    const top = fourier.top || [];
    const cum = fourier.cumExplained || [];

    const pad = 10;
    const plotH = Math.floor(h * 0.64);
    const tableH = h - plotH - pad*2;
    const plotRect = { x: pad, y: pad, w: w - pad*2, h: plotH };
    const tableRect = { x: pad, y: pad + plotH + 6, w: w - pad*2, h: Math.max(0, tableH) };

    // Find max varShare
    let maxV = 1e-9;
    for (let i=0; i<spec.length; i++){
      const v = Number(spec[i].varShare) || 0;
      if (v > maxV) maxV = v;
    }

    // Determine top-N candidates (for "top only" mode)
    const topOnly = !!(elements && elements.spectrumTopOnly && elements.spectrumTopOnly.checked);
    const TOP_N = 20;
    const idxByRank = spec
      .map((s, i)=>({i, v:Number(s.varShare)||0}))
      .sort((a,b)=>b.v-a.v);
    const topIdxSet = new Set(idxByRank.slice(0, Math.min(TOP_N, idxByRank.length)).map(o=>o.i));

    // Title
    drawText(ctx, "Standalone var share by candidate period", plotRect.x, plotRect.y - 2,
      {font:"11px system-ui", color:"rgba(232,238,252,0.70)", baseline:"bottom"});

    // Bars
    const bw = plotRect.w / Math.max(1, spec.length);
    const y0 = plotRect.y + plotRect.h;
    const activeMin = (state.selectedPeriodMin != null) ? state.selectedPeriodMin : state.bestPeriodMin;

    const hit = [];
    for (let i=0; i<spec.length; i++){
      const s = spec[i];
      const frac = clamp((Number(s.varShare)||0) / maxV, 0, 1);
      const bh = Math.floor(frac * plotRect.h);
      const x = plotRect.x + i*bw;
      const barW = Math.max(1, Math.floor(bw - 1));
      const isActive = (activeMin != null && Number(activeMin) === Number(s.min));
      const isTop = topIdxSet.has(i);
      const show = !topOnly || isTop || isActive;

      if (show){
        const fill = isActive ? getCSS("--accent2") : getCSS("--accent");
        const alpha = isActive ? 0.95 : (isTop ? 0.65 : 0.18);
        ctx.fillStyle = colorWithAlpha(fill, alpha);
        ctx.fillRect(x, y0 - bh, barW, bh);
      }

      hit.push({ x, y: plotRect.y, w: bw, h: plotRect.h, periodMin: s.min, label: s.label, varShare: s.varShare, corr: s.corr, idx: i });
    }
    state.spectrumHitboxes = hit;

    // Minimal x-axis tick labels (avoid clutter)
    const tickEvery = Math.max(1, Math.round(spec.length / 8));
    ctx.save();
    ctx.fillStyle = "rgba(232,238,252,0.45)";
    ctx.font = "10px ui-monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (let i=0; i<spec.length; i += tickEvery){
      const x = plotRect.x + i*bw + bw*0.5;
      ctx.fillText(spec[i].label, x, y0 + 4);
    }
    ctx.restore();

    // Table header
    drawText(ctx, "Top components", tableRect.x, tableRect.y,
      {font:"11px system-ui", color:"rgba(232,238,252,0.78)"});
    drawText(ctx, "rank  period  standalone   Δ    cum    r", tableRect.x, tableRect.y + 14,
      {font:"10px ui-monospace", color:"rgba(232,238,252,0.55)"});

    // Table rows
    const maxRows = Math.min(10, top.length);
    let yy = tableRect.y + 30;
    for (let i=0; i<maxRows; i++){
      const t = top[i];
      const standalone = clamp(t.varShare || 0, 0, 1);
      const cumI = (cum && cum[i] != null) ? clamp(cum[i], 0, 1) : null;
      const prev = (i > 0 && cum && cum[i-1] != null) ? clamp(cum[i-1], 0, 1) : 0;
      const delta = (cumI != null) ? clamp(cumI - prev, 0, 1) : null;

      const sPct = Math.round(standalone * 100);
      const dPct = (delta != null) ? Math.round(delta * 100) : null;
      const cPct = (cumI != null) ? Math.round(cumI * 100) : null;
      const r = (t.corr != null && isFinite(t.corr)) ? Number(t.corr) : 0;

      const row = `${String(i+1).padStart(2)}  ${String(t.label).padStart(6)}  ${String(sPct).padStart(3)}%   ${dPct != null ? ("+"+String(dPct).padStart(2)+"%") : "  – "}  ${cPct != null ? String(cPct).padStart(3)+"%" : "  – "}  ${r.toFixed(2)}`;
      drawText(ctx, row, tableRect.x, yy, {font:"10px ui-monospace", color:"rgba(232,238,252,0.72)"});
      yy += 14;
      if (yy > tableRect.y + tableRect.h - 6) break;
    }
  }

  OSC.render = OSC.render || {};
  OSC.render.spectrum = renderSpectrum;

})(window.OSC || (window.OSC = {}));


