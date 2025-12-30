/**
 * render/price.js
 * Exports:
 *  - OSC.render.price(canvas, candlesTf, dayStartsTf, state)
 * Renders price chart with optional detrend overlay
 */

(function(OSC) {
  'use strict';

  const { setupHiDPICanvas, getCSS } = OSC.utils;
  const { clamp } = OSC.utils;
  const { OUTER_PAD, GUTTER_W } = OSC.config;

  function renderPrice(canvas, candlesTf, dayStartsTf, state){
    const ctx = setupHiDPICanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const pad = OUTER_PAD;
    const gutterW = GUTTER_W;
    
    // Match the layout of analysis chart: gutter on left, then plot area
    const innerX = pad + gutterW;
    const innerY = pad;
    const innerW = w - innerX - pad;
    const innerH = h - pad*2;
    const x0 = innerX;  // Start of plot area (after gutter)
    const y0 = pad;

    let lo=Infinity, hi=-Infinity;
    for (const c of candlesTf){ lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }

    let overlay = null;
    if (state.showDetrend){
      const closes1m = state.flat1m.flat.map(k=>k.c);
      const L = clamp(Math.floor(state.detrendHours*60), 30, closes1m.length);
      const resid = OSC.detrend.detrendRollingLinear(closes1m, L);
      const base = OSC.detrend.smaRolling(closes1m, L);
      // Always use 1-minute resolution - no resampling
      overlay = resid.map((v,i)=>v + base[i]);
    }

    const xStep = innerW / Math.max(1, candlesTf.length);
    
    // Store x-axis info for cursor tracking (using innerX to match analysis chart)
    state.priceXAxis = { x0: innerX, innerW, xStep, dataLength: candlesTf.length };
    
    // Draw placeholder box in left gutter
    const gutterX = pad;
    const gutterY = pad;
    const gutterH = h - pad*2;
    ctx.save();
    ctx.fillStyle = getCSS("--panel");
    ctx.fillRect(gutterX, gutterY, gutterW - 16, gutterH);
    ctx.strokeStyle = getCSS("--grid");
    ctx.lineWidth = 1;
    ctx.strokeRect(gutterX, gutterY, gutterW - 16, gutterH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = getCSS("--grid");
    ctx.lineWidth = 1;
    for (let i=0; i<=5; i++){
      const yy = y0 + (innerH*(i/5));
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0+innerW, yy);
      ctx.stroke();
    }
    ctx.restore();

    const yScale = (v)=> y0 + innerH*(1 - (v - lo)/(hi-lo || 1e-9));

    ctx.save();
    ctx.strokeStyle = getCSS("--ghost");
    ctx.lineWidth = 1;
    for (const s of dayStartsTf){
      const xx = x0 + s*xStep;
      ctx.beginPath();
      ctx.moveTo(xx, y0);
      ctx.lineTo(xx, y0+innerH);
      ctx.stroke();
    }
    ctx.restore();

    const up = getCSS("--accent2");
    const down = getCSS("--bad");
    const wick = getCSS("--ghost");

    const bodyW = Math.max(2, xStep*0.65);

    ctx.save();
    for (let i=0; i<candlesTf.length; i++){
      const c = candlesTf[i];
      const x = x0 + i*xStep + xStep*0.5;
      const yO = yScale(c.o);
      const yC = yScale(c.c);
      const yH = yScale(c.h);
      const yL = yScale(c.l);

      ctx.strokeStyle = wick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();

      ctx.fillStyle = (c.c >= c.o) ? up : down;
      const top = Math.min(yO, yC);
      const bot = Math.max(yO, yC);
      ctx.fillRect(x - bodyW/2, top, bodyW, Math.max(1, bot-top));
    }
    ctx.restore();

    if (overlay && overlay.length === candlesTf.length){
      ctx.save();
      ctx.strokeStyle = getCSS("--accent");
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i=0; i<overlay.length; i++){
        const x = x0 + i*xStep + xStep*0.5;
        const y = yScale(overlay[i]);
        if (i===0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw vertical cursor line if mouse is over chart area
    if (state.cursorDataIndex != null && state.cursorDataIndex >= 0 && state.cursorDataIndex < candlesTf.length) {
      const x = x0 + state.cursorDataIndex * xStep + xStep * 0.5;
      if (x >= x0 && x <= x0 + innerW) {
        ctx.save();
        ctx.strokeStyle = getCSS("--good");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + innerH);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  OSC.render = OSC.render || {};
  OSC.render.price = renderPrice;

})(window.OSC || (window.OSC = {}));

