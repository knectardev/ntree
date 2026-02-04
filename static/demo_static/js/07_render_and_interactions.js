'use strict';

  function draw(){
    var _drawT0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var rect = canvas.getBoundingClientRect();
    var Wpx = rect.width;
    var Hpx = rect.height;
    var reason = '';
    try{ reason = (state && state._render) ? String(state._render.pendingReason || '') : ''; } catch(_e){ reason = ''; }

    ctx.clearRect(0, 0, Wpx, Hpx);
    ctx.save();
    ctx.fillStyle = 'rgba(15,22,32,0.55)';
    ctx.fillRect(0, 0, Wpx, Hpx);
    ctx.restore();

    var pad = 14;
    // Reserve space for the Y-axis price labels. We render the price axis on the RIGHT side.
    var yAxisW = 50;
    // Reserve space for X-axis tick labels so they don't get clipped at the bottom.
    // Slightly taller to support 2-line day labels (month + day) when zoomed out.
    var xAxisH = 40;
    var plotW = Math.max(1, Wpx - (pad*2 + yAxisW));
    var plotH = Math.max(1, Hpx - pad*2 - xAxisH);
    var plot = { x: pad, y: pad, w: plotW, h: plotH }; // full plot region (price+volume)
    var showVolume = ui.showVolume ? !!ui.showVolume.checked : false;
    var volSep = showVolume ? 8 : 0;
    var volH = 0;
    if(showVolume){
      // Default volume pane ~22% of plot height; clamp for small canvases.
      volH = clamp(Math.floor(plot.h * 0.22), 46, Math.floor(plot.h * 0.35));
      // Ensure we always leave a reasonable price pane (avoid negative heights on small charts).
      var maxVolH = Math.max(0, Math.floor(plot.h - 110));
      if(volH > maxVolH) volH = maxVolH;
    }
    var pricePlotH = Math.max(1, Math.floor(plot.h - (showVolume ? (volH + volSep) : 0)));
    var pricePlot = { x: plot.x, y: plot.y, w: plot.w, h: pricePlotH };
    var volPlot = null;
    if(showVolume && volH > 0){
      volPlot = { x: plot.x, y: pricePlot.y + pricePlot.h + volSep, w: plot.w, h: Math.max(1, plot.h - pricePlot.h - volSep) };
    }

    var bounds = computeYBounds();
    var yMin = bounds.min;
    var yMax = bounds.max;

    // If Auto-scale is disabled, use a slightly looser static range.
    if(!ui.scale.checked){
      var mid0 = (yMin + yMax) / 2;
      var span0 = (yMax - yMin) * 1.35;
      yMin = mid0 - span0/2;
      yMax = mid0 + span0/2;
    }

    // Apply interactive Y scale factor (drag the Y-axis up/down to zoom Y).
    var mid = (yMin + yMax) / 2;
    var span = (yMax - yMin) * clamp(state.yScaleFactor, 0.2, 6);
    if(!Number.isFinite(span) || span <= 0) span = 1;
    yMin = mid - span/2;
    yMax = mid + span/2;

    // Apply vertical panning (price-space). Positive yPan shifts the range up, moving data down.
    var yPan = Number(state.yPan) || 0;
    yMin += yPan;
    yMax += yPan;

    // Cache for mousemove pan scaling (dyPx -> price delta).
    state._lastYSpan = (yMax - yMin);
    // Only the price pane participates in Y pan/zoom interactions.
    state._lastPlotH = pricePlot.h;

    // y labels (aligned to the same "nice" tick positions used by the grid)
    ctx.save();
    ctx.fillStyle = 'rgba(215,224,234,0.85)';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var yTicksInfo = computePriceTicks(yMin, yMax, pricePlot.h, 58);
    var yTicks = (yTicksInfo && yTicksInfo.ticks && yTicksInfo.ticks.length) ? yTicksInfo.ticks : null;
    if(!yTicks){
      // Fallback to legacy fixed-row labels if tick computation fails.
      var rows = 6;
      for(var i=0;i<=rows;i++){
        var tt = i/rows;
        var price = lerp(yMax, yMin, tt);
        var yy = pricePlot.y + pricePlot.h * tt;
        ctx.fillText(price.toFixed(2), pricePlot.x + pricePlot.w + 8, yy);
      }
    } else {
      var dec = decimalsForStep(yTicksInfo.step);
      for(var yi=0; yi<yTicks.length; yi++){
        var p = yTicks[yi];
        var yy = yForPrice(p, pricePlot, yMin, yMax);
        if(!Number.isFinite(yy)) continue;
        ctx.fillText(Number(p).toFixed(dec), pricePlot.x + pricePlot.w + 8, yy);
      }
    }
    ctx.restore();

    var n = state.data.length;
    if(!n){
      // Grid + "No data" message are still clipped to the plot area.
      ctx.save();
      roundRect(ctx, plot.x, plot.y, plot.w, plot.h, 14);
      ctx.clip();
      if(ui.grid.checked && pricePlot.w > 4 && pricePlot.h > 4) drawGrid(pricePlot);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '14px system-ui';
      // Center the message so it doesn't look clipped.
      // If a request is in-flight, prefer "Loading…" over "No data".
      var msg = (ui.regen && ui.regen.disabled) ? 'Loading…' : 'No data';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, plot.x + plot.w/2, plot.y + plot.h/2);
      ctx.restore();
      ctx.restore(); // clip

      // Plot border (always visible)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      roundRect(ctx, plot.x, plot.y, plot.w, plot.h, 14);
      ctx.stroke();
      ctx.restore();
      return;
    }

    var vb = computeVisibleBars(n, state.xZoom);
    var barsVisibleData = vb.barsVisibleData;
    var barsVisible = vb.barsVisibleScale; // used for x mapping (includes replay padding)
    var maxOff = Math.max(0, n - barsVisibleData);
    // Keep the view right-aligned (to real data) when following latest (replay + normal mode).
    // This keeps the "now" head fixed, with the projection padding rendered to the right.
    // EXCEPTION: If audio playback is active, respect its xOffset control.
    var audioPlaying = !!(window.audioState && window.audioState.playing);
    if(state.followLatest && !state.dragging && !state.yDragging && !audioPlaying){
      state.xOffset = maxOff;
    } else if(!audioPlaying && (!Number.isFinite(state.xOffset) || state.xOffset === 0)){
      // Initial load fallback: right-align once (but not during audio playback).
      state.xOffset = maxOff;
    }
    state.xOffset = clamp(state.xOffset, 0, maxOff);

    var start = Math.floor(state.xOffset);
    var end = Math.min(n-1, start + barsVisibleData + 1);

    // --- Base-layer cache for hover/crosshair ---
    // We cache a rendered base canvas without hover overlay, and on mousemove we only blit
    // that cached base + draw the crosshair + axis labels.
    var baseKey = '';
    try{
      var os0 = getOverlaySettings();
      baseKey = [
        Math.floor(Wpx), Math.floor(Hpx),
        n,
        Number(state.data[0] && state.data[0].t) || 0,
        Number(state.data[n-1] && state.data[n-1].t) || 0,
        start, end,
        Math.round(Number(state.xZoom) * 1000) / 1000,
        Math.round(Number(state.xOffset) * 1000) / 1000,
        Math.round(Number(state.yScaleFactor) * 1000) / 1000,
        Math.round(Number(state.yPan) * 1000) / 1000,
        ui.scale && ui.scale.checked ? 1 : 0,
        ui.grid && ui.grid.checked ? 1 : 0,
        ui.showBands && ui.showBands.checked ? 1 : 0,
        ui.showCandles && ui.showCandles.checked ? 1 : 0,
        String(state.candleStyle || ''),
        ui.fills && ui.fills.checked ? 1 : 0,
        ui.smooth && ui.smooth.checked ? 1 : 0,
        ui.outer && ui.outer.checked ? 1 : 0,
        ui.avgline && ui.avgline.checked ? 1 : 0,
        ui.showVolume && ui.showVolume.checked ? 1 : 0,
        ui.toggleDetrend && ui.toggleDetrend.checked ? 1 : 0,
        ui.detrendHours ? (Math.round((Number(ui.detrendHours.value) || 0) * 100) / 100) : 0,
        os0 && os0.ema9 ? 1 : 0,
        os0 && os0.ema21 ? 1 : 0,
        os0 && os0.ema50 ? 1 : 0,
        os0 && os0.ema200 ? 1 : 0,
        os0 && os0.vwap ? 1 : 0,
        String(state.hoverTradeId || 'none') // Include hoverTradeId in cache key
      ].join('|');
    } catch(_eKey){
      baseKey = '';
    }
    try{
      if(state && state._render){
        if(!state._render.baseCanvas) state._render.baseCanvas = document.createElement('canvas');
      }
    } catch(_eBC){}

    function _drawHoverOnly(){
      // Re-use the already computed yMin/yMax/plot/start/end/barsVisible above.
      try{
        if(!(state.hoverIdx >= 0 && state.hoverIdx < n)) return;
        var hi2 = state.hoverIdx;
        var rawHd2 = state.data[hi2];
        if(!rawHd2) return;

        var hx2 = xForIndex(hi2 + 0.5, plot, barsVisible);
        var hy2 = Number(state.hoverY);
        if(!Number.isFinite(hy2)) hy2 = yForPrice(rawHd2.c, pricePlot, yMin, yMax);
        if(!Number.isFinite(hy2)) return;
        hy2 = clamp(hy2, pricePlot.y, pricePlot.y + pricePlot.h);
        var cursorPrice2 = (yMax - ((hy2 - pricePlot.y) / pricePlot.h) * (yMax - yMin));

        // Crosshair inside plot clip (rounded).
        ctx.save();
        var clipInset2 = 1;
        roundRect(ctx, plot.x + clipInset2, plot.y + clipInset2, plot.w - clipInset2*2, plot.h - clipInset2*2, 14 - clipInset2);
        ctx.clip();
        ctx.save();
        // Crosshair width: use ~1 physical pixel (not 1 CSS pixel) so it doesn't look too thick on HiDPI.
        var _dprCH = Math.max(1, window.devicePixelRatio || 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(hx2, plot.y);
        ctx.lineTo(hx2, plot.y + plot.h);
        ctx.moveTo(plot.x, hy2);
        ctx.lineTo(plot.x + plot.w, hy2);
        ctx.stroke();
        ctx.restore();
        ctx.restore(); // clip

        // Axis callouts (same style as main draw).
        var stepForAxis = NaN;
        try{
          var t0a = Number(state.data[start].t);
          var t1a = Number(state.data[end].t);
          if(Number.isFinite(t0a) && Number.isFinite(t1a) && t1a > t0a){
            stepForAxis = chooseTimeStepMs(t1a - t0a, plot.w, 140);
          }
        } catch(_e){}
        var axisBg = 'rgba(120,130,145,0.70)';
        var axisBorder = 'rgba(255,255,255,0.12)';
        var axisText = 'rgba(255,255,255,0.92)';

        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textBaseline = 'middle';

        // Right price axis pill
        var ptxt = Number.isFinite(cursorPrice2) ? cursorPrice2.toFixed(2) : '';
        var pw = ctx.measureText(ptxt).width;
        var ph = 20;
        var pPadX = 10;
        var pBoxW = Math.max(44, pw + pPadX*2);
        var axisLeft = (plot.x + plot.w);
        var axisRight = axisLeft + yAxisW;
        var pInset = 4;
        var targetX = axisLeft + Math.floor((yAxisW - pBoxW) / 2);
        var minX = axisLeft - Math.max(0, (pBoxW - (yAxisW - pInset*2)));
        var maxX = axisRight - pBoxW - pInset;
        var pBoxX = clamp(targetX, minX, maxX);
        var pBoxY = clamp(hy2 - ph/2, pricePlot.y + 3, pricePlot.y + pricePlot.h - ph - 3);
        ctx.fillStyle = axisBg;
        ctx.strokeStyle = axisBorder;
        ctx.lineWidth = 1;
        roundRect(ctx, pBoxX, pBoxY, pBoxW, ph, 8);
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = axisText;
        ctx.textAlign = 'center';
        ctx.fillText(ptxt, pBoxX + pBoxW/2, pBoxY + ph/2);

        // Bottom time/date pill
        var ttxt = formatAxisTimeUtc(rawHd2.t, stepForAxis);
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        var tw = ctx.measureText(ttxt).width;
        var th = 20;
        var tPadX = 10;
        var tBoxW = Math.max(54, tw + tPadX*2);
        var tBoxX = clamp(hx2 - tBoxW/2, plot.x + 3, plot.x + plot.w - tBoxW - 3);
        var tBoxY = plot.y + plot.h + (xAxisH - th) - 4;
        ctx.fillStyle = axisBg;
        ctx.strokeStyle = axisBorder;
        roundRect(ctx, tBoxX, tBoxY, tBoxW, th, 8);
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = axisText;
        ctx.textAlign = 'center';
        ctx.fillText(ttxt, tBoxX + tBoxW/2, tBoxY + th/2);

        // --- Trade Details Tooltip (Inside fast-path) ---
        if (state.hoverTradeId != null) {
          (function drawTradeDetailsTooltip() {
            try {
              var bt = state.backtest || {};
              var evs = (bt && Array.isArray(bt.executionEvents)) ? bt.executionEvents : [];
              var tradeEvs = evs.filter(function(e) { return e.trade_id === state.hoverTradeId; });
              if (!tradeEvs.length) return;

              var entry = tradeEvs.find(function(e) { return e.event === 'entry'; });
              var exit = tradeEvs.find(function(e) { return e.event === 'exit'; });
              if (!entry) return;

              var side = (entry.side || 'long').toUpperCase();
              var entryPx = Number(entry.price);
              var exitPx = exit ? Number(exit.price) : NaN;
              var reason = exit ? (exit.exit_reason || 'exit') : 'open';
              
              var lines = [
                'Trade #' + state.hoverTradeId + ' (' + side + ')',
                'Entry: ' + entryPx.toFixed(2),
              ];
              
              if (exit) {
                lines.push('Exit: ' + exitPx.toFixed(2) + ' (' + reason + ')');
                var ret = (side === 'LONG') ? (exitPx - entryPx) / entryPx : (entryPx - exitPx) / entryPx;
                lines.push('Result: ' + (ret * 100).toFixed(2) + '%');
              } else {
                lines.push('Status: Open');
              }

              ctx.save();
              ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              var pad = 12;
              var lh = 20;
              var maxW = 0;
              for (var i = 0; i < lines.length; i++) {
                var tw = ctx.measureText(lines[i]).width;
                if (tw > maxW) maxW = tw;
              }
              
              var boxW = maxW + pad * 2;
              var boxH = lines.length * lh + pad * 2;
              
              // Position tooltip near the mouse, but avoid clipping
              var tx = hx2 + 20;
              var ty = hy2 - boxH / 2;
              // Wpx/Hpx are available in the draw() scope where _drawHoverOnly is called
              if (tx + boxW > rect.width) tx = hx2 - boxW - 20;
              ty = clamp(ty, 10, rect.height - boxH - 10);

              ctx.shadowColor = 'rgba(0,0,0,0.45)';
              ctx.shadowBlur = 12;
              ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
              ctx.lineWidth = 1;
              roundRect(ctx, tx, ty, boxW, boxH, 10);
              ctx.fill();
              ctx.stroke();
              ctx.shadowBlur = 0;

              for (var j = 0; j < lines.length; j++) {
                var line = lines[j];
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                if (line.indexOf('Result:') === 0) {
                  var isPos = line.indexOf('-') === -1 && line.indexOf('0.00%') === -1;
                  ctx.fillStyle = isPos ? '#4ade80' : '#fb7185';
                }
                ctx.fillText(line, tx + pad, ty + pad + j * lh + lh/2);
              }
              ctx.restore();
            } catch (e) {
              console.warn('Failed to draw trade tooltip', e);
            }
          })();
        }
      } catch(_eHover){}
    }

    try{
      if(reason === 'hover' && baseKey && state && state._render && state._render.baseCanvas && state._render.baseKey === baseKey){
        ctx.drawImage(state._render.baseCanvas, 0, 0, Wpx, Hpx);
        _drawHoverOnly();
        try{ state._render.pendingReason = ''; } catch(_e0){}
        return;
      }
    } catch(_eFast){}

    state.pickables = []; // Reset pickables only on a full redraw
    var hoveredTradeCoords = []; // Shared coordinate list for connector lines

    // Suppress hover rendering during base draw so we can cache it.
    var _savedHoverIdx = state.hoverIdx;
    var _savedHoverX = state.hoverX;
    var _savedHoverY = state.hoverY;
    state.hoverIdx = -1;
    state.hoverX = NaN;
    state.hoverY = NaN;

    // X-axis ticks + labels (adaptive with zoom/span)
    (function drawXAxis(){
      if(end <= start) return;
      var t0 = Number(state.data[start].t);
      var t1 = Number(state.data[end].t);
      if(!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return;

      var tInfo = computeTimeTicksBySpan(t0, t1, plot.w, 140);
      if(!tInfo) return;
      var stepMs = tInfo.stepMs;
      var first = tInfo.first;

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      // Match Y-axis label style (font + fill) for consistency.
      ctx.fillStyle = 'rgba(215,224,234,0.85)';
      ctx.lineWidth = 1;
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      var labelY = plot.y + plot.h + 8;
      // Webull-style zoomed-out axis: show months only; show year instead of "Dec".
      var isMonthMode = stepMs >= 14*24*60*60_000;
      var isDayMode = !isMonthMode && (stepMs >= 24*60*60_000);
      var prevTm = null;
      var lastLabelRight = -1e18;
      var labelPadPx = 6;

      if(isMonthMode){
        // Find the first bar of each visible month in ET.
        var monthStarts = [];
        var prevYm = '';
        for(var bi=start; bi<=end; bi++){
          var bt = Number(state.data[bi] && state.data[bi].t);
          if(!Number.isFinite(bt)) continue;
          var ym = fmtEt(bt, { year:'numeric', month:'2-digit' });
          if(!prevYm || ym !== prevYm){
            monthStarts.push({ idx: bi, t: bt });
            prevYm = ym;
          }
        }

        var mStep = chooseMonthStep(monthStarts.length, plot.w, 140);

        function _monthNumEt(ms){
          var m = fmtEt(ms, { month:'numeric' });
          var n = parseInt(String(m), 10);
          return Number.isFinite(n) ? n : NaN;
        }

        function _shouldShowMonth(mNum, step){
          // Always include December so we can show year labels (Webull pattern).
          if(mNum === 12) return true;
          if(step <= 1) return true;
          if(step === 2) return (mNum % 2 === 0);
          if(step === 3) return (mNum === 4 || mNum === 7 || mNum === 10);
          if(step === 6) return (mNum === 6);
          // step >= 12: only show December (handled above)
          return false;
        }

        for(var mi=0; mi<monthStarts.length; mi++){
          var m0 = monthStarts[mi];
          if(!m0) continue;
          var mNum = _monthNumEt(m0.t);
          if(!Number.isFinite(mNum)) continue;
          if(!_shouldShowMonth(mNum, mStep)) continue;

          var x0 = xForIndex(m0.idx + 0.5, plot, barsVisible);
          if(x0 < plot.x - 2 || x0 > plot.x + plot.w + 2) continue;

          // tick
          ctx.beginPath();
          ctx.moveTo(x0, plot.y + plot.h);
          ctx.lineTo(x0, plot.y + plot.h + 6);
          ctx.stroke();

          var label0 = (mNum === 12) ? fmtEt(m0.t, { year:'numeric' }) : fmtEt(m0.t, { month:'short' });
          if(label0){
            var lw0 = ctx.measureText(label0).width;
            var lleft0 = x0 - (lw0/2) - labelPadPx;
            var lright0 = x0 + (lw0/2) + labelPadPx;
            if(lleft0 >= lastLabelRight){
              ctx.fillText(label0, x0, labelY);
              lastLabelRight = lright0;
            }
          }
        }

        ctx.restore();
        return;
      }

      for(var tm = first; tm <= t1; tm += stepMs){
        var idx = findIndexByTimeMs(state.data, tm);
        if(idx < start) idx = start;
        if(idx > end) idx = end;
        var x = xForIndex(idx + 0.5, plot, barsVisible);
        if(x < plot.x - 2 || x > plot.x + plot.w + 2) continue;

        // tick
        ctx.beginPath();
        ctx.moveTo(x, plot.y + plot.h);
        ctx.lineTo(x, plot.y + plot.h + 6);
        ctx.stroke();

        if(isDayMode){
          var parts = formatDayLabelPartsUtc(tm, prevTm);
          // Month label (top line) only at transitions; day number always.
          var wTop = parts.top ? ctx.measureText(parts.top).width : 0;
          var wBot = parts.bottom ? ctx.measureText(parts.bottom).width : 0;
          var w = Math.max(wTop, wBot);
          var left = x - (w/2) - labelPadPx;
          var right = x + (w/2) + labelPadPx;
          if(left >= lastLabelRight){
            if(parts.top) ctx.fillText(parts.top, x, labelY - 2);
            if(parts.bottom) ctx.fillText(parts.bottom, x, labelY + 12);
            lastLabelRight = right;
          }
        } else {
          var label = formatTimeLabelUtc(tm, stepMs);
          if(label){
            var lw = ctx.measureText(label).width;
            var lleft = x - (lw/2) - labelPadPx;
            var lright = x + (lw/2) + labelPadPx;
            if(lleft >= lastLabelRight){
              ctx.fillText(label, x, labelY);
              lastLabelRight = lright;
            }
          }
        }
        prevTm = tm;
      }
      ctx.restore();
    })();

    // Clip all in-plot rendering (grid + bands + candles + avg + crosshair) to the rounded plot frame.
    // Important: do this AFTER drawing the X-axis labels, because labels live below the plot.
    ctx.save();
    // Inset the clip slightly so antialiased strokes/bars don't paint over the border.
    var clipInset = 1;
    roundRect(ctx, plot.x + clipInset, plot.y + clipInset, plot.w - clipInset*2, plot.h - clipInset*2, 14 - clipInset);
    ctx.clip();

    // Session shading behind everything else (grid/candles/bands/volume).
    drawSessionShading(plot, start, end, barsVisible);

    if(ui.grid.checked && pricePlot.w > 4 && pricePlot.h > 4){
      drawGrid(pricePlot, { yMin: yMin, yMax: yMax, plot: plot, start: start, end: end, barsVisible: barsVisible });
    }

    var showBands = ui.showBands ? !!ui.showBands.checked : true;
    var showCandles = ui.showCandles ? !!ui.showCandles.checked : false;

    // Allow both off: leaves only Avg/BidAsk (if enabled).
    var isBands = showBands;
    var isCandles = showCandles;

    // No-cross mode is the supported/primary band rendering mode for this demo.
    // The control exists for backwards compatibility but is hidden in the UI; keep it forced on
    // so band lines (including High/Low bands) remain stable and continuous.
    if(ui.nocross) ui.nocross.checked = true;
    var useNoCross = true;
    var doFill = !!ui.fills.checked;
    var doSmooth = !!ui.smooth.checked;

    // 'outer' controls: outer bands in Bands view, and wick visibility in Candles view.
    // Important: band fill should be able to render even when band outlines are hidden.
    // So outer-band selection must not depend on `isBands` (the outlines toggle).
    var showOuterBands = !!ui.outer.checked;
    // The "High/Low bands (or wicks)" toggle:
    // - In Bands mode: controls whether we draw the outer high/low envelope.
    // - In Candles mode: controls whether we draw candle wicks.
    var showWicks = !!ui.outer.checked && isCandles;

    var showAvg = !!ui.avgline.checked;
    var showBA = false;

    // colors
    var strokeTop    = 'rgba(80,220,140,0.85)';
    var strokeMiddle = 'rgba(90,150,255,0.85)';
    var strokeLower  = 'rgba(255,110,110,0.85)';

    var strokeMain = 'rgba(255,62,165,0.78)';
    var strokeAlt  = 'rgba(215,224,234,0.52)';
    var strokeHiLo = 'rgba(138,160,181,0.45)';

    // Candle/volume direction colors (shared)
    var upColor = 'rgb(30, 200, 170)';   // teal-green
    var dnColor = 'rgb(235, 65, 120)';   // magenta-red

    // points
    var pts0=[], pts1=[], pts2=[], pts3=[];
    var ptsO=[], ptsC=[], ptsL=[], ptsH=[];
    var ptsAvg=[];
    // Bid/ask data isn't provided by this API demo.
    var ptsBid=[];
    var ptsAsk=[];

    var prevSig = null;
    var candleW = clamp((plot.w / barsVisible) * 0.60, 2, 16);

    // Volume pane (optional): scaled to vMax over the visible bars.
    if(volPlot && volPlot.w > 2 && volPlot.h > 2){
      // Separator line between panes (subtle)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      var sepY = pricePlot.y + pricePlot.h + Math.floor(volSep * 0.5);
      ctx.beginPath();
      ctx.moveTo(plot.x, sepY);
      ctx.lineTo(plot.x + plot.w, sepY);
      ctx.stroke();
      ctx.restore();

      var vMax = 0;
      for(var vi=start; vi<=end; vi++){
        var vd = state.data[vi];
        if(!vd) continue;
        var vv = Number(vd.v);
        if(Number.isFinite(vv) && vv > vMax) vMax = vv;
      }

      if(vMax > 0){
        var vPad = 4;
        var vBottom = volPlot.y + volPlot.h - vPad;
        var vAvail = Math.max(1, volPlot.h - vPad*2);
        var barW = Math.max(1, Math.floor(candleW));
        for(var vbi=start; vbi<=end; vbi++){
          var bd = state.data[vbi];
          if(!bd) continue;
          var v = Number(bd.v);
          if(!Number.isFinite(v) || v <= 0) continue;
          var hpx = (v / vMax) * vAvail;
          if(hpx < 1) hpx = 1;
          var cx = xForIndex(vbi + 0.5, plot, barsVisible);
          var x0 = Math.floor(cx - barW/2);
          var y0 = Math.floor(vBottom - hpx);
          var isUpV = (Number(bd.c) >= Number(bd.o));
          ctx.save();
          // Volume bars: brighter, Webull-like (keep candle colors unchanged).
          ctx.fillStyle = isUpV ? 'rgba(0, 214, 180, 0.88)' : 'rgba(255, 60, 125, 0.88)';
          ctx.fillRect(x0, y0, barW, Math.floor(vBottom - y0));
          ctx.restore();
        }
      }
    }

    for(var bi=start; bi<=end; bi++){
      var d = state.data[bi];
      if(!d) continue;
      var x = xForIndex(bi + 0.5, plot, barsVisible);

      if(useNoCross){
        var vals = [d.o, d.c, d.l, d.h].slice().sort(function(a,b){ return a-b; });
        pts0.push([x, yForPrice(vals[0], pricePlot, yMin, yMax)]);
        pts1.push([x, yForPrice(vals[1], pricePlot, yMin, yMax)]);
        pts2.push([x, yForPrice(vals[2], pricePlot, yMin, yMax)]);
        pts3.push([x, yForPrice(vals[3], pricePlot, yMin, yMax)]);
      } else {
        var sig = orderSig(d);
        if(prevSig !== null && sig !== prevSig){
          ptsO.push([NaN, NaN]);
          ptsC.push([NaN, NaN]);
          ptsL.push([NaN, NaN]);
          ptsH.push([NaN, NaN]);
        }
        ptsO.push([x, yForPrice(d.o, pricePlot, yMin, yMax)]);
        ptsC.push([x, yForPrice(d.c, pricePlot, yMin, yMax)]);
        ptsL.push([x, yForPrice(d.l, pricePlot, yMin, yMax)]);
        ptsH.push([x, yForPrice(d.h, pricePlot, yMin, yMax)]);
        prevSig = sig;
      }

      var avg = (d.o + d.c + d.h + d.l) / 4;
      ptsAvg.push([x, yForPrice(avg, pricePlot, yMin, yMax)]);

      ptsBid.push([NaN, NaN]);
      ptsAsk.push([NaN, NaN]);
    }

    // Band fills (render behind candles for proper layering)
    // Fill bands should be independent from drawing band outlines:
    // - Bands only: outlines only
    // - Bands + Fill: outlines + fill
    // - Fill only: fill only (no outlines)
    if(useNoCross && doFill){
      if(showOuterBands){
        fillBetween(ctx, pts3, pts2, 'rgba(80,220,140,0.18)', doSmooth);
        fillBetween(ctx, pts2, pts1, 'rgba(90,150,255,0.18)', doSmooth);
        fillBetween(ctx, pts1, pts0, 'rgba(255,110,110,0.18)', doSmooth);
      } else {
        fillBetween(ctx, pts2, pts1, 'rgba(90,150,255,0.18)', doSmooth);
      }
    }

    // Candles
    if(isCandles){
      var cdata = (state.candleStyle === 'ha') ? state.ha : state.data;
      if(state.candleStyle === 'ha' && (!Array.isArray(state.ha) || state.ha.length !== state.data.length)){
        state.ha = computeHeikinAshi(state.data);
        cdata = state.ha;
      }
      for(var ci=start; ci<=end; ci++){
        var cd = cdata[ci];
        if(!cd) continue;
        var cx = xForIndex(ci + 0.5, plot, barsVisible);
        var yo = yForPrice(cd.o, pricePlot, yMin, yMax);
        var yc = yForPrice(cd.c, pricePlot, yMin, yMax);
        var yh = yForPrice(cd.h, pricePlot, yMin, yMax);
        var yl = yForPrice(cd.l, pricePlot, yMin, yMax);

        var isUp = (cd.c >= cd.o);
        var bodyColor = isUp ? upColor : dnColor;

        if(showWicks){
          ctx.save();
          ctx.strokeStyle = bodyColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, yh);
          ctx.lineTo(cx, yl);
          ctx.stroke();
          ctx.restore();
        }
        var top = Math.min(yo, yc);
        var bot = Math.max(yo, yc);
        var bh = Math.max(1, bot - top);
        var bx = cx - candleW/2;
        var by = top;

        ctx.save();
        // Ensure candles are fully opaque regardless of any prior drawing.
        ctx.globalAlpha = 1;
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(bx, by, candleW, bh);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Band lines
    if(isBands && useNoCross){
      if(showOuterBands){
        strokePolyline(ctx, pts0, strokeLower, 1.4, doSmooth);
        strokePolyline(ctx, pts1, strokeMiddle, 1.6, doSmooth);
        strokePolyline(ctx, pts2, strokeMiddle, 1.6, doSmooth);
        strokePolyline(ctx, pts3, strokeTop, 1.8, doSmooth);
      } else {
        strokePolyline(ctx, pts1, strokeMiddle, 1.7, doSmooth);
        strokePolyline(ctx, pts2, strokeMiddle, 1.7, doSmooth);
      }
    } else if(isBands) {
      strokePolyline(ctx, ptsO, strokeAlt, 1.25, doSmooth);
      strokePolyline(ctx, ptsC, strokeMain, 1.8, doSmooth);
      strokePolyline(ctx, ptsL, strokeHiLo, 1.0, doSmooth);
      strokePolyline(ctx, ptsH, strokeHiLo, 1.0, doSmooth);
    }

    // Avg line
    if(showAvg){
      // Match the bright UI blue used elsewhere (screenshot).
      strokePolyline(ctx, ptsAvg, 'rgb(0, 162, 255)', 1.15, doSmooth);
    }

    // Detrended overlay (optional): render as a price-space line on the main chart.
    (function drawDetrendOverlay(){
      try{
        if(!(ui && ui.toggleDetrend && ui.toggleDetrend.checked)) return;
        var series = getDetrendOverlaySeries();
        if(!series || series.length !== state.data.length) return;
        var ptsD = [];
        for(var bi=start; bi<=end; bi++){
          var x = xForIndex(bi + 0.5, plot, barsVisible);
          var yv = Number(series[bi]);
          if(!Number.isFinite(yv)){
            ptsD.push([NaN, NaN]);
          } else {
            ptsD.push([x, yForPrice(yv, pricePlot, yMin, yMax)]);
          }
        }
        // Vivid magenta to match the osc demo overlay vibe.
        // osc demo draws a straight polyline (no smoothing). Respect the chart Smooth toggle here.
        strokePolyline(ctx, ptsD, 'rgba(255, 62, 165, 0.92)', 2.0, !!doSmooth);
      } catch(_e){}
    })();

    // De-noised trend overlay (optional): render as a price-space line on the main chart.
    (function drawTrendOverlay(){
      try{
        var td = (typeof getTrendOverlayData === 'function') ? getTrendOverlayData() : null;
        var drewAny = false;
        // Low-pass SMA trend level (cyan)
        if(td && td.yLP && td.yLP.length === state.data.length){
          var ptsLP = [];
          for(var bi=start; bi<=end; bi++){
            var x = xForIndex(bi + 0.5, plot, barsVisible);
            var yv = Number(td.yLP[bi]);
            if(!Number.isFinite(yv)) ptsLP.push([NaN, NaN]);
            else ptsLP.push([x, yForPrice(yv, pricePlot, yMin, yMax)]);
          }
          strokePolyline(ctx, ptsLP, 'rgba(122, 227, 255, 0.92)', 2.2, !!doSmooth);
          drewAny = true;
        }
        // Local linear trend level (gold-ish so both can be seen together)
        if(td && td.yLin && td.yLin.length === state.data.length){
          var ptsLin = [];
          for(var bi2=start; bi2<=end; bi2++){
            var x2 = xForIndex(bi2 + 0.5, plot, barsVisible);
            var yv2 = Number(td.yLin[bi2]);
            if(!Number.isFinite(yv2)) ptsLin.push([NaN, NaN]);
            else ptsLin.push([x2, yForPrice(yv2, pricePlot, yMin, yMax)]);
          }
          strokePolyline(ctx, ptsLin, 'rgba(255, 215, 0, 0.88)', 2.0, !!doSmooth);
          drewAny = true;
        }

        // If local-linear mode is active, show a small slope readout (per hour) in the sidebar.
        try{
          if(ui && ui.trendSlopeLabel){
            if(td && td.slopePerHr && Number.isFinite(td.lastSlopePerHr)){
              ui.trendSlopeLabel.style.display = '';
              ui.trendSlopeLabel.textContent = 'Slope (last): ' + td.lastSlopePerHr.toFixed(4) + ' / hr';
            } else {
              ui.trendSlopeLabel.style.display = 'none';
            }
          }
        } catch(_eLbl){}
      } catch(_e){}
    })();

    // Indicator overlays (EMA/VWAP), aligned 1:1 with state.data.
    (function drawOverlays(){
      try{
        var ovs = state.overlays;
        if(!ovs || !ovs.length) return;
        for(var si=0; si<ovs.length; si++){
          var s = ovs[si];
          if(!s || !Array.isArray(s.y) || s.y.length < 2) continue;
          if (s.key === 'ema_200') console.log('Drawing EMA 200, points:', s.y.length);
          var pts = [];
          for(var bi=start; bi<=end; bi++){
            var x = xForIndex(bi + 0.5, plot, barsVisible);
            var yyv = Number(s.y[bi]);
            if(!Number.isFinite(yyv)){
              pts.push([NaN, NaN]);
            } else {
              pts.push([x, yForPrice(yyv, pricePlot, yMin, yMax)]);
            }
          }
          strokePolyline(ctx, pts, s.color || 'rgba(215,224,234,0.65)', (s.width || 1.25), doSmooth);
        }
      } catch(_e){}
    })();

    // Strategy markers (Entry/Exit)
    (function drawStrategyMarkers(){
      try {
        if (!state.strategies || !state.backtest || !state.backtest.selectedStrategy || state.backtest.selectedStrategy === 'none') return;
        var selected = state.backtest.selectedStrategy;
        var strat = state.strategies[selected];
        if (!strat) return;

        // Strategy-time artifacts (intent):
        var entryArr = strat.entry || strat.long_entry || [];
        var sideArr = strat.side || [];
        var directions = strat.direction || [];
        var longExits = strat.long_exit || [];
        var exitDirections = strat.exit_direction || [];
        var yOverrides = strat.cross_y || [];
        var exitYOverrides = strat.exit_y || [];

        // Backtest-time artifacts: link triangles to trade_ids if available
        var evsByT = {};
        var bt = state.backtest || {};
        var showExec = (
          bt.executionEvents
          && Array.isArray(bt.executionEvents)
          && bt.executionEvents.length
          && String(bt.executionEventsStrategy || '') === String(selected || '')
        );
        if(showExec){
          for(var ei=0; ei<bt.executionEvents.length; ei++){
            var ev = bt.executionEvents[ei] || {};
            var tms = String(Number(ev.t_ms));
            if(!evsByT[tms]) evsByT[tms] = [];
            evsByT[tms].push(ev);
          }
        }
        
        ctx.save();
        // Dim intent markers if a specific execution trade is hovered
        if (state.hoverTradeId != null) {
          ctx.globalAlpha = 0.2;
        }
        
        for(var bi=start; bi<=end; bi++){
          var d = state.data[bi];
          if(!d || d.idx === undefined) continue;
          var fidx = d.idx;
          var tKey = String(Number(d.t));
          var barEvs = evsByT[tKey] || [];
          
          var cx = xForIndex(bi + 0.5, plot, barsVisible);
          var candleRange = Math.abs(d.h - d.l) || 0.01;
          var markerOffset = candleRange * 0.4;

          // Entry intent markers
          if (entryArr[fidx]) {
            // Find a matching entry event from backtest to get trade_id
            var entryEv = barEvs.find(e => e.event === 'entry');
            var tid = entryEv ? entryEv.trade_id : null;
            var isHovered = (state.hoverTradeId != null && tid === state.hoverTradeId);

            ctx.save();
            if (isHovered) ctx.globalAlpha = 1.0;
            
            var side = 1;
            if(sideArr && sideArr.length){
              var sv = Number(sideArr[fidx]);
              if(Number.isFinite(sv)) side = (sv >= 0 ? 1 : -1);
            } else {
              var dir = directions[fidx];
              side = (dir === 'bearish') ? -1 : 1;
            }
            var isShort = side < 0;
            var color = isShort ? '#e74c3c' : '#2ecc71';
            var price = (yOverrides[fidx] != null && !isNaN(yOverrides[fidx])) ? yOverrides[fidx] : (isShort ? d.h : d.l);
            
            var priceY = yForPrice(price, pricePlot, yMin, yMax);
            // Positioning: Long entries below wick, short entries above wick
            var markerY = yForPrice(isShort ? (d.h + markerOffset) : (d.l - markerOffset), pricePlot, yMin, yMax);
            
            var size = isHovered ? 16 : 12;
            
            drawMarkerWithStem(ctx, cx, priceY, markerY, color, size, function(c, x, y, s, clr) {
              drawTriangle(c, x, y, s, clr, isShort); // isShort=true means downward arrow
            });

            if (tid != null) {
              state.pickables.push({ x: cx, y: markerY, trade_id: tid });
              if (isHovered) {
                hoveredTradeCoords.push({ x: cx, y: markerY, trade_id: tid, isEntry: true });
              }
            }
            ctx.restore();
          }

          // Discretionary exit intent markers
          var hasExecHere = barEvs.some(e => e.event === 'exit');
          if (!hasExecHere && longExits[fidx]) {
            var dirE = exitDirections[fidx];
            var exitIsShort = (dirE === 'bearish'); // exiting short position
            var colorE = exitIsShort ? '#e74c3c' : '#2ecc71';
            var priceE = (exitYOverrides[fidx] != null && !isNaN(exitYOverrides[fidx])) ? exitYOverrides[fidx] : (exitIsShort ? d.l : d.h);
            
            var priceYE = yForPrice(priceE, pricePlot, yMin, yMax);
            // Positioning: Long exit above wick, short exit below wick
            var markerYE = yForPrice(exitIsShort ? (d.l - markerOffset) : (d.h + markerOffset), pricePlot, yMin, yMax);
            
            drawMarkerWithStem(ctx, cx, priceYE, markerYE, colorE, 12, function(c, x, y, s, clr) {
              drawTriangle(c, x, y, s, clr, !exitIsShort); // Long exit (isShort=false) => downward ▼
            });
          }
        }
        
        ctx.restore();
      } catch(e) {
        console.warn('Failed to draw strategy markers', e);
      }
    })();

    // Backtest resolution markers (Entry/Stop/TP) — only after execution.
    (function drawExecutionMarkers(){
      try{
        if(!state || !state.backtest) return;
        var bt = state.backtest || {};
        if(bt.showExecutionMarkers === false) return;
        if(!bt.executionEvents || !Array.isArray(bt.executionEvents) || !bt.executionEvents.length) return;
        if(!bt.selectedStrategy || bt.selectedStrategy === 'none') return;
        if(String(bt.executionEventsStrategy || '') !== String(bt.selectedStrategy || '')) return;

        // Hide execution markers if bar size doesn't match the interval used for backtest (prevents misleading overlays).
        (function(){
          try{
            function barSecToInterval(s){
              s = Math.floor(Number(s) || 60);
              if(s <= 60) return '1Min';
              if(s <= 300) return '5Min';
              if(s <= 900) return '15Min';
              if(s <= 3600) return '1h';
              if(s <= 14400) return '4h';
              if(s <= 86400) return '1d';
              return '1Min';
            }
            var curInt = barSecToInterval(state.windowSec || 60);
            if(bt.executionEventsInterval && String(bt.executionEventsInterval) !== String(curInt)){
              // interval mismatch: don't draw
              bt = null;
            }
          } catch(_e){}
        })();
        if(!bt) return;

        // Index events by exact t_ms; current chart bars use `d.t` in epoch ms.
        // We now support multiple events per bar (e.g. entry and exit on same candle).
        var evsByT = {};
        for(var ei=0; ei<bt.executionEvents.length; ei++){
          var ev = bt.executionEvents[ei] || {};
          var tms = Number(ev.t_ms);
          if(!Number.isFinite(tms)) continue;
          if(!evsByT[String(tms)]) evsByT[String(tms)] = [];
          evsByT[String(tms)].push(ev);
        }

        ctx.save();
        
        // Pass 1: Draw markers
        
        for(var bi=start; bi<=end; bi++){
          var d = state.data[bi];
          if(!d) continue;
          var barEvs = evsByT[String(Number(d.t))];
          if(!barEvs || !barEvs.length) continue;

          var cx = xForIndex(bi + 0.5, plot, barsVisible);
          var candleRange = Math.abs(d.h - d.l) || 0.01;
          
          for (var j = 0; j < barEvs.length; j++) {
            var ev2 = barEvs[j];
            var tradeId = ev2.trade_id;
            var isHoveredTrade = (state.hoverTradeId != null && tradeId === state.hoverTradeId);
            
            // Dim others if something is hovered
            ctx.globalAlpha = (state.hoverTradeId == null || isHoveredTrade) ? 1.0 : 0.2;

            var typ = String(ev2.event || '');
            var subTyp = String(ev2.exit_reason || '');
            var isEntry = (typ === 'entry');
            var side = String(ev2.side || 'long');
            var isLong = (side === 'long');
            
            var price = Number(ev2.price);
            var yBase = Number.isFinite(price) ? price : (isEntry ? d.o : d.c);
            var priceY = yForPrice(yBase, pricePlot, yMin, yMax);
            
            // Positioning logic:
            var markerY;
            var size = isHoveredTrade ? 16 : 12;

            if (isEntry) {
              // Standard Entry positioning (matching Strategy Markers)
              var entryOffset = candleRange * 0.45;
              markerY = yForPrice(isLong ? (d.l - entryOffset) : (d.h + entryOffset), pricePlot, yMin, yMax);
              
              drawMarkerWithStem(ctx, cx, priceY, markerY, isLong ? '#2ecc71' : '#e74c3c', size, function(c, x, y, s, clr) {
                drawTriangle(c, x, y, s, clr, !isLong); // !isLong means downward arrow for shorts
              });
            } else {
              var exitOffset = candleRange * 0.55;
              var isTp = (subTyp === 'take_profit');
              
              // Positioning for Exits:
              // TP Long: Above wick
              // TP Short: Below wick
              // SL Long: Below wick
              // SL Short: Above wick
              var aboveWick = (isTp && isLong) || (!isTp && !isLong);
              markerY = yForPrice(aboveWick ? (d.h + exitOffset) : (d.l - exitOffset), pricePlot, yMin, yMax);
              
              drawMarkerWithStem(ctx, cx, priceY, markerY, isTp ? '#2ecc71' : '#e74c3c', size, function(c, x, y, s, clr) {
                if(subTyp === 'stop_loss' || subTyp === 'end_of_data'){
                  drawX(c, x, y, s, clr);
                } else if(isTp){
                  drawDiamond(c, x, y, s, clr);
                } else {
                  drawX(c, x, y, s, '#94a3b8');
                }
              });
            }

            // Register for hit-testing
            state.pickables.push({ x: cx, y: markerY, trade_id: tradeId });

            if (isHoveredTrade) {
              hoveredTradeCoords.push({ x: cx, y: markerY, trade_id: tradeId, isEntry: isEntry });
            }
          }
        }

        ctx.restore();
      } catch(e){
        console.warn('Failed to draw execution markers', e);
      }
    })();

    // Shared connector lines for the hovered trade (drawn on top of markers)
    (function drawTradeConnectors(){
      if (hoveredTradeCoords.length > 1) {
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1.5;
        
        // Find entry (if multiple, use first)
        var entry = hoveredTradeCoords.find(c => c.isEntry);
        if (entry) {
          for (var k = 0; k < hoveredTradeCoords.length; k++) {
            var c = hoveredTradeCoords[k];
            if (c === entry) continue;
            ctx.moveTo(entry.x, entry.y);
            ctx.lineTo(c.x, c.y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    })();

    // Bid/ask dotted lines removed (not present in API data).

    // Hover label
    var hoverData = null;
    if(state.hoverIdx >= 0 && state.hoverIdx < n){
      var hi = state.hoverIdx;
      var rawHd = state.data[hi];
      var showHa = (state.candleStyle === 'ha');
      var hd = rawHd;
      if(showHa){
        if(!Array.isArray(state.ha) || state.ha.length !== state.data.length) state.ha = computeHeikinAshi(state.data);
        if(state.ha[hi]) hd = state.ha[hi];
      }
      var hx = xForIndex(hi + 0.5, plot, barsVisible);
      var hy = Number(state.hoverY);
      if(!Number.isFinite(hy)) hy = yForPrice(hd.c, pricePlot, yMin, yMax);
      hy = clamp(hy, pricePlot.y, pricePlot.y + pricePlot.h);

      // Cursor price derived from mouse Y (crosshair horizontal line).
      var cursorPrice = (yMax - ((hy - pricePlot.y) / pricePlot.h) * (yMax - yMin));

      // Store hover info; draw crosshair inside the clip, tooltip outside the clip.
      hoverData = { hi: hi, rawHd: rawHd, showHa: showHa, hd: hd, hx: hx, hy: hy, cursorPrice: cursorPrice };

      ctx.save();
      // Crosshair lines: vertical snapped to bar time, horizontal follows cursor price.
      var _dprCH2 = Math.max(1, window.devicePixelRatio || 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1 / _dprCH2;
      ctx.beginPath();
      ctx.moveTo(hx, plot.y);
      ctx.lineTo(hx, plot.y + plot.h);
      ctx.moveTo(plot.x, hy);
      ctx.lineTo(plot.x + plot.w, hy);
      ctx.stroke();
      ctx.restore();
    }

    // Audio playhead visualization - FIXED at center, chart scrolls past it
    (function drawAudioPlayhead(){
      try{
        if(!window.audioState || !window.audioState.playing) return;
        
        // Playhead is ALWAYS at a FIXED position: center of the screen (50%)
        // The chart scrolls past it - the playhead never moves
        var FIXED_PLAYHEAD_POSITION = 0.5;
        var playheadX = plot.x + (plot.w * FIXED_PLAYHEAD_POSITION);
        
        if(!Number.isFinite(playheadX)) return;
        
        // Get device pixel ratio for crisp thin lines (like crosshairs)
        var _dprPH = Math.max(1, window.devicePixelRatio || 1);
        
        ctx.save();
        
        // Draw vertical playhead line - THIN like crosshairs, extends to x-axis
        ctx.strokeStyle = 'rgba(255, 50, 150, 0.85)';  // Bright magenta
        ctx.lineWidth = 1 / _dprPH;  // Super thin like crosshairs
        ctx.beginPath();
        ctx.moveTo(playheadX, plot.y);  // Start at top of entire plot
        ctx.lineTo(playheadX, plot.y + plot.h);  // Extend to bottom (x-axis)
        ctx.stroke();
        
        ctx.restore();
      } catch(_ePlayhead){}
    })();

    // Audio note visualization - HORIZONTAL BARS that scroll with chart (like Market Inventions)
    (function drawAudioNotes(){
      try{
        if(!window._audioNoteEvents || !window._audioNoteEvents.length) return;
        if(!window.audioState || !window.audioState.displayNotes) return;
        if(!window.audioState.playing) return;
        
        var now = performance.now();
        var barWidth = plot.w / barsVisible;
        
        // Calculate BPM-aware note width
        // At 60 BPM: 1 bar = 1 second, so durationMs/1000 * barWidth = visual width
        var bpm = (window.audioState && window.audioState._currentBpm) ? window.audioState._currentBpm : 60;
        var msPerBar = 60000 / bpm;  // Milliseconds per bar
        
        ctx.save();
        
        // Draw each note as a horizontal bar
        for(var ni = 0; ni < window._audioNoteEvents.length; ni++){
          var noteEv = window._audioNoteEvents[ni];
          if(!noteEv || noteEv.barIndex === undefined) continue;
          
          // Check if note is within visible range (with some padding)
          if(noteEv.barIndex < start - 5 || noteEv.barIndex > end + 5) continue;
          
          // Calculate X position based on bar index (scrolls with chart)
          var noteX = xForIndex(noteEv.barIndex, plot, barsVisible);
          if(!Number.isFinite(noteX)) continue;
          
          // Calculate note width: duration in ms → bars → pixels
          // noteWidth = (durationMs / msPerBar) * barWidth
          var durationBars = noteEv.durationMs / msPerBar;
          var noteWidth = durationBars * barWidth;
          // Clamp: minimum visible, maximum reasonable
          noteWidth = Math.max(4, Math.min(noteWidth, barWidth * 4));
          
          // Map price to Y coordinate
          var noteY = yForPrice(noteEv.price, pricePlot, yMin, yMax);
          if(!Number.isFinite(noteY)) continue;
          
          // Clamp to plot bounds
          noteY = Math.max(pricePlot.y + 5, Math.min(pricePlot.y + pricePlot.h - 5, noteY));
          
          // Determine if note is "active" (glowing)
          var isActive = now < noteEv.glowUntil;
          var noteHeight = isActive ? 10 : 6;
          
          // Colors: soprano = green, bass = blue
          var baseColor = (noteEv.voice === 'soprano') ? '#7cffc2' : '#7aa7ff';
          var rgbaBase = (noteEv.voice === 'soprano') ? 'rgba(124, 255, 194,' : 'rgba(122, 167, 255,';
          
          if(isActive){
            ctx.shadowColor = baseColor;
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#ffffff';
          } else {
            var age = now - noteEv.time;
            var maxAge = 10000;
            var alpha = Math.max(0.4, 1 - (age / maxAge));
            ctx.shadowBlur = 0;
            ctx.fillStyle = rgbaBase + alpha + ')';
          }
          
          // Draw the horizontal bar
          ctx.fillRect(noteX, noteY - (noteHeight / 2), noteWidth, noteHeight);
          ctx.shadowBlur = 0;
        }
        
        ctx.restore();
        
        // Clean up old events
        var cutoff = now - 10000;
        window._audioNoteEvents = window._audioNoteEvents.filter(function(e){
          return e && e.time > cutoff;
        });
      } catch(_eAudioVis){}
    })();

    // End of plot clip region
    ctx.restore();

    // Crosshair axis callouts (outside the clip so they're never cut off).
    if(hoverData){
      var hi2 = hoverData.hi;
      var rawHd2 = hoverData.rawHd;
      var showHa2 = hoverData.showHa;
      var hd2 = hoverData.hd;
      var hx2 = hoverData.hx;
      var hy2 = hoverData.hy;
      var cursorPrice2 = hoverData.cursorPrice;

      // Axis callouts (Webull-like): right price label + bottom time/date label.
      var stepForAxis = NaN;
      try{
        var t0a = Number(state.data[start].t);
        var t1a = Number(state.data[end].t);
        if(Number.isFinite(t0a) && Number.isFinite(t1a) && t1a > t0a){
          stepForAxis = chooseTimeStepMs(t1a - t0a, plot.w, 140);
        }
      } catch(_e){}

      var axisBg = 'rgba(120,130,145,0.70)';
      var axisBorder = 'rgba(255,255,255,0.12)';
      var axisText = 'rgba(255,255,255,0.92)';

      // Small drop shadow (subtle)
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;

      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textBaseline = 'middle';

      // Right price axis label
      var ptxt = Number.isFinite(cursorPrice2) ? cursorPrice2.toFixed(2) : '';
      var pw = ctx.measureText(ptxt).width;
      var ph = 20;
      var pPadX = 10;
      var pBoxW = Math.max(44, pw + pPadX*2);
      // Place the price pill in the RIGHT axis gutter (Webull-style overlap).
      // If the pill is wider than the gutter, allow it to overlap slightly into the plot.
      var axisLeft = (plot.x + plot.w);
      var axisRight = axisLeft + yAxisW;
      var pInset = 4;
      var targetX = axisLeft + Math.floor((yAxisW - pBoxW) / 2);
      var minX = axisLeft - Math.max(0, (pBoxW - (yAxisW - pInset*2)));
      var maxX = axisRight - pBoxW - pInset;
      var pBoxX = clamp(targetX, minX, maxX);
      var pBoxY = clamp(hy2 - ph/2, pricePlot.y + 3, pricePlot.y + pricePlot.h - ph - 3);
      ctx.fillStyle = axisBg;
      ctx.strokeStyle = axisBorder;
      ctx.lineWidth = 1;
      roundRect(ctx, pBoxX, pBoxY, pBoxW, ph, 8);
      ctx.fill();
      // Crisp edge: no shadow on stroke
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.fillStyle = axisText;
      ctx.textAlign = 'center';
      ctx.fillText(ptxt, pBoxX + pBoxW/2, pBoxY + ph/2);

      // Bottom time/date axis label (in X-axis reserved area)
      var ttxt = formatAxisTimeUtc(rawHd2.t, stepForAxis);
      var tw = ctx.measureText(ttxt).width;
      var th = 20;
      var tPadX = 10;
      var tBoxW = Math.max(54, tw + tPadX*2);
      var tBoxX = clamp(hx2 - tBoxW/2, plot.x + 3, plot.x + plot.w - tBoxW - 3);
      var tBoxY = plot.y + plot.h + (xAxisH - th) - 4;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = axisBg;
      ctx.strokeStyle = axisBorder;
      roundRect(ctx, tBoxX, tBoxY, tBoxW, th, 8);
      ctx.fill();
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.fillStyle = axisText;
      ctx.textAlign = 'center';
      ctx.fillText(ttxt, tBoxX + tBoxW/2, tBoxY + th/2);

      ctx.restore();
    }

    // Position marker pill (replay): show avg entry price + qty on the right axis.
    (function drawPositionAxisPill(){
      try{
        if(!(state && state.replay && state.replay.active && state.replay.lastState)) return;
        var st = state.replay.lastState;
        if(!st || !st.position) return;
        var q = Number(st.position.qty);
        var px = Number(st.position.avg_price);
        if(!Number.isFinite(q) || q === 0) return;
        if(!Number.isFinite(px)) return;

        var sideTag = (q < 0) ? 'S' : 'L';
        // Practice / gameplay UX requirement: color-code side tags.
        // - Longs: blue
        // - Shorts: purple
        var pillFill = (q < 0)
          ? 'rgba(147,51,234,0.92)'  // purple-600-ish
          : 'rgba(59,130,246,0.92)'; // blue-500-ish
        var qAbs = Math.abs(q);
        // Shares are integers in the UI; but we keep it robust for floats.
        var qTxt = (Math.abs(qAbs - Math.round(qAbs)) < 1e-9) ? String(Math.round(qAbs)) : qAbs.toFixed(2);
        // PnL indicator: arrow + signed unrealized PnL in parentheses.
        // Backend provides unrealized_pnl as an approximation from last close; good enough for UI.
        var unreal = Number(st.position.unrealized_pnl);
        var pnlPart = '';
        if(Number.isFinite(unreal)){
          var arrow = (unreal > 0) ? '↑' : ((unreal < 0) ? '↓' : '→');
          var s = (unreal >= 0 ? '+' : '') + unreal.toFixed(2);
          pnlPart = ' ' + arrow + ' (' + s + ')';
        }
        var txt = sideTag + ' ' + px.toFixed(2) + ' × ' + qTxt + pnlPart;

        // Compute Y position from price scale.
        var yy = yForPrice(px, pricePlot, yMin, yMax);
        if(!Number.isFinite(yy)) return;

        // If hover price pill is near this y, offset to avoid overlap.
        if(hoverData){
          var hy2 = Number(hoverData.hy);
          if(Number.isFinite(hy2) && Math.abs(hy2 - yy) < 24){
            yy = yy - 26;
          }
        }

        ctx.save();
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        var ph2 = 20;
        var padX2 = 10;
        var tw2 = ctx.measureText(txt).width;
        var boxW = Math.max(64, tw2 + padX2 * 2);

        var axisLeft2 = (plot.x + plot.w);
        var axisRight2 = axisLeft2 + yAxisW;
        var inset2 = 4;
        var targetX2 = axisLeft2 + Math.floor((yAxisW - boxW) / 2);
        var minX2 = axisLeft2 - Math.max(0, (boxW - (yAxisW - inset2 * 2)));
        var maxX2 = axisRight2 - boxW - inset2;
        var boxX = clamp(targetX2, minX2, maxX2);
        var boxY = clamp(yy - ph2 / 2, pricePlot.y + 3, pricePlot.y + pricePlot.h - ph2 - 3);

        // Side-colored pill
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = pillFill;
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        roundRect(ctx, boxX, boxY, boxW, ph2, 10);
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.fillText(txt, boxX + boxW / 2, boxY + ph2 / 2);
        ctx.restore();
      } catch(_e){}
    })();

    // Optional replay perf overlay: enable with ?replay_debug=1
    (function drawReplayPerfOverlay(){
      try{
        if(!(state && state.replay && state.replay.active && state.replay._debug && state.replay._debug.enabled)) return;
        var d = state.replay._debug;
        function fms(x){ return Number.isFinite(x) ? (Math.round(x) + 'ms') : '—'; }
        function fint(x){ return Number.isFinite(x) ? String(Math.round(x)) : '—'; }
        function lastList(arr, n){
          try{
            if(!Array.isArray(arr) || !arr.length) return '—';
            var m = Math.max(1, Math.floor(Number(n) || 10));
            var from = Math.max(0, arr.length - m);
            var xs = [];
            for(var i=from;i<arr.length;i++){
              var v = Number(arr[i]);
              xs.push(Number.isFinite(v) ? String(Math.round(v)) : '—');
            }
            return xs.join(',');
          } catch(_e){
            return '—';
          }
        }
        var bpm = (ui && ui.practiceSpeed) ? Number(ui.practiceSpeed.value) : NaN;
        var lines = [];
        lines.push('replay_debug');
        lines.push('bpm=' + (Number.isFinite(bpm) ? String(Math.round(bpm)) : '—') + ' target=' + fms(d.targetMs) + ' behind=' + fms(d.behindMs));
      lines.push('fetch=' + fms(d.lastFetchMs) + ' (max ' + fms(d.maxFetchMs) + ')'
        + ' render=' + fms(d.lastRenderMs) + ' (max ' + fms(d.maxRenderMs) + ')'
        + ' draw=' + fms(d.lastDrawMs) + ' (max ' + fms(d.maxDrawMs) + ')'
        + ' step=' + fms(d.lastStepMs) + ' (max ' + fms(d.maxStepMs) + ')'
        + ' behindMax=' + fms(d.maxBehindMs)
        + ' gapMax=' + fms(d.maxGapMs)
      );
        // List view: last durations (helps spot variability instantly)
        lines.push('last_gap_ms=[' + lastList(d._gap, 12) + ']');
        lines.push('last_step_ms=[' + lastList(d._step, 12) + ']');
        lines.push('last_fetch_ms=[' + lastList(d._fetch, 12) + ']');
        try{
          var qn = (state && state.replay && Array.isArray(state.replay._queue)) ? state.replay._queue.length : 0;
          var fs = (state && state.replay) ? (state.replay._fastStats || null) : null;
          var hits = fs ? (Number(fs.hits) || 0) : 0;
          var misses = fs ? (Number(fs.misses) || 0) : 0;
          var mode = fs ? String(fs.lastMode || '') : '';
          lines.push('queue=' + String(qn) + ' fast=' + String(hits) + '/' + String(misses) + ' mode=' + (mode || '—'));
        } catch(_eFsLine){}
        lines.push('n=' + String(state.data ? state.data.length : 0) + ' xOff=' + fint(state.xOffset) + ' zoom=' + (Number.isFinite(state.xZoom) ? state.xZoom.toFixed(2) : '—'));
      try{
        var st = state.replay.lastState || null;
        var endIso = (st && st.clock && st.clock.disp_window) ? String(st.clock.disp_window.end || '') : '';
        if(endIso){
          lines.push('disp_end=' + endIso);
          d.lastDispEnd = endIso;
          d.lastDispEndAt = Date.now();
        }
      } catch(_eClock){}

        ctx.save();
        ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        var pad = 8;
        var lh = 16;
        var w = 0;
        for(var i=0;i<lines.length;i++){
          var tw = ctx.measureText(lines[i]).width;
          if(tw > w) w = tw;
        }
        w = Math.ceil(w + pad*2);
        var h = Math.ceil(lines.length * lh + pad*2);
        var x = plot.x + 10;
        var y = plot.y + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(235,245,255,0.92)';
        for(var j=0;j<lines.length;j++){
          ctx.fillText(lines[j], x + pad, y + pad + j*lh);
        }
        ctx.restore();
      } catch(_e){}
    })();

    // Plot border
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, plot.x, plot.y, plot.w, plot.h, 14);
    ctx.stroke();
    ctx.restore();

    // Cache base layer (without hover overlay) for future hover-only draws.
    try{
      if(state && state._render && state._render.baseCanvas){
        var bc = state._render.baseCanvas;
        if(bc.width !== canvas.width || bc.height !== canvas.height){
          bc.width = canvas.width;
          bc.height = canvas.height;
        }
        var bctx = bc.getContext('2d');
        if(bctx){
          bctx.setTransform(1,0,0,1,0,0);
          bctx.clearRect(0,0,bc.width,bc.height);
          bctx.drawImage(canvas, 0, 0);
          state._render.baseKey = baseKey;
          state._render.baseW = bc.width;
          state._render.baseH = bc.height;
        }
      }
    } catch(_eCache){}

    // Restore hover state and draw hover overlay on top.
    state.hoverIdx = _savedHoverIdx;
    state.hoverX = _savedHoverX;
    state.hoverY = _savedHoverY;
    _drawHoverOnly();
    try{ if(state && state._render) state._render.pendingReason = ''; } catch(_e1){}

    // Record draw cost (after all rendering).
    try{
      if(state && state.replay && state.replay.active && state.replay._debug && state.replay._debug.enabled){
        var _drawT1 = (window.performance && performance.now) ? performance.now() : Date.now();
        var dm = Math.max(0, _drawT1 - _drawT0);
        state.replay._debug.lastDrawMs = dm;
        try{
          state.replay._debug._draw.push(dm);
          while(state.replay._debug._draw.length > (state.replay._debug._N || 60)) state.replay._debug._draw.shift();
          var md = -Infinity;
          for(var kk=0; kk<state.replay._debug._draw.length; kk++){
            var z = Number(state.replay._debug._draw[kk]);
            if(Number.isFinite(z) && z > md) md = z;
          }
          state.replay._debug.maxDrawMs = (md === -Infinity) ? NaN : md;
        } catch(_eArr3){}
      }
    } catch(_eDrawMs){}
  }

  // interaction
  function updateHover(e){
    var r = canvas.getBoundingClientRect();
    var pad = 14;
    var yAxisW = 50;
    var xAxisH = 40;
    var plotW = Math.max(1, r.width - (pad*2 + yAxisW));
    var plotX = pad;
    var plotY = pad;
    var plotH = Math.max(1, r.height - pad*2 - xAxisH);

    var n = state.data.length;
    if(!n) return;

    var vb = computeVisibleBars(n, state.xZoom);
    var barsVisible = vb.barsVisibleScale;
    var x = e.clientX - r.left;
    var y = e.clientY - r.top;

    // Keep hover only when inside the plot area (not in axes).
    if(x < plotX || x > plotX + plotW || y < plotY || y > plotY + plotH){
      state.hoverIdx = -1;
      state.hoverX = NaN;
      state.hoverY = NaN;
      requestDraw('hover');
      return;
    }

    var t = (x - plotX) / plotW;
    var idx = Math.floor(state.xOffset + t * barsVisible);
    state.hoverIdx = clamp(idx, 0, n-1);
    state.hoverX = x;
    state.hoverY = y;

    // Hit-testing for markers (pickables)
    var nearestTradeId = null;
    var minDist = Infinity;
    var hitRadius = 15; // px

    if (state.pickables && state.pickables.length) {
      for (var pi = 0; pi < state.pickables.length; pi++) {
        var p = state.pickables[pi];
        var dx = x - p.x;
        var dy = y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hitRadius && dist < minDist) {
          minDist = dist;
          nearestTradeId = p.trade_id;
        }
      }
    }

    if (state.hoverTradeId !== nearestTradeId) {
      state.hoverTradeId = nearestTradeId;
      // If we found a marker, we don't necessarily want to force a full redraw
      // if it hasn't changed, but crosshairs usually do. 
      // Marker highlighting needs a redraw.
    }

    requestDraw('hover');
  }

  canvas.addEventListener('mousemove', function(e){
    if(state.yDragging){
      var r = canvas.getBoundingClientRect();
      var dyPx = (e.clientY - r.top) - state.dragY0;
      // dy>0 => zoom out (expand span); dy<0 => zoom in
      var f = state.yScale0 * Math.exp(dyPx * 0.006);
      state.yScaleFactor = clamp(f, 0.2, 6);
      requestDraw('pan');
    } else if(state.dragging){
      var r = canvas.getBoundingClientRect();
      var dxPx = (e.clientX - r.left) - state.dragX0;
      var dyPx = (e.clientY - r.top) - state.dragY0;
      var n = state.data.length;
      var vb = computeVisibleBars(n, state.xZoom);
      var barsVisible = vb.barsVisibleScale;
      // Keep in sync with draw(): reserve 50px for the right-side Y-axis gutter.
      var yAxisW = 50;
      var plotW = Math.max(1, r.width - (14*2 + yAxisW));
      var barsPerPx = barsVisible / plotW;
      state.xOffset = state.xOffset0 - dxPx * barsPerPx;
      state.lastDragDx = dxPx;

      // Vertical pan: convert pixel delta to price-space delta using the last computed span.
      var span = Number(state._lastYSpan);
      var ph = Number(state._lastPlotH);
      if(Number.isFinite(span) && span > 0 && Number.isFinite(ph) && ph > 0){
        state.yPan = Number(state.yPan0) + (dyPx / ph) * span;
      }
      requestDraw('pan');
    } else {
      updateHover(e);
    }
  });

  canvas.addEventListener('mouseleave', function(){
    state.hoverIdx = -1;
    state.hoverX = NaN;
    state.hoverY = NaN;
    state.dragging = false;
    state.yDragging = false;
    requestDraw('hover');
  });

  function drawMarkerWithStem(ctx, cx, priceY, markerY, color, size, drawFunc) {
    // 1. Black dot at the actual price point
    ctx.beginPath();
    ctx.fillStyle = '#000000';
    ctx.arc(cx, priceY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. Vertical dashed line connecting dot to marker
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.moveTo(cx, priceY);
    ctx.lineTo(cx, markerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Draw the actual marker shape
    drawFunc(ctx, cx, markerY, size, color);
  }

  function drawTriangle(ctx, x, y, size, color, isDown) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (isDown) {
      // Point down
      ctx.moveTo(x - size/2, y - size/2);
      ctx.lineTo(x + size/2, y - size/2);
      ctx.lineTo(x, y + size/2);
    } else {
      // Point up
      ctx.moveTo(x - size/2, y + size/2);
      ctx.lineTo(x + size/2, y + size/2);
      ctx.lineTo(x, y - size/2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawX(ctx, x, y, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - size/2, y - size/2);
    ctx.lineTo(x + size/2, y + size/2);
    ctx.moveTo(x + size/2, y - size/2);
    ctx.lineTo(x - size/2, y + size/2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDiamond(ctx, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - size/2);
    ctx.lineTo(x + size/2, y);
    ctx.lineTo(x, y + size/2);
    ctx.lineTo(x - size/2, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  canvas.addEventListener('mousedown', function(e){
    var r = canvas.getBoundingClientRect();
    var pad = 14;
    var yAxisW = 50;
    var plotRight = r.width - pad - yAxisW; // plot.x(=pad) + plot.w
    var x = (e.clientX - r.left);
    var y = (e.clientY - r.top);

    // Any mouse interaction implies manual exploration; stop snapping back to latest.
    state.followLatest = false;

    // If user clicks in the Y-axis area (right of plot), start Y-zoom drag.
    if(x > plotRight){
      state.yDragging = true;
      state.dragY0 = y;
      state.yScale0 = state.yScaleFactor;
      return;
    }

    // Otherwise, pan on X.
    state.dragging = true;
    state.dragX0 = x;
    state.dragY0 = y;
    state.xOffset0 = state.xOffset;
    state.yPan0 = Number(state.yPan) || 0;
  });

  canvas.addEventListener('dblclick', function(e){
    var r = canvas.getBoundingClientRect();
    var pad = 14;
    var yAxisW = 50;
    var plotRight = r.width - pad - yAxisW; // right edge of plot area; Y-axis region is x > plotRight
    var x = (e.clientX - r.left);

    if(x > plotRight){
      e.preventDefault();
      e.stopPropagation();
      yAxisAutoFit();
    }
  });
    
  window.addEventListener('mouseup', function(){
    // If user panned into an edge, shift the requested window and refetch to browse history.
    // Older data: drag chart right => dx>0 => xOffset decreases and clamps to 0.
    // Newer data: drag chart left  => dx<0 => xOffset increases and clamps to max.
    try{
      if(!state.dragging) { state.lastDragDx = 0; }
      var dx = Number(state.lastDragDx) || 0;
      var n = state.data.length;
      if(n && Math.abs(dx) > 40){
        var vb = computeVisibleBars(n, state.xZoom);
        var barsVisibleData = vb.barsVisibleData;
        var maxOff = Math.max(0, n - barsVisibleData);
        var atLeft = (state.xOffset <= 0.0001);
        var atRight = (state.xOffset >= maxOff - 0.0001);

        var span = Number(state.viewSpanMs);
        var endMs = Number(state.viewEndMs);
        if(Number.isFinite(span) && span > 0 && Number.isFinite(endMs)){
          var step = Math.max(60*1000, Math.floor(span * 0.7));
          if(atLeft && dx > 0){
            // go older
            state.followLatest = false;
            var newEnd = endMs - step;
            if(Number.isFinite(state.datasetStartMs)){
              newEnd = Math.max(newEnd, state.datasetStartMs + span);
            }
            if(newEnd !== endMs){
              state.viewEndMs = newEnd;
              loadFromAPI();
            }
          } else if(atRight && dx < 0){
            // go newer
            var newEnd2 = endMs + step;
            if(Number.isFinite(state.datasetEndMs)){
              newEnd2 = Math.min(newEnd2, state.datasetEndMs);
              if(newEnd2 === state.datasetEndMs) state.followLatest = true;
            } else {
              state.followLatest = false;
            }
            if(newEnd2 !== endMs){
              state.viewEndMs = newEnd2;
              loadFromAPI();
            }
          }
        }
      }
    } catch(_e){
      // ignore pan-to-fetch failures
    }
    state.dragging = false;
    state.yDragging = false;
    state.lastDragDx = 0;
  });

  canvas.addEventListener('wheel', function(e){
    e.preventDefault();
    // Zooming is manual exploration; stop snapping back to latest.
    state.followLatest = false;
    var n = state.data.length;
    if(!n) return;

    var zoomFactor = Math.exp(-e.deltaY * 0.0015);
    var oldZoom = state.xZoom;
    // Allow deep zoom-in; bar size minimum stays at 1m.
    var newZoom = clamp(oldZoom * zoomFactor, 1, 256);

    var r = canvas.getBoundingClientRect();
    var pad = 14;
    var yAxisW = 50;
    var plotX = pad;
    var plotW = Math.max(1, r.width - (pad*2 + yAxisW));
    var mouseX = (e.clientX - r.left);
    var tt = clamp((mouseX - plotX) / plotW, 0, 1);

    var vbOld = computeVisibleBars(n, oldZoom);
    var vbNew = computeVisibleBars(n, newZoom);
    var oldBarsVisible = vbOld.barsVisibleScale;
    var newBarsVisible = vbNew.barsVisibleScale;

    // Anchor in data-index space (clamp to real bars to avoid "anchoring" into future padding).
    var anchorBar = clamp(state.xOffset + tt * oldBarsVisible, 0, Math.max(0, n - 1));
    state.xZoom = newZoom;
    state.xOffset = anchorBar - tt * newBarsVisible;

    draw();
    // Update the selector immediately (UI-only) based on what the user now sees.
    try{ syncSpanPresetFromNavigation({ skipSave: true, skipUrl: true }); } catch(_e){}

    // If user zooms out to the point where we would show (nearly) all loaded bars, expand the
    // requested window span and refetch more history so zoom-out keeps working.
    try{
      // Important: when already clamped at xZoom==1, further zoom-out attempts won't change zoom.
      // Detect that via wheel direction (deltaY>0) and expand span repeatedly.
      var tryingZoomOut = (e && Number(e.deltaY) > 0);
      var atMinZoom = (oldZoom <= 1.01 && newZoom <= 1.01);
      var shouldExpand = (tryingZoomOut && atMinZoom) || (newZoom <= 1.01 && oldZoom > newZoom);
      if(shouldExpand && Number.isFinite(state.datasetStartMs) && Number.isFinite(state.datasetEndMs) && Number.isFinite(state.viewSpanMs) && Number.isFinite(state.viewEndMs)){
        var fullSpan = Math.max(60*1000, Number(state.datasetEndMs) - Number(state.datasetStartMs));
        var curSpan = clamp(Number(state.viewSpanMs), 60*1000, fullSpan);
        if(curSpan < fullSpan - 60*1000){
          // Manual zoom implies exploration; don't follow latest.
          state.followLatest = false;
          // Jump faster to reduce the number of expensive /window scans needed to reach full history.
          var monthMs = 30 * 24 * 60 * 60 * 1000;
          var nextSpan = (curSpan >= monthMs) ? fullSpan : Math.floor(curSpan * 4.0);
          state.viewSpanMs = Math.min(fullSpan, Math.max(curSpan + 60*1000, nextSpan));
          syncSpanPresetFromNavigation();
          if(windowTimer) clearTimeout(windowTimer);
          windowTimer = setTimeout(function(){ loadFromAPI(); }, 90);
        }
      }
    } catch(_e){}

    // Debounce persistence (URL + localStorage) so we don't spam while wheel-scrolling.
    try{
      if(state._spanPresetCommitTimer) clearTimeout(state._spanPresetCommitTimer);
      state._spanPresetCommitTimer = setTimeout(function(){
        try{ syncSpanPresetFromNavigation({ skipSave: false, skipUrl: false }); } catch(_e2){}
      }, 220);
    } catch(_e3){}

    // Auto W recompute on zoom: if the recommended bar size changes, refetch.
    try{
      if(ui.autoW && ui.autoW.checked && Number.isFinite(state.viewSpanMs) && state.viewSpanMs > 0){
        var vis = getVisibleSpanMs(state.viewSpanMs);
        var effMaxBars = (getQueryParam('max_bars','') !== '' ? getQueryParam('max_bars','') : (getQueryParam('limit','') !== '' ? getQueryParam('limit','') : '5000'));
        var rec = recommendBarSecForVisibleSpan(vis, effMaxBars);
        rec = snapToPreset(rec);
        if(Math.floor(rec) !== Math.floor(state.windowSec)){
          state.windowSec = rec;
          if(ui.window) ui.window.value = String(rec);
          if(ui.windowVal) ui.windowVal.textContent = formatWindow(rec);
          syncBarPresetUi();
          updateUrlBarSize();
          if(windowTimer) clearTimeout(windowTimer);
          windowTimer = setTimeout(function(){ loadFromAPI(); }, 90);
        }
      }
    } catch(_e){}
  }, { passive:false });

  var windowTimer = null;
  function updateUrlBarSize(){
    try{
      var u = new URL(window.location.href);
      u.searchParams.set('bar_s', String(Math.floor(state.windowSec)));
      // Time scale preset (requested span).
      if(state && state.spanPreset) u.searchParams.set('span', String(state.spanPreset));
      if(ui.autoW && ui.autoW.checked) u.searchParams.set('auto_w', '1');
      else u.searchParams.delete('auto_w');
      u.searchParams.set('max_bars', String(Math.floor(Number(getQueryParam('max_bars','') || '5000') || 5000)));
      // Legacy param: keep reading it on load, but don't keep emitting it.
      u.searchParams.delete('w');
      window.history.replaceState(null, '', u.toString());
    } catch(e){
      // Ignore URL update failures (e.g., very old browsers / unusual environments).
    }
  }

  function setWindowSecFromUI(fromSlider){
    // If the user touches the bar size slider, treat that as a manual override and disable Auto W.
    enforceAlwaysOnOptions();
    // Any direct interaction implies the user is exploring history; stop snapping back to latest.
    if(fromSlider) state.followLatest = false;
    if(fromSlider && ui.autoW) ui.autoW.checked = false;
    var w = Number(ui.window.value);
    // App is always in snapped mode: bar size is restricted to preset increments.
    w = snapToPreset(w);
    state.windowSec = clamp(w, 60, 86400);

    ui.windowVal.textContent = formatWindow(state.windowSec);
    ui.window.value = String(state.windowSec);
    syncBarPresetUi();

    updateUrlBarSize();
    scheduleSaveUiConfig();

    // Replay mode: bar size (W) is governed by the replay display clock (disp_tf_sec) and
    // the frontend intentionally re-syncs `state.windowSec` from server state every step.
    // That makes bar-size changes appear "ignored" during an active replay session.
    // UX improvement: changing bar size while replay is active will restart replay using the new disp_tf_sec.
    try{
      if(state && state.replay && state.replay.active){
        // Preserve whether the user was playing so we can auto-resume.
        var wasPlaying = !!state.replay.playing;
        _setPracticeStatus('Restarting replay with new bar size…');
        // Start a brand-new session using current UI settings (including state.windowSec as disp_tf_sec).
        // This is the simplest way to "change resolution" in replay without introducing mid-session resampling.
        replayStart({ autoPlay: wasPlaying, preserveUi: true });
        return;
      }
    } catch(_eReplayW){}

    if(windowTimer) clearTimeout(windowTimer);
    windowTimer = setTimeout(function(){ loadFromAPI(); }, 120);
  }

  if(ui.autoW) ui.autoW.addEventListener('change', function(){ setWindowSecFromUI(false); });
  // Bar size radios (footer).
  (function bindBarPresetRadios(){
    try{
      var els = document.querySelectorAll('input[type="radio"][name="windowPreset"]');
      for(var i=0;i<els.length;i++){
        (function(el){
          if(!el) return;
          el.addEventListener('change', function(){
            try{
              if(!el.checked) return;
              if(ui.window) ui.window.value = String(el.value);
              setWindowSecFromUI(true);
            } catch(_e){}
          });
        })(els[i]);
      }
      syncBarPresetUi();
    } catch(_e){}
  })();
  // Scale preset radios (footer).
  (function bindSpanPresetRadios(){
    try{
      var els = document.querySelectorAll('input[type="radio"][name="spanPreset"]');
      for(var i=0;i<els.length;i++){
        (function(el){
          if(!el) return;
          el.addEventListener('change', function(){
            try{
              if(!el.checked) return;
              setSpanPreset(el.value, { skipLoad: false, skipSave: false, skipUrl: false });
            } catch(_e){}
          });
        })(els[i]);
      }
      syncSpanPresetUi();
    } catch(_e){}
  })();
  // Candle style dropdown interactions
  if(ui.candleStyleBtn){
    ui.candleStyleBtn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      toggleCandleStyleMenu();
    });
  }
  if(ui.candleStyleMenu){
    ui.candleStyleMenu.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.getAttribute) return;
      var v = t.getAttribute('data-value');
      if(!v) return;
      setCandleStyle(v);
      closeCandleStyleMenu();
      scheduleSaveUiConfig();
      draw();
    });
  }
  document.addEventListener('click', function(e){
    // Close any open dropdown when clicking outside.
    if(ui.tickerDD && ui.tickerDD.classList.contains('open')){
      if(!(e && e.target && ui.tickerDD.contains(e.target))) closeTickerMenu();
    }
    if(ui.symbolDD && ui.symbolDD.classList.contains('open')){
      if(!(e && e.target && ui.symbolDD.contains(e.target))) closeSymbolMenu();
    }
    if(ui.candleStyleDD && ui.candleStyleDD.classList.contains('open')){
      if(!(e && e.target && ui.candleStyleDD.contains(e.target))) closeCandleStyleMenu();
    }
  });
  document.addEventListener('keydown', function(e){
    if(e && e.key === 'Escape'){
      closeTickerMenu();
      closeSymbolMenu();
      closeCandleStyleMenu();
    }
  });
  // (goLive removed)

  function onToggleDraw(){
    draw();
    scheduleSaveUiConfig();
  }

  // Trend overlay UX (spaghetti prevention): only allow ONE trend overlay at a time.
  function onTrendToggleChanged(e){
    try{
      var tgt = e && e.target ? e.target : null;
      if(tgt === ui.toggleTrendLP && ui.toggleTrendLP && ui.toggleTrendLP.checked){
        if(ui.toggleTrendLin) ui.toggleTrendLin.checked = false;
      } else if(tgt === ui.toggleTrendLin && ui.toggleTrendLin && ui.toggleTrendLin.checked){
        if(ui.toggleTrendLP) ui.toggleTrendLP.checked = false;
      }
    } catch(_e){}
    onToggleDraw();
  }

  function onSessionFilterChanged(e){
    // Use TradingView-style filtering: remove off-hours bars from the rendered dataset.
    // Guard: never allow all sessions to be disabled (otherwise the chart becomes empty/blank).
    try{
      var pre = ui.sessPreMarket ? !!ui.sessPreMarket.checked : true;
      var after = ui.sessAfterHours ? !!ui.sessAfterHours.checked : true;
      var closed = ui.sessClosed ? !!ui.sessClosed.checked : true;
      if(!pre && !after && !closed){
        // Re-enable the one the user just tried to turn off.
        if(e && e.target && typeof e.target.checked === 'boolean') e.target.checked = true;
      }
    } catch(_e){}
    applySessionFilter({ skipSave: false, skipDraw: false });
  }

  // Debug helper
  window.debugOverlays = function() {
    console.log('--- Overlay Debug ---');
    console.log('Overlay Settings:', getOverlaySettings());
    console.log('state.data.length:', state.data ? state.data.length : 0);
    console.log('state.dataFull.length:', state.dataFull ? state.dataFull.length : 0);
    console.log('state.overlays:', state.overlays);
    if (state.overlays && state.overlays.length) {
      state.overlays.forEach(o => {
        var nonNull = 0;
        if (o.y) {
           for(var i=0; i<o.y.length; i++) if(!isNaN(o.y[i])) nonNull++;
        }
        console.log(`- ${o.label}: ${o.y ? o.y.length : 0} points, ${nonNull} non-NaN`);
      });
    }
    console.log('--- End Debug ---');
  };

  function recomputeOverlaysFromState(){
    // Use applySessionFilter to recompute overlays correctly (using FULL data history)
    // while preserving the current session filters.
    applySessionFilter({ skipSave: true, skipDraw: true });
  }

  async function onOverlayToggleChanged(){
    // EMA toggles can recompute locally; VWAP prefers a refetch (non-replay) so we can preload to session start.
    scheduleSaveUiConfig();
    async function apply(){
      var s = getOverlaySettings();
      if(s && s.vwap && !STATIC_MODE && !(state && state.replay && state.replay.active)){
        await loadFromAPI();
        return;
      }
      recomputeOverlaysFromState();
      draw();
    }
    try{
      // During gameplay, briefly pause stepping while we recompute overlays to avoid mid-frame clobbering.
      if(state && state.replay && state.replay.active){
        return await withReplayPaused(apply);
      }
      return await apply();
    } catch(_e){
      draw();
    }
  }
  ui.grid.addEventListener('change', onToggleDraw);
  ui.scale.addEventListener('change', onToggleDraw);
  ui.nocross.addEventListener('change', onToggleDraw);
  ui.fills.addEventListener('change', onToggleDraw);
  ui.smooth.addEventListener('change', onToggleDraw);
  ui.outer.addEventListener('change', onToggleDraw);
  ui.avgline.addEventListener('change', onToggleDraw);
  if(ui.toggleDetrend) ui.toggleDetrend.addEventListener('change', onToggleDraw);
  if(ui.toggleTrendLP) ui.toggleTrendLP.addEventListener('change', onTrendToggleChanged);
  if(ui.toggleTrendLin) ui.toggleTrendLin.addEventListener('change', onTrendToggleChanged);
  if(ui.indEma9) ui.indEma9.addEventListener('change', onOverlayToggleChanged);
  if(ui.indEma21) ui.indEma21.addEventListener('change', onOverlayToggleChanged);
  if(ui.indEma50) ui.indEma50.addEventListener('change', onOverlayToggleChanged);
  if(ui.indEma200) ui.indEma200.addEventListener('change', onOverlayToggleChanged);
  if(ui.indVwap) ui.indVwap.addEventListener('change', onOverlayToggleChanged);
  // Candle bias removed.
  if(ui.showBands) ui.showBands.addEventListener('change', onToggleDraw);
  if(ui.showVolume) ui.showVolume.addEventListener('change', onToggleDraw);
  if(ui.sessPreMarket) ui.sessPreMarket.addEventListener('change', onSessionFilterChanged);
  if(ui.sessAfterHours) ui.sessAfterHours.addEventListener('change', onSessionFilterChanged);
  if(ui.sessClosed) ui.sessClosed.addEventListener('change', onSessionFilterChanged);
  if(ui.showCandles) ui.showCandles.addEventListener('change', function(){
    syncCandleStyleEnabled();
    onToggleDraw();
  });

  // Practice / Play Mode (replay / practice-field).
  // Contract: see notes.txt (server returns {state, delta} and state is authoritative).
  function _setPracticeStatus(txt){
    try{
      if(!ui.practiceStatus) return;
      var t = String(txt || '');
      ui.practiceStatus.textContent = t;
      // Auto-hide when empty; only show errors / important messages.
      ui.practiceStatus.style.display = t ? '' : 'none';
    } catch(_e){}
  }
  function _practiceSpeedBpm(){
    try{
      var v = ui.practiceSpeed ? Number(ui.practiceSpeed.value) : NaN;
      if(!Number.isFinite(v) || v <= 0) v = 100;
      return clamp(Math.floor(v), 30, 150);
    } catch(_e){
      return 60;
    }
  }

  function _syncPracticeSpeedLabel(){
    try{
      if(!ui.practiceSpeedLabel) return;
      ui.practiceSpeedLabel.textContent = String(_practiceSpeedBpm());
    } catch(_e){}
  }

  function _setPracticeUiStateActive(active){
    // Two UI states:
    // - idle: show Play only
    // - active: show Pause + Reset only
    try{
      if(ui.practiceBtn) ui.practiceBtn.style.display = active ? 'none' : '';
      if(ui.practicePauseBtn) ui.practicePauseBtn.style.display = active ? '' : 'none';
      if(ui.practiceResetBtn) ui.practiceResetBtn.style.display = active ? '' : 'none';
    } catch(_e){}
    // While replay is active, lock time-scale UI to 1M to match simulator requirements.
    try{
      updateSpanPresetAvailability();
      syncSpanPresetUi();
    } catch(_e2){}
  }

  function _syncPracticePauseBtn(){
    // When a session is active:
    // - if playing: show "Pause"
    // - if paused:  show "Resume"
    try{
      if(!ui.practicePauseBtn) return;
      var playing = !!(state && state.replay && state.replay.playing);
      var lbl = ui.practicePauseBtn.querySelector('.practiceCtl__label');
      if(lbl) lbl.textContent = playing ? 'Pause' : 'Resume';
      ui.practicePauseBtn.title = playing ? 'Pause replay' : 'Resume replay';
      // Swap icon between pause and play for clarity.
      var icon = ui.practicePauseBtn.querySelector('.practiceCtl__icon');
      if(icon){
        icon.classList.toggle('practiceCtl__icon--pause', playing);
        icon.classList.toggle('practiceCtl__icon--play', !playing);
      }
    } catch(_e){}
  }

  function _stopReplayTimer(){
    // Pause stepping without ending the server session.
    try{
      if(state && state.replay){
        // Cancel any scheduled tick (supports both interval + timeout handles).
        try{ if(state.replay.timer) clearInterval(state.replay.timer); } catch(_e0){}
        try{ if(state.replay.timer) clearTimeout(state.replay.timer); } catch(_e1){}
        state.replay.timer = null;
        state.replay.playing = false;
        // Stop any RAF-driven playback loop.
        try{
          if(state.replay._rafId){
            cancelAnimationFrame(state.replay._rafId);
            state.replay._rafId = null;
          }
          state.replay._rafLastTs = 0;
          state.replay._rafAcc = 0;
        } catch(_eRaf){}
        // Clear any buffered states and in-flight prefetch flag.
        try{
          state.replay._queue = [];
          state.replay._prefetchInFlight = false;
          state.replay._needsDraw = false;
        } catch(_eQ){}
        // Cancel any in-progress loop scheduling; in-flight network calls will finish naturally.
        state.replay._loopToken = (Number(state.replay._loopToken) || 0) + 1;
      }
    } catch(_e){}
    _syncPracticePauseBtn();
  }

  function _startReplayLoop(intervalMs){
    // Buffered replay loop:
    // - Prefetch a batch of N future states from the server (single-flight)
    // - Consume them locally at an even cadence (RAF-driven), so network jitter doesn't change step timing
    if(!state || !state.replay) return;
    if(!state.replay.active || !state.replay.sessionId) return;

    // Stop any prior playback.
    _stopReplayTimer();

    state.replay.playing = true;
    state.replay._stepFailCount = 0;
    state.replay._loopToken = (Number(state.replay._loopToken) || 0) + 1;
    state.replay._queue = [];
    state.replay._prefetchInFlight = false;
    state.replay._rafLastTs = 0;
    state.replay._rafAcc = 0;
    state.replay._needsDraw = true;
    state.replay._lastUiUpdateAt = 0;
    _syncPracticePauseBtn();

    // Update debug targetMs (best-effort).
    try{
      if(state.replay._debug && state.replay._debug.enabled){
        // Prefer bpm-derived cadence, but keep intervalMs as a fallback.
        var bpm0 = _practiceSpeedBpm();
        var ms0 = Math.max(80, Math.floor(60000 / bpm0));
        var ms1 = Math.max(80, Math.floor(Number(intervalMs) || ms0));
        state.replay._debug.targetMs = ms1;
      }
    } catch(_eDbg0){}

    // Kick initial prefetch and start RAF loop.
    _replayMaybePrefetch(true);
    _replayStartRafLoop();
  }

  function _replayMsPerStep(){
    var bpm = _practiceSpeedBpm();
    return Math.max(80, Math.floor(60000 / bpm));
  }

  function _replayQueueLen(){
    try{ return (state && state.replay && Array.isArray(state.replay._queue)) ? state.replay._queue.length : 0; } catch(_e){ return 0; }
  }

  function _replayMaybePrefetch(force){
    try{
      if(!state || !state.replay) return;
      if(!state.replay.active || !state.replay.sessionId) return;
      if(!state.replay.playing) return;
      if(state.replay._prefetchInFlight) return;
      // Keep batches small: large `states[]` payloads create JSON parse spikes and can
      // *cause* the stop/start cadence even if we buffer.
      var low = 2;
      var want = 4; // batch size
      // If we detected a delta alignment issue, force an immediate resync fetch.
      if(state.replay.deltaMode && state.replay._forceResync){
        force = true;
        want = 1;
      }
      if(!force && _replayQueueLen() >= low) return;
      state.replay._prefetchInFlight = true;
      // Fetch a batch of future steps. We don't render immediately; we enqueue.
      _replayFetchBatch(want, null).then(function(states){
        try{
          if(!state || !state.replay) return;
          if(!Array.isArray(states) || !states.length) return;
          if(!Array.isArray(state.replay._queue)) state.replay._queue = [];
          // Append in order.
          for(var i=0;i<states.length;i++){
            state.replay._queue.push(states[i]);
          }
        } catch(_eQ){}
      }).catch(function(e){
        console.error(e);
        _setPracticeStatus('Replay prefetch failed: ' + String(e && e.message ? e.message : e));
        // Do not hard-stop on one failure; allow the next frame to retry.
      }).finally(function(){
        try{ if(state && state.replay) state.replay._prefetchInFlight = false; } catch(_eF){}
      });
    } catch(_e){}
  }

  function _replayConsumeOne(){
    try{
      if(!state || !state.replay) return false;
      if(!Array.isArray(state.replay._queue) || !state.replay._queue.length) return false;
      var item = state.replay._queue.shift();
      if(!item) return false;
      if(state.replay.deltaMode){
        var ok = _applyReplayDelta(item, { skipDraw: true });
        if(!ok) return false;
      } else {
        _renderReplayState(item, { skipDraw: true });
      }
      state.replay._needsDraw = true;
      
      // Audio hook: notify audio engine when a bar advances
      try{
        if(typeof window.onReplayBarAdvance === 'function'){
          // Get the current bar from chart data (rightmost visible bar)
          var barData = null;
          var barIndex = 0;
          if(state.data && state.data.length > 0){
            // The "now" bar is the last bar in the visible data
            barIndex = state.data.length - 1;
            barData = state.data[barIndex];
          }
          if(barData){
            window.onReplayBarAdvance(barData, barIndex, state.replay.lastState);
          }
        }
      } catch(_eAudio){ console.warn('[Audio Hook Error]', _eAudio); }
      
      return true;
    } catch(_e){
      return false;
    }
  }

  function _replayStartRafLoop(){
    try{
      if(!state || !state.replay) return;
      if(state.replay._rafId) return;
      var token = state.replay._loopToken;
      function frame(ts){
        try{
          if(!state || !state.replay) return;
          if(!state.replay.playing) { state.replay._rafId = null; return; }
          if(token !== state.replay._loopToken) { state.replay._rafId = null; return; }

          if(!state.replay._rafLastTs) state.replay._rafLastTs = ts;
          var dt = ts - state.replay._rafLastTs;
          state.replay._rafLastTs = ts;
          // Clamp dt to avoid huge catch-up loops after tab was backgrounded.
          if(!Number.isFinite(dt) || dt < 0) dt = 0;
          if(dt > 250) dt = 250;
          state.replay._rafAcc += dt;

          var ms = _replayMsPerStep();
          // Prevent unbounded accumulation (keeps playback feeling steady).
          if(state.replay._rafAcc > ms * 5) state.replay._rafAcc = ms * 2;

          var advanced = false;
          while(state.replay._rafAcc >= ms){
            var ok = _replayConsumeOne();
            if(!ok) break;
            advanced = true;
            state.replay._rafAcc -= ms;
          }

          // Keep the buffer topped up.
          if(advanced || _replayQueueLen() < 4){
            _replayMaybePrefetch(false);
          }

          // Draw only when state changed (reduces CPU while keeping responsiveness).
          if(state.replay._needsDraw){
            draw();
            state.replay._needsDraw = false;
          }

          // Throttle tiny UI updates (labels/tooltips) while replay is running.
          try{
            if(!state.replay._lastUiUpdateAt) state.replay._lastUiUpdateAt = ts;
            if(ts - state.replay._lastUiUpdateAt > 120){
              _syncPracticePauseBtn();
              state.replay._lastUiUpdateAt = ts;
            }
          } catch(_eUi){}

          state.replay._rafId = requestAnimationFrame(frame);
        } catch(_eFrame){
          console.error(_eFrame);
          try{ _stopReplayTimer(); } catch(_eStop){}
        }
      }
      state.replay._rafId = requestAnimationFrame(frame);
    } catch(_e){}
  }

  async function withReplayPaused(fn){
    var wasPlaying = !!(state && state.replay && state.replay.playing);
    if(wasPlaying) _stopReplayTimer();
    try{
      return await fn();
    } finally {
      if(wasPlaying && state && state.replay && state.replay.active && state.replay.sessionId){
        var bpm = _practiceSpeedBpm();
        var intervalMs = Math.max(80, Math.floor(60000 / bpm));
        _startReplayLoop(intervalMs);
      }
    }
  }

  async function _endReplaySession(){
    _stopReplayTimer();
    try{
      if(state && state.replay && state.replay.sessionId){
        await _postJson('/replay/end', { session_id: state.replay.sessionId });
      }
    } catch(_e0){}
    if(state && state.replay){
      state.replay.active = false;
      state.replay.sessionId = '';
      state.replay.lastState = null;
    }
    _setPracticeUiStateActive(false);
    // If the history modal is open, refresh it so the just-ended session appears immediately.
    try{
      if(ui.historyModal && ui.historyModal.style.display !== 'none'){
        loadTradeHistory();
      }
    } catch(_e2){}
  }

  function _clearReplayLocal(){
    // Clear local replay UI state without calling server.
    _stopReplayTimer();
    try{
      if(state && state.replay){
        state.replay.active = false;
        state.replay.sessionId = '';
        state.replay.lastState = null;
      }
    } catch(_e){}
    _setPracticeUiStateActive(false);
  }
  async function _postJson(url, payload){
    var res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload || {}) });
    if(!res.ok){
      var t = '';
      try{ t = await res.text(); } catch(_e){}
      throw new Error('HTTP ' + res.status + ' ' + url + (t ? (': ' + t) : ''));
    }
    return await res.json();
  }

  async function _getJson(url){
    var res = await fetch(url, { method:'GET', cache:'no-store' });
    if(!res.ok){
      var t = '';
      try{ t = await res.text(); } catch(_e){}
      throw new Error('HTTP ' + res.status + ' ' + url + (t ? (': ' + t) : ''));
    }
    return await res.json();
  }

  function _setHistoryStatus(txt){
    try{
      if(ui.practiceHistoryStatus) ui.practiceHistoryStatus.textContent = String(txt || '');
    } catch(_e){}
  }

  function _setHistoryModalStatus(txt){
    try{
      if(ui.historyModalStatus) ui.historyModalStatus.textContent = String(txt || '');
    } catch(_e){}
  }

  function _showHistoryModal(show){
    try{
      if(!ui.historyModal) return;
      ui.historyModal.style.display = show ? '' : 'none';
      if(show){
        // Avoid background scroll when modal is open.
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    } catch(_e){}
  }

  function _fmtDateShort(iso){
    var s = String(iso || '');
    if(!s) return '';
    // sqlite CURRENT_TIMESTAMP is often "YYYY-MM-DD HH:MM:SS"
    return s.replace('T',' ').slice(0,16);
  }

  function _fmtNum2(x){
    var n = Number(x);
    return Number.isFinite(n) ? n.toFixed(2) : '';
  }

  function _setHistoryViewMode(mode){
    // mode: 'cards' | 'ledger' | 'matrix'
    try{
      state.historyViewMode = (mode === 'matrix' || mode === 'ledger' || mode === 'cards') ? mode : 'cards';
      if(ui.historyViewCardsBtn){
        ui.historyViewCardsBtn.classList.toggle('btnToggleOn', state.historyViewMode === 'cards');
      }
      if(ui.historyViewLedgerBtn){
        ui.historyViewLedgerBtn.classList.toggle('btnToggleOn', state.historyViewMode === 'ledger');
      }
      if(ui.historyViewMatrixBtn){
        ui.historyViewMatrixBtn.classList.toggle('btnToggleOn', state.historyViewMode === 'matrix');
      }
    } catch(_e){}
  }

  function _fmtDur(sec){
    var s = Math.floor(Number(sec) || 0);
    if(!Number.isFinite(s) || s <= 0) return '';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if(h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function _renderSessionCards(j){
    if(!ui.historyTableWrap) return;
    ui.historyTableWrap.innerHTML = '';
    var sessions = (j && Array.isArray(j.sessions)) ? j.sessions : [];
    // Cards: show most recent sessions first.
    // We sort by best-available timestamp (updated_at/t_end/created_at/t_start).
    try{
      sessions.sort(function(a,b){
        function key(s){
          if(!s) return 0;
          var iso = s.updated_at || s.t_end || s.created_at || s.t_start || '';
          var ms = parseIsoToMs(iso);
          return Number.isFinite(ms) ? ms : 0;
        }
        return key(b) - key(a);
      });
    } catch(_eSort){}
    if(!sessions.length){
      ui.historyTableWrap.innerHTML = '<div class="hint" style="padding:10px;">No sessions yet.</div>';
      return;
    }

    // Cards should not carry any ledger filter forward.
    try{ state.historySessionFilter = null; } catch(_e0){}

    var list = document.createElement('div');
    list.className = 'cardList';

    function pnlClass(v){
      var n = Number(v);
      if(!Number.isFinite(n) || n === 0) return 'pnlFlat';
      return n > 0 ? 'pnlPos' : 'pnlNeg';
    }

    function segClass(v){
      var n = Number(v);
      if(!Number.isFinite(n) || n === 0) return '';
      return n > 0 ? 'segPos' : 'segNeg';
    }

    for(var i=0;i<sessions.length;i++){
      var s = sessions[i] || {};
      var pnl = (s.pnl && (s.pnl.realized !== undefined)) ? Number(s.pnl.realized) : Number(s.realized);
      var act = s.activity || {};
      var strip = s.strip || {};
      var segs = Array.isArray(strip.segments) ? strip.segments : [];

      var card = document.createElement('div');
      card.className = 'sessCard';

      var hd = document.createElement('div');
      hd.className = 'sessCardHd';

      var left = document.createElement('div');
      var titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.gap = '10px';
      var title = document.createElement('div');
      title.className = 'sessTitle';
      title.textContent = String((s.label || '') + ' · ' + (s.symbol || '—')).trim();

      // Badge (label_session) — place next to title per notes.
      var lab = s.session_label || null;
      if(lab && typeof lab === 'object'){
        var pill = document.createElement('div');
        var sev = String(lab.severity || 'neutral');
        var cls = (sev === 'good') ? 'badgeGood' : (sev === 'warn' ? 'badgeWarn' : (sev === 'bad' ? 'badgeBad' : 'badgeNeutral'));
        pill.className = 'badgePill ' + cls;
        pill.textContent = String(lab.label || '');
        pill.title = String(lab.reason || '');
        titleRow.appendChild(title);
        titleRow.appendChild(pill);
      } else {
        titleRow.appendChild(title);
      }
      var sub = document.createElement('div');
      sub.className = 'sessSub';
      var t0 = _fmtDateShort(s.t_start || s.created_at);
      var t1 = _fmtDateShort(s.t_end || s.updated_at);
      var dur = _fmtDur(s.duration_sec);
      sub.textContent = (t0 && t1) ? (t0 + ' → ' + t1 + (dur ? (' (' + dur + ')') : '')) : (t0 || t1 || '');
      left.appendChild(titleRow);
      left.appendChild(sub);

      var rightWrap = document.createElement('div');
      rightWrap.style.display = 'flex';
      rightWrap.style.flexDirection = 'column';
      rightWrap.style.alignItems = 'flex-end';
      rightWrap.style.gap = '6px';

      var headline = (s.outcome && (s.outcome.headline !== undefined) && (s.outcome.headline !== null)) ? String(s.outcome.headline) : '';
      var right = document.createElement('div');
      right.className = 'pnlBig ' + pnlClass(pnl);
      right.textContent = headline ? headline : (Number.isFinite(pnl) ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) : '—');

      rightWrap.appendChild(right);

      hd.appendChild(left);
      hd.appendChild(rightWrap);

      var bd = document.createElement('div');
      bd.className = 'sessBd';

      var mini = document.createElement('div');
      mini.className = 'miniRow';
      var roundTrips = (act && Number.isFinite(Number(act.round_trips))) ? Number(act.round_trips) : 0;
      var scaleIns = (act && Number.isFinite(Number(act.adds))) ? Number(act.adds) : 0;
      mini.innerHTML =
        '<span><span class="miniK">Round Trips:</span> ' + String(roundTrips) + '</span>'
        + '<span><span class="miniK">Hit Rate:</span> ' + (s.pnl && Number.isFinite(Number(s.pnl.win_rate)) ? Math.round(Number(s.pnl.win_rate) * 100) + '%' : '—') + '</span>'
        + '<span><span class="miniK">MaxPos:</span> ' + String(Number.isFinite(Number(act.max_abs_position_qty)) ? Number(act.max_abs_position_qty) : '—') + '</span>'
        + '<span><span class="miniK">Scale-ins:</span> ' + String(scaleIns) + '</span>';
      bd.appendChild(mini);

      var stripEl = document.createElement('div');
      stripEl.className = 'strip';
      // Encode quantity (width) + outcome strength (opacity):
      // - width proportional to qty_peak
      // - opacity proportional to |realized| (relative within the session)
      var maxAbsPnl = 0;
      var maxQtyPeak = 0;
      for(var kk=0; kk<segs.length; kk++){
        var gg = segs[kk] || {};
        var rv = Math.abs(Number(gg.realized) || 0);
        var qp = Math.abs(Number(gg.qty_peak) || 0);
        if(Number.isFinite(rv) && rv > maxAbsPnl) maxAbsPnl = rv;
        if(Number.isFinite(qp) && qp > maxQtyPeak) maxQtyPeak = qp;
      }
      if(!Number.isFinite(maxAbsPnl) || maxAbsPnl <= 0) maxAbsPnl = 0;
      if(!Number.isFinite(maxQtyPeak) || maxQtyPeak <= 0){
        var sessMaxPos = Math.abs(Number(act.max_abs_position_qty) || 0);
        maxQtyPeak = (Number.isFinite(sessMaxPos) && sessMaxPos > 0) ? sessMaxPos : 0;
      }

      // Zero-trade/no-exit case: show a neutral strip instead of "empty".
      if(!segs.length){
        var fills = (act && Number.isFinite(Number(act.fills))) ? Number(act.fills) : 0;
        var pillsN = clamp(Math.max(1, Math.min(6, Math.floor(fills || 1))), 1, 6);
        for(var q=0; q<pillsN; q++){
          var p0 = document.createElement('span');
          p0.className = 'segPill segNeu';
          // width proportional to session max position (if present)
          var w0 = maxQtyPeak > 0 ? (24 + 40) : 34;
          p0.style.width = String(Math.floor(clamp(w0, 20, 76))) + 'px';
          p0.style.opacity = '0.55';
          stripEl.appendChild(p0);
        }
      } else {
        for(var k=0;k<segs.length;k++){
          var g = segs[k] || {};
          var rv2 = Number(g.realized) || 0;
          var abs2 = Math.abs(rv2);
          var qp2 = Math.abs(Number(g.qty_peak) || 0);
          var relQty = (maxQtyPeak > 0) ? (qp2 / maxQtyPeak) : 0;
          var relPnl = (maxAbsPnl > 0) ? (abs2 / maxAbsPnl) : 0;
          // width 22..76 by qty, opacity 0.30..1.0 by pnl
          var w = 22 + relQty * 54;
          var op = 0.30 + relPnl * 0.70;
          if(!Number.isFinite(w)) w = 34;
          if(!Number.isFinite(op)) op = 0.55;
          w = clamp(w, 20, 76);
          op = clamp(op, 0.25, 1.0);

          var pill = document.createElement('span');
          pill.className = 'segPill ' + (segClass(rv2) || 'segNeu');
          pill.style.width = String(Math.floor(w)) + 'px';
          pill.style.opacity = String(op);
          pill.title = 'Trip ' + String(g.trip_index || (k+1)) + ' · ' + String(g.dir || '') + ' · ' + _fmtNum2(rv2)
            + (Number.isFinite(Number(g.qty_peak)) ? (' · qty_peak=' + String(g.qty_peak)) : '')
            + (Number.isFinite(Number(g.adds)) && Number(g.adds) > 0 ? (' · scale-ins=' + String(g.adds)) : '');
          stripEl.appendChild(pill);
        }
      }
      bd.appendChild(stripEl);

      var ft = document.createElement('div');
      ft.className = 'sessFt';
      var hint = document.createElement('div');
      hint.className = 'sessHint';
      hint.textContent = (s.outcome && s.outcome.confidence_hint) ? String(s.outcome.confidence_hint) : '';
      var actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.alignItems = 'center';
      var btnLedger = document.createElement('button');
      btnLedger.className = 'btn';
      btnLedger.type = 'button';
      btnLedger.textContent = 'View Ledger';
      btnLedger.addEventListener('click', (function(sess){
        return function(){
          try{ state.historySessionFilter = String(sess.session_id || ''); } catch(_e){}
          _setHistoryViewMode('ledger');
          loadTradeHistory();
        };
      })(s));
      actions.appendChild(btnLedger);

      var btnDel = document.createElement('button');
      btnDel.className = 'btn';
      btnDel.type = 'button';
      btnDel.textContent = 'Delete';
      btnDel.title = 'Delete this session and all its events';
      btnDel.addEventListener('click', (function(sess, cardEl){
        return async function(){
          var sid = String(sess && sess.session_id ? sess.session_id : '');
          if(!sid) return;
          var ok = false;
          try{
            var name = String((sess.label || '') + ' · ' + (sess.symbol || '')).trim();
            var when = String(_fmtDateShort(sess.t_start || sess.created_at) || '');
            ok = window.confirm('Delete this session and all associated events?\n\n' + (name ? (name + '\n') : '') + (when ? (when + '\n') : '') + '\nThis cannot be undone.');
          } catch(_e){ ok = false; }
          if(!ok) return;
          _setHistoryModalStatus('Deleting…');
          try{
            await _postJson('/replay/session/delete', { session_id: sid });
            // Remove the specific card immediately so the user sees it disappear,
            // even though S1/S2 labels may shift after refresh.
            try{ if(cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl); } catch(_eRm){}
            // If the deleted session is currently active in practice mode, clear local state.
            try{
              if(state && state.replay && String(state.replay.sessionId || '') === sid){
                _clearReplayLocal();
              }
            } catch(_e2){}
            await loadTradeHistory();
            _setHistoryModalStatus('Deleted.');
          } catch(e){
            console.error(e);
            _setHistoryModalStatus('Delete failed');
          }
        };
      })(s, card));
      actions.appendChild(btnDel);
      ft.appendChild(hint);
      ft.appendChild(actions);

      card.appendChild(hd);
      card.appendChild(bd);
      card.appendChild(ft);
      list.appendChild(card);
    }

    ui.historyTableWrap.appendChild(list);
  }

  function _renderTradeLedger(j){
    if(!ui.historyTableWrap) return;
    ui.historyTableWrap.innerHTML = '';
    var sessionsAll = (j && Array.isArray(j.sessions)) ? j.sessions : [];
    var sessions = sessionsAll;
    try{
      var f = (state && state.historySessionFilter) ? String(state.historySessionFilter) : '';
      if(f){
        sessions = [];
        for(var si=0; si<sessionsAll.length; si++){
          var ss = sessionsAll[si];
          if(ss && String(ss.session_id || '') === f) sessions.push(ss);
        }
        // show a small filter hint above the table
        var hint = document.createElement('div');
        hint.className = 'hint';
        hint.style.marginBottom = '10px';
        hint.innerHTML = 'Filtered to one session · <a href="#" style="color:rgba(90,150,255,.92);text-decoration:none;">Clear</a>';
        hint.querySelector('a').addEventListener('click', function(e){
          try{ e.preventDefault(); } catch(_e){}
          try{ state.historySessionFilter = null; } catch(_e2){}
          loadTradeLedger();
        });
        ui.historyTableWrap.appendChild(hint);
      }
    } catch(_e0){}
    if(!sessions.length){
      ui.historyTableWrap.innerHTML = '<div class="hint" style="padding:10px;">No sessions yet.</div>';
      return;
    }

    var table = document.createElement('table');
    table.className = 'histTable';

    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var cols = ['Session','Symbol','Exec Time','FillID','Row','TradeID','Type','Open/Close','Ref','Qty','SignedQty','Price','Value','RPnLΔ'];
    for(var i=0;i<cols.length;i++){
      var th = document.createElement('th');
      th.textContent = cols[i];
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for(var s=0;s<sessions.length;s++){
      var sess = sessions[s] || {};
      var rows = Array.isArray(sess.rows) ? sess.rows : [];
      for(var r=0;r<rows.length;r++){
        var x = rows[r] || {};
        var tr = document.createElement('tr');
        function td(v){
          var t = document.createElement('td');
          t.textContent = (v === null || v === undefined) ? '' : String(v);
          return t;
        }
        tr.appendChild(td(sess.label || sess.session_id || ''));
        tr.appendChild(td(sess.symbol || ''));
        tr.appendChild(td(_fmtDateShort(x.exec_ts)));
        tr.appendChild(td(x.fill_id));
        tr.appendChild(td(x.row_in_fill));
        tr.appendChild(td(x.trade_id));
        tr.appendChild(td(x.entry_type));
        tr.appendChild(td(x.open_close));
        tr.appendChild(td(x.reference));
        tr.appendChild(td(x.qty));
        tr.appendChild(td(x.signed_qty));
        tr.appendChild(td(_fmtNum2(x.price)));
        tr.appendChild(td(_fmtNum2(x.value)));
        tr.appendChild(td(_fmtNum2(x.realized_pnl_delta)));
        tbody.appendChild(tr);
      }
    }

    table.appendChild(tbody);
    var wrap = document.createElement('div');
    wrap.className = 'tableWrap';
    wrap.appendChild(table);
    ui.historyTableWrap.appendChild(wrap);
  }

  function _renderTradeMatrix(matrix){
    if(!ui.historyTableWrap) return;
    var sessions = (matrix && Array.isArray(matrix.sessions)) ? matrix.sessions : [];
    var maxTrades = (matrix && Number.isFinite(Number(matrix.max_trades))) ? Math.floor(Number(matrix.max_trades)) : 0;
    ui.historyTableWrap.innerHTML = '';
    if(!sessions.length){
      ui.historyTableWrap.innerHTML = '<div class="hint" style="padding:10px;">No sessions yet.</div>';
      return;
    }
    if(maxTrades <= 0) maxTrades = 1;

    var table = document.createElement('table');
    table.className = 'histTable';

    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var th0 = document.createElement('th');
    th0.textContent = 'Trade';
    hr.appendChild(th0);
    for(var i=0;i<sessions.length;i++){
      var s = sessions[i];
      var th = document.createElement('th');
      var lbl = (s && s.label) ? String(s.label) : ('S' + (i+1));
      var sym = s && s.symbol ? String(s.symbol) : '—';
      var created = _fmtDateShort(s && s.created_at);
      th.innerHTML = '<div style="display:flex;flex-direction:column;gap:2px;">'
        + '<div style="font-weight:800;">' + lbl + ' · ' + sym + '</div>'
        + '<div class="tradeMeta">' + created + '</div>'
        + '</div>';
      th.title = (s && s.session_id) ? String(s.session_id) : '';
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for(var r=0;r<maxTrades;r++){
      var tr = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.textContent = 'T' + (r+1);
      tr.appendChild(td0);
      for(var c=0;c<sessions.length;c++){
        var td = document.createElement('td');
        var trades = sessions[c] && Array.isArray(sessions[c].trades) ? sessions[c].trades : [];
        var t = trades[r] || null;
        if(!t){
          td.innerHTML = '<div class="tradeMeta">—</div>';
        } else {
          var side = (t.side === 'short') ? 'S' : 'L';
          var qty = (t.qty !== undefined && t.qty !== null) ? String(t.qty) : '';
          var ep = Number(t.entry_price);
          var xp = Number(t.exit_price);
          var pnl = Number(t.pnl);
          var pnlCls = Number.isFinite(pnl) ? (pnl >= 0 ? 'tradePnlUp' : 'tradePnlDn') : 'tradeMeta';
          td.innerHTML =
            '<div class="tradeCell">'
            + '<div><span style="font-weight:800;">' + side + '</span> × ' + qty + '</div>'
            + '<div class="tradeMeta">' + (Number.isFinite(ep) ? ep.toFixed(2) : '—') + ' → ' + (Number.isFinite(xp) ? xp.toFixed(2) : '—') + '</div>'
            + '<div class="' + pnlCls + '">PnL ' + (Number.isFinite(pnl) ? pnl.toFixed(2) : '—') + '</div>'
            + '</div>';
          td.title = (sessions[c] && sessions[c].session_id) ? ('session=' + sessions[c].session_id) : '';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    var wrap = document.createElement('div');
    wrap.className = 'tableWrap';
    wrap.appendChild(table);
    ui.historyTableWrap.appendChild(wrap);
  }

  async function loadTradeMatrix(){
    _setHistoryModalStatus('Loading…');
    try{
      var j = await _getJson('/replay/trade_matrix?limit_sessions=8');
      _renderTradeMatrix(j);
      _setHistoryModalStatus('Loaded ' + ((j && j.sessions && j.sessions.length) ? j.sessions.length : 0) + ' sessions');
    } catch(e){
      console.error(e);
      _setHistoryModalStatus('Failed to load history');
      if(ui.historyTableWrap) ui.historyTableWrap.innerHTML = '';
    }
  }

  async function loadTradeLedger(){
    _setHistoryModalStatus('Loading…');
    try{
      var j = await _getJson('/replay/trade_ledger?limit_sessions=8');
      _renderTradeLedger(j);
      var n = (j && j.sessions && j.sessions.length) ? j.sessions.length : 0;
      var total = (j && Number.isFinite(Number(j.total_sessions))) ? Number(j.total_sessions) : null;
      _setHistoryModalStatus('Loaded ' + String(n) + (total !== null ? (' of ' + String(total)) : '') + ' sessions');
    } catch(e){
      console.error(e);
      _setHistoryModalStatus('Failed to load history');
      if(ui.historyTableWrap) ui.historyTableWrap.innerHTML = '';
    }
  }

  async function loadSessionCards(){
    _setHistoryModalStatus('Loading…');
    try{
      // Default to meaningful "sessions" (those with fills); backend supports `only_with_fills=0` if needed.
      var j = await _getJson('/replay/session_summaries?limit_sessions=8&only_with_fills=1');
      _renderSessionCards(j);
      var n = (j && j.sessions && j.sessions.length) ? j.sessions.length : 0;
      var total = (j && Number.isFinite(Number(j.total_sessions))) ? Number(j.total_sessions) : null;
      var fills = (j && Number.isFinite(Number(j.total_sessions_with_fills))) ? Number(j.total_sessions_with_fills) : null;
      var extra = '';
      if(total !== null) extra = ' of ' + String(total);
      if(fills !== null) extra += ' · ' + String(fills) + ' w/ fills';
      _setHistoryModalStatus('Loaded ' + String(n) + extra + ' sessions');
    } catch(e){
      console.error(e);
      _setHistoryModalStatus('Failed to load history');
      if(ui.historyTableWrap) ui.historyTableWrap.innerHTML = '';
    }
  }

  async function loadTradeHistory(){
    var m = (state && state.historyViewMode) ? String(state.historyViewMode) : 'cards';
    if(m === 'matrix') return await loadTradeMatrix();
    if(m === 'ledger') return await loadTradeLedger();
    return await loadSessionCards();
  }
  function _barsFromReplayState(st){
    var bars = (st && st.display_series && Array.isArray(st.display_series.bars)) ? st.display_series.bars : [];
    var out = new Array(bars.length);
    for(var i=0;i<bars.length;i++){
      var b = bars[i];
      if(!b){ out[i] = null; continue; }
      var tm = parseIsoToMs(b.ts);
      out[i] = {
        t: Number.isFinite(tm) ? tm : NaN,
        o: Number(b.o),
        h: Number(b.h),
        l: Number(b.l),
        c: Number(b.c),
        v: Number(b.v),
        bid: NaN,
        ask: NaN
      };
    }
    // Filter nulls defensively
    var clean = [];
    for(var j=0;j<out.length;j++){
      var d = out[j];
      if(d && Number.isFinite(Number(d.t))) clean.push(d);
    }
    return clean;
  }
  function _renderReplayState(st, opts){
    var o = opts || {};
    if(!st) return;
    if(!state || !state.replay) return;
    state.replay.lastState = st;

    // Keep UI bar size aligned to disp_tf_sec (display clock).
    try{
      var bs = Math.floor(Number(st.disp_tf_sec) || Math.floor(Number(state.windowSec) || 60));
      if(Number.isFinite(bs) && bs > 0){
        state.windowSec = clamp(bs, 60, 86400);
        state._loadedBarS = state.windowSec;
        if(ui.window) ui.window.value = String(state.windowSec);
        if(ui.windowVal) ui.windowVal.textContent = formatWindow(state.windowSec);
        syncBarPresetUi();
        updateUrlBarSize();
      }
    } catch(_e0){}

    // Clamp navigation bounds so the chart stays future-blind.
    try{
      var ds0 = st.actual_range && st.actual_range.start ? parseIsoToMs(st.actual_range.start) : parseIsoToMs(st.requested_range && st.requested_range.start);
      var de0 = st.clock && st.clock.disp_window && st.clock.disp_window.end ? parseIsoToMs(st.clock.disp_window.end) : NaN;
      // Full history end (does NOT change future-blind clamp).
      var deMax0 = st.actual_range && st.actual_range.end ? parseIsoToMs(st.actual_range.end) : parseIsoToMs(st.requested_range && st.requested_range.end);
      if(Number.isFinite(ds0)) state.datasetStartMs = ds0;
      if(Number.isFinite(de0)) state.datasetEndMs = de0;
      if(Number.isFinite(deMax0)) state.datasetMaxEndMs = deMax0;
      if(Number.isFinite(state.datasetEndMs)) state.viewEndMs = state.datasetEndMs;
      updateSpanPresetAvailability();
    } catch(_e1){}

    // Render candles from authoritative display_series.
    //
    // Fast path (append-only):
    // - Only when session filters are "show all" (so dataFull==data)
    // - Only when the new window overlaps the old window by all-but-last timestamps
    // - Only when relevant toggles haven't changed since the last replay render
    //
    // Otherwise: fall back to the safe full rebuild + applySessionFilter().
    try{
      function allSessionsEnabled(){
        try{
          return !!(
            (!ui.sessPreMarket || ui.sessPreMarket.checked) &&
            (!ui.sessAfterHours || ui.sessAfterHours.checked) &&
            (!ui.sessClosed || ui.sessClosed.checked)
          );
        } catch(_e){ return true; }
      }
      function replayFastSig(){
        var os = getOverlaySettings();
        return [
          'sym', String(getSymbol() || ''),
          'disp', Math.floor(Number(st.disp_tf_sec) || 0),
          'cand', ui.showCandles && ui.showCandles.checked ? 1 : 0,
          'cstyle', String(state.candleStyle || ''),
          'pre', ui.sessPreMarket && ui.sessPreMarket.checked ? 1 : 0,
          'after', ui.sessAfterHours && ui.sessAfterHours.checked ? 1 : 0,
          'closed', ui.sessClosed && ui.sessClosed.checked ? 1 : 0,
          'ema9', os && os.ema9 ? 1 : 0,
          'ema21', os && os.ema21 ? 1 : 0,
          'ema50', os && os.ema50 ? 1 : 0,
          'vwap', os && os.vwap ? 1 : 0
        ].join('|');
      }
      function buildOverlaysFromReplayState(st2){
        try{
          var os = getOverlaySettings();
          if(!os || !anyOverlayEnabled(os)) return [];
          if(!(st2 && replayOverlaysAvailable(st2.overlays))) return [];
          var out = [];
          // Helper to map [{ts,v}] -> y[]
          function yFromPoints(points){
            if(!Array.isArray(points)) return [];
            var y = new Array(points.length);
            for(var i=0;i<points.length;i++){
              var p = points[i];
              var v = (p && p.v !== null && p.v !== undefined) ? Number(p.v) : NaN;
              y[i] = Number.isFinite(v) ? v : NaN;
            }
            return y;
          }
          var ema = (st2.overlays && st2.overlays.ema) ? st2.overlays.ema : {};
          if(os.ema9 && Array.isArray(ema['9']) && ema['9'].length){
            out.push({ t_ms: [], y: yFromPoints(ema['9']), key: 'ema_9', label: 'EMA 9', color: 'rgba(215,224,234,0.92)', width: 1.25 });
          }
          if(os.ema21 && Array.isArray(ema['21']) && ema['21'].length){
            out.push({ t_ms: [], y: yFromPoints(ema['21']), key: 'ema_21', label: 'EMA 21', color: 'rgba(215,224,234,0.72)', width: 1.25 });
          }
          if(os.ema50 && Array.isArray(ema['50']) && ema['50'].length){
            out.push({ t_ms: [], y: yFromPoints(ema['50']), key: 'ema_50', label: 'EMA 50', color: 'rgba(215,224,234,0.52)', width: 1.25 });
          }
          if(os.ema200 && Array.isArray(ema['200']) && ema['200'].length){
            out.push({ t_ms: [], y: yFromPoints(ema['200']), key: 'ema_200', label: 'EMA 200', color: 'rgba(255, 0, 0, 1.0)', width: 2.0 });
          }
          if(os.vwap && Array.isArray(st2.overlays && st2.overlays.vwap) && st2.overlays.vwap.length){
            out.push({ t_ms: [], y: yFromPoints(st2.overlays.vwap), key: 'vwap_session', label: 'VWAP', color: 'rgb(255, 215, 0)', width: 1.55 });
          }
          // Fill t_ms from current data (aligned by index)
          try{
            if(Array.isArray(state.dataFull) && state.dataFull.length){
              for(var si=0; si<out.length; si++){
                var s = out[si];
                s.t_ms = new Array(state.dataFull.length);
                for(var j=0;j<state.dataFull.length;j++) s.t_ms[j] = Number(state.dataFull[j].t);
              }
            }
          } catch(_eTms){}
          return out;
        } catch(_e){
          return [];
        }
      }
      function appendHa(prevHa, rawBar){
        var o = Number(rawBar.o), h = Number(rawBar.h), l = Number(rawBar.l), c = Number(rawBar.c);
        var haClose = (o + h + l + c) / 4;
        var prevOpen = prevHa ? Number(prevHa.o) : NaN;
        var prevClose = prevHa ? Number(prevHa.c) : NaN;
        var haOpen = (!Number.isFinite(prevOpen) || !Number.isFinite(prevClose)) ? ((o + c) / 2) : ((prevOpen + prevClose) / 2);
        var haHigh = Math.max(h, haOpen, haClose);
        var haLow = Math.min(l, haOpen, haClose);
        return { o: haOpen, h: haHigh, l: haLow, c: haClose };
      }

      var rawBars = (st && st.display_series && Array.isArray(st.display_series.bars)) ? st.display_series.bars : [];
      var newLen = rawBars.length;
      var oldArr = Array.isArray(state.dataFull) ? state.dataFull : null;
      var oldLen = oldArr ? oldArr.length : 0;
      var sig = replayFastSig();
      var prevSig = (state.replay._fastSig || '');

      var canFast = !!(oldArr && oldLen > 2 && newLen === oldLen && allSessionsEnabled() && sig === prevSig);
      if(canFast){
        // Quick compute ts arrays
        var oldTs0 = new Array(oldLen);
        for(var i0=0;i0<oldLen;i0++) oldTs0[i0] = Number(oldArr[i0] && oldArr[i0].t);
        var newTs0 = new Array(newLen);
        for(var j0=0;j0<newLen;j0++) newTs0[j0] = parseIsoToMs(rawBars[j0] && rawBars[j0].ts);

        // Determine drop count (how many old bars rolled off).
        var drop = 0;
        if(oldLen >= 2 && oldTs0[1] === newTs0[0]) drop = 1;
        else {
          // find first match of newTs[0] in oldTs (drop index)
          var head = newTs0[0];
          for(var k0=0;k0<oldLen;k0++){
            if(oldTs0[k0] === head){ drop = k0; break; }
          }
        }
        if(drop > 0 && drop < oldLen){
          // Validate overlap: old[drop..] == new[0..oldLen-drop-1]
          var ok = true;
          for(var x=drop; x<oldLen; x++){
            if(oldTs0[x] !== newTs0[x - drop]) { ok = false; break; }
          }
          if(ok){
            var appendN = drop; // fixed window size
            // Ensure we are in "no filter" mode: data === dataFull (same reference).
            if(state.data !== state.dataFull) state.data = state.dataFull;
            // Drop rolled-off bars
            state.dataFull.splice(0, drop);

            // Drop aligned derived arrays
            try{
              if(Array.isArray(state._sessionType) && state._sessionType.length === oldLen) state._sessionType.splice(0, drop);
            } catch(_eS){}
            try{
              if(Array.isArray(state.ha) && state.ha.length === oldLen) state.ha.splice(0, drop);
            } catch(_eHaSp){}
            try{
              if(Array.isArray(state.overlays)){
                for(var si0=0; si0<state.overlays.length; si0++){
                  var s0 = state.overlays[si0];
                  if(s0 && Array.isArray(s0.y) && s0.y.length === oldLen) s0.y.splice(0, drop);
                  if(s0 && Array.isArray(s0.t_ms) && s0.t_ms.length === oldLen) s0.t_ms.splice(0, drop);
                }
              }
            } catch(_eOvSp){}

            // Append new bars
            for(var a=0; a<appendN; a++){
              var rb = rawBars[newLen - appendN + a];
              if(!rb) continue;
              var tm = parseIsoToMs(rb.ts);
              var nb = { t: Number.isFinite(tm) ? tm : NaN, o: Number(rb.o), h: Number(rb.h), l: Number(rb.l), c: Number(rb.c), v: Number(rb.v), bid: NaN, ask: NaN };
              state.dataFull.push(nb);
            }

            // Ensure length restored
            if(state.dataFull.length !== newLen){
              throw new Error('fast path length mismatch');
            }

            // Append session types
            try{
              if(!Array.isArray(state._sessionType) || state._sessionType.length !== (newLen - appendN)){
                state._sessionType = computeSessionTypesForData(state.dataFull);
              } else {
                for(var a2=0;a2<appendN;a2++){
                  var t2 = Number(state.dataFull[newLen - appendN + a2].t);
                  state._sessionType.push(Number.isFinite(t2) ? sessionTypeForMsEt(t2) : 'closed');
                }
              }
            } catch(_eSess){
              state._sessionType = computeSessionTypesForData(state.dataFull);
            }

            // HA append-only (only if HA candles are enabled)
            var needHa = !!(ui && ui.showCandles && ui.showCandles.checked && state && state.candleStyle === 'ha');
            if(needHa){
              try{
                if(!Array.isArray(state.ha) || state.ha.length !== (newLen - appendN)){
                  state.ha = computeHeikinAshi(state.dataFull);
                } else {
                  var prev = state.ha.length ? state.ha[state.ha.length - 1] : null;
                  for(var a3=0;a3<appendN;a3++){
                    var raw = state.dataFull[newLen - appendN + a3];
                    var haBar = appendHa(prev, raw);
                    state.ha.push(haBar);
                    prev = haBar;
                  }
                }
              } catch(_eHa2){
                state.ha = computeHeikinAshi(state.dataFull);
              }
            } else {
              state.ha = [];
            }

            // Overlays (prefer server overlays): rebuild once if missing or settings changed; otherwise shift+append last points
            try{
              var os2 = getOverlaySettings();
              if(!os2 || !anyOverlayEnabled(os2)){
                state.overlays = [];
              } else if(st && replayOverlaysAvailable(st.overlays)){
                var needRebuildOv = !Array.isArray(state.overlays) || !state.overlays.length || (state.replay._fastOvSig !== sig);
                if(needRebuildOv){
                  // Build from the authoritative overlay arrays (O(n) once per settings change)
                  state.overlays = buildOverlaysFromReplayState(st);
                  state.replay._fastOvSig = sig;
                } else {
                  // Append overlay points for the newly appended bars (assume overlay arrays aligned to rawBars).
                  function appendSeries(key, points){
                    if(!Array.isArray(points) || !points.length) return;
                    var s = null;
                    for(var i=0;i<state.overlays.length;i++){
                      if(state.overlays[i] && state.overlays[i].key === key){ s = state.overlays[i]; break; }
                    }
                    if(!s || !Array.isArray(s.y)) return;
                    // points are full-length; take the last appendN values
                    for(var q=0;q<appendN;q++){
                      var p = points[newLen - appendN + q];
                      var vv = (p && p.v !== null && p.v !== undefined) ? Number(p.v) : NaN;
                      s.y.push(Number.isFinite(vv) ? vv : NaN);
                      if(Array.isArray(s.t_ms)) s.t_ms.push(Number(state.dataFull[newLen - appendN + q].t));
                    }
                  }
                  var ema2 = st.overlays.ema || {};
                  if(os2.ema9) appendSeries('ema_9', ema2['9']);
                  if(os2.ema21) appendSeries('ema_21', ema2['21']);
                  if(os2.ema50) appendSeries('ema_50', ema2['50']);
                  if(os2.ema200) appendSeries('ema_200', ema2['200']);
                  if(os2.vwap) appendSeries('vwap_session', st.overlays.vwap);
                }
              } else {
                // If replay overlays absent, keep overlays empty in fast path (avoid local recompute).
                state.overlays = [];
              }
            } catch(_eOv2){
              // If overlay update fails, clear them (safe) and continue.
              state.overlays = [];
            }

            // Replay UX: keep right-aligned as time advances.
            state.followLatest = true;
            state.hoverIdx = -1;
            if(!o.skipDraw) draw();
            try{
              if(state && state.replay && state.replay._fastStats){
                state.replay._fastStats.hits = (Number(state.replay._fastStats.hits) || 0) + 1;
                state.replay._fastStats.lastMode = 'fast';
              }
            } catch(_eFS){}
            // Update fast-path signature
            state.replay._fastSig = sig;
            return;
          }
        }
      }
      // Update signature even if fast path not taken (keeps it current for next attempt).
      state.replay._fastSig = sig;
    } catch(_eFast){
      // fall through to full rebuild
    }

    // Safe full rebuild + filter/derived recompute (correctness path)
    var out = _barsFromReplayState(st);
    state.dataFull = out;
    state.data = out;
    state._sessionType = [];
    state.ha = [];
    state.overlaysFull = [];
    state.overlays = [];
    state.followLatest = true;
    applySessionFilter({ skipSave: true, skipDraw: true });
    state.hoverIdx = -1;
    if(!o.skipDraw) draw();
    try{
      if(state && state.replay && state.replay._fastStats){
        state.replay._fastStats.misses = (Number(state.replay._fastStats.misses) || 0) + 1;
        state.replay._fastStats.lastMode = 'full';
      }
    } catch(_eFS2){}
  }

  function _applyReplayDelta(item, opts){
    var o = opts || {};
    try{
      if(!item) return false;
      // If server included a full resync snapshot, just render it (correctness-first).
      if(item.state){
        _renderReplayState(item.state, o);
        return true;
      }
      var d = item.delta || null;
      if(!d) return false;
      if(!state || !state.replay) return false;

      var drop = Math.max(0, Math.floor(Number(d.drop) || 0));
      var appendBars = Array.isArray(d.append_bars) ? d.append_bars : [];
      if(!Array.isArray(state.dataFull) || !state.dataFull.length){
        state.replay._forceResync = true;
        return false;
      }
      function _allSessionsEnabled(){
        try{
          return !!(
            (!ui.sessPreMarket || ui.sessPreMarket.checked) &&
            (!ui.sessAfterHours || ui.sessAfterHours.checked) &&
            (!ui.sessClosed || ui.sessClosed.checked)
          );
        } catch(_e){ return true; }
      }
      var _filtersAll = _allSessionsEnabled();
      if(_filtersAll){
        // Fast delta path assumes no filtering, so keep data as the authoritative full window.
        if(state.data !== state.dataFull) state.data = state.dataFull;
      }

      // Fixed-window expectation: usually drop === appendBars.length.
      if(drop > 0 && appendBars.length && drop !== appendBars.length){
        state.replay._forceResync = true;
      }

      if(drop){
        state.dataFull.splice(0, drop);
        if(_filtersAll){
          try{
            if(Array.isArray(state._sessionType) && state._sessionType.length >= drop) state._sessionType.splice(0, drop);
          } catch(_eS){}
          try{
            if(Array.isArray(state.ha) && state.ha.length >= drop) state.ha.splice(0, drop);
          } catch(_eHa){}
          try{
            if(Array.isArray(state.overlays)){
              for(var si=0; si<state.overlays.length; si++){
                var s = state.overlays[si];
                if(s && Array.isArray(s.y) && s.y.length >= drop) s.y.splice(0, drop);
                if(s && Array.isArray(s.t_ms) && s.t_ms.length >= drop) s.t_ms.splice(0, drop);
              }
            }
          } catch(_eOv){}
        }
      }

      function barFromDelta(b){
        var tm = parseIsoToMs(b && b.ts);
        return {
          t: Number.isFinite(tm) ? tm : NaN,
          o: Number(b && b.o),
          h: Number(b && b.h),
          l: Number(b && b.l),
          c: Number(b && b.c),
          v: Number(b && b.v),
          bid: NaN,
          ask: NaN
        };
      }

      var newOnes = [];
      for(var i=0;i<appendBars.length;i++){
        var bb = appendBars[i];
        if(!bb) continue;
        var b2 = barFromDelta(bb);
        if(b2 && Number.isFinite(Number(b2.t))) newOnes.push(b2);
      }
      for(var j=0;j<newOnes.length;j++) state.dataFull.push(newOnes[j]);

      // Keep replay.lastState updated so applySessionFilter() can build server-authoritative overlays.
      try{
        if(!state.replay.lastState) state.replay.lastState = {};
        var ls = state.replay.lastState;
        if(!ls.display_series) ls.display_series = { bars: [] };
        if(!Array.isArray(ls.display_series.bars)) ls.display_series.bars = [];
        if(drop && ls.display_series.bars.length >= drop) ls.display_series.bars.splice(0, drop);
        for(var jj=0;jj<appendBars.length;jj++){
          var rb = appendBars[jj];
          if(rb) ls.display_series.bars.push(rb);
        }
        if(item.meta && item.meta.disp_window_end){
          if(!ls.clock) ls.clock = {};
          if(!ls.clock.disp_window) ls.clock.disp_window = {};
          ls.clock.disp_window.end = String(item.meta.disp_window_end);
        }
        // Shift+append overlays in lastState (window-sized).
        var oaLS = d.overlays_append || {};
        if(!ls.overlays) ls.overlays = {};
        var ovLS = ls.overlays;
        if(!ovLS.ema) ovLS.ema = {};
        function shiftAppend(arr, pt){
          if(!Array.isArray(arr)) arr = [];
          if(drop && arr.length >= drop) arr.splice(0, drop);
          if(pt) arr.push(pt);
          return arr;
        }
        try{
          var emaLS = oaLS.ema || {};
          var p9 = (Array.isArray(emaLS['9']) && emaLS['9'].length) ? emaLS['9'][emaLS['9'].length - 1] : null;
          var p21 = (Array.isArray(emaLS['21']) && emaLS['21'].length) ? emaLS['21'][emaLS['21'].length - 1] : null;
          var p50 = (Array.isArray(emaLS['50']) && emaLS['50'].length) ? emaLS['50'][emaLS['50'].length - 1] : null;
          var p200 = (Array.isArray(emaLS['200']) && emaLS['200'].length) ? emaLS['200'][emaLS['200'].length - 1] : null;
          ovLS.ema['9'] = shiftAppend(ovLS.ema['9'], p9);
          ovLS.ema['21'] = shiftAppend(ovLS.ema['21'], p21);
          ovLS.ema['50'] = shiftAppend(ovLS.ema['50'], p50);
          ovLS.ema['200'] = shiftAppend(ovLS.ema['200'], p200);
        } catch(_eEmaLS){}
        try{
          var vwLS = (Array.isArray(oaLS.vwap) && oaLS.vwap.length) ? oaLS.vwap[oaLS.vwap.length - 1] : null;
          ovLS.vwap = shiftAppend(ovLS.vwap, vwLS);
        } catch(_eVwLS){}
      } catch(_eLS){}

      // If session filters are active, rebuild filtered view + derived arrays for correctness.
      if(!_filtersAll){
        try{
          applySessionFilter({ skipSave: true, skipDraw: true });
        } catch(_eFilt){}
        state.followLatest = true;
        state.hoverIdx = -1;
        if(!o.skipDraw) draw();
        return true;
      }

      // Session types (best-effort; fast path only)
      try{
        if(!Array.isArray(state._sessionType)) state._sessionType = [];
        for(var k=0;k<newOnes.length;k++){
          var t2 = Number(newOnes[k].t);
          state._sessionType.push(Number.isFinite(t2) ? sessionTypeForMsEt(t2) : 'closed');
        }
      } catch(_eSess){}

      // HA append-only if enabled
      try{
        var needHa = !!(ui && ui.showCandles && ui.showCandles.checked && state && state.candleStyle === 'ha');
        function appendHa(prevHa, rawBar){
          var oo = Number(rawBar.o), hh = Number(rawBar.h), ll = Number(rawBar.l), cc = Number(rawBar.c);
          var haClose = (oo + hh + ll + cc) / 4;
          var prevOpen = prevHa ? Number(prevHa.o) : NaN;
          var prevClose = prevHa ? Number(prevHa.c) : NaN;
          var haOpen = (!Number.isFinite(prevOpen) || !Number.isFinite(prevClose)) ? ((oo + cc) / 2) : ((prevOpen + prevClose) / 2);
          var haHigh = Math.max(hh, haOpen, haClose);
          var haLow = Math.min(ll, haOpen, haClose);
          return { o: haOpen, h: haHigh, l: haLow, c: haClose };
        }
        if(needHa){
          if(!Array.isArray(state.ha)) state.ha = [];
          var prev = state.ha.length ? state.ha[state.ha.length - 1] : null;
          for(var a=0;a<newOnes.length;a++){
            var haBar = appendHa(prev, newOnes[a]);
            state.ha.push(haBar);
            prev = haBar;
          }
          // Safety: if anything drifted (e.g. after a resync/mismatch), rebuild once from authoritative bars.
          if(!Array.isArray(state.ha) || state.ha.length !== state.dataFull.length){
            state.ha = computeHeikinAshi(state.dataFull);
          }
        } else {
          state.ha = [];
        }
      } catch(_eHa2){
        state.ha = [];
      }

      // Overlays append (server-authoritative)
      try{
        var os = getOverlaySettings();
        if(!os || !anyOverlayEnabled(os)){
          state.overlays = [];
        } else if(Array.isArray(state.overlays) && state.overlays.length){
          var oa = d.overlays_append || {};
          var ema = oa.ema || {};
          var vwap = oa.vwap || [];
          function pushPoint(seriesKey, pt){
            if(!pt) return;
            var v = (pt.v !== null && pt.v !== undefined) ? Number(pt.v) : NaN;
            for(var ii=0; ii<state.overlays.length; ii++){
              var s2 = state.overlays[ii];
              if(!s2 || s2.key !== seriesKey) continue;
              if(!Array.isArray(s2.y)) s2.y = [];
              if(!Array.isArray(s2.t_ms)) s2.t_ms = [];
              s2.y.push(Number.isFinite(v) ? v : NaN);
              var tms = state.dataFull.length ? Number(state.dataFull[state.dataFull.length - 1].t) : NaN;
              s2.t_ms.push(Number.isFinite(tms) ? tms : NaN);
              return;
            }
          }
          if(os.ema9 && Array.isArray(ema['9']) && ema['9'].length) pushPoint('ema_9', ema['9'][ema['9'].length - 1]);
          if(os.ema21 && Array.isArray(ema['21']) && ema['21'].length) pushPoint('ema_21', ema['21'][ema['21'].length - 1]);
          if(os.ema50 && Array.isArray(ema['50']) && ema['50'].length) pushPoint('ema_50', ema['50'][ema['50'].length - 1]);
          if(os.ema200 && Array.isArray(ema['200']) && ema['200'].length) pushPoint('ema_200', ema['200'][ema['200'].length - 1]);
          if(os.vwap && Array.isArray(vwap) && vwap.length) pushPoint('vwap_session', vwap[vwap.length - 1]);
        } else {
          state.overlays = [];
        }
      } catch(_eOv2){
        state.overlays = [];
      }

      // Update metadata/bounds (best-effort)
      try{
        if(!state.replay.lastState) state.replay.lastState = {};
        if(item.position) state.replay.lastState.position = item.position;
        if(item.orders) state.replay.lastState.orders = item.orders;
        if(item.meta && item.meta.disp_window_end){
          var endMs = parseIsoToMs(item.meta.disp_window_end);
          if(Number.isFinite(endMs)){
            state.datasetEndMs = endMs;
            state.viewEndMs = endMs;
          }
        }
      } catch(_eMeta){}

      state.followLatest = true;
      state.hoverIdx = -1;
      if(!o.skipDraw) draw();
      return true;
    } catch(_e){
      try{ if(state && state.replay) state.replay._forceResync = true; } catch(_e2){}
      return false;
    }
  }
