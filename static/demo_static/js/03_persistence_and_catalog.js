'use strict';

  // UI config persistence (static mode): localStorage instead of server.
  var UI_CFG_KEY = 'char_ui_config_v1';

  function coerceBool(v, fallback){
    if(v === true || v === false) return v;
    if(v === 1 || v === 0) return !!v;
    var s = (v === null || v === undefined) ? '' : String(v).toLowerCase();
    if(s === 'true' || s === '1') return true;
    if(s === 'false' || s === '0') return false;
    return !!fallback;
  }

  function coerceInt(v, fallback){
    var n = Number(v);
    if(!Number.isFinite(n)) return Number(fallback);
    return Math.floor(n);
  }

  var persist = {
    enabled: false,
    applying: false,
    hadConfig: false,
    saveTimer: null
  };

  async function fetchUiConfig(){
    try{
      var raw = localStorage.getItem(UI_CFG_KEY);
      if(!raw) return null;
      var j = JSON.parse(raw);
      if(!j || typeof j !== 'object') return null;
      return j;
    } catch(_e){
      return null;
    }
  }

  function getTicker(){
    var t = String(state.ticker || '').trim();
    if(t) return t;
    if(ui.tickerLabel){
      var tt = String(ui.tickerLabel.textContent || '').trim();
      if(tt) return tt;
    }
    return 'ES';
  }

  function getSymbol(){
    var s = String(state.symbol || '').trim();
    if(s) return s;
    if(ui.symbolLabel){
      var t = String(ui.symbolLabel.textContent || '').trim();
      if(t) return t;
    }
    return 'ESZ5';
  }

  function closeTickerMenu(){
    if(!ui.tickerDD) return;
    ui.tickerDD.classList.remove('open');
    if(ui.tickerBtn) ui.tickerBtn.setAttribute('aria-expanded','false');
  }

  function toggleTickerMenu(){
    if(!ui.tickerDD || !ui.tickerBtn) return;
    var open = ui.tickerDD.classList.toggle('open');
    ui.tickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setTicker(ticker){
    var v = String(ticker || '').trim().toUpperCase();
    if(!v) v = 'ES';
    state.ticker = v;
    if(ui.tickerLabel) ui.tickerLabel.textContent = v;
    if(ui.tickerMenu){
      var items = ui.tickerMenu.querySelectorAll('.ddItem');
      for(var i=0;i<items.length;i++){
        var it = items[i];
        var val = it.getAttribute('data-value');
        if(val === v) it.classList.add('sel');
        else it.classList.remove('sel');
      }
    }
  }

  function ensureTickerItem(ticker){
    if(!ui.tickerMenu) return;
    var v = String(ticker || '').trim().toUpperCase();
    if(!v) return;
    var items = ui.tickerMenu.querySelectorAll('.ddItem');
    for(var i=0;i<items.length;i++){
      if(items[i].getAttribute('data-value') === v) return;
    }
    var div = document.createElement('div');
    div.className = 'ddItem mono';
    div.setAttribute('role','option');
    div.setAttribute('data-value', v);
    div.textContent = v;
    ui.tickerMenu.appendChild(div);
  }

  function closeSymbolMenu(){
    if(!ui.symbolDD) return;
    ui.symbolDD.classList.remove('open');
    if(ui.symbolBtn) ui.symbolBtn.setAttribute('aria-expanded','false');
  }

  function toggleSymbolMenu(){
    if(!ui.symbolDD || !ui.symbolBtn) return;
    var open = ui.symbolDD.classList.toggle('open');
    ui.symbolBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setSymbol(sym){
    var v = String(sym || '').trim();
    if(!v) v = 'ESZ5';
    state.symbol = v;
    if(ui.symbolLabel) ui.symbolLabel.textContent = v;
    if(ui.symbolMenu){
      var items = ui.symbolMenu.querySelectorAll('.ddItem');
      for(var i=0;i<items.length;i++){
        var it = items[i];
        var val = it.getAttribute('data-value');
        if(val === v) it.classList.add('sel');
        else it.classList.remove('sel');
      }
    }
  }

  function symbolDisplayText(sym){
    var s = String(sym || '').trim();
    if(!s) return '';
    // Generic continuous labels: <ROOT>_CONT or <ROOT>1!
    if(/^[A-Z0-9]+_CONT$/.test(s)){
      var root = s.replace(/_CONT$/,'');
      return s + ' (Continuous ' + root + ' \u2013 calendar roll)';
    }
    if(/^[A-Z0-9]+1!$/.test(s)){
      var root2 = s.replace(/1!$/,'');
      return s + ' (Continuous ' + root2 + ' \u2013 calendar roll)';
    }
    // Legacy explicit labels (kept for a nicer first impression on ES).
    if(s === 'ESU5') return 'ESU5 (Sep 2025 \u2013 single contract)';
    if(s === 'ESZ5') return 'ESZ5 (Dec 2025 \u2013 single contract)';
    return s;
  }

  function ensureSymbolItem(sym){
    if(!ui.symbolMenu) return;
    var v = String(sym || '').trim();
    if(!v) return;
    var items = ui.symbolMenu.querySelectorAll('.ddItem');
    for(var i=0;i<items.length;i++){
      if(items[i].getAttribute('data-value') === v) return;
    }
    var div = document.createElement('div');
    div.className = 'ddItem mono';
    div.setAttribute('role','option');
    div.setAttribute('data-value', v);
    div.textContent = symbolDisplayText(v);
    ui.symbolMenu.appendChild(div);
  }

  async function fetchSymbolCatalog(){
    try{
      if(STATIC_MODE){
        return await loadStaticCatalog();
      }
      // API mode: if we're in single mode, synthesize a 1-item catalog.
      var symQ = String(getQueryParam('symbol', '') || '').trim();
      if(SINGLE_MODE && symQ){
        return [{ symbol: symQ, dataset: (inferDatasetFromSymbol(symQ) || symQ), synthetic: false }];
      }
      // Optional: if you later add an endpoint that returns catalog items, this will use it.
      // Expected: [{dataset,symbol}, ...] or {symbols:[...]}
      try{
        var url = buildUrl(API_BASE, '/api/symbols', {});
        var res = await fetch(url, { method:'GET', cache:'no-store' });
        if(res && res.ok){
          var j = await res.json();
          if(Array.isArray(j)) return j;
          if(j && Array.isArray(j.symbols)) return j.symbols;
        }
      } catch(_e2){}
      if(symQ) return [{ symbol: symQ, dataset: (inferDatasetFromSymbol(symQ) || symQ), synthetic: false }];
      return [];
    } catch(_e){
      return [];
    }
  }

  async function fetchMetaForSymbol(symbol){
    try{
      // In static mode, dataset bounds come from the bars file payload.
      return null;
    } catch(_e){
      return null;
    }
  }

  function buildCatalogIndex(items){
    // Returns { datasets:[], byDataset:{DS:[symbols...]}, datasetBySymbol:{sym:DS} }
    var byDataset = {};
    var datasetBySymbol = {};
    for(var i=0;i<items.length;i++){
      var it = items[i];
      if(!it) continue;
      var sym = String(it.symbol || '').trim();
      if(!sym) continue;
      var ds = String(it.dataset || '').trim().toUpperCase();
      // Fallback: infer ES by known synthetic/contract patterns if dataset missing.
      if(!ds){
        if(sym === 'ES_CONT' || sym === 'ES1!' || /^ES[A-Z]\\d$/.test(sym)) ds = 'ES';
      }
      if(!ds) continue;
      if(!byDataset[ds]) byDataset[ds] = [];
      byDataset[ds].push(sym);
      datasetBySymbol[sym] = ds;
    }
    var datasets = Object.keys(byDataset).sort();
    for(var k=0;k<datasets.length;k++){
      var d = datasets[k];
      // Unique + stable order.
      var seen = {};
      var dedup = [];
      var arr = byDataset[d] || [];
      for(var j=0;j<arr.length;j++){
        var s2 = String(arr[j] || '').trim();
        if(!s2 || seen[s2]) continue;
        seen[s2] = true;
        dedup.push(s2);
      }
      // Prefer ES_CONT at top for ES.
      if(d === 'ES'){
        dedup.sort();
        if(dedup.indexOf('ES_CONT') >= 0){
          dedup = ['ES_CONT'].concat(dedup.filter(function(x){ return x !== 'ES_CONT'; }));
        }
      } else {
        dedup.sort();
      }
      byDataset[d] = dedup;
    }
    return { datasets: datasets, byDataset: byDataset, datasetBySymbol: datasetBySymbol };
  }

  function refreshSymbolMenuForTicker(){
    if(!ui.symbolMenu) return;
    var ds = String(getTicker() || 'ES').trim().toUpperCase();
    var catalog = state._catalog || null;
    var syms = (catalog && catalog.byDataset && catalog.byDataset[ds]) ? catalog.byDataset[ds] : [];
    ui.symbolMenu.innerHTML = '';
    for(var i=0;i<syms.length;i++) ensureSymbolItem(syms[i]);
  }

  function chooseDefaultSymbolForTicker(ds){
    var d = String(ds || '').trim().toUpperCase();
    var catalog = state._catalog || null;
    var syms = (catalog && catalog.byDataset && catalog.byDataset[d]) ? catalog.byDataset[d] : [];
    if(!syms || !syms.length) return (d === 'ES' ? 'ES_CONT' : '');
    if(d === 'ES' && syms.indexOf('ES_CONT') >= 0) return 'ES_CONT';
    return String(syms[0] || '').trim();
  }

  function applyUiConfig(cfg){
    if(!cfg || typeof cfg !== 'object') return false;
    persist.applying = true;
    try{
      if(typeof cfg.ticker === 'string' && cfg.ticker.trim()){
        ensureTickerItem(cfg.ticker.trim());
        setTicker(cfg.ticker.trim());
        refreshSymbolMenuForTicker();
      }
      if(typeof cfg.symbol === 'string' && cfg.symbol.trim()){
        ensureSymbolItem(cfg.symbol.trim());
        setSymbol(cfg.symbol.trim());
      }

      // Always-on options (removed from UI): ignore persisted values.
      if(ui.showBands && cfg.showBands !== undefined) ui.showBands.checked = coerceBool(cfg.showBands, ui.showBands.checked);
      if(ui.showCandles && cfg.showCandles !== undefined) ui.showCandles.checked = coerceBool(cfg.showCandles, ui.showCandles.checked);
      if(ui.nocross && cfg.nocross !== undefined) ui.nocross.checked = coerceBool(cfg.nocross, ui.nocross.checked);
      if(ui.fills && cfg.fills !== undefined) ui.fills.checked = coerceBool(cfg.fills, ui.fills.checked);
      if(ui.smooth && cfg.smooth !== undefined) ui.smooth.checked = coerceBool(cfg.smooth, ui.smooth.checked);
      if(ui.outer && cfg.outer !== undefined) ui.outer.checked = coerceBool(cfg.outer, ui.outer.checked);
      if(ui.avgline && cfg.avgline !== undefined) ui.avgline.checked = coerceBool(cfg.avgline, ui.avgline.checked);
      // Session shading toggles (footer)
      if(ui.sessPreMarket && cfg.sess_pre_market !== undefined) ui.sessPreMarket.checked = coerceBool(cfg.sess_pre_market, ui.sessPreMarket.checked);
      if(ui.sessAfterHours && cfg.sess_after_hours !== undefined) ui.sessAfterHours.checked = coerceBool(cfg.sess_after_hours, ui.sessAfterHours.checked);
      if(ui.sessClosed && cfg.sess_closed !== undefined) ui.sessClosed.checked = coerceBool(cfg.sess_closed, ui.sessClosed.checked);
      // Overlays (EMA/VWAP)
      if(ui.indEma9 && cfg.ind_ema9 !== undefined) ui.indEma9.checked = coerceBool(cfg.ind_ema9, ui.indEma9.checked);
      if(ui.indEma21 && cfg.ind_ema21 !== undefined) ui.indEma21.checked = coerceBool(cfg.ind_ema21, ui.indEma21.checked);
      if(ui.indEma50 && cfg.ind_ema50 !== undefined) ui.indEma50.checked = coerceBool(cfg.ind_ema50, ui.indEma50.checked);
      if(ui.indVwap && cfg.ind_vwap !== undefined) ui.indVwap.checked = coerceBool(cfg.ind_vwap, ui.indVwap.checked);
      // Candle bias UI is intentionally removed.

      if(cfg.bar_s !== undefined){
        var ww = clamp(coerceInt(cfg.bar_s, 60), 60, 86400);
        ww = snapToPreset(ww);
        state.windowSec = ww;
        if(ui.window) ui.window.value = String(ww);
        if(ui.windowVal) ui.windowVal.textContent = formatWindow(ww);
        syncBarPresetUi();
      }

      // Scale preset (requested window span).
      // Kept intentionally simple: store as a small key ('1d','5d','1m','3m').
      if(typeof cfg.span === 'string' && cfg.span.trim()){
        setSpanPreset(cfg.span.trim(), { skipLoad: true, skipSave: true, skipUrl: true });
      }

      if(typeof cfg.candleStyle === 'string' && cfg.candleStyle){
        setCandleStyle(cfg.candleStyle);
      }

      // Continuous detrend overlay + trend de-noise (optional sidebar panel).
      if(cfg.detrend_overlay !== undefined && ui.toggleDetrend) ui.toggleDetrend.checked = coerceBool(cfg.detrend_overlay, !!ui.toggleDetrend.checked);
      if(cfg.detrend_hours !== undefined && ui.detrendHours){
        var dh = Number(cfg.detrend_hours);
        // Allow 0.0 as a valid "no smoothing" value.
        if(!Number.isFinite(dh) || dh < 0) dh = 2.0;
        ui.detrendHours.value = String(dh);
      }
      // New: independent de-noise functions.
      if(cfg.trend_lp !== undefined && ui.toggleTrendLP) ui.toggleTrendLP.checked = coerceBool(cfg.trend_lp, !!ui.toggleTrendLP.checked);
      if(cfg.trend_lin !== undefined && ui.toggleTrendLin) ui.toggleTrendLin.checked = coerceBool(cfg.trend_lin, !!ui.toggleTrendLin.checked);
      // Back-compat: older config used a single show flag + mode dropdown.
      // If present, map it onto the new checkboxes (only if the new keys are absent).
      if((cfg.trend_lp === undefined && cfg.trend_lin === undefined) && (cfg.trend_show !== undefined || cfg.trend_mode !== undefined)){
        var show = (cfg.trend_show !== undefined) ? coerceBool(cfg.trend_show, false) : false;
        var tm = String(cfg.trend_mode || '').trim();
        if(tm !== 'lp' && tm !== 'lin') tm = 'lp';
        if(ui.toggleTrendLP) ui.toggleTrendLP.checked = !!(show && tm === 'lp');
        if(ui.toggleTrendLin) ui.toggleTrendLin.checked = !!(show && tm === 'lin');
      }

      // Feature registry config (optional; used by static/demo_static/js/10_features.js).
      // Stored as an opaque object so we can evolve it without breaking older configs.
      try{
        if(cfg && cfg.feat_cfg && typeof cfg.feat_cfg === 'object'){
          window.__feature_cfg_saved = cfg.feat_cfg;
        }
      } catch(_eFeatCfg){}

      // Feature UI (checkbox selections / enable flag).
      // This is used by static/demo_static/js/11_feature_ui.js.
      try{
        window.__feature_ui_saved = {
          enabled: (cfg && typeof cfg.feat_enable === 'boolean') ? cfg.feat_enable : true,
          selected: (cfg && Array.isArray(cfg.feat_selected)) ? cfg.feat_selected.slice() : []
        };
      } catch(_eFeatUi){}

      syncCandleStyleEnabled();
      enforceAlwaysOnOptions();
      return true;
    } catch(_e){
      return false;
    } finally {
      persist.applying = false;
    }
  }

  function collectUiConfig(){
    return {
      version: 1,
      // saved_at is set server-side too, but keeping it here is handy for debugging.
      saved_at: new Date().toISOString().replace('.000Z','Z'),
      ticker: getTicker(),
      symbol: getSymbol(),
      bar_s: Math.floor(Number(state.windowSec) || 60),
      span: String(state.spanPreset || '1d'),
      auto_w: !!(ui.autoW && ui.autoW.checked),
      showBands: !!(ui.showBands && ui.showBands.checked),
      showCandles: !!(ui.showCandles && ui.showCandles.checked),
      candleStyle: String(state.candleStyle || 'std'),
      showVolume: !!(ui.showVolume && ui.showVolume.checked),
      grid: !!(ui.grid && ui.grid.checked),
      scale: !!(ui.scale && ui.scale.checked),
      nocross: !!(ui.nocross && ui.nocross.checked),
      fills: !!(ui.fills && ui.fills.checked),
      smooth: !!(ui.smooth && ui.smooth.checked),
      outer: !!(ui.outer && ui.outer.checked),
      avgline: !!(ui.avgline && ui.avgline.checked),
      sess_pre_market: !!(ui.sessPreMarket && ui.sessPreMarket.checked),
      sess_after_hours: !!(ui.sessAfterHours && ui.sessAfterHours.checked),
      sess_closed: !!(ui.sessClosed && ui.sessClosed.checked),
      ind_ema9: !!(ui.indEma9 && ui.indEma9.checked),
      ind_ema21: !!(ui.indEma21 && ui.indEma21.checked),
      ind_ema50: !!(ui.indEma50 && ui.indEma50.checked),
      ind_vwap: !!(ui.indVwap && ui.indVwap.checked),
      ind_candle_bias: false,
      // Continuous detrend / trends (sidebar)
      detrend_overlay: !!(ui.toggleDetrend && ui.toggleDetrend.checked),
      detrend_hours: ui.detrendHours ? (Math.round((Number(ui.detrendHours.value) || 0) * 100) / 100) : 0,
      trend_lp: !!(ui.toggleTrendLP && ui.toggleTrendLP.checked),
      trend_lin: !!(ui.toggleTrendLin && ui.toggleTrendLin.checked),

      // Feature registry (opaque config blob; optional)
      feat_cfg: (function(){
        try{
          return (window.__feature_cfg_saved && typeof window.__feature_cfg_saved === 'object') ? window.__feature_cfg_saved : null;
        } catch(_e){
          return null;
        }
      })(),

      // Feature UI selections
      feat_enable: (function(){
        try{
          if(window.__feature_cfg_saved && typeof window.__feature_cfg_saved.enabled === 'boolean') return !!window.__feature_cfg_saved.enabled;
          if(window.__feature_ui_saved && typeof window.__feature_ui_saved.enabled === 'boolean') return !!window.__feature_ui_saved.enabled;
          return true;
        } catch(_e){
          return true;
        }
      })(),
      feat_selected: (function(){
        try{
          return (window.__feature_ui_saved && Array.isArray(window.__feature_ui_saved.selected)) ? window.__feature_ui_saved.selected.slice() : [];
        } catch(_e){
          return [];
        }
      })()
    };
  }

  function scheduleSaveUiConfig(){
    if(!persist.enabled || persist.applying) return;
    if(persist.saveTimer) clearTimeout(persist.saveTimer);
    persist.saveTimer = setTimeout(function(){
      try{
        localStorage.setItem(UI_CFG_KEY, JSON.stringify(collectUiConfig()));
      } catch(_e){}
    }, 250);
  }

  // Robust rounded-rect path: never passes a negative radius to arcTo.
  function roundRect(ctx, x, y, w, h, r){
    if(!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
    if(w < 0){ x += w; w = -w; }
    if(h < 0){ y += h; h = -h; }
    if(w <= 0 || h <= 0) return;
    var rr = Math.max(0, Math.min(Number.isFinite(r) ? r : 0, w/2, h/2));
    ctx.beginPath();
    if(rr === 0){ ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // Stroke a polyline with gap support. smooth=true uses quadratic smoothing via midpoints.
  function strokePolyline(ctx, pts, style, width, smooth, dash){
    if(!pts || pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if(Array.isArray(dash)) ctx.setLineDash(dash);

    var seg = [];

    function strokeSeg(segPts){
      if(segPts.length < 2) return;
      ctx.beginPath();
      if(!smooth || segPts.length < 3){
        ctx.moveTo(segPts[0][0], segPts[0][1]);
        for(var i=1;i<segPts.length;i++) ctx.lineTo(segPts[i][0], segPts[i][1]);
        ctx.stroke();
        return;
      }
      ctx.moveTo(segPts[0][0], segPts[0][1]);
      for(var j=1;j<segPts.length-1;j++){
        var p1 = segPts[j];
        var p2 = segPts[j+1];
        var mx = (p1[0] + p2[0]) / 2;
        var my = (p1[1] + p2[1]) / 2;
        ctx.quadraticCurveTo(p1[0], p1[1], mx, my);
      }
      var pn1 = segPts[segPts.length-2];
      var pn = segPts[segPts.length-1];
      ctx.quadraticCurveTo(pn1[0], pn1[1], pn[0], pn[1]);
      ctx.stroke();
    }

    for(var k=0;k<pts.length;k++){
      var p = pts[k];
      var px = p[0];
      var py = p[1];
      if(!Number.isFinite(px) || !Number.isFinite(py)){
        strokeSeg(seg);
        seg = [];
        continue;
      }
      seg.push([px,py]);
    }
    strokeSeg(seg);

    ctx.restore();
  }

  // Fill between two polylines with gap support.
  function fillBetween(ctx, upperPts, lowerPts, fillStyle, smooth){
    var n = Math.min(upperPts.length, lowerPts.length);
    if(n < 2) return;

    ctx.save();
    ctx.fillStyle = fillStyle;

    var segUpper = [];
    var segLower = [];

    function appendSmoothLineTo(pts){
      for(var i=1;i<pts.length-1;i++){
        var p1 = pts[i];
        var p2 = pts[i+1];
        var mx = (p1[0] + p2[0]) / 2;
        var my = (p1[1] + p2[1]) / 2;
        ctx.quadraticCurveTo(p1[0], p1[1], mx, my);
      }
      var pn1 = pts[pts.length-2];
      var pn = pts[pts.length-1];
      ctx.quadraticCurveTo(pn1[0], pn1[1], pn[0], pn[1]);
    }

    function flush(){
      if(segUpper.length < 2 || segLower.length < 2){ segUpper = []; segLower = []; return; }
      ctx.beginPath();
      ctx.moveTo(segUpper[0][0], segUpper[0][1]);
      if(!smooth || segUpper.length < 3){
        for(var i=1;i<segUpper.length;i++) ctx.lineTo(segUpper[i][0], segUpper[i][1]);
      } else {
        appendSmoothLineTo(segUpper);
      }
      var rev = segLower.slice().reverse();
      ctx.lineTo(rev[0][0], rev[0][1]);
      if(!smooth || rev.length < 3){
        for(var j=1;j<rev.length;j++) ctx.lineTo(rev[j][0], rev[j][1]);
      } else {
        appendSmoothLineTo(rev);
      }
      ctx.closePath();
      ctx.fill();
      segUpper = []; segLower = [];
    }

    for(var k=0;k<n;k++){
      var ux = upperPts[k][0], uy = upperPts[k][1];
      var lx = lowerPts[k][0], ly = lowerPts[k][1];
      var ok = Number.isFinite(ux) && Number.isFinite(uy) && Number.isFinite(lx) && Number.isFinite(ly);
      if(!ok){ flush(); continue; }
      segUpper.push([ux,uy]);
      segLower.push([lx,ly]);
    }
    flush();

    ctx.restore();
  }

  // --- Detrend overlay helpers (ported from osc/src/detrend.js + osc/src/render/price.js) ---
  function detrendRollingLinear(closes, win){
    var N = closes.length;
    var w = clamp(Math.floor(Number(win) || 0), 5, N);
    var out = new Array(N);
    for(var i=0;i<N;i++) out[i] = 0;

    for(var i2=0; i2<N; i2++){
      var start = clamp(i2 - w + 1, 0, N-1);
      var end = i2;
      var nn = end - start + 1;

      var sX = (nn-1)*nn/2;
      var sX2 = (nn-1)*nn*(2*nn-1)/6;

      var sY = 0, sXY = 0;
      for(var j=0; j<nn; j++){
        var y = Number(closes[start + j]);
        if(!Number.isFinite(y)) y = 0;
        sY += y;
        sXY += j * y;
      }

      var denom = (nn * sX2 - sX*sX) || 1e-9;
      var a = (nn*sXY - sX*sY) / denom;
      var b = (sY - a*sX) / nn;
      var yhat = a*(nn-1) + b;
      var yi = Number(closes[i2]);
      if(!Number.isFinite(yi)) yi = 0;
      out[i2] = yi - yhat;
    }
    return out;
  }

  function smaRolling(closes, win){
    var N = closes.length;
    var w = clamp(Math.floor(Number(win) || 0), 1, N);
    var out = new Array(N);
    var sum = 0;
    for(var i=0; i<N; i++){
      var y = Number(closes[i]);
      if(!Number.isFinite(y)) y = 0;
      sum += y;
      if(i >= w){
        var y0 = Number(closes[i-w]);
        if(!Number.isFinite(y0)) y0 = 0;
        sum -= y0;
      }
      var denom = Math.min(i+1, w);
      out[i] = sum/denom;
    }
    return out;
  }

  function getDetrendOverlaySeries(){
    try{
      if(!(ui && ui.toggleDetrend && ui.toggleDetrend.checked)) return null;
      if(!state || !Array.isArray(state.data) || !state.data.length) return null;
      var n = state.data.length;
      if(n < 2) return null;

      var barS = Math.floor(Number(state.windowSec) || 60);
      if(!Number.isFinite(barS) || barS <= 0) barS = 60;

      var dh = ui.detrendHours ? Number(ui.detrendHours.value) : NaN;
      // Allow 0.0 as "no smoothing" (overlay should become raw closes).
      if(!Number.isFinite(dh) || dh < 0) dh = 2.0;

      // Convert hours to window in bars based on current bar size.
      var winBars = Math.floor((dh * 3600) / barS);
      if(!Number.isFinite(winBars) || winBars <= 0) winBars = 5;
      // osc demo clamps to at least 30 minutes when operating on 1-minute data.
      // Mirror that time-based minimum across any bar size.
      var minBars = Math.max(5, Math.ceil((30 * 60) / barS));
      winBars = clamp(winBars, minBars, n);

      var t0 = Number(state.data[0] && state.data[0].t) || 0;
      var t1 = Number(state.data[n-1] && state.data[n-1].t) || 0;
      var key = [n, t0, t1, barS, Math.round(dh*100)/100, winBars].join('|');

      try{
        if(!state._render) state._render = {};
        if(state._render.detrendOverlay && state._render.detrendOverlay.key === key){
          return state._render.detrendOverlay.y;
        }
      } catch(_eCache){}

      var closes = new Array(n);
      for(var i=0;i<n;i++){
        var d = state.data[i];
        var c = d ? Number(d.c) : NaN;
        closes[i] = Number.isFinite(c) ? c : 0;
      }

      // Special-case: 0h means "no smoothing", so the overlay just matches raw closes.
      if(dh === 0){
        try{
          state._render.detrendOverlay = { key: key, y: closes.slice() };
        } catch(_eStore0){}
        return closes;
      }

      var resid = detrendRollingLinear(closes, winBars);
      var base = smaRolling(closes, winBars);
      var y = new Array(n);
      for(var k=0;k<n;k++) y[k] = Number(resid[k]) + Number(base[k]);

      try{
        state._render.detrendOverlay = { key: key, y: y };
      } catch(_eStore){}
      return y;
    } catch(_e){
      return null;
    }
  }

  // --- Trend (de-noised) overlay helpers ---
  // Trend modes:
  //  - lp: low-pass filtering (SMA trend level)
  //  - lin: local linear trend extraction (trend level + slope)
  function rollingLinearTrend(closes, win){
    var N = closes.length;
    var w = clamp(Math.floor(Number(win) || 0), 5, N);
    var level = new Array(N);
    var slopePerBar = new Array(N);
    for(var i=0;i<N;i++){ level[i] = 0; slopePerBar[i] = 0; }

    for(var i2=0; i2<N; i2++){
      var start = clamp(i2 - w + 1, 0, N-1);
      var end = i2;
      var nn = end - start + 1;

      var sX = (nn-1)*nn/2;
      var sX2 = (nn-1)*nn*(2*nn-1)/6;

      var sY = 0, sXY = 0;
      for(var j=0; j<nn; j++){
        var y = Number(closes[start + j]);
        if(!Number.isFinite(y)) y = 0;
        sY += y;
        sXY += j * y;
      }

      var denom = (nn * sX2 - sX*sX) || 1e-9;
      var a = (nn*sXY - sX*sY) / denom;
      var b = (sY - a*sX) / nn;
      var yhat = a*(nn-1) + b;
      level[i2] = yhat;
      slopePerBar[i2] = a;
    }
    return { level: level, slopePerBar: slopePerBar };
  }

  function getTrendOverlayData(){
    try{
      var wantLP = !!(ui && ui.toggleTrendLP && ui.toggleTrendLP.checked);
      var wantLin = !!(ui && ui.toggleTrendLin && ui.toggleTrendLin.checked);
      if(!wantLP && !wantLin) return null;
      if(!state || !Array.isArray(state.data) || !state.data.length) return null;
      var n = state.data.length;
      if(n < 2) return null;

      var barS = Math.floor(Number(state.windowSec) || 60);
      if(!Number.isFinite(barS) || barS <= 0) barS = 60;

      // Reuse the same "smoothing strength" lookback window (hours) as the detrend overlay.
      var dh = ui.detrendHours ? Number(ui.detrendHours.value) : NaN;
      // Allow 0.0 as a valid "no smoothing" value.
      if(!Number.isFinite(dh) || dh < 0) dh = 2.0;

      var winBars = Math.floor((dh * 3600) / barS);
      if(!Number.isFinite(winBars) || winBars <= 0) winBars = 5;
      var minBars = Math.max(5, Math.ceil((30 * 60) / barS));
      winBars = clamp(winBars, minBars, n);

      var t0 = Number(state.data[0] && state.data[0].t) || 0;
      var t1 = Number(state.data[n-1] && state.data[n-1].t) || 0;
      var key = [n, t0, t1, barS, Math.round(dh*100)/100, winBars, wantLP?1:0, wantLin?1:0].join('|');

      try{
        if(!state._render) state._render = {};
        if(state._render.trendOverlay && state._render.trendOverlay.key === key){
          return state._render.trendOverlay;
        }
      } catch(_eCache){}

      var closes = new Array(n);
      for(var i=0;i<n;i++){
        var d = state.data[i];
        var c = d ? Number(d.c) : NaN;
        closes[i] = Number.isFinite(c) ? c : 0;
      }

      var out = { key: key, yLP: null, yLin: null, slopePerHr: null, lastSlopePerHr: NaN };
      // Special-case: 0h means "no smoothing".
      // - LP becomes raw closes
      // - LIN level becomes raw closes; slope is 0
      if(dh === 0){
        if(wantLP) out.yLP = closes.slice();
        if(wantLin){
          out.yLin = closes.slice();
          out.slopePerHr = new Array(n);
          for(var z=0; z<n; z++) out.slopePerHr[z] = 0;
          out.lastSlopePerHr = 0;
        }
        try{ state._render.trendOverlay = out; } catch(_eStoreZ){}
        return out;
      }
      if(wantLP){
        out.yLP = smaRolling(closes, winBars);
      }
      if(wantLin){
        var lin = rollingLinearTrend(closes, winBars);
        out.yLin = lin.level;
        out.slopePerHr = new Array(n);
        var mult = (barS > 0) ? (3600 / barS) : 60; // bars/hr
        for(var k=0;k<n;k++){
          var s = Number(lin.slopePerBar[k]);
          out.slopePerHr[k] = Number.isFinite(s) ? (s * mult) : NaN;
        }
        out.lastSlopePerHr = Number(out.slopePerHr[n-1]);
      }
      try{ state._render.trendOverlay = out; } catch(_eStore){}
      return out;
    } catch(_e){
      return null;
    }
  }

  function orderSig(d){
    var arr = [
      ['l', d.l],
      ['o', d.o],
      ['c', d.c],
      ['h', d.h]
    ].sort(function(a,b){ return a[1]-b[1]; });
    return arr.map(function(x){ return x[0]; }).join('');
  }

  function formatWindow(sec){
    if(sec >= 3600 && sec % 3600 === 0) return (sec/3600) + 'h';
    if(sec >= 3600){
      var hh = Math.floor(sec/3600);
      var rem = sec % 3600;
      if(rem % 60 === 0) return hh + 'h' + (rem/60) + 'm';
      var mm = Math.floor(rem/60);
      var ss = rem % 60;
      return hh + 'h' + mm + 'm' + ss + 's';
    }
    if(sec < 60) return sec + 's';
    if(sec % 60 === 0) return (sec/60) + 'm';
    var m = Math.floor(sec/60);
    var s = sec % 60;
    return m + 'm' + s + 's';
  }

  // Display contract:
  // - This app runs on 1-minute Alpaca bars; minimum resolution is 60s.
  // Keep this list ordered ascending.
  var SNAP_PRESETS = [60, 300, 1800, 3600, 14400, 86400];

  // Auto W targets roughly this many candles on screen.
  // Clamp is applied at call-sites to keep behavior stable if this value changes.
  var AUTO_W_TARGET_BARS = 400; // target ~300–500 candles visible

  // Default initial window when URL doesn't specify start/end and full history isn't requested.
  // This avoids "full-history bootstrap" which forces coarse bars + slow loads.
  var DEFAULT_INIT_SPAN_MS = 24 * 60 * 60 * 1000; // 24h (increase to 7d if you prefer)

  function parseIsoToMs(s){
    // Accept ISO strings with Z or offsets. If timezone-less, interpret as UTC.
    var str = String(s || '').trim();
    if(!str) return NaN;
    var ms = Date.parse(str);
    if(Number.isFinite(ms)) return ms;
    // If missing timezone, Date.parse can be inconsistent across environments; treat as UTC.
    if(!/[zZ]|[+\-]\d\d:\d\d$/.test(str)) ms = Date.parse(str + 'Z');
    return ms;
  }

  function snapToPreset(sec){
    var best = SNAP_PRESETS[0];
    var bestD = Math.abs(sec - best);
    for(var i=0;i<SNAP_PRESETS.length;i++){
      var p = SNAP_PRESETS[i];
      var d = Math.abs(sec - p);
      if(d < bestD){ bestD = d; best = p; }
    }
    return best;
  }

  function syncBarPresetUi(){
    try{
      var cur = snapToPreset(clamp(Number(state.windowSec || (ui.window ? ui.window.value : 60) || 60), 60, 86400));
      var els = document.querySelectorAll('input[type="radio"][name="windowPreset"]');
      for(var i=0;i<els.length;i++){
        var el = els[i];
        if(!el) continue;
        el.checked = (Number(el.value) === cur);
      }
    } catch(_e){}
  }

  function snapCeilToPreset(sec){
    var s = Math.max(60, Math.floor(Number(sec) || 60));
    for(var i=0;i<SNAP_PRESETS.length;i++){
      if(SNAP_PRESETS[i] >= s) return SNAP_PRESETS[i];
    }
    return SNAP_PRESETS[SNAP_PRESETS.length-1];
  }

  function recommendBarSec(spanMs, limit, targetBars){
    var span = Number(spanMs);
    if(!Number.isFinite(span) || span <= 0) return 60;
    var spanSec = Math.max(1, Math.floor(span / 1000));
    var tgt = Math.max(50, Math.floor(Number(targetBars) || 800));
    var lim = Math.floor(Number(limit) || 0);
    var minForLimit = (lim > 0) ? Math.max(1, Math.ceil(spanSec / lim)) : 1;
    var raw = Math.max(1, Math.floor(spanSec / tgt), minForLimit);
    return clamp(snapCeilToPreset(raw), 60, 86400);
  }

  function getVisibleSpanMs(requestSpanMs){
    // Visible time span is driven by zoom: visibleSpan = requestSpan / xZoom.
    var span = Number(requestSpanMs);
    if(!Number.isFinite(span) || span <= 0) return NaN;
    var z = Number(state.xZoom);
    if(!Number.isFinite(z) || z <= 0) z = 1;
    return span / z;
  }

  function recommendBarSecForVisibleSpan(visibleSpanMs, effMaxBars){
    var target = clamp(Math.floor(Number(AUTO_W_TARGET_BARS) || 400), 150, 800);
    return recommendBarSec(visibleSpanMs, effMaxBars, target);
  }
