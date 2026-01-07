'use strict';

  var state = {
    // dataFull is the unfiltered window returned by the loader.
    // data is the currently displayed view after applying session filters (TradingView-style).
    dataFull: [],
    data: [],
    ha: [],
    overlaysFull: [], // [{t_ms,y,key,label,color,width}] aligned with dataFull
    overlays: [],     // [{t_ms,y,key,label,color,width}] aligned with data (filtered)
    candleStyle: 'std', // 'std' | 'ha'
    xOffset: 0,
    xZoom: 1,
    dragging: false,
    dragX0: 0,
    dragY0: 0,
    xOffset0: 0,
    yPan: 0,      // price-space vertical pan offset (added to yMin/yMax)
    yPan0: 0,
    lastDragDx: 0,
    yDragging: false,
    yScale0: 1,
    yScaleFactor: 1,
    hoverIdx: -1,
    hoverX: NaN,
    hoverY: NaN,
    hoverTradeId: null, // Stable ID of the trade being hovered
    pickables: [],      // Array of hit-testable objects {x, y, r, trade_id}
    symbol: 'ESZ5',
    windowSec: 60,
    // Navigation anchor: requested window span (not the full dataset span).
    viewSpanMs: NaN,
    viewEndMs: NaN,
    spanPreset: '1d',
    followLatest: true,
    datasetStartMs: NaN,
    datasetEndMs: NaN,
    // Full dataset end (used for span preset availability). In replay mode we keep datasetEndMs future-blind.
    datasetMaxEndMs: NaN,
    _bootstrappedInitialWindow: false,
    _lastYSpan: NaN,
    _lastPlotH: NaN,
    _loadedBarS: NaN,
    _vwapTrimStartMs: NaN,
    // Render cache: we keep a cached "base layer" bitmap so hover/crosshair updates don't
    // need to recompute/redraw the entire chart.
    _render: {
      baseCanvas: null,      // offscreen canvas holding base layer
      baseKey: '',
      baseW: 0,
      baseH: 0,
      pendingReason: '',
      rafDrawId: null
    },

    // Replay (practice-field) mode state
    replay: {
      active: false,
      sessionId: '',
      playing: false,
      timer: null,
      lastState: null,
      // Replay loop internals (avoid overlapping async steps).
      _loopToken: 0,
      _inFlight: false,
      // Buffered playback (frontend clock): we prefetch batches from the server and
      // consume them locally at an even cadence to avoid network jitter.
      _queue: [],
      _prefetchInFlight: false,
      _rafId: null,
      _rafLastTs: 0,
      _rafAcc: 0,
      _needsDraw: false,
      _lastUiUpdateAt: 0,
      // Replay render fast-path stats (debugging stutter):
      // - hits: append-only path used
      // - misses: full rebuild path used
      // - lastMode: 'fast' | 'full'
      _fastStats: { hits: 0, misses: 0, lastMode: '' },
      _stepFailCount: 0,
      // Optional perf/debug overlay (enabled via ?replay_debug=1)
      _debug: {
        enabled: false,
        targetMs: NaN,
        behindMs: NaN,
        lastStepMs: NaN,
        lastFetchMs: NaN,
        lastRenderMs: NaN,
        lastDrawMs: NaN,
        lastTickAt: NaN,
        // rolling stats (last N samples)
        _N: 60,
        _fetch: [],
        _render: [],
        _draw: [],
        _step: [],
        _behind: [],
        _gap: [], // time between step starts (wall clock)
        maxFetchMs: NaN,
        maxRenderMs: NaN,
        maxDrawMs: NaN,
        maxStepMs: NaN,
        maxBehindMs: NaN,
        maxGapMs: NaN,
        // replay clock tracking
        lastDispEnd: '',
        lastDispEndAt: NaN,
        // Per-step samples (for variability inspection / export)
        // Each: {seq, started_at_ms, finished_at_ms, bpm, target_ms, behind_ms, fetch_ms, render_ms, draw_ms, step_ms, disp_end}
        seq: 0,
        maxSamples: 400,
        samples: [],
        _lastStepStartAtMs: NaN
      }
    }
  };

  // Enable replay debug overlay via URL param (kept off by default).
  try{
    if(state && state.replay && state.replay._debug){
      state.replay._debug.enabled = truthyQueryParam('replay_debug');
    }
  } catch(_eDbgInit){}

  // Debug export helpers (available in devtools console when ?replay_debug=1):
  // - window.replayDebugSamples(): returns array of sample objects
  // - window.dumpReplayDebugCsv(): prints CSV to console (copy/paste into spreadsheet)
  try{
    window.replayDebugSamples = function(){
      try{
        var d = state && state.replay && state.replay._debug ? state.replay._debug : null;
        if(!d || !Array.isArray(d.samples)) return [];
        return d.samples.slice();
      } catch(_e){
        return [];
      }
    };
    window.dumpReplayDebugCsv = function(){
      try{
        var rows = window.replayDebugSamples();
        var header = [
          'seq','started_at_ms','finished_at_ms','bpm','target_ms','behind_ms','gap_ms',
          'fetch_ms','render_ms','draw_ms','step_ms','data_len','last_bar_t_ms','disp_end'
        ];
        var out = [header.join(',')];
        for(var i=0;i<rows.length;i++){
          var r = rows[i] || {};
          function esc(s){
            var x = String(s ?? '');
            if(x.indexOf('"') !== -1) x = x.replace(/"/g,'""');
            if(/[",\n]/.test(x)) x = '"' + x + '"';
            return x;
          }
          var line = [
            r.seq, r.started_at_ms, r.finished_at_ms, r.bpm, r.target_ms, r.behind_ms, r.gap_ms,
            r.fetch_ms, r.render_ms, r.draw_ms, r.step_ms, r.data_len, r.last_bar_t_ms, esc(r.disp_end || '')
          ].map(function(v){ return (v === undefined || v === null) ? '' : String(v); }).join(',');
          out.push(line);
        }
        var csv = out.join('\n');
        console.log(csv);
        return csv;
      } catch(e){
        console.error(e);
        return '';
      }
    };
  } catch(_eDbgFns){}

  // Live mode is disabled in this app integration (use "Fetch Latest Data" instead).
  var LIVE_POLL_MS = 10_000;
  var livePollTimer = null;
  var liveStatusTimer = null;
  state._liveStatus = null; // { enabled, connected, last_ts_event: {sym: iso}, ... }
  state._liveStatusAtMs = NaN;
  state._lastFullSyncAtMs = NaN;

  function closeCandleStyleMenu(){
    if(!ui.candleStyleDD) return;
    ui.candleStyleDD.classList.remove('open');
    if(ui.candleStyleBtn) ui.candleStyleBtn.setAttribute('aria-expanded','false');
  }

  function toggleCandleStyleMenu(){
    if(!ui.candleStyleDD || !ui.candleStyleBtn || ui.candleStyleBtn.disabled) return;
    var open = ui.candleStyleDD.classList.toggle('open');
    ui.candleStyleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setCandleStyle(v){
    var key = String(v || 'std');
    if(key !== 'std' && key !== 'ha') key = 'std';
    state.candleStyle = key;
    if(ui.candleStyleLabel) ui.candleStyleLabel.textContent = (key === 'ha') ? 'Heikin Ashi' : 'Standard';
    if(ui.candleStyleMenu){
      var items = ui.candleStyleMenu.querySelectorAll('.ddItem');
      for(var i=0;i<items.length;i++){
        var it = items[i];
        var val = it.getAttribute('data-value');
        if(val === key) it.classList.add('sel');
        else it.classList.remove('sel');
      }
    }
  }

  function syncCandleStyleEnabled(){
    var enabled = !!(ui.showCandles && ui.showCandles.checked);
    if(ui.candleStyleBtn) ui.candleStyleBtn.disabled = !enabled;
    if(!enabled) closeCandleStyleMenu();
  }

  function msToIsoZ(ms){
    // API accepts Z or offsets; keep URLs compact using ISO Z.
    return new Date(ms).toISOString().replace('.000Z','Z');
  }

  function resize(){
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var r = canvas.getBoundingClientRect();
    canvas.width = Math.floor(r.width * dpr);
    canvas.height = Math.floor(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function requestDraw(reason){
    // Coalesce multiple draw requests into a single RAF tick.
    try{
      if(!state || !state._render) return draw();
      state._render.pendingReason = String(reason || '');
      if(state._render.rafDrawId) return;
      state._render.rafDrawId = requestAnimationFrame(function(){
        try{
          state._render.rafDrawId = null;
          draw();
        } catch(_e){
          state._render.rafDrawId = null;
        }
      });
    } catch(_e){
      draw();
    }
  }

  function computeYBounds(){
    // Auto-scale Y should reflect the currently visible X window, so the price action
    // uses as much vertical space as possible in the current view.
    //
    // This is also what the Y-axis double-click ("auto-fit") expects: reset to a
    // tight-but-not-clipped range for the visible bars.
    if(!state.data.length) return {min:0,max:1};

    var n = state.data.length;
    var xZoom = Number(state.xZoom);
    if(!Number.isFinite(xZoom) || xZoom <= 0) xZoom = 1;

    var barsVisible = Math.min(n, Math.max(8, Math.floor(n / xZoom)));

    // Keep behavior consistent with draw(): if xOffset is unset/0 on first load,
    // right-align the view.
    var xOffset = Number(state.xOffset);
    if(!Number.isFinite(xOffset) || xOffset === 0){
      xOffset = Math.max(0, n - barsVisible);
    }
    xOffset = clamp(xOffset, 0, Math.max(0, n - barsVisible));

    var start = Math.floor(xOffset);
    var end = Math.min(n - 1, start + barsVisible + 1);

    // If candles are shown and Heikin Ashi is active, fit to HA highs/lows to match
    // the displayed candles; otherwise fit to raw highs/lows.
    var useHa = false;
    if(ui && ui.showCandles && ui.showCandles.checked && state.candleStyle === 'ha'){
      if(Array.isArray(state.ha) && state.ha.length === state.data.length) useHa = true;
    }
    var arr = useHa ? state.ha : state.data;

    var min = Infinity, max = -Infinity;
    for(var i=start; i<=end; i++){
      var d = arr[i];
      if(!d) continue;
      var lo = Number(d.l);
      var hi = Number(d.h);
      if(!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      if(lo < min) min = lo;
      if(hi > max) max = hi;
    }

    if(!Number.isFinite(min) || !Number.isFinite(max) || max <= min){
      // Fallback to something sane (should be rare).
      min = 0; max = 1;
    }

    // Small padding to prevent wick/body clipping while keeping the chart "maxed" vertically.
    var span = (max - min);
    // Increase padding if strategy markers are likely to be drawn to avoid clipping.
    var hasStrategy = !!(state && state.backtest && state.backtest.selectedStrategy && state.backtest.selectedStrategy !== 'none');
    var pad = span * (hasStrategy ? 0.12 : 0.02);
    if(!Number.isFinite(pad) || pad <= 0) pad = 1;
    return { min: min - pad, max: max + pad };
  }
    
  function yAxisAutoFit(){
    state.yScaleFactor = 1;
    state.yPan = 0;
    ui.scale.checked = true;
    draw();
  }

  function drawGrid(pricePlot, opts){
    // If opts aren't provided (e.g. no-data state), fall back to a simple evenly-spaced grid.
    var x = pricePlot.x, y = pricePlot.y, w = pricePlot.w, h = pricePlot.h;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;

    // Canvas stroke crispness:
    // A 1px vertical line looks "thicker" if it lands between pixels (antialiasing).
    // Snap X to half-pixel so all vertical grid lines render with a consistent thin weight.
    function _crispX(px){
      return Math.round(px) + 0.5;
    }

    var haveOpts = !!(opts && Number.isFinite(opts.yMin) && Number.isFinite(opts.yMax));
    if(!haveOpts){
      var rows = 6;
      for(var i=0;i<=rows;i++){
        var yy0 = y + (h/rows)*i;
        ctx.beginPath();
        ctx.moveTo(x, yy0);
        ctx.lineTo(x+w, yy0);
        ctx.stroke();
      }
      var cols = 10;
      for(var j=0;j<=cols;j++){
        var xx0 = _crispX(x + (w/cols)*j);
        ctx.beginPath();
        ctx.moveTo(xx0, y);
        ctx.lineTo(xx0, y+h);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // Horizontal grid lines: align to Y-axis price ticks.
    var yMin = Number(opts.yMin), yMax = Number(opts.yMax);
    var yTicksInfo = computePriceTicks(yMin, yMax, pricePlot.h, 58);
    var yTicks = yTicksInfo && yTicksInfo.ticks ? yTicksInfo.ticks : [];
    for(var yi=0; yi<yTicks.length; yi++){
      var p = yTicks[yi];
      var yy = yForPrice(p, pricePlot, yMin, yMax);
      if(!Number.isFinite(yy)) continue;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x+w, yy);
      ctx.stroke();
    }

    // Vertical grid lines: align to X-axis time/date ticks (same step selection as axis labels).
    var start = opts.start, end = opts.end, barsVisible = opts.barsVisible, plot = opts.plot;
    var data = (state && Array.isArray(state.data)) ? state.data : null;
    if(data && Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(barsVisible) && plot && plot.w > 4){
      // Extend vertical grid lines to the full plot height (including volume pane) so they reach
      // the bottom edge of the container. Stay inside the clip inset (see clipInset=1).
      var vTop = plot.y + 1;
      var vBottom = plot.y + plot.h - 1;
      var t0 = Number(data[start] && data[start].t);
      var t1 = Number(data[end] && data[end].t);
      var tInfo = computeTimeTicksBySpan(t0, t1, plot.w, 140);
      if(tInfo){
        for(var tm = tInfo.first; tm <= tInfo.t1; tm += tInfo.stepMs){
          var idx = findIndexByTimeMs(data, tm);
          if(idx < start) idx = start;
          if(idx > end) idx = end;
          var xx = _crispX(xForIndex(idx + 0.5, plot, barsVisible));
          if(!Number.isFinite(xx)) continue;
          if(xx < x - 2 || xx > x + w + 2) continue;
          ctx.beginPath();
          ctx.moveTo(xx, vTop);
          ctx.lineTo(xx, vBottom);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  function xForIndex(i, plot, barsVisible){
    var t = (i - state.xOffset) / barsVisible;
    return plot.x + t * plot.w;
  }

  function yForPrice(p, plot, yMin, yMax){
    var t = (p - yMin) / (yMax - yMin);
    return plot.y + plot.h * (1 - t);
  }

  function niceStep(step){
    // "Nice number" tick step: 1, 2, 5 * 10^n
    var s = Math.abs(Number(step));
    if(!Number.isFinite(s) || s <= 0) return 1;
    var exp = Math.floor(Math.log10(s));
    var f = s / Math.pow(10, exp);
    var nf;
    if(f <= 1) nf = 1;
    else if(f <= 2) nf = 2;
    else if(f <= 5) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }

  function decimalsForStep(step){
    var s = Math.abs(Number(step));
    if(!Number.isFinite(s) || s <= 0) return 2;
    if(s >= 1) return 2;
    // Enough precision to show distinct ticks; cap to keep labels sane.
    var d = Math.ceil(-Math.log10(s)) + 1;
    return clamp(d, 2, 6);
  }

  function computePriceTicks(yMin, yMax, plotH, minPxPerTick){
    var a = Number(yMin), b = Number(yMax);
    if(!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
    var h = Number(plotH);
    if(!Number.isFinite(h) || h <= 0) h = 500;
    var minPx = Number(minPxPerTick);
    if(!Number.isFinite(minPx) || minPx < 20) minPx = 58;

    var targetTicks = clamp(Math.floor(h / minPx), 3, 12);
    var raw = (b - a) / targetTicks;
    var step = niceStep(raw);
    if(!Number.isFinite(step) || step <= 0) step = raw;

    // Expand to nice boundaries so ticks align to round prices.
    var lo = Math.floor(a / step) * step;
    var hi = Math.ceil(b / step) * step;
    // Guard against floating drift.
    var eps = step * 1e-9;

    var out = [];
    for(var v = lo; v <= hi + eps; v += step){
      // Avoid -0.00
      var vv = (Math.abs(v) < eps) ? 0 : v;
      out.push(vv);
      if(out.length > 200) break;
    }
    // Keep only ticks that land within the visible range (with small epsilon).
    var out2 = [];
    for(var i=0;i<out.length;i++){
      var t = out[i];
      if(t >= a - eps && t <= b + eps) out2.push(t);
    }
    return { ticks: out2, step: step };
  }

  function chooseTimeStepMs(spanMs, plotW, minPxPerTick){
    // Pick a tick step so labels don't overlap.
    // NOTE: This is intentionally "pixel-aware": we estimate how many ticks we can fit
    // based on the plot width, then choose the nearest step >= target.
    var span = Number(spanMs);
    if(!Number.isFinite(span) || span <= 0) return 60 * 1000;
    var plotWidth = Number(plotW);
    var minPx = Number(minPxPerTick);
    if(!Number.isFinite(plotWidth) || plotWidth <= 0) plotWidth = 900;
    if(!Number.isFinite(minPx) || minPx <= 10) minPx = 140;

    var maxTicks = Math.max(2, Math.floor(plotWidth / minPx));
    var target = Math.max(1, Math.floor(span / maxTicks)); // ms per tick

    var steps = [
      1000, 2000, 5000, 10_000, 15_000, 30_000,
      60_000, 2*60_000, 5*60_000, 10*60_000, 15*60_000, 30*60_000,
      60*60_000, 2*60*60_000, 4*60*60_000, 6*60*60_000, 12*60*60_000,
      24*60*60_000, 2*24*60*60_000, 7*24*60*60_000, 14*24*60*60_000, 30*24*60*60_000
    ];
    for(var i=0;i<steps.length;i++){
      if(steps[i] >= target) return steps[i];
    }
    return steps[steps.length-1];
  }

  function chooseMonthStep(monthCount, plotW, minPxPerTick){
    // Choose a month stride so labels don't overlap when zoomed out.
    var m = Math.max(0, Math.floor(Number(monthCount) || 0));
    if(m <= 0) return 1;
    var plotWidth = Number(plotW);
    var minPx = Number(minPxPerTick);
    if(!Number.isFinite(plotWidth) || plotWidth <= 0) plotWidth = 900;
    if(!Number.isFinite(minPx) || minPx <= 10) minPx = 140;
    var maxTicks = Math.max(2, Math.floor(plotWidth / minPx));
    var target = Math.max(1, Math.ceil(m / maxTicks));
    var steps = [1, 2, 3, 6, 12];
    for(var i=0;i<steps.length;i++){
      if(steps[i] >= target) return steps[i];
    }
    return steps[steps.length-1];
  }

  function computeTimeTicksBySpan(t0, t1, plotW, minPxPerTick){
    var a = Number(t0), b = Number(t1);
    if(!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
    var spanMs = b - a;
    var stepMs = chooseTimeStepMs(spanMs, plotW, minPxPerTick);
    var first = Math.floor(a / stepMs) * stepMs;
    if(first < a) first += stepMs;
    return { stepMs: stepMs, first: first, t0: a, t1: b };
  }

  // Display timezone: NYSE / Eastern Time (handles EST/EDT automatically).
  var DISPLAY_TZ = 'America/New_York';

  function fmtEt(ms, opts){
    try{
      var d = new Date(ms);
      if(!Number.isFinite(d.getTime())) return '';
      return new Intl.DateTimeFormat('en-US', Object.assign({
        timeZone: DISPLAY_TZ
      }, (opts || {}))).format(d);
    } catch(_e){
      // Fallback: local time
      var dd = new Date(ms);
      return (Number.isFinite(dd.getTime()) ? dd.toLocaleString() : '');
    }
  }

  function formatTimeLabelUtc(ms, stepMs){
    // (Name kept for minimal diff) Render in ET, 12-hour time.
    if(stepMs < 60_000) return fmtEt(ms, { hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true });
    if(stepMs < 24*60*60_000) return fmtEt(ms, { hour:'numeric', minute:'2-digit', hour12:true });
    return fmtEt(ms, { year:'numeric', month:'2-digit', day:'2-digit' });
  }

  function formatDayLabelPartsUtc(ms, prevMs){
    // (Name kept for minimal diff) Returns {top,bottom} in ET: top=month at transitions, bottom=day number.
    var day = fmtEt(ms, { day:'numeric' });
    var top = '';
    var mon = fmtEt(ms, { month:'short' });
    var ym = fmtEt(ms, { year:'numeric', month:'2-digit' });
    var prevYm = (prevMs === null || prevMs === undefined) ? '' : fmtEt(prevMs, { year:'numeric', month:'2-digit' });
    if(!prevYm || prevYm !== ym) top = mon;
    // also show month on the 1st
    var dayNum = parseInt(String(day), 10);
    if(dayNum === 1) top = mon;
    return { top: top, bottom: String(day) };
  }

  function formatTooltipTimeUtc(ms){
    // (Name kept for minimal diff) Tooltip/crosshair time in ET, non-military, with TZ abbreviation.
    return fmtEt(ms, { year:'numeric', month:'2-digit', day:'2-digit', hour:'numeric', minute:'2-digit', hour12:true, timeZoneName:'short' });
  }

  function formatAxisTimeUtc(ms, stepMs){
    // (Name kept for minimal diff) Compact axis label in ET.
    // If we're zoomed out to multi-week+ spans, day-of-month is noisy; show month+year.
    if(Number(stepMs) >= 14*24*60*60_000) return fmtEt(ms, { month:'short', year:'numeric' });
    if(Number(stepMs) >= 24*60*60_000) return fmtEt(ms, { month:'short', day:'numeric' });
    return fmtEt(ms, { hour:'numeric', minute:'2-digit', hour12:true });
  }

  function formatVolume(v){
    var x = Number(v);
    if(!Number.isFinite(x)) return '';
    var ax = Math.abs(x);
    if(ax >= 1e9) return (x/1e9).toFixed(2).replace(/\.00$/,'') + 'B';
    if(ax >= 1e6) return (x/1e6).toFixed(2).replace(/\.00$/,'') + 'M';
    if(ax >= 1e3) return (x/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return String(Math.round(x));
  }

  function computeHeikinAshi(bars){
    // Returns an array of {o,h,l,c} (same length as bars).
    // HA is sequential:
    // haClose = (o + h + l + c)/4
    // haOpen  = (prevHaOpen + prevHaClose)/2, seed: (o0 + c0)/2
    // haHigh  = max(h, haOpen, haClose)
    // haLow   = min(l, haOpen, haClose)
    if(!Array.isArray(bars) || !bars.length) return [];
    var out = new Array(bars.length);
    var prevOpen = NaN;
    var prevClose = NaN;
    for(var i=0;i<bars.length;i++){
      var b = bars[i];
      if(!b){
        out[i] = { o: NaN, h: NaN, l: NaN, c: NaN };
        continue;
      }
      var o = Number(b.o), h = Number(b.h), l = Number(b.l), c = Number(b.c);
      var haClose = (o + h + l + c) / 4;
      var haOpen = (i === 0 || !Number.isFinite(prevOpen) || !Number.isFinite(prevClose)) ? ((o + c) / 2) : ((prevOpen + prevClose) / 2);
      var haHigh = Math.max(h, haOpen, haClose);
      var haLow = Math.min(l, haOpen, haClose);
      out[i] = { o: haOpen, h: haHigh, l: haLow, c: haClose };
      prevOpen = haOpen;
      prevClose = haClose;
    }
    return out;
  }

  function findIndexByTimeMs(data, tMs){
    // data must be sorted by .t ascending.
    var lo = 0, hi = data.length - 1;
    while(lo <= hi){
      var mid = (lo + hi) >> 1;
      var v = data[mid].t;
      if(v < tMs) lo = mid + 1;
      else if(v > tMs) hi = mid - 1;
      else return mid;
    }
    return clamp(lo, 0, data.length - 1);
  }

  function rightAlignXView(){
    // Default trading-chart convention: start with "current" (right edge) in view.
    // This is the programmatic equivalent of panning all the way to the right.
    var n = (state && Array.isArray(state.data)) ? state.data.length : 0;
    if(!n) return;
    var z = Number(state.xZoom);
    if(!Number.isFinite(z) || z <= 0) z = 1;
    // IMPORTANT:
    // - barsVisibleData determines how many real bars we can pan over (xOffset clamp).
    // - Rendering may use additional "future" padding bars (replay UX) via barsVisibleScale,
    //   but we never allow xOffset to scroll into non-existent bars.
    var barsVisibleData = Math.min(n, Math.max(8, Math.floor(n / z)));
    state.xOffset = Math.max(0, n - barsVisibleData);
  }

  function futurePadBars(){
    // Practice / replay UX: reserve a small empty "future" region to the right so the
    // user can visually project trade placement without showing future candles.
    // Measured in "bar widths" (slots), not pixels.
    try{
      return (state && state.replay && state.replay.active) ? 5 : 0;
    } catch(_e){
      return 0;
    }
  }

  function computeVisibleBars(n, zoom){
    var nn = Math.max(0, Math.floor(Number(n) || 0));
    var z = Number(zoom);
    if(!Number.isFinite(z) || z <= 0) z = 1;
    // "Data bars" controls offsets/bounds.
    var barsVisibleData = Math.min(nn, Math.max(8, Math.floor(nn / z)));
    // "Scale bars" controls horizontal mapping (slot count across the plot).
    var pad = Math.max(0, Math.floor(Number(futurePadBars()) || 0));
    var barsVisibleScale = Math.max(1, Math.floor(barsVisibleData + pad));
    return { barsVisibleData: barsVisibleData, barsVisibleScale: barsVisibleScale, padBars: pad };
  }
