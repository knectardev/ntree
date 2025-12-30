/**
 * render/analysis.js
 * Exports:
 *  - OSC.render.analysis(canvas, state, elements)
 * Renders cleaned signal + rhythm analysis panel
 */

(function(OSC) {
  'use strict';

  const { setupHiDPICanvas, getCSS, drawText, colorWithAlpha, truncateTextToWidth } = OSC.utils;
  const { clamp } = OSC.utils;
  const { OUTER_PAD, GUTTER_W } = OSC.config;

  function drawZeroLine(ctx, rect, yScale){
    const y0 = yScale(0);
    if (!isFinite(y0)) return;
    if (y0 < rect.y || y0 > rect.y + rect.h) return;
    ctx.save();
    ctx.strokeStyle = "rgba(232,238,252,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rect.x, y0 + 0.5);
    ctx.lineTo(rect.x + rect.w, y0 + 0.5);
    ctx.stroke();
    // label once per panel; keep short to avoid pretending this is a unit axis
    drawText(ctx, "Center", rect.x + 6, y0 - 12, {font:"10px system-ui", color:"rgba(232,238,252,0.52)"});
    ctx.restore();
  }

  function drawQualitativeScale(ctx, rect){
    const x = rect.x + rect.w - 6;
    const topY = rect.y + 6;
    const midY = rect.y + rect.h*0.5 - 6;
    const botY = rect.y + rect.h - 16;
    const txt = "rgba(232,238,252,0.42)";
    drawText(ctx, "High motion", x, topY, {font:"10px system-ui", color:txt, align:"right"});
    drawText(ctx, "Moderate", x, midY, {font:"10px system-ui", color:txt, align:"right"});
    drawText(ctx, "Low motion", x, botY, {font:"10px system-ui", color:txt, align:"right"});
  }

  function drawBadge(ctx, text, xRight, yTop, opts={}){
    const padX = opts.padX !== undefined ? opts.padX : 8;
    const padY = opts.padY !== undefined ? opts.padY : 5;
    const r = opts.radius !== undefined ? opts.radius : 10;
    const bg = opts.bg !== undefined ? opts.bg : "rgba(255,255,255,0.03)";
    const border = opts.border !== undefined ? opts.border : "rgba(255,255,255,0.10)";
    const color = opts.color !== undefined ? opts.color : getCSS("--muted");
    const font = opts.font !== undefined ? opts.font : "11px system-ui";

    ctx.save();
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    const wBox = Math.ceil(tw + padX*2);
    const hBox = Math.ceil(11 + padY*2);
    const x = Math.round(xRight - wBox);
    const y = Math.round(yTop);
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // rounded rect
    const rr = Math.min(r, wBox/2, hBox/2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + wBox, y, x + wBox, y + hBox, rr);
    ctx.arcTo(x + wBox, y + hBox, x, y + hBox, rr);
    ctx.arcTo(x, y + hBox, x, y, rr);
    ctx.arcTo(x, y, x + wBox, y, rr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(text, x + padX, y + padY);
    ctx.restore();
  }

  function drawScaleBars(ctx, x, y, w, scores, bestLabel, activeMin, selectedMin, hoverMin, state){
    const rowH = 12;
    const labelW = 34;
    const barH = 7;

    const bg = getCSS("--grid");
    const fill = getCSS("--accent");
    const txt = getCSS("--muted");
    const fg = getCSS("--fg");
    const fillDim = colorWithAlpha(fill, 0.30);

    // Keep canvas text below the DOM chart title area to avoid overlap.
    if (bestLabel){
      ctx.save();
      ctx.font = "11px system-ui";
      ctx.fillStyle = fg;
      const safe = truncateTextToWidth(ctx, bestLabel, Math.max(0, w - 8));
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(safe, x, y);
      ctx.restore();
    }

    const top = y + 18;
    const maxRaw = Math.max(1e-9, ...scores.map(s=>s.raw));

    const hit = [];

    for (let i=0; i<scores.length; i++){
      const s = scores[i];
      const yy = top + i*(rowH);
      const bx = x + labelW;
      const bw = w - labelW - 8;

      const frac = clamp(s.raw / maxRaw, 0, 1);
      const barW = Math.max(0, Math.floor(frac * bw));

      drawText(ctx, s.label, x, yy-1, {font:"11px ui-monospace", color:txt});

      ctx.save();
      ctx.fillStyle = bg;
      ctx.fillRect(bx, yy+2, bw, barH);

      const isActive = (activeMin != null && Number(activeMin) === Number(s.min));
      ctx.fillStyle = isActive ? fill : fillDim;
      if (isActive){
        // Make the active (selected rhythm) bar pop: bright fill + subtle glow.
        ctx.save();
        ctx.shadowColor = colorWithAlpha(fill, 0.85);
        ctx.shadowBlur = 10;
        ctx.fillRect(bx, yy+2, barW, barH);
        ctx.restore();
      } else {
        ctx.fillRect(bx, yy+2, barW, barH);
      }

      if (hoverMin != null && Number(hoverMin) === Number(s.min)){
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.strokeRect(bx-1, yy+1, bw+2, barH+2);
      }
      if (selectedMin != null && Number(selectedMin) === Number(s.min)){
        ctx.strokeStyle = getCSS("--accent2");
        ctx.lineWidth = 2;
        ctx.strokeRect(bx-1, yy+1, bw+2, barH+2);
      }

      ctx.restore();

      hit.push({x:bx, y:yy, w:bw, h:rowH, periodMin:s.min, label:s.label});
    }

    drawText(ctx, "Hover or click a bar to analyze that rhythm", x, top + scores.length*rowH + 6, {font:"11px system-ui", color:txt});

    // Store hitboxes in state
    if (state) {
      state.scanHitboxes = hit;
      state.scanHitboxesAnalysis = hit;
    }

    return hit;
  }

  function renderAnalysis(canvas, state, elements){
    if (!canvas || !state || !state.flat1m) return;

    const ctx = setupHiDPICanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const pad = OUTER_PAD;
    const gutterW = GUTTER_W;

    const innerX = pad + gutterW;
    const innerY = pad;
    const innerW = w - innerX - pad;
    const innerH = h - pad*2;

    const gapY = 10;
    const topH = Math.max(120, Math.floor(innerH * 0.58));
    const botH = Math.max(90, innerH - topH - gapY);

    const residRect = {x:innerX, y:innerY, w:innerW, h:topH};
    const cycleRect = {x:innerX, y:innerY + topH + gapY, w:innerW, h:botH};

    const closes1m = state.flat1m.flat.map(k => k.c);
    const L = clamp(Math.floor(state.detrendHours*60), 30, closes1m.length);
    const resid1m = OSC.detrend.detrendRollingLinear(closes1m, L);

    // Always use 1-minute resolution - no resampling
    const residTf = resid1m;

    const scan = OSC.scan.computeOscillationScanOnResidual(resid1m, state.scanWindow, state.periods);
    state.bestPeriodMin = scan.best ? scan.best.min : null;

    const activePeriodMin = (state.selectedPeriodMin != null) ? state.selectedPeriodMin : state.bestPeriodMin;

    // Always use 1-minute resolution - no resampling
    let cycleTf = new Array(residTf.length).fill(0);
    if (activePeriodMin != null){
      const bp = OSC.scan.bandpassApprox(resid1m, activePeriodMin);
      cycleTf = bp;
    }

    // Compute best-fit sine wave if enabled
    let sineFit = null;
    if (state.showSineFit && activePeriodMin != null) {
      sineFit = OSC.scan.fitSineAtPeriod(resid1m, activePeriodMin, 1);
    }

    // Draw grid
    ctx.save();
    ctx.strokeStyle = getCSS("--grid");
    ctx.lineWidth = 1;
    for (let i=0;i<=4;i++){
      const yy = residRect.y + residRect.h*(i/4);
      ctx.beginPath();
      ctx.moveTo(residRect.x, yy);
      ctx.lineTo(residRect.x+residRect.w, yy);
      ctx.stroke();
    }
    for (let i=0;i<=4;i++){
      const yy = cycleRect.y + cycleRect.h*(i/4);
      ctx.beginPath();
      ctx.moveTo(cycleRect.x, yy);
      ctx.lineTo(cycleRect.x+cycleRect.w, yy);
      ctx.stroke();
    }
    ctx.restore();

    // Draw cleaned signal
    function drawSeries(rect, series, color, options = {}){
      if (!series || !series.length) return {yScale: ()=>0, xStep: 0};
      let lo=Infinity, hi=-Infinity;
      for (const v of series){ lo=Math.min(lo,v); hi=Math.max(hi,v); }
      const padY = 6;
      const yScale = v => rect.y + padY + (rect.h - padY*2) * (1 - (v - lo)/(hi-lo || 1e-9));
      const xStep = rect.w / Math.max(1, series.length);

      // Baseline + semantic vertical guide (no numeric y-axis)
      if (options.showGuides !== false) {
        drawZeroLine(ctx, rect, yScale);
        drawQualitativeScale(ctx, rect);
      }

      // Draw line
      ctx.save();
      const alpha = options.alpha !== undefined ? options.alpha : 1.0;
      const finalColor = (alpha < 1.0) ? colorWithAlpha(color, alpha) : color;
      ctx.strokeStyle = finalColor;
      ctx.lineWidth = options.lineWidth || 2;
      if (options.dashed) {
        ctx.setLineDash([4, 4]);
      }
      ctx.beginPath();
      for (let i=0; i<series.length; i++){
        const x = rect.x + i*xStep + xStep*0.5;
        const y = yScale(series[i]);
        if (i===0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.restore();

      return {yScale, xStep};
    }

    const residScale = drawSeries(residRect, residTf, getCSS("--warn"));
    const cycleColor = (state.selectedPeriodMin != null) ? getCSS("--accent2") : getCSS("--accent");
    const cycleScale = drawSeries(cycleRect, cycleTf, cycleColor);

    // Draw best-fit sine wave overlay if enabled
    if (sineFit && sineFit.fit) {
      const sineColor = getCSS("--accent2");
      drawSeries(cycleRect, sineFit.fit, sineColor, { dashed: true, alpha: 0.6, lineWidth: 1.5, showGuides: false });
    }

    // Optional amplitude cue (badge). Uses noise percentile when available; otherwise uses
    // the variance share proxy from the current window.
    if (scan && scan.best && activePeriodMin != null) {
      const baseline = OSC.baseline ? OSC.baseline.getBaseline() : null;
      let strengthLabel = null;
      
      // Check if baseline is available and matches current settings
      if (baseline && baseline.key && OSC.baseline && OSC.baseline.baselineKey) {
        const currentBaselineKey = OSC.baseline.baselineKey(state);
        if (baseline.key === currentBaselineKey && baseline.bestRaw) {
          const pRaw = OSC.scan.percentileRank(baseline.bestRaw, scan.best.raw);
          if (pRaw != null) {
            strengthLabel = (pRaw >= 85) ? "High" : (pRaw >= 70 ? "Medium" : "Low");
          }
        }
      }
      
      // Fallback to variance share if no baseline
      if (!strengthLabel) {
        const tailN = clamp(Math.floor(Number(state.scanWindow) || 780), 120, resid1m.length);
        const tailResid = resid1m.slice(resid1m.length - tailN);
        const bp = OSC.scan.bandpassApprox(resid1m, activePeriodMin);
        const tailCycle = bp.slice(bp.length - tailN);
        const rR = OSC.scan.rms(tailResid);
        const rC = OSC.scan.rms(tailCycle);
        const share = clamp((rC*rC) / ((rR*rR) + 1e-9), 0, 1);
        const sharePct = Math.round(share * 100);
        strengthLabel = (sharePct >= 40) ? "High" : (sharePct >= 20 ? "Medium" : "Low");
      }
      
      const strengthVar = (strengthLabel === "High") ? "--good" : (strengthLabel === "Medium" ? "--warn" : "--bad");
      const strengthColor = getCSS(strengthVar);
      drawBadge(
        ctx,
        `Variance explained: ${strengthLabel}`,
        residRect.x + residRect.w - 6,
        residRect.y + 6,
        {
          bg: colorWithAlpha(strengthColor, 0.18),
          border: colorWithAlpha(strengthColor, 0.55),
          color: colorWithAlpha(strengthColor, 0.95)
        }
      );
    }

    // Compute stability, insight, and gate decision
    const stab = OSC.scan.computePeriodStability(resid1m, state.scanWindow, state.periods);
    
    // Compute and render insight
    if (OSC.insight && OSC.insight.computeInsight) {
      const baseline = OSC.baseline ? OSC.baseline.getBaseline() : null;
      OSC.insight.computeInsight(scan, stab, resid1m, activePeriodMin, state, elements, baseline);
    }

    // Compute and render gate UI
    if (OSC.gate && OSC.gate.gateDecision && OSC.gate.renderGateUI && elements) {
      const gate = {
        enabled: state.gateEnabled,
        useStability: true,
        minDominance: Number(elements.gateDom && elements.gateDom.value) || 0.6,
        minSeparation: Number(elements.gateSep && elements.gateSep.value) || 1.25,
        requireRange: !!(elements.gateRequireRange && elements.gateRequireRange.checked),
        detrendHoursForSlope: state.detrendHours,
        maxSlopeSigmaPerHr: Number(elements.gateSlope && elements.gateSlope.value) || 0.9,
        suppressHighVol: !!(elements.gateSuppressHighVol && elements.gateSuppressHighVol.checked),
        volMult: Number(elements.gateVol && elements.gateVol.value) || 1.3,
        volWindowMinutes: 120
      };
      const gateRes = OSC.gate.gateDecision(stab, closes1m, resid1m, gate);
      OSC.gate.renderGateUI(state.gateEnabled, gateRes, elements);

      // Draw turning points if enabled
      if (state.showTurns && activePeriodMin != null) {
        const turns = OSC.scan.findTurningPoints(cycleTf, 2);
        const markerColor = gateRes.eligible ? getCSS("--accent") : getCSS("--ghost");
        ctx.save();
        ctx.fillStyle = markerColor;
        for (const t of turns){
          const i = t.i;
          const x = cycleRect.x + i*cycleScale.xStep + cycleScale.xStep*0.5;
          const y = cycleScale.yScale(cycleTf[i]);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.restore();

        const msg = gateRes.eligible ? "Gate: eligible" : `Gate: suppressed (${gateRes.reasons.join(", ")})`;
        drawText(ctx, msg, cycleRect.x, cycleRect.y + cycleRect.h + 6, {font:"11px system-ui", color: gateRes.eligible ? getCSS("--good") : getCSS("--muted")});
      }
    }

    // Store x-axis info for cursor tracking
    state.analysisXAxis = { 
      x0: innerX, 
      innerW, 
      xStep: residScale.xStep, 
      dataLength: residTf.length,
      residRect,
      cycleRect
    };

    // Draw Pattern Finder bars in the left gutter
    if (scan && scan.scores && scan.scores.length) {
      const activeMin = (state.selectedPeriodMin != null) ? state.selectedPeriodMin : state.bestPeriodMin;
      const bestLbl = scan.best ? `Best: ${scan.best.label}` : "Best: –";
      const ratioTxt = (scan.bestRatio != null) ? ` • ${scan.bestRatio.toFixed(2)}×` : "";
      const sel = (state.selectedPeriodMin != null) ? OSC.scan.fmtPeriodLabel(state.selectedPeriodMin) : "Auto";
      const bestLabel = `${bestLbl}${ratioTxt} • Sel: ${sel}`;

      const gutterX = pad;
      const gutterY = pad + 28;
      const gutterBarsW = GUTTER_W - 16;

      drawScaleBars(ctx, gutterX, gutterY, gutterBarsW, scan.scores, bestLabel, activeMin, state.selectedPeriodMin, state.hoverPeriodMin, state);
    }

    // Draw vertical cursor line if mouse is over chart area
    // Use the stored x-axis info to ensure alignment with price chart
    if (state.cursorDataIndex != null && state.cursorDataIndex >= 0 && state.cursorDataIndex < residTf.length) {
      // Use the same xStep calculation as stored in analysisXAxis for consistency
      const xStep = residScale.xStep;
      const x = innerX + state.cursorDataIndex * xStep + xStep * 0.5;
      if (x >= innerX && x <= innerX + innerW) {
        ctx.save();
        ctx.strokeStyle = getCSS("--good");
        ctx.lineWidth = 2;
        // Draw line across both plots in analysis chart
        ctx.beginPath();
        ctx.moveTo(x, residRect.y);
        ctx.lineTo(x, residRect.y + residRect.h);
        ctx.moveTo(x, cycleRect.y);
        ctx.lineTo(x, cycleRect.y + cycleRect.h);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Status text
    drawText(ctx, "Vertical scale normalized to recent window", w - pad, h - pad - 6, 
      {font:"10px system-ui", color:"rgba(232,238,252,0.42)", align:"right", baseline:"bottom"});
  }

  OSC.render = OSC.render || {};
  OSC.render.analysis = renderAnalysis;

})(window.OSC || (window.OSC = {}));
