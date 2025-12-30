/**
 * utils.js
 * Exports:
 *  - OSC.utils (pure helpers; no DOM access)
 */
(function(){
  const OSC = (window.OSC = window.OSC || {});

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function getCSS(varName){
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  function colorWithAlpha(color, alpha){
    const a = Math.max(0, Math.min(1, Number(alpha)));
    const s = String(color || "").trim();
    if (!s) return `rgba(255,255,255,${a})`;

    // rgb()/rgba()
    const m = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (m){
      const r = Math.round(Number(m[1]));
      const g = Math.round(Number(m[2]));
      const b = Math.round(Number(m[3]));
      return `rgba(${r},${g},${b},${a})`;
    }

    // #rgb or #rrggbb
    if (s[0] === "#"){
      const hex = s.slice(1);
      if (hex.length === 3){
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `rgba(${r},${g},${b},${a})`;
      }
      if (hex.length === 6){
        const r = parseInt(hex.slice(0,2), 16);
        const g = parseInt(hex.slice(2,4), 16);
        const b = parseInt(hex.slice(4,6), 16);
        return `rgba(${r},${g},${b},${a})`;
      }
    }

    // Fallback: unknown format; return as-is (alpha can't be applied reliably).
    return s;
  }

  function setupHiDPICanvas(canvas){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return ctx;
  }

  function drawText(ctx, text, x, y, opts={}){
    ctx.save();
    ctx.font = opts.font || "12px system-ui";
    ctx.fillStyle = opts.color || getCSS("--fg");
    ctx.textBaseline = opts.baseline || "top";
    ctx.textAlign = opts.align || "left";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function truncateTextToWidth(ctx, text, maxW){
    const s = String(text || "");
    if (maxW <= 0) return "";
    if (ctx.measureText(s).width <= maxW) return s;
    const ell = "…";
    let lo = 0, hi = s.length;
    while (lo < hi){
      const mid = ((lo + hi + 1) >> 1);
      const t = s.slice(0, mid) + ell;
      if (ctx.measureText(t).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + ell;
  }

  OSC.utils = {
    clamp,
    clamp01,
    getCSS,
    colorWithAlpha,
    setupHiDPICanvas,
    drawText,
    truncateTextToWidth
  };
})();


