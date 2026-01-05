'use strict';

  // Mode selection:
  // - static: load from ./static/*.json or file:// pickers
  // - api: fetch from same-origin (or ?api_base=...) /window endpoint
  //
  // UX: when hosted over http(s) by the Flask app, default to API mode.
  // When opened via file://, default to static mode.
  var _defaultMode = (String(window.location && window.location.protocol || '') === 'file:') ? 'static' : 'api';
  var MODE = getQueryParam('mode', _defaultMode);
  // Static-only mode: no server calls.
  var STATIC_MODE = (String(MODE || '').toLowerCase() !== 'api');
  // When in api mode, the chart calls: buildUrl(API_BASE, '/window', ...)
  // Use same-origin by default; override with ?api_base=http://127.0.0.1:5000 if needed.
  var API_BASE = getQueryParam('api_base', '');
  // Single-symbol convenience: when ?single=1&symbol=SPY, build a catalog from the symbol.
  var SINGLE_MODE = (getQueryParam('single', '') !== '');
  try{
    if(document && document.body){
      document.body.classList.remove('static','api');
      document.body.classList.add(STATIC_MODE ? 'static' : 'api');
    }
  } catch(_e){}

  // Show app navigation only when hosted via Flask/http(s).
  try{
    var nav = document.getElementById('appNav');
    if(nav){
      var proto = String(window.location && window.location.protocol || '');
      // NOTE: CSS default is display:none; so we must explicitly set a visible display value here.
      nav.style.display = (proto === 'http:' || proto === 'https:') ? 'block' : 'none';
    }
  } catch(_eNav){}

  function buildUrl(base, path, params){
    var b = String(base || '').replace(/\/+$/,'');
    var p = String(path || '');
    var q = [];
    for(var k in (params || {})){
      if(!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if(v === undefined || v === null || v === '') continue;
      q.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
    return b + p + (q.length ? ('?' + q.join('&')) : '');
  }

  // When served over http(s), we can fetch relative JSON files from here.
  var STATIC_BASE = getQueryParam('static_base', './static');
  // When opened via file://, use Directory Picker (Chromium) to read local files.
  // Folder selection modes:
  // - root: selected folder contains catalog.json and (optionally) bars/
  // - bars: selected folder is the bars/ folder itself
  var _staticDirMode = ''; // 'root' | 'bars' | ''
  var _staticRootDirHandle = null;
  var _staticBarsDirHandle = null;
  var _staticGeneratedCatalog = null; // { symbols:[{dataset,symbol}], _generated:true }
  var _staticBarsByKey = {}; // key: `${symbol}_${bar_s}` => barsPayload
  var _staticBaseBySymbol = {}; // symbol => smallest-bar_s barsPayload (best for aggregation)

  function joinPath(a, b){
    var aa = String(a || '').replace(/\/+$/,'');
    var bb = String(b || '').replace(/^\/+/,'');
    return aa + '/' + bb;
  }

  async function readTextFromDirHandle(dirHandle, relPath){
    if(!dirHandle) throw new Error('No directory handle selected');
    var parts = String(relPath || '').split('/').filter(function(x){ return !!x; });
    var cur = dirHandle;
    for(var i=0;i<parts.length;i++){
      var name = parts[i];
      var isLast = (i === parts.length - 1);
      if(isLast){
        var fh = await cur.getFileHandle(name);
        var f = await fh.getFile();
        return await f.text();
      }
      cur = await cur.getDirectoryHandle(name);
    }
    throw new Error('Invalid relPath: ' + relPath);
  }

  function inferDatasetFromSymbol(sym){
    var s = String(sym || '').trim().toUpperCase();
    if(!s) return '';
    // Prefer prefix before _CONT if present.
    var m0 = /^([A-Z0-9]+)_CONT$/.exec(s);
    if(m0 && m0[1]) return m0[1];
    // Otherwise take leading letters (ESZ5 -> ES, NQH6 -> NQ).
    var m1 = /^([A-Z]{1,6})/.exec(s);
    if(m1 && m1[1]) return m1[1];
    return '';
  }

  function barsKey(symbol, bar_s){
    var sym = String(symbol || '').trim();
    var bs = Math.floor(Number(bar_s) || 0);
    return sym + '_' + bs;
  }

  function rememberBarsPayload(j){
    try{
      if(!j || typeof j !== 'object') return;
      var sym = String(j.symbol || '').trim();
      var bs = Math.floor(Number(j.bar_s) || 0);
      if(!sym || !Number.isFinite(bs) || bs <= 0) return;
      var k = barsKey(sym, bs);
      _staticBarsByKey[k] = j;
      var cur = _staticBaseBySymbol[sym] || null;
      var curBs = cur ? Math.floor(Number(cur.bar_s) || 0) : 0;
      if(!cur || !Number.isFinite(curBs) || curBs <= 0 || bs < curBs){
        _staticBaseBySymbol[sym] = j;
      }
    } catch(_e){}
  }

  function aggregateBarsPayload(basePayload, targetBarS){
    // Aggregate OHLCV from a smaller bar size into a larger one.
    // We align buckets relative to the first timestamp to keep the chart stable.
    if(!basePayload || typeof basePayload !== 'object') throw new Error('No base payload to aggregate');
    var sym = String(basePayload.symbol || '').trim();
    var baseS = Math.floor(Number(basePayload.bar_s) || 0);
    var tgtS = Math.floor(Number(targetBarS) || 0);
    if(!sym) throw new Error('Base payload missing symbol');
    if(!Number.isFinite(baseS) || baseS <= 0) throw new Error('Base payload missing bar_s');
    if(!Number.isFinite(tgtS) || tgtS <= 0) throw new Error('Invalid target bar_s');
    if(tgtS < baseS) throw new Error('Cannot downsample below base bar_s (' + baseS + 's)');

    var t = basePayload.t_ms, o = basePayload.o, h = basePayload.h, l = basePayload.l, c = basePayload.c, v = basePayload.v;
    if(!Array.isArray(t) || !Array.isArray(o) || !Array.isArray(h) || !Array.isArray(l) || !Array.isArray(c) || !Array.isArray(v)){
      throw new Error('Base payload missing arrays t_ms,o,h,l,c,v');
    }
    var n = t.length;
    if(!n) throw new Error('Base payload has no data');
    if(o.length !== n || h.length !== n || l.length !== n || c.length !== n || v.length !== n){
      throw new Error('Base payload has mismatched array lengths');
    }
    var t0 = Number(t[0]);
    if(!Number.isFinite(t0)) throw new Error('Base payload t_ms[0] not finite');
    var bucketMs = tgtS * 1000;

    var outT = [];
    var outO = [];
    var outH = [];
    var outL = [];
    var outC = [];
    var outV = [];

    var curBucket = null;
    var bo = NaN, bh = -Infinity, bl = Infinity, bc = NaN, bv = 0;
    var bt = NaN;

    function flush(){
      if(curBucket === null) return;
      outT.push(bt);
      outO.push(bo);
      outH.push(bh);
      outL.push(bl);
      outC.push(bc);
      outV.push(bv);
    }

    for(var i=0;i<n;i++){
      var ti = Number(t[i]);
      if(!Number.isFinite(ti)) continue;
      var b = Math.floor((ti - t0) / bucketMs);
      if(curBucket === null){
        curBucket = b;
        bt = t0 + b * bucketMs;
        bo = Number(o[i]);
        bh = Number(h[i]);
        bl = Number(l[i]);
        bc = Number(c[i]);
        bv = Number(v[i]);
        continue;
      }
      if(b !== curBucket){
        flush();
        curBucket = b;
        bt = t0 + b * bucketMs;
        bo = Number(o[i]);
        bh = Number(h[i]);
        bl = Number(l[i]);
        bc = Number(c[i]);
        bv = Number(v[i]);
        continue;
      }
      // same bucket
      var hi = Number(h[i]); if(Number.isFinite(hi)) bh = Math.max(bh, hi);
      var li = Number(l[i]); if(Number.isFinite(li)) bl = Math.min(bl, li);
      bc = Number(c[i]);
      var vi = Number(v[i]); if(Number.isFinite(vi)) bv += vi;
    }
    flush();

    var out = {
      symbol: sym,
      bar_s: tgtS,
      dataset_start: basePayload.dataset_start || null,
      dataset_end: basePayload.dataset_end || null,
      start: basePayload.start || null,
      end: basePayload.end || null,
      t_ms: outT,
      o: outO,
      h: outH,
      l: outL,
      c: outC,
      v: outV,
      _derived_from_bar_s: baseS
    };
    // If start/end not present, derive from timestamps.
    try{
      if(outT.length){
        if(!out.start) out.start = new Date(outT[0]).toISOString().replace('.000Z','Z');
        if(!out.end) out.end = new Date(outT[outT.length-1]).toISOString().replace('.000Z','Z');
      }
    } catch(_e){}
    return out;
  }

  async function generateCatalogFromBarsDir(dirHandle){
    // Build a minimal catalog from filenames like <symbol>_<bar_s>.json.
    var symbols = [];
    var seen = {};
    try{
      for await (var entry of dirHandle.values()){
        try{
          if(!entry || entry.kind !== 'file') continue;
          var name = String(entry.name || '');
          var m = /^(.+)_([0-9]+)\.json$/i.exec(name);
          if(!m) continue;
          var sym = String(m[1] || '').trim();
          if(!sym) continue;
          if(seen[sym]) continue;
          seen[sym] = true;
          symbols.push({ dataset: inferDatasetFromSymbol(sym), symbol: sym });
        } catch(_e){}
      }
    } catch(_e){}
    // Ensure stable order.
    symbols.sort(function(a,b){ return String(a.symbol||'').localeCompare(String(b.symbol||'')); });
    return { symbols: symbols, _generated: true };
  }

  async function readJsonFromStatic(relPath){
    // Prefer dirHandle when present (file:// safe), else fetch from STATIC_BASE.
    var p = String(relPath || '').replace(/^\/+/,'');
    // In-memory override (file picker)
    if(/^bars\//.test(p)){
      var m = /^bars\/(.+)_([0-9]+)\.json$/.exec(p);
      if(m){
        var k = barsKey(m[1], m[2]);
        if(_staticBarsByKey && _staticBarsByKey[k]) return _staticBarsByKey[k];
      }
    }
    if(p === 'catalog.json' && _staticGeneratedCatalog) return _staticGeneratedCatalog;
    if(_staticDirMode === 'root' && _staticRootDirHandle){
      var txt0 = await readTextFromDirHandle(_staticRootDirHandle, p);
      return JSON.parse(txt0);
    }
    if(_staticDirMode === 'bars' && _staticBarsDirHandle){
      if(p === 'catalog.json'){
        // No catalog.json in bars-only mode; return generated.
        var gen = await generateCatalogFromBarsDir(_staticBarsDirHandle);
        _staticGeneratedCatalog = gen;
        return gen;
      }
      // Map bars/<file> to <file> in selected bars directory.
      var p2 = p;
      if(/^bars\//.test(p2)) p2 = p2.replace(/^bars\//,'');
      var txt1 = await readTextFromDirHandle(_staticBarsDirHandle, p2);
      return JSON.parse(txt1);
    }
    var url = joinPath(STATIC_BASE, p);
    var res = await fetch(url, { method:'GET', cache:'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return await res.json();
  }

  async function loadStaticCatalog(){
    // Expected: { symbols: [{dataset,symbol}, ...] } or a plain array of {dataset,symbol}.
    var j = await readJsonFromStatic('catalog.json');
    var arr = [];
    if(Array.isArray(j)) arr = j;
    else if(j && Array.isArray(j.symbols)) arr = j.symbols;
    var out = [];
    for(var i=0;i<arr.length;i++){
      var item = arr[i];
      if(typeof item === 'string'){
        var sym = String(item || '').trim();
        if(!sym) continue;
        out.push({ symbol: sym, dataset: '', synthetic: false });
        continue;
      }
      if(item && typeof item === 'object' && typeof item.symbol === 'string'){
        out.push({
          symbol: String(item.symbol || '').trim(),
          dataset: String(item.dataset || '').trim(),
          synthetic: !!item.synthetic
        });
      }
    }
    return out;
  }

  async function loadStaticBars(symbol, bar_s){
    var sym = String(symbol || '').trim();
    var bs = Math.floor(Number(bar_s) || 60);
    if(!sym) throw new Error('Missing symbol');
    if(!Number.isFinite(bs) || bs <= 0) throw new Error('Invalid bar_s');
    var k = barsKey(sym, bs);
    if(_staticBarsByKey && _staticBarsByKey[k]) return _staticBarsByKey[k];
    var name = 'bars/' + sym + '_' + bs + '.json';
    var j = await readJsonFromStatic(name);
    rememberBarsPayload(j);
    return j;
  }
