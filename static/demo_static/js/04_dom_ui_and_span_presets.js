'use strict';

  // chart state
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  var ui = {
    tickerDD: document.getElementById('tickerDD'),
    tickerBtn: document.getElementById('tickerBtn'),
    tickerMenu: document.getElementById('tickerMenu'),
    tickerLabel: document.getElementById('tickerLabel'),
    // Sidebar indicator toggles
    indEma9: document.getElementById('indEma9'),
    indEma21: document.getElementById('indEma21'),
    indEma50: document.getElementById('indEma50'),
    indVwap: document.getElementById('indVwap'),
    indCandleBias: null,
    practiceBtn: document.getElementById('practiceBtn'),
    practicePauseBtn: document.getElementById('practicePauseBtn'),
    practiceResetBtn: document.getElementById('practiceResetBtn'),
    practiceSpeed: document.getElementById('practiceSpeed'),
    practiceSpeedLabel: document.getElementById('practiceSpeedLabel'),
    practiceStatus: document.getElementById('practiceStatus'),
    practiceScore: document.getElementById('practiceScore'),
    practiceQty: document.getElementById('practiceQty'),
    practiceQtyLabel: document.getElementById('practiceQtyLabel'),
    practiceLongBtn: document.getElementById('practiceLongBtn'),
    practiceShortBtn: document.getElementById('practiceShortBtn'),
    practiceFlattenBtn: document.getElementById('practiceFlattenBtn'),
    practiceHistoryBtn: document.getElementById('practiceHistoryBtn'),
    practiceHistoryStatus: document.getElementById('practiceHistoryStatus'),
    historyModal: document.getElementById('historyModal'),
    historyCloseBtn: document.getElementById('historyCloseBtn'),
    historyRefreshBtn: document.getElementById('historyRefreshBtn'),
    historyModalStatus: document.getElementById('historyModalStatus'),
    historyTableWrap: document.getElementById('historyTableWrap'),
    historyViewCardsBtn: document.getElementById('historyViewCardsBtn'),
    historyViewLedgerBtn: document.getElementById('historyViewLedgerBtn'),
    historyViewMatrixBtn: document.getElementById('historyViewMatrixBtn'),
    window: document.getElementById('window'),
    // Some checkboxes may be removed from the UI; we keep "virtual" controls so existing
    // logic can continue to read ui.*.checked.
    autoW: document.getElementById('autoW'),
    grid: document.getElementById('grid'),
    scale: document.getElementById('scale'),
    nocross: document.getElementById('nocross'),
    fills: document.getElementById('fills'),
    smooth: document.getElementById('smooth'),
    outer: document.getElementById('outer'),
    avgline: document.getElementById('avgline'),
    showBands: document.getElementById('showBands'),
    showCandles: document.getElementById('showCandles'),
    showVolume: document.getElementById('showVolume'),
    candleStyleDD: document.getElementById('candleStyleDD'),
    candleStyleBtn: document.getElementById('candleStyleBtn'),
    candleStyleMenu: document.getElementById('candleStyleMenu'),
    candleStyleLabel: document.getElementById('candleStyleLabel'),
    windowVal: document.getElementById('windowVal'),
    regen: document.getElementById('regen'),
    // Continuous detrend overlay controls (sidebar)
    toggleDetrend: document.getElementById('toggleDetrend'),
    detrendHours: document.getElementById('detrendHours'),
    // Continuous trend / de-noise controls (sidebar)
    toggleTrendLP: document.getElementById('toggleTrendLP'),
    toggleTrendLin: document.getElementById('toggleTrendLin'),
    trendSlopeLabel: document.getElementById('trendSlopeLabel'),
    // Feature registry UI (sidebar)
    featEnable: document.getElementById('featEnable'),
    featList: document.getElementById('featList'),
    featReadout: document.getElementById('featReadout'),
    // Footer session toggles
    sessPreMarket: document.getElementById('sessPreMarket'),
    sessAfterHours: document.getElementById('sessAfterHours'),
    sessClosed: document.getElementById('sessClosed')
  };

  function makeAlwaysOnCheckbox(){
    // Minimal interface used by the app: `.checked` and `.addEventListener`.
    // We keep these as virtual controls so we can remove checkboxes from the UI
    // while preserving existing code paths.
    return {
      checked: true,
      disabled: true,
      addEventListener: function(){ /* no-op */ }
    };
  }

  function enforceAlwaysOnOptions(){
    if(ui.showVolume) ui.showVolume.checked = true;
    if(ui.grid) ui.grid.checked = true;
    if(ui.scale) ui.scale.checked = true;
  }

  // Ensure virtual always-on controls exist even though their checkboxes may be removed from the UI.
  // Auto W is user-controllable; the others are forced on.
  if(!ui.autoW) ui.autoW = makeAlwaysOnCheckbox();
  if(!ui.showVolume) ui.showVolume = makeAlwaysOnCheckbox();
  if(!ui.grid) ui.grid = makeAlwaysOnCheckbox();
  if(!ui.scale) ui.scale = makeAlwaysOnCheckbox();
  // Optional sidebar controls (may not exist in all modes/layouts).
  if(!ui.toggleDetrend) ui.toggleDetrend = { checked: false, addEventListener: function(){ /* no-op */ } };
  if(!ui.detrendHours) ui.detrendHours = { value: '2.0', addEventListener: function(){ /* no-op */ } };
  if(!ui.toggleTrendLP) ui.toggleTrendLP = { checked: false, addEventListener: function(){ /* no-op */ } };
  if(!ui.toggleTrendLin) ui.toggleTrendLin = { checked: false, addEventListener: function(){ /* no-op */ } };
  if(!ui.trendSlopeLabel) ui.trendSlopeLabel = { style: { display: 'none' }, textContent: '' };
  // Feature UI elements are optional (older layouts).
  if(!ui.featEnable) ui.featEnable = { checked: true, addEventListener: function(){ /* no-op */ } };
  if(!ui.featList) ui.featList = null;
  if(!ui.featReadout) ui.featReadout = null;
  enforceAlwaysOnOptions();

  // Scale preset (requested window span) helpers.
  var SPAN_PRESETS = {
    '1d': 24 * 60 * 60 * 1000,
    '5d': 5 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
    '3m': 90 * 24 * 60 * 60 * 1000,
    // Longer presets (future-proof). These are approximations; exact calendar months/years
    // vary, but this is sufficient for bucket sizing + navigation UX.
    '6m': 180 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
    '3y': 3 * 365 * 24 * 60 * 60 * 1000,
    '5y': 5 * 365 * 24 * 60 * 60 * 1000,
    // Special: "show everything available" (resolved against dataset bounds when known).
    'all': Number.POSITIVE_INFINITY
  };
  var SPAN_PRESET_ORDER = ['1d','5d','1m','3m','6m','1y','3y','5y','all'];

  function normalizeSpanPreset(v){
    var k = String(v || '').trim().toLowerCase();
    if(SPAN_PRESETS[k]) return k;
    return '1d';
  }

  function inferSpanPresetFromSpanMs(spanMs){
    // "Reverse bracketing" (round-up / ceiling):
    // - If span is between 5D and 1M, select 1M (even if not exact).
    // - This matches the user expectation that the selector reflects the nearest *bucket above*.
    var s = Number(spanMs);
    if(!Number.isFinite(s) || s <= 0) return '1d';
    // If span effectively covers the full dataset history, call it "ALL".
    // (This keeps the selector truthful when we auto-expand to full history.)
    try{
      var ds0 = Number(state && state.datasetStartMs);
      var de0 = Number(state && state.datasetEndMs);
      var deMax = Number(state && state.datasetMaxEndMs);
      var endForHistory = (Number.isFinite(deMax) && Number.isFinite(ds0) && deMax > ds0) ? deMax : de0;
      if(Number.isFinite(ds0) && Number.isFinite(endForHistory) && endForHistory > ds0){
        var datasetSpan = endForHistory - ds0;
        var slack = 6 * 60 * 60 * 1000; // 6h
        if(s + slack >= datasetSpan) return 'all';
      }
    } catch(_e){}
    var items = [];
    for(var ii=0; ii<SPAN_PRESET_ORDER.length; ii++){
      var kk = SPAN_PRESET_ORDER[ii];
      var mm = Number(SPAN_PRESETS[kk]);
      if(Number.isFinite(mm) && mm > 0) items.push({ k: kk, ms: mm });
    }
    items.sort(function(a,b){ return a.ms - b.ms; });
    if(!items.length) return '1d';
    for(var i=0;i<items.length;i++){
      if(s <= items[i].ms) return items[i].k;
    }
    return items[items.length-1].k;
  }

  function updateSpanPresetAvailability(){
    // Disable presets that exceed available dataset history.
    // This is both UX (avoid "clickable but no data") and an implicit hint about history limits.
    try{
      var ds0 = Number(state && state.datasetStartMs);
      var de0 = Number(state && state.datasetEndMs);
      var deMax = Number(state && state.datasetMaxEndMs);
      // In replay mode, datasetEndMs is intentionally clamped to the current cursor to keep the chart future-blind.
      // Use datasetMaxEndMs (full history end) for availability so clicking Play doesn't force a smaller span preset.
      var endForHistory = (Number.isFinite(deMax) && Number.isFinite(ds0) && deMax > ds0) ? deMax : de0;
      if(!Number.isFinite(ds0) || !Number.isFinite(endForHistory) || endForHistory <= ds0) return;
      var datasetSpan = endForHistory - ds0;
      // Tolerance for "almost exactly N days" datasets (weekends, partial sessions, etc.)
      var slack = 6 * 60 * 60 * 1000; // 6h
      var keys = SPAN_PRESET_ORDER.slice();
      var enabled = {};
      for(var i=0;i<keys.length;i++){
        var k = keys[i];
        var need = Number(SPAN_PRESETS[k]) || 0;
        var ok = (k === 'all') ? true : ((need <= 0) ? true : ((datasetSpan + slack) >= need));
        // Replay: we set a default span preset on start, but do NOT hard-lock the UI.
        enabled[k] = !!ok;
        // Update DOM controls if present.
        var input = document.querySelector('input[type="radio"][name="spanPreset"][value="' + k + '"]');
        if(input){
          input.disabled = !ok;
          var lab = input.closest ? input.closest('label') : null;
          if(lab){
            if(!ok) lab.classList.add('isDisabled');
            else lab.classList.remove('isDisabled');
            // Hide non-applicable options entirely (instead of showing disabled/grayed out).
            if(k !== 'all'){
              if(!ok) lab.classList.add('isHidden');
              else lab.classList.remove('isHidden');
            } else {
              // ALL is always applicable.
              lab.classList.remove('isHidden');
            }
            lab.setAttribute('aria-disabled', (!ok) ? 'true' : 'false');
          }
        }
      }
      // Keep a copy for other logic (e.g. reverse-bracketing) to consult.
      state._spanPresetEnabled = enabled;

      // If current preset is no longer available, fall back to the largest available.
      var cur = normalizeSpanPreset(state.spanPreset || '1d');
      if(!enabled[cur]){
        var pick = null;
        for(var j=keys.length-1; j>=0; j--){
          if(enabled[keys[j]]){ pick = keys[j]; break; }
        }
        if(!pick) pick = '1d';
        // Only update indicator + persistence here; do not force a refetch loop.
        state.spanPreset = pick;
        state.viewSpanMs = Number(SPAN_PRESETS[pick]) || DEFAULT_INIT_SPAN_MS;
        syncSpanPresetUi();
        updateUrlBarSize();
        scheduleSaveUiConfig();
      } else {
        // Keep UI consistent (e.g. after first bounds arrive).
        syncSpanPresetUi();
      }
    } catch(_e){}
  }

  function currentEffectiveVisibleSpanMs(){
    // Effective visible span is driven by zoom: visibleSpan = requestedSpan / xZoom.
    // This matches user expectation when zooming in/out: the selector should reflect what you see.
    try{
      if(!Number.isFinite(state.viewSpanMs) || state.viewSpanMs <= 0) return NaN;
      return getVisibleSpanMs(state.viewSpanMs);
    } catch(_e){
      return NaN;
    }
  }

  function syncSpanPresetFromNavigation(opts){
    // Keep the active radio (and optionally persistence) in sync with how the user has navigated.
    // IMPORTANT: this does NOT change the span; it only updates the indicator + persistence.
    var o = opts || {};
    var span = currentEffectiveVisibleSpanMs();
    if(!Number.isFinite(span) || span <= 0) return;
    // Choose the "rounded up" preset, but never choose a disabled preset.
    var inferred = inferSpanPresetFromSpanMs(span);
    try{
      var enabledMap = (state && state._spanPresetEnabled) ? state._spanPresetEnabled : null;
      function isEnabled(k){
        if(enabledMap && enabledMap[k] !== undefined) return !!enabledMap[k];
        var el = document.querySelector('input[type="radio"][name="spanPreset"][value="' + k + '"]');
        return el ? !el.disabled : true;
      }
      if(!isEnabled(inferred)){
        // Find the smallest enabled preset >= current span (round-up among enabled),
        // else fall back to the largest enabled.
        var items2 = [];
        for(var ii=0; ii<SPAN_PRESET_ORDER.length; ii++){
          var kk = SPAN_PRESET_ORDER[ii];
          var mm = Number(SPAN_PRESETS[kk]);
          if(Number.isFinite(mm) && mm > 0) items2.push({ k: kk, ms: mm });
        }
        items2.sort(function(a,b){ return a.ms - b.ms; });
        var pick = null;
        for(var j=0;j<items2.length;j++){
          if(span <= items2[j].ms && isEnabled(items2[j].k)){ pick = items2[j].k; break; }
        }
        if(!pick){
          for(var r=items2.length-1; r>=0; r--){
            if(isEnabled(items2[r].k)){ pick = items2[r].k; break; }
          }
        }
        if(pick) inferred = pick;
      }
    } catch(_e){}
    if(inferred !== state.spanPreset){
      state.spanPreset = inferred;
      syncSpanPresetUi();
      if(!o.skipUrl) updateUrlBarSize();
      if(!o.skipSave) scheduleSaveUiConfig();
    } else {
      // Still ensure UI reflects current state (e.g. after DOM reloads).
      syncSpanPresetUi();
    }
  }

  function syncSpanPresetUi(){
    try{
      var k = normalizeSpanPreset(state && state.spanPreset ? state.spanPreset : '1d');
      var els = document.querySelectorAll('input[type="radio"][name="spanPreset"]');
      for(var i=0;i<els.length;i++){
        var el = els[i];
        if(!el) continue;
        el.checked = (String(el.value || '').toLowerCase() === k);
      }
    } catch(_e){}
  }

  function setSpanPreset(v, opts){
    var o = opts || {};
    var key = normalizeSpanPreset(v);
    // Replay: do NOT hard-lock span preset while active; allow user changes.
    // If dataset bounds are known and this preset is not available, fall back to the largest available.
    try{
      updateSpanPresetAvailability();
      var el = document.querySelector('input[type="radio"][name="spanPreset"][value="' + key + '"]');
      if(el && el.disabled){
        // pick the largest enabled
        var keys = SPAN_PRESET_ORDER.slice();
        for(var i=keys.length-1;i>=0;i--){
          var k2 = keys[i];
          var el2 = document.querySelector('input[type="radio"][name="spanPreset"][value="' + k2 + '"]');
          if(el2 && !el2.disabled){ key = k2; break; }
        }
      }
    } catch(_e){}
    state.spanPreset = key;
    if(key === 'all'){
      // Resolve to the currently known full dataset span; if unknown, fall back to a small default
      // and we'll expand after bounds are learned from the first response.
      var ds0 = Number(state && state.datasetStartMs);
      var de0 = Number(state && state.datasetEndMs);
      var deMax = Number(state && state.datasetMaxEndMs);
      var endForHistory = (Number.isFinite(deMax) && Number.isFinite(ds0) && deMax > ds0) ? deMax : de0;
      if(Number.isFinite(ds0) && Number.isFinite(endForHistory) && endForHistory > ds0){
        state.viewSpanMs = endForHistory - ds0;
      } else {
        state.viewSpanMs = DEFAULT_INIT_SPAN_MS;
      }
    } else {
      state.viewSpanMs = Number(SPAN_PRESETS[key]) || DEFAULT_INIT_SPAN_MS;
    }
    // Picking a preset should show (roughly) that preset span immediately.
    state.xZoom = 1;
    // Preset selection implies "show me the latest N"; keep following latest.
    state.followLatest = true;
    if(Number.isFinite(state.datasetEndMs)) state.viewEndMs = state.datasetEndMs;
    syncSpanPresetUi();
    updateSpanPresetAvailability();
    if(!o.skipUrl) updateUrlBarSize();
    if(!o.skipSave) scheduleSaveUiConfig();
    if(!o.skipLoad && !STATIC_MODE) loadFromAPI();
  }
