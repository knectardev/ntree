'use strict';

// helpers
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }

  function getQueryParam(key, fallback){
    var qs = window.location.search || '';
    var re = new RegExp('[?&]' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^&]*)');
    var m = re.exec(qs);
    if(!m) return fallback;
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  }

  function truthyQueryParam(key){
    try{
      var v = String(getQueryParam(key, '') || '').trim().toLowerCase();
      if(!v) return false;
      return (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on');
    } catch(_e){
      return false;
    }
  }

  function regenButtonLabel(){
    // Single action button label.
    return STATIC_MODE ? 'Load snapshot' : 'Fetch Latest Data';
  }

    function getOverlaySettings(){
    return {
      ema9: !!(ui.indEma9 && ui.indEma9.checked),
      ema21: !!(ui.indEma21 && ui.indEma21.checked),
      ema50: !!(ui.indEma50 && ui.indEma50.checked),
      vwap: !!(ui.indVwap && ui.indVwap.checked),
        // candlestick bias intentionally disabled/hidden
        candleBias: false
    };
  }

  function anyOverlayEnabled(s){
    if(!s) return false;
    return !!(s.ema9 || s.ema21 || s.ema50 || s.vwap);
  }

  // Overlay cache keyed by (symbol, bar_s, firstT, lastT, seriesKey)
  var overlayCache = Object.create(null);

  function cacheGet(key){ return overlayCache[key] || null; }
  function cacheSet(key, val){ overlayCache[key] = val; return val; }

  function emaFromClose(t_ms, close, period){
    var n = Math.min(Array.isArray(t_ms) ? t_ms.length : 0, Array.isArray(close) ? close.length : 0);
    if(n <= 0) return null;
    var p = Math.max(1, Math.floor(Number(period) || 1));
    var k = 2 / (p + 1);
    var y = new Array(n);
    var ema = Number(close[0]);
    if(!Number.isFinite(ema)) ema = 0;
    y[0] = ema;
    for(var i=1;i<n;i++){
      var c = Number(close[i]);
      if(!Number.isFinite(c)) c = ema;
      ema = c * k + ema * (1 - k);
      y[i] = ema;
    }
    return { t_ms: t_ms.slice(0, n), y: y, key: 'ema_' + p, label: 'EMA ' + p };
  }

  // Efficient ET part extraction (for session-reset VWAP).
  var _etPartsFmt = null;
  function etParts(ms){
    if(!_etPartsFmt){
      _etPartsFmt = new Intl.DateTimeFormat('en-US', {
        timeZone: DISPLAY_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }
    var parts = _etPartsFmt.formatToParts(new Date(ms));
    var y=0,m=0,d=0,hh=0,mm=0;
    for(var i=0;i<parts.length;i++){
      var p = parts[i];
      if(p.type === 'year') y = parseInt(p.value, 10);
      else if(p.type === 'month') m = parseInt(p.value, 10);
      else if(p.type === 'day') d = parseInt(p.value, 10);
      else if(p.type === 'hour') hh = parseInt(p.value, 10);
      else if(p.type === 'minute') mm = parseInt(p.value, 10);
    }
    var dayKey = String(y).padStart(4,'0') + String(m).padStart(2,'0') + String(d).padStart(2,'0');
    var mins = hh * 60 + mm;
    return { y:y, m:m, d:d, hh:hh, mm:mm, dayKey: dayKey, mins: mins };
  }

  function findUtcMsForEtLocal(y, m, d, hh, mm){
    // Brute-force within +/- 12h of an EST guess; called rarely (per fetch) so it's fine.
    var guess = Date.UTC(y, m-1, d, hh + 5, mm, 0, 0);
    for(var delta=-720; delta<=720; delta++){
      var ms = guess + delta * 60_000;
      var p = etParts(ms);
      if(p.y === y && p.m === m && p.d === d && p.hh === hh && p.mm === mm) return ms;
    }
    return guess;
  }

  function sessionStartMsForEtDay(anyMs){
    var p = etParts(anyMs);
    if(!p || !p.y) return NaN;
    return findUtcMsForEtLocal(p.y, p.m, p.d, 9, 30);
  }

  // Market session vertical shading (ET schedule)
  var MARKET_HOURS_COLORS = {
    // Keep regular-hours overlay faint so grid lines remain visible
    regular: 'rgba(0, 0, 0, 0.9)',
    pre_market: 'rgba(0, 0, 0, 0.6)',
    after_hours: 'rgba(0, 0, 0, 0.3)',
    closed: 'rgba(149, 165, 166, 0.10)'
  };

  function sessionTypeForMsEt(ms){
    // Returns one of: 'regular' | 'pre_market' | 'after_hours' | 'closed'
    var p = etParts(ms);
    if(!p || !Number.isFinite(p.mins)) return 'closed';
    var mins = p.mins;
    var preStart = 4*60;          // 04:00
    var rthStart = 9*60 + 30;     // 09:30
    var rthEnd = 16*60;           // 16:00
    var ahEnd = 20*60;            // 20:00
    if(mins >= preStart && mins < rthStart) return 'pre_market';
    if(mins >= rthStart && mins < rthEnd) return 'regular';
    if(mins >= rthEnd && mins < ahEnd) return 'after_hours';
    return 'closed';
  }

  function computeSessionTypesForData(data){
    var n = Array.isArray(data) ? data.length : 0;
    var out = new Array(n);
    for(var i=0;i<n;i++){
      var d = data[i];
      var tm = d ? Number(d.t) : NaN;
      out[i] = Number.isFinite(tm) ? sessionTypeForMsEt(tm) : 'closed';
    }
    return out;
  }

  function drawSessionShading(plot, start, end, barsVisible){
    try{
      if(!plot || plot.w <= 1 || plot.h <= 1) return;
      if(!Array.isArray(state.data) || !state.data.length) return;

      // Practice / replay mode: keep the chart background uniform black.
      // The play controls already communicate the mode; session shading can read like a "gray overlay".
      try{
        if(state && state.replay && state.replay.active){
          ctx.save();
          ctx.fillStyle = MARKET_HOURS_COLORS.regular || 'rgba(0, 0, 0, 0.9)';
          ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
          ctx.restore();
          return;
        }
      } catch(_eReplayBg){}

      var types = state._sessionType;
      if(!Array.isArray(types) || types.length !== state.data.length){
        // Lazy repair (should normally be set on load/merge).
        state._sessionType = computeSessionTypesForData(state.data);
        types = state._sessionType;
      }

      var showPre = ui.sessPreMarket ? !!ui.sessPreMarket.checked : true;
      var showAfter = ui.sessAfterHours ? !!ui.sessAfterHours.checked : true;
      var showClosed = ui.sessClosed ? !!ui.sessClosed.checked : true;

      function enabledForType(t){
        if(t === 'pre_market') return showPre;
        if(t === 'after_hours') return showAfter;
        if(t === 'closed') return showClosed;
        return true; // regular always on
      }

      function paintSeg(type, i0, i1){
        if(!enabledForType(type)) return;
        var x0 = xForIndex(i0, plot, barsVisible);
        var x1 = xForIndex(i1 + 1, plot, barsVisible);
        if(!Number.isFinite(x0) || !Number.isFinite(x1)) return;
        // Clamp to plot bounds
        var left = Math.max(plot.x, Math.min(x0, x1));
        var right = Math.min(plot.x + plot.w, Math.max(x0, x1));
        if(right <= left) return;
        ctx.save();
        ctx.fillStyle = MARKET_HOURS_COLORS[type] || MARKET_HOURS_COLORS.closed;
        ctx.fillRect(left, plot.y, right - left, plot.h);
        ctx.restore();
      }

      var curType = null;
      var segStart = start;
      for(var i=start; i<=end; i++){
        var t = types[i] || 'closed';
        if(curType === null){ curType = t; segStart = i; continue; }
        if(t !== curType){
          paintSeg(curType, segStart, i-1);
          curType = t;
          segStart = i;
        }
      }
      if(curType !== null) paintSeg(curType, segStart, end);

      // Replay "future padding": extend the last visible session shading into the empty
      // projection region so the right-side background matches the left/past background.
      // This does NOT create candles; it only colors the plot background.
      try{
        var padBars = Math.max(0, Math.floor(Number(futurePadBars()) || 0));
        if(padBars > 0){
          // Always use the "regular" (black) shade for the projection area.
          // Otherwise, if the last visible bar is a 'closed' session, the padding can look gray,
          // which reads like a mode indicator. Practice controls already make mode obvious.
          paintSeg('regular', end + 1, end + padBars);
        }
      } catch(_ePad){}
    } catch(_e){
      // Never let shading break the chart.
    }
  }

  function getSessionFilterFlags(){
    return {
      pre: ui.sessPreMarket ? !!ui.sessPreMarket.checked : true,
      after: ui.sessAfterHours ? !!ui.sessAfterHours.checked : true,
      closed: ui.sessClosed ? !!ui.sessClosed.checked : true
    };
  }

  function sessionTypeAllowed(type, flags){
    // Regular is always included; the toggles control extended/closed sessions.
    if(type === 'pre_market') return !!(flags && flags.pre);
    if(type === 'after_hours') return !!(flags && flags.after);
    if(type === 'closed') return !!(flags && flags.closed);
    return true;
  }

  function barsToArrays(data){
    var n = Array.isArray(data) ? data.length : 0;
    var t_ms = new Array(n);
    var o = new Array(n);
    var h = new Array(n);
    var l = new Array(n);
    var c = new Array(n);
    var v = new Array(n);
    for(var i=0;i<n;i++){
      var d = data[i];
      t_ms[i] = d ? Number(d.t) : NaN;
      o[i] = d ? Number(d.o) : NaN;
      h[i] = d ? Number(d.h) : NaN;
      l[i] = d ? Number(d.l) : NaN;
      c[i] = d ? Number(d.c) : NaN;
      v[i] = d ? Number(d.v) : NaN;
    }
    return { t_ms: t_ms, o: o, h: h, l: l, c: c, v: v };
  }

  function overlaysFromReplayState(overlaysObj, settings, allowedTms){
    // Convert server-provided replay overlays to the local overlay-series format:
    // [{t_ms:[], y:[], key,label,color,width}]
    var out = [];
    if(!overlaysObj || !settings || !allowedTms) return out;

    function buildSeries(points, key, label, color, width){
      if(!Array.isArray(points) || !points.length) return null;
      var t_ms = [];
      var y = [];
      for(var i=0;i<points.length;i++){
        var p = points[i];
        if(!p) continue;
        var tm = parseIsoToMs(p.ts);
        if(!Number.isFinite(tm)) continue;
        if(!allowedTms.has(tm)) continue;
        t_ms.push(tm);
        var v = (p.v === null || p.v === undefined) ? NaN : Number(p.v);
        y.push(Number.isFinite(v) ? v : NaN);
      }
      return { t_ms: t_ms, y: y, key: key, label: label, color: color, width: width };
    }

    try{
      var ema = overlaysObj.ema || {};
      if(settings.ema9){
        var s9 = buildSeries(ema["9"], "ema_9", "EMA 9", "rgba(215,224,234,0.92)", 1.25);
        if(s9) out.push(s9);
      }
      if(settings.ema21){
        var s21 = buildSeries(ema["21"], "ema_21", "EMA 21", "rgba(215,224,234,0.72)", 1.25);
        if(s21) out.push(s21);
      }
      if(settings.ema50){
        var s50 = buildSeries(ema["50"], "ema_50", "EMA 50", "rgba(215,224,234,0.52)", 1.25);
        if(s50) out.push(s50);
      }
      if(settings.vwap){
        var vw = buildSeries(overlaysObj.vwap, "vwap_session", "VWAP", "rgb(255, 215, 0)", 1.55);
        if(vw) out.push(vw);
      }
    } catch(_e){}
    return out;
  }

  function replayOverlaysAvailable(overlaysObj){
    // Replay backend may return `overlays: {}` (empty) even though UI supports local EMA/VWAP.
    // Only treat replay overlays as usable if they contain actual series points.
    try{
      if(!overlaysObj || typeof overlaysObj !== 'object') return false;
      if(Array.isArray(overlaysObj.vwap) && overlaysObj.vwap.length) return true;
      var ema = overlaysObj.ema;
      if(ema && typeof ema === 'object'){
        // Any EMA period with points counts.
        var keys = Object.keys(ema);
        for(var i=0;i<keys.length;i++){
          var k = keys[i];
          var arr = ema[k];
          if(Array.isArray(arr) && arr.length) return true;
        }
      }
      return false;
    } catch(_e){
      return false;
    }
  }

  function captureViewAnchor(){
    // Snapshot a time anchor near the center of the current view so filtering doesn't "jump" wildly.
    try{
      var anchorZoom = Number(state.xZoom);
      if(!Number.isFinite(anchorZoom) || anchorZoom <= 0) anchorZoom = 1;
      var anchorT = NaN;
      if(!state.followLatest && Array.isArray(state.data) && state.data.length){
        var n0 = state.data.length;
        var barsVis0 = Math.min(n0, Math.max(8, Math.floor(n0 / anchorZoom)));
        var off0 = Number(state.xOffset);
        if(!Number.isFinite(off0)) off0 = 0;
        var centerIdx = Math.floor(off0 + barsVis0 * 0.5);
        centerIdx = clamp(centerIdx, 0, n0 - 1);
        anchorT = Number(state.data[centerIdx].t);
      }
      return { t: anchorT, zoom: anchorZoom };
    } catch(_e){
      return { t: NaN, zoom: Number(state.xZoom) || 1 };
    }
  }

  function applySessionFilter(opts){
    // TradingView-style: toggles remove the actual bars (candles/volume/indicators), not just shading.
    var o = opts || {};
    var base = (Array.isArray(state.dataFull) && state.dataFull.length) ? state.dataFull : state.data;
    if(!Array.isArray(base)) base = [];

    var anchor = o.anchor || captureViewAnchor();
    var flags = getSessionFilterFlags();

    var filtered = [];
    for(var i=0;i<base.length;i++){
      var d = base[i];
      if(!d) continue;
      var tm = Number(d.t);
      var st = Number.isFinite(tm) ? sessionTypeForMsEt(tm) : 'closed';
      if(sessionTypeAllowed(st, flags)) filtered.push(d);
    }

    // If the chosen session filters yield no bars, auto-recover to "show all sessions"
    // to avoid an empty/blank chart (common source of "crash" reports when zooming).
    if(!filtered.length && base.length){
      try{
        if(ui.sessPreMarket) ui.sessPreMarket.checked = true;
        if(ui.sessAfterHours) ui.sessAfterHours.checked = true;
        if(ui.sessClosed) ui.sessClosed.checked = true;
      } catch(_e0){}
      filtered = base.slice();
      flags = getSessionFilterFlags();
    }

    state.data = filtered;
    state._sessionType = computeSessionTypesForData(filtered);
    // Heikin-Ashi is only needed when Candles are shown AND HA mode is selected.
    // Avoid recomputing HA every time replay advances if we're not rendering HA candles.
    try{
      var needHa = !!(ui && ui.showCandles && ui.showCandles.checked && state && state.candleStyle === 'ha');
      state.ha = needHa ? computeHeikinAshi(filtered) : [];
    } catch(_eHa){
      state.ha = [];
    }

    // Overlays:
    // - In replay mode, prefer server-provided overlays only if they actually contain data.
    //   (Backend may emit `overlays: {}`; in that case we compute locally so EMA/VWAP stays visible.)
    // - Otherwise, compute locally from the loaded payload.
    try{
      var os = getOverlaySettings();
      if(os && anyOverlayEnabled(os) && filtered.length){
        if(
          state && state.replay && state.replay.active &&
          state.replay.lastState && replayOverlaysAvailable(state.replay.lastState.overlays)
        ){
          var allowed = new Set();
          for(var ii=0; ii<filtered.length; ii++){
            var d2 = filtered[ii];
            if(d2 && Number.isFinite(Number(d2.t))) allowed.add(Number(d2.t));
          }
          state.overlays = overlaysFromReplayState(state.replay.lastState.overlays, os, allowed);
        } else {
          var arrs = barsToArrays(filtered);
          state.overlays = computeOverlays(
            arrs,
            os,
            { symbol: String(getSymbol() || ''), bar_s: Math.floor(Number(state.windowSec) || 60) }
          );
        }
      } else {
        state.overlays = [];
      }
    } catch(_e2){
      state.overlays = [];
    }

    // Keep view policy consistent with loads: followLatest stays right-aligned, otherwise re-center on anchor time.
    try{
      if(!Number.isFinite(state.xZoom) || state.xZoom <= 0) state.xZoom = 1;
      if(state.followLatest){
        rightAlignXView();
      } else if(Number.isFinite(anchor && anchor.t) && state.data.length){
        state.xZoom = Number(anchor.zoom) || state.xZoom;
        var n1 = state.data.length;
        var barsVis1 = computeVisibleBars(n1, state.xZoom).barsVisibleData;
        var idx1 = findIndexByTimeMs(state.data, anchor.t);
        state.xOffset = idx1 - barsVis1 * 0.5;
      }
    } catch(_e3){}

    // Clamp xOffset to new bounds and clear hover (indices changed).
    try{
      state.hoverIdx = -1;
      var n2 = state.data.length;
      if(n2){
        var barsVisibleData = computeVisibleBars(n2, state.xZoom).barsVisibleData;
        var maxOff = Math.max(0, n2 - barsVisibleData);
        state.xOffset = clamp(Number(state.xOffset) || 0, 0, maxOff);
      } else {
        state.xOffset = 0;
      }
    } catch(_e4){}

    // Update counts from the unfiltered window so users can tell when a session has 0 bars.
    updateSessionCountsUi();

    if(!o.skipDraw) draw();
    if(!o.skipSave) scheduleSaveUiConfig();
  }

  function updateSessionCountsUi(){
    try{
      var base = (Array.isArray(state.dataFull) && state.dataFull.length) ? state.dataFull : state.data;
      if(!Array.isArray(base) || !base.length) return;
      var pre = 0, after = 0, closed = 0, reg = 0;
      for(var i=0;i<base.length;i++){
        var d = base[i];
        if(!d) continue;
        var tm = Number(d.t);
        var st = Number.isFinite(tm) ? sessionTypeForMsEt(tm) : 'closed';
        if(st === 'pre_market') pre++;
        else if(st === 'after_hours') after++;
        else if(st === 'closed') closed++;
        else reg++;
      }
      var elPre = document.getElementById('sessCountPre');
      var elAfter = document.getElementById('sessCountAfter');
      var elClosed = document.getElementById('sessCountClosed');
      if(elPre) elPre.textContent = String(pre);
      if(elAfter) elAfter.textContent = String(after);
      if(elClosed) elClosed.textContent = String(closed);
    } catch(_e){}
  }

  function vwapSession(bars){
    // bars: {t_ms,h,l,c,v}
    var t_ms = bars.t_ms, h = bars.h, l = bars.l, c = bars.c, v = bars.v;
    var n = Math.min(t_ms.length, h.length, l.length, c.length, v.length);
    if(n <= 0) return null;
    var y = new Array(n);
    var cumPV = 0;
    var cumV = 0;
    var prevDay = '';
    var prevMins = -1;
    var openMins = 9*60 + 30;
    var closeMins = 16*60;
    var lastRegVwap = NaN;
    for(var i=0;i<n;i++){
      var tm = Number(t_ms[i]);
      if(!Number.isFinite(tm)) { y[i] = NaN; continue; }
      var p = etParts(tm);
      var reset = false;
      if(i === 0) reset = true;
      else if(p.dayKey !== prevDay) reset = true;
      else if(prevMins < openMins && p.mins >= openMins) reset = true;
      if(reset){ cumPV = 0; cumV = 0; lastRegVwap = NaN; }

      // Anchor VWAP to 09:30 ET:
      // - Before 09:30: no VWAP (don't accumulate premarket prints)
      // - Regular session: accumulate
      // - After 16:00: hold last regular VWAP flat
      if(p.mins < openMins){
        y[i] = NaN;
        prevDay = p.dayKey;
        prevMins = p.mins;
        continue;
      }
      if(p.mins >= closeMins){
        y[i] = Number.isFinite(lastRegVwap) ? lastRegVwap : NaN;
        prevDay = p.dayKey;
        prevMins = p.mins;
        continue;
      }
      var tp = (Number(h[i]) + Number(l[i]) + Number(c[i])) / 3;
      if(!Number.isFinite(tp)) tp = Number(c[i]);
      var vv = Number(v[i]);
      if(!Number.isFinite(vv) || vv < 0) vv = 0;
      cumPV += tp * vv;
      cumV += vv;
      y[i] = (cumV > 0) ? (cumPV / cumV) : tp;
      lastRegVwap = y[i];
      prevDay = p.dayKey;
      prevMins = p.mins;
    }
    return { t_ms: t_ms.slice(0, n), y: y, key: 'vwap_session', label: 'VWAP' };
  }

  function computeOverlays(bars, settings, meta){
    var out = [];
    if(!bars || !Array.isArray(bars.t_ms) || !bars.t_ms.length) return out;
    if(!settings || !anyOverlayEnabled(settings)) return out;
    var sym = meta && meta.symbol ? String(meta.symbol) : '';
    var barS = meta && meta.bar_s ? String(Math.floor(meta.bar_s)) : '';
    var firstT = Number(bars.t_ms[0]);
    var lastT = Number(bars.t_ms[bars.t_ms.length - 1]);
    // Include length so cached overlays can't be incorrectly reused for filtered windows that share
    // the same [firstT,lastT] but contain fewer bars (e.g. when extended hours are hidden).
    var n0 = Math.floor(Number(bars.t_ms.length) || 0);
    var baseKey = sym + '|' + barS + '|' + String(firstT) + '|' + String(lastT) + '|' + String(n0) + '|';

    function getOrCompute(seriesKey, computeFn){
      var k = baseKey + seriesKey;
      var cached = cacheGet(k);
      if(cached) return cached;
      var val = computeFn();
      if(val) cacheSet(k, val);
      return val;
    }

    if(settings.ema9){
      var s9 = getOrCompute('ema_9', function(){ return emaFromClose(bars.t_ms, bars.c, 9); });
      if(s9){ s9.color = 'rgba(215,224,234,0.92)'; s9.width = 1.25; out.push(s9); }
    }
    if(settings.ema21){
      var s21 = getOrCompute('ema_21', function(){ return emaFromClose(bars.t_ms, bars.c, 21); });
      if(s21){ s21.color = 'rgba(215,224,234,0.72)'; s21.width = 1.25; out.push(s21); }
    }
    if(settings.ema50){
      var s50 = getOrCompute('ema_50', function(){ return emaFromClose(bars.t_ms, bars.c, 50); });
      if(s50){ s50.color = 'rgba(215,224,234,0.52)'; s50.width = 1.25; out.push(s50); }
    }
    if(settings.vwap){
      var vw = getOrCompute('vwap_session', function(){ return vwapSession(bars); });
      if(vw){ vw.color = 'rgb(255, 215, 0)'; vw.width = 1.55; out.push(vw); }
    }
    return out;
  }
