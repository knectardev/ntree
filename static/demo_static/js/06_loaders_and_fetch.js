'use strict';

  async function loadFromAPI(force){
    if(STATIC_MODE){
      return await loadFromStatic(force);
    }
    // When practicing (replay mode), the authoritative data source is /replay/*.
    // Avoid background /window fetches overwriting replay state.
    if(state && state.replay && state.replay.active){
      return;
    }
    // Prevent overlapping requests from live polling / repeated UI events.
    // We still allow internal "one-hop" recursion (Auto W refinement) via force=true.
    if(!force && ui.regen && ui.regen.disabled) return;
    // Prevent out-of-order fetches (e.g. rapid slider drags) from overwriting newer data.
    state._reqSeq = (state._reqSeq || 0) + 1;
    var myReq = state._reqSeq;

    var symbol = String(getSymbol() || 'ESZ5').trim();
    if(!symbol) symbol = 'ESZ5';

    // Optional pass-through query params, if your backend supports them.
    var start = getQueryParam('start', '');
    var end = getQueryParam('end', '');
    var maxBarsQ = getQueryParam('max_bars', '');
    var limit = getQueryParam('limit', ''); // back-compat
    var explicitWindow = !!(start && end);
    var derivedWindow = false;
    var hadReqWindow = false;
    var reqStartMs = NaN;
    var reqEndMs = NaN;
    // If we start with unknown bounds, the server will default to "last hour ending at dataset end".
    // After the first response we can learn dataset_end and then request our preferred default window.
    var postBootstrapInitialWindow = false;

    // Cap the payload by default. If `max_bars` is set, use it; else fall back to legacy `limit`.
    // Auto W will increase bar_s to keep the returned bar count within this budget.
    var effMaxBars = (maxBarsQ !== '' ? maxBarsQ : (limit !== '' ? limit : '5000'));

    // If caller didn't specify a start/end in the URL, drive the request from the app's view anchors:
    //   - state.viewEndMs: right edge of requested window
    //   - state.viewSpanMs: requested window span (not the full dataset)
    //
    // When following latest, intentionally omit `end` so the backend can extend the window using live data.
    // When NOT following latest (manual browsing), send explicit end so panning/zooming is stable.
    if(!start && !end){
      if(Number.isFinite(state.datasetStartMs) && Number.isFinite(state.datasetEndMs)){
        var dsStart = Number(state.datasetStartMs);
        var dsEnd = Number(state.datasetEndMs);

        // Initialize anchors if unset.
        if(!Number.isFinite(state.viewEndMs)) state.viewEndMs = dsEnd;
        if(!Number.isFinite(state.viewSpanMs) || state.viewSpanMs <= 0){
          state.viewSpanMs = DEFAULT_INIT_SPAN_MS;
        }

        // Clamp anchors to dataset bounds.
        var spanMs0 = clamp(Number(state.viewSpanMs), 60*1000, Math.max(60*1000, dsEnd - dsStart));
        var endMs0 = clamp(Number(state.viewEndMs), dsStart + spanMs0, dsEnd);
        var startMs0 = Math.max(dsStart, endMs0 - spanMs0);

        state.viewSpanMs = spanMs0;
        state.viewEndMs = endMs0;
        syncSpanPresetFromNavigation();

        start = msToIsoZ(startMs0);
        // omit end only in followLatest mode so server can extend window with live
        end = state.followLatest ? '' : msToIsoZ(endMs0);

        derivedWindow = true;
        reqStartMs = startMs0;
        reqEndMs = endMs0;
      }
    } else {
    // URL-driven explicit window disables followLatest.
      state.followLatest = false;
      if(start && end){
        reqStartMs = parseIsoToMs(start);
        reqEndMs = parseIsoToMs(end);
      }
    }
    hadReqWindow = !!(explicitWindow || derivedWindow);

    // Auto bar sizing: choose bar_s using the *visible* span implied by zoom (not the full dataset span).
    // Target ~300–500 candles on screen (clamped 150–800).
    // If start/end aren't provided, we'll optionally do a one-time post-adjust using the server window labels.
    var autoW = (ui.autoW ? !!ui.autoW.checked : false);
    if(autoW && start && end){
      var sMs = parseIsoToMs(start);
      var eMs = parseIsoToMs(end);
      if(Number.isFinite(sMs) && Number.isFinite(eMs) && eMs > sMs){
        var visSpanMsA = getVisibleSpanMs(eMs - sMs);
        var rec = recommendBarSecForVisibleSpan(visSpanMsA, effMaxBars);
        state.windowSec = rec;
        if(ui.window) ui.window.value = String(rec);
        if(ui.windowVal) ui.windowVal.textContent = formatWindow(rec);
        syncBarPresetUi();
        updateUrlBarSize();
      }
    } else if(autoW && Number.isFinite(state.viewSpanMs) && state.viewSpanMs > 0){
      // Prefer the currently requested span (derived window or previously set viewSpanMs).
      var visSpanMsB = getVisibleSpanMs(state.viewSpanMs);
      if(Number.isFinite(visSpanMsB) && visSpanMsB > 0){
        var rec2 = recommendBarSecForVisibleSpan(visSpanMsB, effMaxBars);
        state.windowSec = rec2;
        if(ui.window) ui.window.value = String(rec2);
        if(ui.windowVal) ui.windowVal.textContent = formatWindow(rec2);
        syncBarPresetUi();
        updateUrlBarSize();
      }
    }

    // Bar size: UI drives bar_s; always normalize to preset increments (snapped state).
    var bar_s = clamp(Number(state.windowSec || ui.window.value || 60), 30, 86400);
    if(!Number.isFinite(bar_s)) bar_s = 60;
    bar_s = snapToPreset(bar_s);
    state.windowSec = bar_s;
    if(ui.window) ui.window.value = String(bar_s);
    if(ui.windowVal) ui.windowVal.textContent = formatWindow(bar_s);
    syncBarPresetUi();

    // If the full-history span would exceed the max bars budget, bump bar_s up to the smallest
    // preset that fits within effMaxBars (even if Auto W is off).
    (function enforceMaxBars(){
      try{
        var cap = Math.max(1, Math.floor(Number(effMaxBars) || 1));
        var spanMs = NaN;
        if(start && end){
          var ssMs2 = parseIsoToMs(start);
          var eeMs2 = parseIsoToMs(end);
          if(Number.isFinite(ssMs2) && Number.isFinite(eeMs2) && eeMs2 > ssMs2) spanMs = eeMs2 - ssMs2;
        } else if(Number.isFinite(state.viewSpanMs) && state.viewSpanMs > 0){
          spanMs = Number(state.viewSpanMs);
        }
        if(!Number.isFinite(spanMs) || spanMs <= 0) return;
        var visSpanMs = getVisibleSpanMs(spanMs);
        if(!Number.isFinite(visSpanMs) || visSpanMs <= 0) return;
        var visSec = Math.max(1, Math.floor(visSpanMs / 1000));
        var need = Math.ceil(visSec / Math.max(1, Math.floor(bar_s)));
        if(Number.isFinite(need) && need > cap){
          var minBar = snapCeilToPreset(Math.ceil(visSec / cap));
          minBar = clamp(minBar, 60, 86400);
          if(minBar !== bar_s){
            bar_s = minBar;
            state.windowSec = bar_s;
            if(ui.window) ui.window.value = String(bar_s);
            if(ui.windowVal) ui.windowVal.textContent = formatWindow(bar_s);
            syncBarPresetUi();
            updateUrlBarSize();
          }
        }
      } catch(_e){}
    })();

    // VWAP correctness: if VWAP overlay is enabled and we have a concrete start time,
    // preload bars back to the session open (RTH 09:30 ET) so the first bar's VWAP isn't "mid-session wrong".
    // We'll trim back to the requested start after computing overlays.
    var overlaySettings0 = getOverlaySettings();
    var vwapTrimStartMs = NaN;
    if(overlaySettings0 && overlaySettings0.vwap && start){
      try{
        var origStartMs0 = parseIsoToMs(start);
        if(Number.isFinite(origStartMs0)){
          var sess0 = sessionStartMsForEtDay(origStartMs0);
          if(Number.isFinite(sess0) && sess0 < origStartMs0){
            vwapTrimStartMs = origStartMs0;
            start = msToIsoZ(sess0);
          }
        }
      } catch(_e){}
    }

    var url = buildUrl(API_BASE, '/window', {
      symbol: symbol,
      start: start,
      end: end,
      max_bars: effMaxBars,
      // send legacy `limit` too for older servers
      limit: effMaxBars,
      bar_s: Math.floor(bar_s)
    });
    if(ui.reqInfo) ui.reqInfo.textContent = 'bar_s=' + Math.floor(bar_s) + ' (loading…)';

    var prevText = ui.regen ? ui.regen.textContent : '';
    if(ui.regen){ ui.regen.disabled = true; ui.regen.textContent = 'Loading…'; }

    // Update the "last update" chip (top-right) on success/error.
    function setUpdateChip(status, text){
      try{
        var dot = document.getElementById('updateDot');
        var el = document.getElementById('updateText');
        if(dot){
          dot.classList.remove('ok','live','warn','err');
          if(status === 'ok') dot.classList.add('ok');
          else if(status === 'live') dot.classList.add('live');
          else if(status === 'warn') dot.classList.add('warn');
          else if(status === 'err') dot.classList.add('err');
        }
        if(el) el.textContent = String(text || '');
      } catch(_e){}
    }

    try{
      // Client-side request timing (high-level): headers, download, parse.
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      var res = await fetch(url, { method: 'GET', cache: 'no-store' });
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      if(!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
      var txt = await res.text();
      var t2 = (window.performance && performance.now) ? performance.now() : Date.now();
      var j = JSON.parse(txt);
      var t3 = (window.performance && performance.now) ? performance.now() : Date.now();
      if(myReq !== state._reqSeq) return; // stale response

      // Capture dataset bounds (if present) for navigation clamping.
      if(j && j.dataset_start){
        var ds = parseIsoToMs(j.dataset_start);
        if(Number.isFinite(ds)) state.datasetStartMs = ds;
      }
      if(j && j.dataset_end){
        var de = parseIsoToMs(j.dataset_end);
        if(Number.isFinite(de)) state.datasetEndMs = de;
      }
      updateSpanPresetAvailability();
      state._lastFullSyncAtMs = Date.now();

      // Cold-load UX:
      // - Always render the first response (server default is "last hour ending at dataset end")
      // - Then (once bounds are known) do ONE follow-up fetch for the preferred default window
      //   ending at dataset end. Never auto-bootstrap to full-history.
      if(!explicitWindow && !derivedWindow && !start && !end && Number.isFinite(state.datasetStartMs) && Number.isFinite(state.datasetEndMs)){
        if(!state._bootstrappedInitialWindow){
          state._bootstrappedInitialWindow = true;
          state.viewEndMs = state.datasetEndMs;
          // Respect any pre-selected preset; otherwise fall back to the default.
          var pref = (Number.isFinite(state.viewSpanMs) && state.viewSpanMs > 0) ? Number(state.viewSpanMs) : DEFAULT_INIT_SPAN_MS;
          state.viewSpanMs = clamp(pref, 60*1000, Math.max(60*1000, state.datasetEndMs - state.datasetStartMs));
          syncSpanPresetFromNavigation();
          postBootstrapInitialWindow = true;
        }
      }

      // Track navigation anchors from what we *asked* for (preferred) or, if absent, what we got.
      if((explicitWindow || derivedWindow) && Number.isFinite(reqEndMs) && Number.isFinite(reqStartMs) && reqEndMs > reqStartMs){
        state.viewEndMs = reqEndMs;
        state.viewSpanMs = reqEndMs - reqStartMs;
        syncSpanPresetFromNavigation();
      } else if(!hadReqWindow && j && j.start && j.end){
        // Discovery only: set end anchor so subsequent requests can be anchored consistently.
        var we2 = parseIsoToMs(j.end);
        if(Number.isFinite(we2)) state.viewEndMs = we2;
      }
      if(state.followLatest && Number.isFinite(state.datasetEndMs)) state.viewEndMs = state.datasetEndMs;

      // If start/end weren't specified, use the server-reported window once to pick a better bar size.
      // Guard against infinite loops by only auto-adjusting if bar_s actually changes.
      if(autoW && (!start || !end) && j && j.start && j.end){
        var js = parseIsoToMs(j.start);
        var je = parseIsoToMs(j.end);
        if(Number.isFinite(js) && Number.isFinite(je) && je > js){
          var visSpanMsC = getVisibleSpanMs(je - js);
          var rec2 = recommendBarSecForVisibleSpan(visSpanMsC, (effMaxBars || j.max_bars || j.limit || ''));
          if(Math.floor(rec2) !== Math.floor(bar_s)){
            state.windowSec = rec2;
            if(ui.window) ui.window.value = String(rec2);
            if(ui.windowVal) ui.windowVal.textContent = formatWindow(rec2);
            syncBarPresetUi();
            updateUrlBarSize();
            // Re-fetch with the refined bar size (one hop). Bump reqSeq via recursion; current response is discarded.
            loadFromAPI(true);
            return;
          }
        }
      }

      var t = j.t_ms, o = j.o, h = j.h, l = j.l, c = j.c, v = j.v;
      // Treat server bar_s as authoritative (server may normalize non-multiple-of-30).
      // Also reset Y pan/zoom on bar size changes so the chart visibly re-scales as expected.
      var serverBar = (j && j.bar_s !== undefined && j.bar_s !== null) ? Number(j.bar_s) : NaN;
      var effBar = Number.isFinite(serverBar) ? Math.floor(serverBar) : Math.floor(bar_s);
      if(Number.isFinite(effBar) && effBar > 0){
        if(!Number.isFinite(state._loadedBarS) || Math.floor(state._loadedBarS) !== effBar){
          state._loadedBarS = effBar;
          // Keep X behavior consistent: data loads always right-align and reset zoom.
          // (Already done below.) For Y, reset pan/zoom so auto-scale feels responsive to bar changes.
          state.yPan = 0;
          state.yScaleFactor = 1;
        }
        // Keep UI + URL consistent with what the server actually served.
        state.windowSec = clamp(effBar, 60, 86400);
        if(ui.window) ui.window.value = String(state.windowSec);
        if(ui.windowVal) ui.windowVal.textContent = formatWindow(state.windowSec);
        syncBarPresetUi();
        updateUrlBarSize();
      }

      // If the dataset contains more history than the current window, and the full history
      // would still fit within the max bars budget at the current bar size, auto-expand
      // the requested window to include the full dataset.
      //
      // This fixes the common "I imported multiple years but only 1Y is visible" issue for
      // coarse bars (e.g. 1D equities) where fetching everything is still cheap.
      try{
        var spanQ0 = String(getQueryParam('span', '') || '').trim().toLowerCase();
        var cap0 = Math.max(1, Math.floor(Number(effMaxBars || j.max_bars || j.limit || 0) || 1));
        var dsA = Number(state && state.datasetStartMs);
        var deA = Number(state && state.datasetEndMs);
        if(!explicitWindow && Number.isFinite(dsA) && Number.isFinite(deA) && deA > dsA){
          var fullSpanMs = deA - dsA;
          var secPerBar = Math.max(1, Math.floor(Number(effBar) || Math.floor(state.windowSec) || 60));
          var approxBars = Math.ceil(fullSpanMs / (secPerBar * 1000));
          var wantsAll = (String(state && state.spanPreset || '').toLowerCase() === 'all') || (spanQ0 === 'all') || (spanQ0 === '1y');
          var curSpan0 = Number(state && state.viewSpanMs);
          if(wantsAll && !state._autoExpandedFullHistoryOnce && Number.isFinite(approxBars) && approxBars <= cap0){
            if(!Number.isFinite(curSpan0) || curSpan0 < fullSpanMs - 60*1000){
              state._autoExpandedFullHistoryOnce = true;
              state.spanPreset = 'all';
              state.viewSpanMs = fullSpanMs;
              state.viewEndMs = deA;
              state.followLatest = true;
              state.xZoom = 1;
              syncSpanPresetUi();
              updateSpanPresetAvailability();
              updateUrlBarSize();
              loadFromAPI(true);
              return;
            }
          }
        }
      } catch(_eAutoAll){}

      if(!Array.isArray(t) || !Array.isArray(o) || !Array.isArray(h) || !Array.isArray(l) || !Array.isArray(c) || !Array.isArray(v)){
        throw new Error('Unexpected JSON shape. Expected arrays: t_ms,o,h,l,c,v');
      }
      var n = t.length;
      if(o.length !== n || h.length !== n || l.length !== n || c.length !== n || v.length !== n){
        throw new Error('Mismatched array lengths in payload');
      }

      // Compute overlays against the full payload (including any VWAP preload),
      // then trim to the requested viewport start.
      var overlaysFull = [];
      try{
        if(overlaySettings0 && anyOverlayEnabled(overlaySettings0)){
          overlaysFull = computeOverlays(
            { t_ms: t, o: o, h: h, l: l, c: c, v: v },
            overlaySettings0,
            { symbol: symbol, bar_s: effBar }
          );
        }
      } catch(_e){}

      var trimIdx = 0;
      if(Number.isFinite(vwapTrimStartMs) && vwapTrimStartMs > 0){
        while(trimIdx < n && Number(t[trimIdx]) < vwapTrimStartMs) trimIdx++;
      }
      if(trimIdx > 0 && trimIdx < n){
        t = t.slice(trimIdx); o = o.slice(trimIdx); h = h.slice(trimIdx); l = l.slice(trimIdx); c = c.slice(trimIdx); v = v.slice(trimIdx);
        n = t.length;
        // Trim overlays to match.
        try{
          for(var si=0; si<overlaysFull.length; si++){
            var s = overlaysFull[si];
            if(!s || !Array.isArray(s.y) || !Array.isArray(s.t_ms)) continue;
            s.t_ms = s.t_ms.slice(trimIdx);
            s.y = s.y.slice(trimIdx);
          }
        } catch(_e2){}
      }

      var out = new Array(n);
      for(var i=0;i<n;i++){
        out[i] = {
          t: Number(t[i]),
          o: Number(o[i]),
          h: Number(h[i]),
          l: Number(l[i]),
          c: Number(c[i]),
          v: Number(v[i]),
          bid: NaN,
          ask: NaN,
          idx: i
        };
      }

      // Preserve the user's view when NOT following latest:
      // snapshot a time anchor near the center of the current view, then re-center on it after refresh.
      var anchorT = NaN;
      var anchorZoom = Number(state.xZoom);
      if(!Number.isFinite(anchorZoom) || anchorZoom <= 0) anchorZoom = 1;
      if(!state.followLatest && Array.isArray(state.data) && state.data.length){
        try{
          var n0 = state.data.length;
          var barsVis0 = computeVisibleBars(n0, anchorZoom).barsVisibleData;
          var off0 = Number(state.xOffset);
          if(!Number.isFinite(off0)) off0 = 0;
          var centerIdx = Math.floor(off0 + barsVis0 * 0.5);
          centerIdx = clamp(centerIdx, 0, n0 - 1);
          anchorT = Number(state.data[centerIdx].t);
        } catch(_e){}
      }

      // Store unfiltered window, then apply TradingView-style session filtering to build state.data.
      state.dataFull = out;
      state.strategies = j.strategies || {};
      state.overlaysFull = overlaysFull || [];
      state.data = out;
      state._sessionType = computeSessionTypesForData(out);
      // Compute HA only if HA candles are actually selected (avoid heavy work on every refresh).
      try{
        var needHa0 = !!(ui && ui.showCandles && ui.showCandles.checked && state && state.candleStyle === 'ha');
        state.ha = needHa0 ? computeHeikinAshi(out) : [];
      } catch(_eHa0){
        state.ha = [];
      }
      state.overlays = overlaysFull || [];
      applySessionFilter({ anchor: { t: anchorT, zoom: anchorZoom }, skipSave: true, skipDraw: true });
      updateSessionCountsUi();
      // X view policy:
      // - If following latest: keep right-aligned but do NOT reset zoom.
      // - If not following latest: keep your pan/zoom centered on the previous time anchor.
      if(!Number.isFinite(state.xZoom) || state.xZoom <= 0) state.xZoom = 1;
      if(state.followLatest){
        rightAlignXView();
      } else if(Number.isFinite(anchorT) && state.data.length){
        state.xZoom = anchorZoom;
        var n1 = state.data.length;
        var barsVis1 = computeVisibleBars(n1, state.xZoom).barsVisibleData;
        var idx1 = findIndexByTimeMs(state.data, anchorT);
        state.xOffset = idx1 - barsVis1 * 0.5;
      }
      state.hoverIdx = -1;
      draw();
      // Now that we have *something* rendered, upgrade to the preferred initial window.
      // This keeps cold-load fast and avoids the long "Loading..." stall.
      if(postBootstrapInitialWindow){
        if(windowTimer) clearTimeout(windowTimer);
        windowTimer = setTimeout(function(){ loadFromAPI(); }, 30);
      }
      if(ui.reqInfo){
        var s = 'bars=' + n + ' · bar_s=' + Math.floor(bar_s);
        if(j && j.truncated) s += ' · truncated';
        if(j && j.live_merged) s += ' · live';
        try{
          var fetchMs = Math.max(0, (t1 - t0));
          var dlMs = Math.max(0, (t2 - t1));
          var parseMs = Math.max(0, (t3 - t2));
          s += ' · net=' + Math.round(fetchMs) + 'ms';
          s += ' · dl=' + Math.round(dlMs) + 'ms';
          s += ' · parse=' + Math.round(parseMs) + 'ms';
        } catch(_e){}
        if(Number.isFinite(serverBar)){
          if(Math.floor(serverBar) !== Math.floor(bar_s)) s += ' (server=' + Math.floor(serverBar) + ')';
        } else if(Math.floor(bar_s) !== 1) {
          // Helpful hint: older servers ignore bar_s and won't include it in the payload.
          s += ' (server missing bar_s; restart api_server or use ?api=...)';
        }
        ui.reqInfo.textContent = s;
      }

      // Chip: show fetch time AND data freshness (end timestamp + age).
      (function(){
        var now = new Date();
        var hh = String(now.getHours()).padStart(2,'0');
        var mm = String(now.getMinutes()).padStart(2,'0');
        var ss = String(now.getSeconds()).padStart(2,'0');
        var mode = (j && j.live_merged) ? 'LIVE' : 'HIST';

        // Prefer dataset_end if present; otherwise use the last bar time from the payload.
        var dataEndMs = NaN;
        if(j && j.dataset_end) dataEndMs = parseIsoToMs(j.dataset_end);
        if(!Number.isFinite(dataEndMs) && Array.isArray(t) && t.length) dataEndMs = Number(t[t.length - 1]);
        if(!Number.isFinite(dataEndMs) && j && j.end) dataEndMs = parseIsoToMs(j.end);

        var ageSec = Number.isFinite(dataEndMs) ? Math.max(0, Math.floor((Date.now() - dataEndMs) / 1000)) : NaN;
        var ageTxt = Number.isFinite(ageSec) ? (ageSec >= 3600 ? (Math.floor(ageSec/3600) + 'h') : (ageSec >= 60 ? (Math.floor(ageSec/60) + 'm') : (ageSec + 's'))) : '—';
        var dataTxt = Number.isFinite(dataEndMs) ? formatTooltipTimeUtc(dataEndMs) : '—';

        // If following latest but data is old, warn. (Futures can be closed; still useful signal.)
        var stale = Number.isFinite(ageSec) && ageSec > 120 && state.followLatest;
        var status = (j && j.live_merged) ? 'live' : (stale ? 'warn' : 'ok');

        // Optional ingest freshness hint (from /live/status), if available.
        var ingestTxt = '';
        try{
          var ls = state._liveStatus || null;
          if(ls && ls.enabled){
            var lastMap = ls.last_ts_event || {};
            var sym = String(getSymbol() || '');
            // Prefer exact symbol; fallback to first/only symbol if present.
            var iso = lastMap[sym];
            if(!iso){
              var keys = Object.keys(lastMap || {});
              if(keys && keys.length === 1) iso = lastMap[keys[0]];
            }
            var ms = iso ? parseIsoToMs(iso) : NaN;
            var a2 = Number.isFinite(ms) ? Math.max(0, Math.floor((Date.now() - ms)/1000)) : NaN;
            var a2Txt = Number.isFinite(a2) ? (a2 >= 3600 ? (Math.floor(a2/3600) + 'h') : (a2 >= 60 ? (Math.floor(a2/60) + 'm') : (a2 + 's'))) : '—';
            ingestTxt = ' · ingest: ' + a2Txt + ' ago';
          }
        } catch(_e){}

        setUpdateChip(status, 'Fetched: ' + hh + ':' + mm + ':' + ss + ' · ' + mode + ' · data: ' + dataTxt + ' (' + ageTxt + ' ago)' + ingestTxt);
      })();
    } catch(e){
      console.error(e);
      state.data = [];
      draw();
      var msg = String(e && e.message ? e.message : e);
      if(ui.reqInfo) ui.reqInfo.textContent = 'bar_s=' + Math.floor(bar_s) + ' (error: ' + msg + ')';
      (function(){
        var now = new Date();
        var hh = String(now.getHours()).padStart(2,'0');
        var mm = String(now.getMinutes()).padStart(2,'0');
        var ss = String(now.getSeconds()).padStart(2,'0');
        setUpdateChip('err', 'Last update: ' + hh + ':' + mm + ':' + ss + ' · ERROR');
      })();
      // Avoid blocking alerts for transient reload/network blips; rely on footer + console.
      // Common during uvicorn --reload restarts.
    } finally {
      if(ui.regen){ ui.regen.disabled = false; ui.regen.textContent = regenButtonLabel(); }
    }
  }

  async function loadFromStatic(force){
    // Keep UI behavior similar to API version, but load from ./static/bars/<symbol>_<bar_s>.json
    if(!force && ui.regen && ui.regen.disabled) return;
    state._reqSeq = (state._reqSeq || 0) + 1;
    var myReq = state._reqSeq;

    var symbol = String(getSymbol() || '').trim();
    if(!symbol) symbol = 'ES_CONT';

    // Bar size
    var bar_s = clamp(Number(state.windowSec || (ui.window ? ui.window.value : 60) || 60), 30, 86400);
    if(!Number.isFinite(bar_s)) bar_s = 60;
    bar_s = snapToPreset(bar_s);
    state.windowSec = bar_s;
    if(ui.window) ui.window.value = String(bar_s);
    if(ui.windowVal) ui.windowVal.textContent = formatWindow(bar_s);
    syncBarPresetUi();
    if(ui.reqInfo) ui.reqInfo.textContent = 'bar_s=' + Math.floor(bar_s) + ' (loading…)';

    var prevText = ui.regen ? ui.regen.textContent : '';
    if(ui.regen){ ui.regen.disabled = true; ui.regen.textContent = 'Loading…'; }

    function setUpdateChip(status, text){
      try{
        var dot = document.getElementById('updateDot');
        var el = document.getElementById('updateText');
        if(dot){
          dot.classList.remove('ok','live','warn','err');
          if(status === 'ok') dot.classList.add('ok');
          else if(status === 'warn') dot.classList.add('warn');
          else if(status === 'err') dot.classList.add('err');
        }
        if(el) el.textContent = String(text || '');
      } catch(_e){}
    }

    try{
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      var j = null;
      try{
        j = await loadStaticBars(symbol, bar_s);
      } catch(eLoad){
        // Fallback: if the exact bar_s file doesn't exist, try deriving it from the smallest available bars we have.
        var base = _staticBaseBySymbol[symbol] || null;
        if(!base){
          // try any cached payload for this symbol (pick smallest bar_s)
          var best = null;
          for(var kk in (_staticBarsByKey || {})){
            if(!Object.prototype.hasOwnProperty.call(_staticBarsByKey, kk)) continue;
            if(kk.indexOf(symbol + '_') !== 0) continue;
            var cand = _staticBarsByKey[kk];
            if(!cand) continue;
            var bs0 = Math.floor(Number(cand.bar_s) || 0);
            if(!Number.isFinite(bs0) || bs0 <= 0) continue;
            if(!best || bs0 < Math.floor(Number(best.bar_s) || 0)) best = cand;
          }
          base = best;
        }
        if(base){
          j = aggregateBarsPayload(base, bar_s);
          rememberBarsPayload(j);
        } else {
          throw eLoad;
        }
      }
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      if(myReq !== state._reqSeq) return; // stale

      // Bounds from payload
      if(j && j.dataset_start){
        var ds = parseIsoToMs(j.dataset_start);
        if(Number.isFinite(ds)) state.datasetStartMs = ds;
      }
      if(j && j.dataset_end){
        var de = parseIsoToMs(j.dataset_end);
        if(Number.isFinite(de)) state.datasetEndMs = de;
      }
      if(!Number.isFinite(state.datasetStartMs) && Array.isArray(j.t_ms) && j.t_ms.length) state.datasetStartMs = Number(j.t_ms[0]);
      if(!Number.isFinite(state.datasetEndMs) && Array.isArray(j.t_ms) && j.t_ms.length) state.datasetEndMs = Number(j.t_ms[j.t_ms.length-1]);
      updateSpanPresetAvailability();

      var t = j.t_ms, o = j.o, h = j.h, l = j.l, c = j.c, v = j.v;
      if(!Array.isArray(t) || !Array.isArray(o) || !Array.isArray(h) || !Array.isArray(l) || !Array.isArray(c) || !Array.isArray(v)){
        throw new Error('Unexpected JSON shape. Expected arrays: t_ms,o,h,l,c,v');
      }
      var n = t.length;
      if(o.length !== n || h.length !== n || l.length !== n || c.length !== n || v.length !== n){
        throw new Error('Mismatched array lengths in payload');
      }

      // Overlays (EMA/VWAP) computed from the loaded payload (static mode doesn't do session preloads).
      var overlays = [];
      try{
        var os = getOverlaySettings();
        if(os && anyOverlayEnabled(os)){
          overlays = computeOverlays(
            { t_ms: t, o: o, h: h, l: l, c: c, v: v },
            os,
            { symbol: symbol, bar_s: bar_s }
          );
        }
      } catch(_e){}

      var out = new Array(n);
      for(var i=0;i<n;i++){
        out[i] = { t:Number(t[i]), o:Number(o[i]), h:Number(h[i]), l:Number(l[i]), c:Number(c[i]), v:Number(v[i]), bid:NaN, ask:NaN, idx: i };
      }
      state.followLatest = false;
      // Store full window, then filter displayed bars.
      state.dataFull = out;
      state.strategies = j.strategies || {};
      state.overlaysFull = overlays || [];
      state.data = out;
      state._sessionType = computeSessionTypesForData(out);
      // Compute HA only if HA candles are actually selected (avoid heavy work on every load).
      try{
        var needHa1 = !!(ui && ui.showCandles && ui.showCandles.checked && state && state.candleStyle === 'ha');
        state.ha = needHa1 ? computeHeikinAshi(out) : [];
      } catch(_eHa1){
        state.ha = [];
      }
      state.overlays = overlays || [];
      applySessionFilter({ skipSave: true, skipDraw: true });
      updateSessionCountsUi();
      state.hoverIdx = -1;
      if(!Number.isFinite(state.xZoom) || state.xZoom <= 0) state.xZoom = 1;
      rightAlignXView();
      draw();

      if(ui.reqInfo){
        var extra = '';
        try{
          if(j && j._derived_from_bar_s) extra = ' · derived_from=' + Math.floor(Number(j._derived_from_bar_s) || 0) + 's';
        } catch(_e){}
        ui.reqInfo.textContent = 'bars=' + n + ' · bar_s=' + Math.floor(bar_s) + extra + ' · load=' + Math.round(Math.max(0,t1-t0)) + 'ms';
      }
      setUpdateChip('ok', 'Loaded: ' + symbol + ' @ ' + Math.floor(bar_s) + 's');
    } catch(e){
      try{ setUpdateChip('err', 'Load error'); } catch(_e){}
      if(ui.reqInfo){
        var msg = String(e && e.message ? e.message : e);
        if(/Failed to fetch/i.test(msg)){
          msg += ' (if you are on file://, use Pick snapshot folder or Pick bars file)';
        }
        ui.reqInfo.textContent = 'Error: ' + msg;
      }
    } finally {
      if(ui.regen){ ui.regen.disabled = false; ui.regen.textContent = regenButtonLabel(); }
    }
  }

  async function pollLiveIncremental(){
    try{
      if(STATIC_MODE) return;
      if(!state.followLatest) return;
      if(state.dragging || state.yDragging) return;
      // Don't compete with an in-flight full request.
      if(ui.regen && ui.regen.disabled) return;
      // If we don't have a baseline yet, wait for the next full /window sync.
      if((!Array.isArray(state.dataFull) || state.dataFull.length === 0) && (!Array.isArray(state.data) || state.data.length === 0)) return;

      var sym = String(getSymbol() || '').trim();
      if(!sym) return;
      var barS = Math.floor(Number(state.windowSec || 60));
      if(!Number.isFinite(barS) || barS <= 0) barS = 60;
      barS = snapToPreset(clamp(barS, 60, 86400));

      var base = (Array.isArray(state.dataFull) && state.dataFull.length) ? state.dataFull : state.data;
      var lastT = Number(base[base.length - 1].t);
      if(!Number.isFinite(lastT)) return;
      // Overlap a couple buckets to handle in-progress-bar updates.
      var sinceMs = lastT - (barS * 1000 * 2);

      var url = liveSinceUrl(sym, sinceMs, barS, 2000);
      var res = await fetch(url, { method:'GET', cache:'no-store' });
      if(!res.ok) return;
      var j = await res.json();
      if(!j || !Array.isArray(j.t_ms) || !Array.isArray(j.o) || !Array.isArray(j.h) || !Array.isArray(j.l) || !Array.isArray(j.c) || !Array.isArray(j.v)) return;
      var t = j.t_ms, o = j.o, h = j.h, l = j.l, c = j.c, v = j.v;
      var n = t.length;
      if(!n) return;

      // Merge/append in time order.
      if(!Array.isArray(state.dataFull) || !state.dataFull.length){
        // Establish a full baseline if we only had filtered state.data.
        state.dataFull = Array.isArray(state.data) ? state.data.slice() : [];
      }
      for(var i=0;i<n;i++){
        var tt = Number(t[i]);
        if(!Number.isFinite(tt)) continue;
        var nb = { t: tt, o: Number(o[i]), h: Number(h[i]), l: Number(l[i]), c: Number(c[i]), v: Number(v[i]), bid: NaN, ask: NaN };
        var cur = state.dataFull;
        var m = cur.length;
        if(m === 0){
          cur.push(nb);
          continue;
        }
        var last = cur[m - 1];
        if(tt > last.t){
          cur.push(nb);
        } else if(tt === last.t){
          cur[m - 1] = nb;
        } else {
          // Rare: update earlier bucket (overlap). Replace if found, else insert.
          var idx = findIndexByTimeMs(cur, tt);
          if(idx >= 0 && idx < cur.length && cur[idx].t === tt){
            cur[idx] = nb;
          } else if(idx >= 0){
            cur.splice(idx, 0, nb);
          }
        }
      }

      // Re-apply session filtering to update the visible dataset.
      applySessionFilter({ skipSave: true, skipDraw: true });
      updateSessionCountsUi();
      // Following latest: keep right-aligned.
      rightAlignXView();
      draw();

      // If the server reports a live_end watermark, use it to keep datasetEndMs moving.
      if(j && j.live_end){
        var le = parseIsoToMs(j.live_end);
        if(Number.isFinite(le)){
          if(!Number.isFinite(state.datasetEndMs) || le > state.datasetEndMs) state.datasetEndMs = le;
        }
      }
      updateSpanPresetAvailability();
    } catch(_e){
      // ignore transient errors during reloads
    }
  }
