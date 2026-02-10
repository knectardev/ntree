'use strict';

  async function replayStart(opts){
    var o = opts || {};
    await _endReplaySession();

    var symbol = String(getSymbol() || '').trim();
    if(!symbol) symbol = 'SPY';

    // Replay start should use the user's *current* settings (span preset + bar size),
    // not reset them. Defaults should be established by UI config / initial UI state, not here.

    var dispTf = clamp(Math.floor(Number(state.windowSec) || 60), 60, 86400);
    var payload = {
      symbol: symbol,
      exec_tf_sec: 60,
      disp_tf_sec: dispTf,
      // Randomize scenario/anchor each time replay starts.
      seed: Math.floor(Math.random() * 1000000000),
      snap_to_disp_boundary: true,
      // Opt-in delta protocol for replay (keeps payloads tiny per step).
      delta_mode: true
    };
    // Display history: derive from current requested x-axis span (plus small slack).
    // Prefer explicit state.viewSpanMs (set by the span preset UI), then fall back to span preset mapping.
    var targetSpanMs = Number(state && state.viewSpanMs);
    if(!Number.isFinite(targetSpanMs) || targetSpanMs <= 0){
      try{
        var sp = String(state && state.spanPreset ? state.spanPreset : '1d');
        targetSpanMs = Number(SPAN_PRESETS[sp]) || (24*60*60*1000);
      } catch(_eSp){
        targetSpanMs = (24*60*60*1000);
      }
    }
    var dispMs = Math.max(60_000, Math.floor(dispTf) * 1000);
    var wantBars = Math.ceil(targetSpanMs / dispMs) + 5; // +slack so "6M" isn't borderline
    // Cap to keep payload sizes reasonable.
    var MAX_HISTORY_BARS = 800;
    payload.initial_history_bars = clamp(wantBars, 50, MAX_HISTORY_BARS);
    // Ensure the randomized anchor has enough runway beyond the "now" cursor.
    // (Frontend also reserves 5 empty display slots for projection.)
    payload.min_future_disp_bars = 5;
    // Use full DB history; enforce that the random start point is at least 4 weeks back.
    // Requirement: start at least ~1 month in the past (when possible).
    payload.min_anchor_age_days = 30;

    _setPracticeStatus('Starting replay…');
    try{
      var j = await _postJson('/replay/start', payload);
      state.replay.active = true;
      state.replay.sessionId = String(j.session_id || '');
      state.replay.deltaMode = true;
      state.replay._forceResync = false;
      state.replay.playing = false;
      state.replay.timer = null;
      _renderReplayState(j.state);
      // Hide debug/status readout after successful start (sidebar design TBD).
      _setPracticeStatus('');
      _setPracticeUiStateActive(true);
      _syncPracticePauseBtn();
      if(o.autoPlay){
        // Start the timer immediately.
        replayTogglePlay();
      }
    } catch(e){
      console.error(e);
      state.replay.active = false;
      state.replay.sessionId = '';
      _setPracticeStatus('Replay start failed: ' + String(e && e.message ? e.message : e));
      _setPracticeUiStateActive(false);
    }
  }
  async function _replayFetchBatch(dispSteps, dbgSample){
    // Fetch N display steps from the server.
    // If dispSteps>1, ask the server to return an array of intermediate states ("states") so
    // the frontend can buffer and play smoothly.
    if(!state.replay.active || !state.replay.sessionId){
      await replayStart();
      return [];
    }
    var steps = Math.max(1, Math.floor(Number(dispSteps) || 1));
    try{
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      var payload = { session_id: state.replay.sessionId, disp_steps: steps };
      if(state.replay.deltaMode){
        payload.delta_only = true;
        payload.return_deltas = (steps > 1);
        payload.resync_every = 500;
        if(state.replay._forceResync){
          payload.force_state = true;
          try{ state.replay._queue = []; } catch(_eQ){}
          state.replay._forceResync = false;
        }
      } else {
        if(steps > 1) payload.return_states = true;
      }
      var j = await _postJson('/replay/step', payload);
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      try{
        if(state && state.replay && state.replay._debug && state.replay._debug.enabled){
          var fm = Math.max(0, t1 - t0);
          state.replay._debug.lastFetchMs = fm;
          try{
            state.replay._debug._fetch.push(fm);
            while(state.replay._debug._fetch.length > (state.replay._debug._N || 60)) state.replay._debug._fetch.shift();
            var mf = -Infinity;
            for(var ii=0; ii<state.replay._debug._fetch.length; ii++){
              var x = Number(state.replay._debug._fetch[ii]);
              if(Number.isFinite(x) && x > mf) mf = x;
            }
            state.replay._debug.maxFetchMs = (mf === -Infinity) ? NaN : mf;
          } catch(_eArr){}
        }
      } catch(_eDbgF){}
      try{
        if(dbgSample){
          dbgSample.fetch_ms = Math.max(0, t1 - t0);
        }
      } catch(_eS0){}
      if(state.replay.deltaMode){
        var deltas = (j && Array.isArray(j.deltas) && j.deltas.length) ? j.deltas : (j && j.delta ? [j] : []);
        return deltas;
      }
      var states = (j && Array.isArray(j.states) && j.states.length) ? j.states : (j && j.state ? [j.state] : []);
      return states;
    } catch(e){
      console.error(e);
      var msg = String(e && e.message ? e.message : e);
      _setPracticeStatus('Replay fetch failed: ' + msg);
      try{ state.replay._stepFailCount = (Number(state.replay._stepFailCount) || 0) + 1; } catch(_e1){}
      // If the server session is gone, pause (don't nuke local state; allow Play to restart).
      if(msg.indexOf('HTTP 404') !== -1 || msg.indexOf('session not found') !== -1){
        _stopReplayTimer();
        _setPracticeStatus('Replay restarting: session not found (server).');
        // Auto-restart a new session and resume playback (sessions are in-memory; server restarts clear them).
        try{
          replayStart({ autoPlay: true });
        } catch(_eAuto){
          _setPracticeStatus('Replay paused: session not found (server). Press Play to start a new session.');
        }
        return [];
      }
      // Avoid infinite noisy failing; pause after repeated failures.
      try{
        if((Number(state.replay._stepFailCount) || 0) >= 3){
          _stopReplayTimer();
          _setPracticeStatus('Replay paused after repeated fetch errors. Press Resume to retry.');
        }
      } catch(_e2){}
      return [];
    }
  }

  async function replayStepOnce(dbgSample){
    // Compatibility: single-step fetch + render (used by non-buffered callers).
    var states = await _replayFetchBatch(1, dbgSample);
    if(!states || !states.length) return;
    var st = states[states.length - 1];
    // Always render from authoritative state (delta is optional optimization).
    var r0 = (window.performance && performance.now) ? performance.now() : Date.now();
    _renderReplayState(st);
    var r1 = (window.performance && performance.now) ? performance.now() : Date.now();
    try{
      if(state && state.replay && state.replay._debug && state.replay._debug.enabled){
        var rm = Math.max(0, r1 - r0);
        state.replay._debug.lastRenderMs = rm;
        try{
          state.replay._debug._render.push(rm);
          while(state.replay._debug._render.length > (state.replay._debug._N || 60)) state.replay._debug._render.shift();
          var mr = -Infinity;
          for(var jj=0; jj<state.replay._debug._render.length; jj++){
            var y = Number(state.replay._debug._render[jj]);
            if(Number.isFinite(y) && y > mr) mr = y;
          }
          state.replay._debug.maxRenderMs = (mr === -Infinity) ? NaN : mr;
        } catch(_eArr2){}
      }
    } catch(_eDbgR){}
    try{
      if(dbgSample){
        dbgSample.render_ms = Math.max(0, r1 - r0);
        if(state && state.replay && state.replay._debug && state.replay._debug.enabled){
          dbgSample.draw_ms = Number(state.replay._debug.lastDrawMs);
        }
      }
    } catch(_eS1){}
    try{ state.replay._stepFailCount = 0; } catch(_e0){}
  }

  function _practiceQty(){
    try{
      // Discrete presets (shares)
      var PRESETS = [1, 5, 10, 25, 50, 100];
      if(ui.practiceQty && String(ui.practiceQty.type || '').toLowerCase() === 'range'){
        var idx = Math.floor(Number(ui.practiceQty.value));
        if(!Number.isFinite(idx)) idx = 0;
        idx = clamp(idx, 0, PRESETS.length - 1);
        return Number(PRESETS[idx]) || 1;
      }
      // Fallback: numeric input (legacy)
      var v = ui.practiceQty ? Number(ui.practiceQty.value) : NaN;
      if(!Number.isFinite(v) || v <= 0) v = 1;
      return Math.max(1, Math.floor(v));
    } catch(_e){
      return 1;
    }
  }

  function _syncPracticeQtyLabel(){
    try{
      if(!ui.practiceQtyLabel) return;
      var q = _practiceQty();
      ui.practiceQtyLabel.textContent = String(q) + ' shares';
    } catch(_e){}
  }

  async function placeMarket(side){
    if(!state.replay.active || !state.replay.sessionId){
      _setPracticeStatus('Start replay first.');
      return;
    }
    var qty = _practiceQty();
    return withReplayPaused(async function(){
      try{
        var j = await _postJson('/replay/order/place', { session_id: state.replay.sessionId, type: 'market', side: side, qty: qty, tag: 'ui' });
        _renderReplayState(j.state);
      } catch(e){
        console.error(e);
        _setPracticeStatus('Order failed: ' + String(e && e.message ? e.message : e));
      }
    });
  }

  async function flattenNow(){
    if(!state.replay.active || !state.replay.sessionId){
      _setPracticeStatus('Start replay first.');
      return;
    }
    return withReplayPaused(async function(){
      try{
        var j = await _postJson('/replay/flatten', { session_id: state.replay.sessionId });
        _renderReplayState(j.state);
      } catch(e){
        console.error(e);
        _setPracticeStatus('Flatten failed: ' + String(e && e.message ? e.message : e));
      }
    });
  }
  function replayTogglePlay(){
    // Play/Pause/Resume UX:
    // - If no active session: start one and begin stepping.
    // - If active and playing: pause (stop stepping timer, keep session).
    // - If active and paused: resume (restart stepping timer).
    if(!state.replay.active || !state.replay.sessionId){
      replayStart({ autoPlay: true });
      return;
    }
    if(state.replay.playing){
      _stopReplayTimer();
      // Hide status label (design TBD). Errors will still surface via _setPracticeStatus.
      _setPracticeStatus('');
      return;
    }
    var bpm = _practiceSpeedBpm();
    var intervalMs = Math.max(80, Math.floor(60000 / bpm));
    _startReplayLoop(intervalMs);
    // Hide any prior "Starting replay…" etc once playback is running.
    _setPracticeStatus('');
  }

  if(ui.practiceBtn) ui.practiceBtn.addEventListener('click', function(){ replayTogglePlay(); });
  if(ui.practicePauseBtn) ui.practicePauseBtn.addEventListener('click', function(){ replayTogglePlay(); });
  // Reset should end the current session and return to the idle "Play" state.
  if(ui.practiceResetBtn) ui.practiceResetBtn.addEventListener('click', function(){ _endReplaySession(); });
  if(ui.practiceLongBtn) ui.practiceLongBtn.addEventListener('click', function(){ placeMarket('buy'); });
  if(ui.practiceShortBtn) ui.practiceShortBtn.addEventListener('click', function(){ placeMarket('sell'); });
  if(ui.practiceFlattenBtn) ui.practiceFlattenBtn.addEventListener('click', function(){ flattenNow(); });
  if(ui.practiceQty){
    ui.practiceQty.addEventListener('input', function(){ _syncPracticeQtyLabel(); });
    ui.practiceQty.addEventListener('change', function(){ _syncPracticeQtyLabel(); });
  }
  if(ui.practiceSpeed){
    ui.practiceSpeed.addEventListener('input', function(){
      _syncPracticeSpeedLabel();
      // Playback cadence is derived from bpm inside the RAF loop; no restart needed.
      // Reset accumulator so the new cadence takes effect immediately.
      try{
        if(state && state.replay && state.replay.playing){
          state.replay._rafAcc = 0;
          if(state.replay._debug && state.replay._debug.enabled){
            state.replay._debug.targetMs = _replayMsPerStep();
          }
        }
      } catch(_e){}
    });
    ui.practiceSpeed.addEventListener('change', function(){
      _syncPracticeSpeedLabel();
      try{
        if(state && state.replay && state.replay.playing){
          if(state.replay._debug && state.replay._debug.enabled){
            state.replay._debug.targetMs = _replayMsPerStep();
          }
        }
      } catch(_e2){}
    });
  }
  _syncPracticeSpeedLabel();
  _syncPracticeQtyLabel();
  _setPracticeUiStateActive(!!(state && state.replay && state.replay.active));
  // History modal wiring
  if(ui.practiceHistoryBtn){
    ui.practiceHistoryBtn.addEventListener('click', function(){
      _showHistoryModal(true);
      _setHistoryViewMode('cards');
      loadTradeHistory();
    });
  }
  if(ui.historyCloseBtn) ui.historyCloseBtn.addEventListener('click', function(){ _showHistoryModal(false); });
  if(ui.historyRefreshBtn) ui.historyRefreshBtn.addEventListener('click', function(){ loadTradeHistory(); });
  if(ui.historyViewCardsBtn) ui.historyViewCardsBtn.addEventListener('click', function(){ _setHistoryViewMode('cards'); loadTradeHistory(); });
  if(ui.historyViewLedgerBtn) ui.historyViewLedgerBtn.addEventListener('click', function(){ _setHistoryViewMode('ledger'); loadTradeHistory(); });
  if(ui.historyViewMatrixBtn) ui.historyViewMatrixBtn.addEventListener('click', function(){ _setHistoryViewMode('matrix'); loadTradeHistory(); });
  if(ui.historyModal){
    ui.historyModal.addEventListener('click', function(e){
      // Click outside the modal closes
      try{
        if(e && e.target === ui.historyModal) _showHistoryModal(false);
      } catch(_e){}
    });
  }
  document.addEventListener('keydown', function(e){
    try{
      if(e && e.key === 'Escape' && ui.historyModal && ui.historyModal.style.display !== 'none'){
        _showHistoryModal(false);
      }
    } catch(_e){}
  });
  async function fetchLatestAndReload(){
    // In API mode, this triggers the server-side fetch for *all* tickers, then reloads the window.
    if(STATIC_MODE){
      return loadFromAPI();
    }
    if(ui.regen && ui.regen.disabled) return;
    var prev = ui.regen ? ui.regen.textContent : '';
    if(ui.regen){ ui.regen.disabled = true; ui.regen.textContent = 'Fetching…'; }
    try{
      var res = await fetch('/api/fetch-latest', { method:'POST', headers:{'Content-Type':'application/json'} });
      // Ignore response body errors here; chart reload will show empty/error in footer if needed.
      try{ if(res && res.ok) await res.json(); } catch(_e){}
    } catch(_e2){
      // ignore; reload below will reflect current DB state
    } finally {
      if(ui.regen){ ui.regen.disabled = false; ui.regen.textContent = regenButtonLabel(); }
    }
    loadFromAPI();
  }

  ui.regen.addEventListener('click', fetchLatestAndReload);
  // Symbol dropdown interactions
  if(ui.tickerBtn){
    ui.tickerBtn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      toggleTickerMenu();
    });
  }
  if(ui.tickerMenu){
    ui.tickerMenu.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.getAttribute) return;
      var v = t.getAttribute('data-value');
      if(!v) return;
      setTicker(v);
      closeTickerMenu();
      // Rebuild symbol list for this dataset and choose an appropriate default symbol.
      refreshSymbolMenuForTicker();
      var catalog = state._catalog || null;
      var ds = String(getTicker() || 'ES').trim().toUpperCase();
      var curSym = getSymbol();
      var curDs = (catalog && catalog.datasetBySymbol) ? catalog.datasetBySymbol[curSym] : '';
      if(curDs !== ds){
        var defSym = chooseDefaultSymbolForTicker(ds);
        if(defSym){
          ensureSymbolItem(defSym);
          setSymbol(defSym);
        }
      }
      scheduleSaveUiConfig();
      loadFromAPI();
    });
  }
  if(ui.symbolBtn){
    ui.symbolBtn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      toggleSymbolMenu();
    });
  }
  if(ui.symbolMenu){
    ui.symbolMenu.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.getAttribute) return;
      var v = t.getAttribute('data-value');
      if(!v) return;
      setSymbol(v);
      closeSymbolMenu();
      scheduleSaveUiConfig();
      loadFromAPI();
    });
  }

  // tests
  function assert(cond, msg){ if(!cond) throw new Error('Test failed: ' + msg); }

  function applyYScaleBounds(minV, maxV, factor){
    var mid = (minV + maxV) / 2;
    var span = (maxV - minV) * factor;
    return { min: mid - span/2, max: mid + span/2 };
  }

  (function runTests(){
    assert(Array.isArray(SNAP_PRESETS) && SNAP_PRESETS.length > 5, 'snap presets');
    assert(snapToPreset(61) === 60, 'snap 61->60');
    assert(snapToPreset(89) === 60, 'snap 89->60');
    assert(snapCeilToPreset(61) === 300, 'snapCeil 61->300');
    assert(snapCeilToPreset(1) === 60, 'snapCeil clamps min preset');
    assert(snapCeilToPreset(86400) === 86400, 'snapCeil 86400->86400');

    // Minimum bar size is the smallest preset, even if the span/target would imply smaller.
    // In Alpaca-only mode, smallest preset is 60s (1-minute base resolution).
    assert(recommendBarSec(3600*1000, 5000, 800) === 60, 'recommend 1h clamps to min preset');
    // Limit guard: if limit is tiny, bar_s must grow (>= 1h/100 = 36s -> snapCeil to 60s).
    assert(recommendBarSec(3600*1000, 100, 800) >= 60, 'recommend respects max bars');

    var dummy = document.createElement('canvas').getContext('2d');
    var up = [[0,0],[1,0],[2,0]];
    var lo = [[0,1],[1,1],[2,1]];
    fillBetween(dummy, up, lo, 'rgba(255,0,0,0.2)', false);
    fillBetween(dummy, up, lo, 'rgba(0,255,0,0.2)', true);
    strokePolyline(dummy, up, 'rgba(0,0,0,1)', 1, true, [3,4]);

    var threw = false;
    try {
      roundRect(dummy, 10, 10, 100, 40, 12);
      dummy.stroke();
      roundRect(dummy, 10, 10, -50, 20, 12);
      dummy.stroke();
      roundRect(dummy, 10, 10, 20, -10, 12);
      dummy.stroke();
      roundRect(dummy, 10, 10, 0.1, 0.1, 12);
      dummy.stroke();
    } catch(e){
      threw = true;
    }
    assert(!threw, 'roundRect robustness');

    assert(!!document.getElementById('showBands'), 'showBands exists');
    assert(!!document.getElementById('showCandles'), 'showCandles exists');
    assert(!!document.getElementById('tickerDD'), 'ticker dropdown exists');
    assert(!!document.getElementById('tickerBtn'), 'ticker dropdown button exists');
    assert(!!document.getElementById('tickerMenu'), 'ticker dropdown menu exists');
    assert(!!document.getElementById('candleStyleDD'), 'candleStyle dropdown exists');
    assert(!!document.getElementById('candleStyleBtn'), 'candleStyle button exists');
    assert(!!document.getElementById('candleStyleMenu'), 'candleStyle menu exists');
    assert(!!document.getElementById('sessPreMarket'), 'session toggle pre-market exists');
    assert(!!document.getElementById('sessAfterHours'), 'session toggle after-hours exists');
    assert(!!document.getElementById('sessClosed'), 'session toggle closed exists');
    assert(!!ui.autoW, 'autoW control exists');
    assert(!!ui.showVolume && ui.showVolume.checked === true, 'showVolume forced on');
    assert(!!ui.grid, 'grid control exists');
    assert(!!ui.scale && ui.scale.checked === true, 'scale forced on');

    var b0 = applyYScaleBounds(0, 10, 2);
    assert(Math.abs((b0.max - b0.min) - 20) < 1e-9, 'applyYScaleBounds doubles span');
    var b1 = applyYScaleBounds(0, 10, 0.5);
    assert(Math.abs((b1.max - b1.min) - 5) < 1e-9, 'applyYScaleBounds halves span');
  })();

  // boot
  (async function(){
    // Static demo: no API hint.
    // Enable bar size controls; they re-fetch the API with bar_s.
    ui.window.disabled = false;
    // API mode: minimum resolution is 60s.
    try{
      if(!STATIC_MODE && ui.window){
        if(Number(ui.window.value) < 30) ui.window.value = '30';
        syncBarPresetUi();
      }
      if(ui.regen) ui.regen.textContent = regenButtonLabel();
    } catch(_e){}

    // 0) Populate ticker + symbol dropdown from the server's discovered datasets.
    try{
      if(ui.symbolLabel) ui.symbolLabel.textContent = 'Loading…';
      if(ui.symbolMenu) ui.symbolMenu.innerHTML = '';
    } catch(_e){}
    var items = await fetchSymbolCatalog();
    state._catalog = buildCatalogIndex(items || []);
    // Populate ticker menu
    if(ui.tickerMenu){
      ui.tickerMenu.innerHTML = '';
      var dss = (state._catalog && state._catalog.datasets) ? state._catalog.datasets : [];
      if(dss && dss.length){
        for(var di=0; di<dss.length; di++) ensureTickerItem(dss[di]);
      } else {
        ['ES','NQ','LE'].forEach(function(d){ ensureTickerItem(d); });
      }
    }
    // Choose ticker: prefer current symbol's dataset if possible, else ES, else first.
    (function(){
      var catalog = state._catalog || null;
      var curSym = getSymbol();
      var ds0 = (catalog && catalog.datasetBySymbol) ? catalog.datasetBySymbol[curSym] : '';
      if(!ds0){
        var dss2 = (catalog && catalog.datasets) ? catalog.datasets : [];
        if(dss2.indexOf('ES') >= 0) ds0 = 'ES';
        else ds0 = (dss2[0] || 'ES');
      }
      ensureTickerItem(ds0);
      setTicker(ds0);
      refreshSymbolMenuForTicker();
      // Ensure symbol is valid for the chosen ticker.
      var syms2 = (catalog && catalog.byDataset) ? catalog.byDataset[ds0] : [];
      if(syms2 && syms2.length){
        if(syms2.indexOf(curSym) < 0){
          var def = chooseDefaultSymbolForTicker(ds0);
          if(def){ ensureSymbolItem(def); setSymbol(def); }
        } else {
          ensureSymbolItem(curSym);
          setSymbol(curSym);
        }
      } else {
        // Fallback if no catalog available.
        if(ds0 === 'ES') ['ES_CONT','ESZ5','ESU5','ESM5'].forEach(function(s){ ensureSymbolItem(s); });
        setSymbol(getSymbol());
      }
    })();

    // 1) Load persisted UI config (if present).
    var cfg = await fetchUiConfig();
    if(cfg && applyUiConfig(cfg)){
      persist.hadConfig = true;
    }

    // 2) Apply URL overrides (so shareable URLs still win).
    (function(){
      // Optional: allow symbol in URL to override config.
      var symQ = getQueryParam('symbol', '');
      if(symQ){
        var s0 = String(symQ).trim();
        // With Symbol dropdown removed, treat the URL symbol as the selected ticker too.
        ensureTickerItem(s0);
        setTicker(s0);
        ensureSymbolItem(s0);
        setSymbol(s0);
      }

      // Auto W:
      // - if explicitly specified (?auto_w=1/0), honor it
      // - otherwise, if we did NOT load a saved config, default to enabled unless bar size is in URL
      var autoQ = getQueryParam('auto_w', '');
      if(ui.autoW){
        if(autoQ !== ''){
          ui.autoW.checked = !(String(autoQ).trim() === '0');
        } else if(!persist.hadConfig){
          // Default: enabled unless bar size is explicitly specified in URL.
          var qsBar0 = getQueryParam('bar_s', '');
          var qsW0 = getQueryParam('w', '');
          ui.autoW.checked = !((qsBar0 !== '') || (qsW0 !== ''));
        }
      }

      // Bar size from URL (?bar_s=60) or legacy (?w=60), else keep existing (config/default).
      var qsBar = getQueryParam('bar_s', '');
      var qsW = getQueryParam('w', '');
      var raw = (qsBar !== '' ? qsBar : qsW);
      var ww = (raw !== '' ? clamp(Number(raw), 30, 86400) : clamp(Number(state.windowSec || ui.window.value), 30, 86400));
      if(!Number.isFinite(ww)) ww = 60;
      ww = snapToPreset(ww);
      state.windowSec = ww;
      ui.window.value = String(ww);
      ui.windowVal.textContent = formatWindow(state.windowSec);
      syncBarPresetUi();

      // Scale preset from URL (?span=1d/5d/1m/3m), else keep config/default.
      var spanQ = getQueryParam('span', '');
      if(spanQ !== ''){
        setSpanPreset(spanQ, { skipLoad: true, skipSave: true, skipUrl: true });
      } else if(!persist.hadConfig) {
        // Default to 1d unless a saved config provided something else.
        setSpanPreset('1d', { skipLoad: true, skipSave: true, skipUrl: true });
      } else {
        // Ensure UI matches current state from config.
        syncSpanPresetUi();
      }

      // Candle style from URL or existing (config/default).
      var csQ = getQueryParam('candle_style', '');
      if(csQ !== '') setCandleStyle(csQ);
      else if(!persist.hadConfig) setCandleStyle('std');
      syncCandleStyleEnabled();

      updateUrlBarSize();
      enforceAlwaysOnOptions();
    })();

    // 3) Enable persistence after initial state is coherent.
    persist.enabled = true;
    scheduleSaveUiConfig();

    loadFromAPI();
  })();

  // Live polling:
  // - Prefer incremental updates via /live/since (fast, avoids DBN scan).
  // - Do a full /window sync occasionally as a safety net.
  (function(){
    if(STATIC_MODE) return;
    try{
      if(livePollTimer) clearInterval(livePollTimer);
      livePollTimer = setInterval(function(){
        try{
          if(!state.followLatest) return;
          if(state.dragging || state.yDragging) return;
          if(ui.regen && ui.regen.disabled) return; // request in flight
          pollLiveIncremental();
          var now = Date.now();
          var lastFull = Number(state._lastFullSyncAtMs);
          if(!Number.isFinite(lastFull) || (now - lastFull) > 60_000){
            if(ui.regen && ui.regen.disabled) return; // request in flight
            loadFromAPI();
          }
        } catch(_e){}
      }, 2_000);
    } catch(_e){}
  })();

  // Live status polling (for freshness diagnostics / UI chip hints).
  (function(){
    if(STATIC_MODE) return;
    try{
      if(liveStatusTimer) clearInterval(liveStatusTimer);
      liveStatusTimer = setInterval(async function(){
        try{
          return; // disabled in static demo
          if(!res.ok) return;
          var j = await res.json();
          state._liveStatus = j;
          state._liveStatusAtMs = Date.now();
        } catch(_e){}
      }, 15_000);
    } catch(_e){}
  })();

  // Snapshot folder picker (file:// support).
  (function(){
    var btn = document.getElementById('pickStaticDir');
    if(!btn) return;
    btn.addEventListener('click', async function(){
      try{
        if(!window.showDirectoryPicker){
          alert('Directory picker not available in this browser. Serve this folder over http(s) or use Edge/Chrome.');
          return;
        }
        var h = await window.showDirectoryPicker();
        // Detect whether this is the root (contains catalog.json) or the bars folder.
        _staticDirMode = '';
        _staticRootDirHandle = null;
        _staticBarsDirHandle = null;
        _staticGeneratedCatalog = null;
        try{
          await h.getFileHandle('catalog.json');
          _staticDirMode = 'root';
          _staticRootDirHandle = h;
        } catch(_e){
          // Treat as bars directory and generate a catalog from filenames.
          _staticDirMode = 'bars';
          _staticBarsDirHandle = h;
          _staticGeneratedCatalog = await generateCatalogFromBarsDir(h);
        }
        // Try to load catalog immediately to populate menus.
        var items = await fetchSymbolCatalog();
        state._catalog = buildCatalogIndex(items || []);
        if(ui.tickerMenu){
          ui.tickerMenu.innerHTML = '';
          var dss = (state._catalog && state._catalog.datasets) ? state._catalog.datasets : [];
          if(dss && dss.length){
            for(var di=0; di<dss.length; di++) ensureTickerItem(dss[di]);
          }
        }
        // Re-sync menus + reload.
        refreshSymbolMenuForTicker();
        scheduleSaveUiConfig();
        loadFromAPI();
      } catch(e){
        try{ console.error(e); } catch(_e){}
      }
    });
  })();

  // Single bars-file picker (file:// support).
  (function(){
    var btn = document.getElementById('pickBarsFile');
    if(!btn) return;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    btn.addEventListener('click', function(){
      try{ input.value = ''; } catch(_e){}
      input.click();
    });

    input.addEventListener('change', async function(){
      try{
        var f = (input.files && input.files[0]) ? input.files[0] : null;
        if(!f) return;
        var txt = await f.text();
        var j = JSON.parse(txt);
        if(!j || typeof j !== 'object') throw new Error('Invalid JSON');
        if(!Array.isArray(j.t_ms) || !Array.isArray(j.o) || !Array.isArray(j.h) || !Array.isArray(j.l) || !Array.isArray(j.c) || !Array.isArray(j.v)){
          throw new Error('Unexpected JSON shape. Expected arrays: t_ms,o,h,l,c,v');
        }
        var sym = String(j.symbol || '').trim();
        var bs = Math.floor(Number(j.bar_s) || 60);
        if(!sym) sym = String(getSymbol() || 'ES_CONT').trim();
        if(!Number.isFinite(bs) || bs <= 0) bs = Math.floor(Number(state.windowSec) || 60);
        _staticBarsByKey[barsKey(sym, bs)] = j;
        rememberBarsPayload(j);
        // Also synthesize a catalog (single symbol) so menus work.
        _staticGeneratedCatalog = { symbols: [{ dataset: inferDatasetFromSymbol(sym), symbol: sym }], _generated: true };
        _staticDirMode = ''; // file-driven
        _staticRootDirHandle = null;
        _staticBarsDirHandle = null;

        // Update UI state to match the file and reload.
        ensureTickerItem(inferDatasetFromSymbol(sym) || 'ES');
        setTicker(inferDatasetFromSymbol(sym) || 'ES');
        refreshSymbolMenuForTicker();
        ensureSymbolItem(sym);
        setSymbol(sym);
        state.windowSec = snapToPreset(clamp(bs, 60, 86400));
        if(ui.window) ui.window.value = String(state.windowSec);
        if(ui.windowVal) ui.windowVal.textContent = formatWindow(state.windowSec);
        syncBarPresetUi();
        scheduleSaveUiConfig();
        loadFromAPI();
      } catch(e){
        alert('Failed to load bars file: ' + String(e && e.message ? e.message : e));
      }
    });
  })();
