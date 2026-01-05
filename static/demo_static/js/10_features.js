'use strict';

// Feature factory / registry (RL-friendly)
// - Computes per-bar features with stable names
// - Keeps overlays minimal; features are for export/agents/diagnostics
//
// Integration point: `applySessionFilter()` calls `window.FEATURES_onStateUpdated(...)`
// after rebuilding `state.data` + `state.overlays`.
//
// This file is intentionally dependency-light (no build step).

(function(){
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function isFiniteNum(x){ return Number.isFinite(Number(x)); }

  function deepCopy(obj){
    try{ return JSON.parse(JSON.stringify(obj)); } catch(_e){ return obj; }
  }

  // -------- Defaults (minutes-based, then converted to bars) --------
  // Windows are expressed in minutes so behavior is consistent across bar sizes.
  var FEATURES_DEFAULT_CFG = {
    enabled: true,

    // Horizons (bars) for targets/projections
    horizons_k: [1, 3, 10],

    // Normalization: global rolling sigma of log returns
    sigma_window_minutes: 500,        // ~100 bars @ 5m, ~500 bars @ 1m
    sigma_short_window_minutes: 60,   // regime / vol ratio
    sigma_floor: 1e-6,

    // Trend (Kalman local linear trend on log price)
    kalman_enabled: true,
    kalman_responsiveness: 1.0,       // 0.2–3 is reasonable; higher reacts faster

    // Rolling drift metrics on returns (simple mean/t-stat; RL-friendly)
    ols_enabled: true,
    ols_window_minutes: 120,
    ols_fit_ok_r2_min: 0.05,          // (reserved; mean model doesn't use r2)
    ols_fit_ok_t_min: 1.0,

    // AR(p) on returns
    ar_enabled: true,
    ar_orders: [1, 2, 3],
    ar_window_minutes: 240,

    // Classifier (logistic)
    clf_enabled: true,
    clf_train_window_minutes: 2000,   // ~2000 bars @ 1m, ~400 bars @ 5m
    clf_refit_every_minutes: 60,      // auto stride baseline (used when stride='auto')
    clf_entropy_max: 0.65,
    clf_l2: 1.0,
    clf_gd_steps: 35,
    clf_lr: 0.08,
    clf_brier_window_minutes: 500,

    // Update cadence controls:
    // - stride controls how often parameters refit
    // - predictions/features are emitted every bar using last params
    stride: {
      // If 'auto', derive from bar size (minutes):
      // OLS/AR: max(1, round(5 / bar_size_minutes))
      // CLF:    max(5, round(60 / bar_size_minutes))
      ols: 'auto',
      ar: 'auto',
      kalman: 1,
      clf: 'auto'
    }
  };

  function getBarMinutes(){
    try{
      var s = (window.state && Number(window.state.windowSec)) ? Number(window.state.windowSec) : 60;
      var m = s / 60;
      return (Number.isFinite(m) && m > 0) ? m : 1;
    } catch(_e){
      return 1;
    }
  }

  function minutesToBars(mins){
    var m = Number(mins);
    if(!Number.isFinite(m) || m <= 0) return 1;
    var bm = getBarMinutes();
    return Math.max(1, Math.round(m / bm));
  }

  function resolveStride(strideVal, autoMinutes){
    if(strideVal === 'auto'){
      var bm = getBarMinutes();
      var am = Number(autoMinutes);
      if(!Number.isFinite(am) || am <= 0) am = 5;
      return Math.max(1, Math.round(am / bm));
    }
    var s = Math.floor(Number(strideVal));
    return (Number.isFinite(s) && s >= 1) ? s : 1;
  }

  function cfgHash(cfg){
    try{ return JSON.stringify(cfg); } catch(_e){ return String(Date.now()); }
  }

  function getEffectiveCfg(){
    // Merge: defaults <- saved localStorage (via 03_persistence) <- query params (lightweight overrides)
    var cfg = deepCopy(FEATURES_DEFAULT_CFG);

    try{
      var saved = window.__feature_cfg_saved;
      if(saved && typeof saved === 'object'){
        // Shallow merge top-level + stride
        for(var k in saved){
          if(k === 'stride' && saved.stride && typeof saved.stride === 'object'){
            cfg.stride = cfg.stride || {};
            for(var sk in saved.stride) cfg.stride[sk] = saved.stride[sk];
          } else {
            cfg[k] = saved[k];
          }
        }
      }
    } catch(_eSaved){}

    // URL overrides (optional):
    // - ?feat=0 disables, ?feat=1 enables
    // - ?feat_dbg=1 enables basic console debug logs
    try{
      var qs = window.location.search || '';
      if(qs.indexOf('feat=') !== -1){
        var m = /[?&]feat=([^&]+)/.exec(qs);
        if(m){
          var v = String(decodeURIComponent(m[1] || '')).trim().toLowerCase();
          if(v === '0' || v === 'false' || v === 'off') cfg.enabled = false;
          if(v === '1' || v === 'true' || v === 'on') cfg.enabled = true;
        }
      }
      cfg._debug = (qs.indexOf('feat_dbg=1') !== -1);
    } catch(_eQs){
      cfg._debug = false;
    }

    // Derive per-model strides from bar size if requested.
    cfg._stride = {
      ols: resolveStride(cfg.stride && cfg.stride.ols, 5),
      ar: resolveStride(cfg.stride && cfg.stride.ar, 5),
      kalman: resolveStride(cfg.stride && cfg.stride.kalman, 1),
      clf: resolveStride(cfg.stride && cfg.stride.clf, (cfg.clf_refit_every_minutes || 60))
    };

    // Convert minute windows to bar windows.
    cfg._bars = {
      sigma: minutesToBars(cfg.sigma_window_minutes),
      sigmaShort: minutesToBars(cfg.sigma_short_window_minutes),
      ols: minutesToBars(cfg.ols_window_minutes),
      ar: minutesToBars(cfg.ar_window_minutes),
      clfTrain: minutesToBars(cfg.clf_train_window_minutes),
      clfBrier: minutesToBars(cfg.clf_brier_window_minutes)
    };

    // Clamp and sanitize.
    cfg.horizons_k = Array.isArray(cfg.horizons_k) ? cfg.horizons_k.slice() : [1,3,10];
    cfg.horizons_k = cfg.horizons_k.map(function(x){ return Math.max(1, Math.floor(Number(x) || 1)); });
    cfg.horizons_k = Array.from(new Set(cfg.horizons_k)).sort(function(a,b){ return a-b; });
    if(!cfg.horizons_k.length) cfg.horizons_k = [1,3,10];

    cfg.ar_orders = Array.isArray(cfg.ar_orders) ? cfg.ar_orders.slice() : [1,2,3];
    cfg.ar_orders = cfg.ar_orders.map(function(x){ return Math.max(1, Math.floor(Number(x) || 1)); });
    cfg.ar_orders = Array.from(new Set(cfg.ar_orders)).filter(function(p){ return p <= 5; }).sort(function(a,b){ return a-b; });

    cfg.sigma_floor = Math.max(1e-12, Number(cfg.sigma_floor) || 1e-6);
    cfg.kalman_responsiveness = clamp(Number(cfg.kalman_responsiveness) || 1.0, 0.05, 10.0);

    cfg.clf_l2 = Math.max(0, Number(cfg.clf_l2) || 0);
    cfg.clf_gd_steps = clamp(Math.floor(Number(cfg.clf_gd_steps) || 35), 5, 200);
    cfg.clf_lr = clamp(Number(cfg.clf_lr) || 0.08, 0.001, 0.5);
    cfg.clf_entropy_max = clamp(Number(cfg.clf_entropy_max) || 0.65, 0.01, 0.999);

    return cfg;
  }

  // -------- Small math utilities --------
  function safeLog(x){
    var v = Number(x);
    if(!Number.isFinite(v) || v <= 0) return NaN;
    return Math.log(v);
  }
  function sigmoid(z){
    var x = Number(z);
    if(!Number.isFinite(x)) return 0.5;
    if(x >= 30) return 1;
    if(x <= -30) return 0;
    return 1 / (1 + Math.exp(-x));
  }
  function entropyBernoulli(p){
    var x = clamp(Number(p), 1e-12, 1 - 1e-12);
    return -x*Math.log(x) - (1-x)*Math.log(1-x);
  }

  // Rolling mean/std for log returns (windowed, O(n))
  function rollingStd(vals, win){
    var n = Array.isArray(vals) ? vals.length : 0;
    var W = Math.max(1, Math.floor(Number(win) || 1));
    var out = new Array(n);
    var sum = 0, sum2 = 0, cnt = 0;
    var q = []; // store last W values
    for(var i=0;i<n;i++){
      var v = Number(vals[i]);
      if(!Number.isFinite(v)) v = 0;
      q.push(v);
      sum += v;
      sum2 += v*v;
      cnt++;
      if(cnt > W){
        var old = q.shift();
        sum -= old;
        sum2 -= old*old;
        cnt--;
      }
      if(cnt <= 1){
        out[i] = NaN;
      } else {
        var mean = sum / cnt;
        var varr = Math.max(0, (sum2 / cnt) - mean*mean);
        out[i] = Math.sqrt(varr);
      }
    }
    return out;
  }

  function rollingMeanStd(vals, win){
    var n = Array.isArray(vals) ? vals.length : 0;
    var W = Math.max(1, Math.floor(Number(win) || 1));
    var meanOut = new Array(n);
    var stdOut = new Array(n);
    var sum = 0, sum2 = 0, cnt = 0;
    var q = [];
    for(var i=0;i<n;i++){
      var v = Number(vals[i]);
      if(!Number.isFinite(v)) v = 0;
      q.push(v);
      sum += v;
      sum2 += v*v;
      cnt++;
      if(cnt > W){
        var old = q.shift();
        sum -= old;
        sum2 -= old*old;
        cnt--;
      }
      if(cnt <= 0){
        meanOut[i] = NaN; stdOut[i] = NaN;
      } else if(cnt === 1){
        meanOut[i] = sum / cnt; stdOut[i] = NaN;
      } else {
        var mu = sum / cnt;
        var varr = Math.max(0, (sum2 / cnt) - mu*mu);
        meanOut[i] = mu;
        stdOut[i] = Math.sqrt(varr);
      }
    }
    return { mean: meanOut, std: stdOut };
  }

  // Extract overlay array (aligned with state.data) by key.
  function getOverlayY(key){
    try{
      var ovs = (window.state && Array.isArray(window.state.overlays)) ? window.state.overlays : [];
      for(var i=0;i<ovs.length;i++){
        var s = ovs[i];
        if(s && s.key === key && Array.isArray(s.y)) return s.y;
      }
      return null;
    } catch(_e){
      return null;
    }
  }

  // -------- Kalman local linear trend (log price) --------
  function kalmanLocalLinearTrend(logP, sigma, resp){
    var n = Array.isArray(logP) ? logP.length : 0;
    var level = new Array(n);
    var slope = new Array(n);
    var slopeStd = new Array(n);

    var x0 = Number.isFinite(logP[0]) ? Number(logP[0]) : 0;
    var x1 = 0;
    // Covariance P (2x2)
    var P00 = 1e-3, P01 = 0, P10 = 0, P11 = 1e-3;

    for(var i=0;i<n;i++){
      var z = Number(logP[i]);
      var sig = Number(sigma && sigma[i]);
      if(!Number.isFinite(sig)) sig = 0;
      var s2 = Math.max(0, sig*sig);

      // Dynamics:
      // x = F x, F=[[1,1],[0,1]]
      var xp0 = x0 + x1;
      var xp1 = x1;
      // P = F P F' + Q
      // FPF'
      var FP00 = P00 + P01 + P10 + P11;
      var FP01 = P01 + P11;
      var FP10 = P10 + P11;
      var FP11 = P11;

      // Process noise (scaled by volatility + responsiveness knob)
      // Heuristic: allow more slope variation when sigma is larger.
      var qSlope = (Number(resp) || 1) * Math.max(1e-12, s2) * 0.01;
      var qLevel = qSlope * 0.10;
      var Q00 = qLevel, Q01 = 0, Q10 = 0, Q11 = qSlope;

      var Pp00 = FP00 + Q00;
      var Pp01 = FP01 + Q01;
      var Pp10 = FP10 + Q10;
      var Pp11 = FP11 + Q11;

      // Observation: z = [1,0] x + noise
      var R = Math.max(1e-12, s2);
      if(Number.isFinite(z)){
        var y = z - xp0;
        var S = Pp00 + R; // scalar
        var K0 = Pp00 / (S || 1e-12);
        var K1 = Pp10 / (S || 1e-12);
        x0 = xp0 + K0 * y;
        x1 = xp1 + K1 * y;
        // P = (I - K H) Pp, with H=[1,0]
        P00 = (1 - K0) * Pp00;
        P01 = (1 - K0) * Pp01;
        P10 = Pp10 - K1 * Pp00;
        P11 = Pp11 - K1 * Pp01;
      } else {
        x0 = xp0;
        x1 = xp1;
        P00 = Pp00; P01 = Pp01; P10 = Pp10; P11 = Pp11;
      }

      level[i] = x0;
      slope[i] = x1;           // log-price change per bar ~ return per bar
      slopeStd[i] = Math.sqrt(Math.max(0, P11));
    }

    return { level_log: level, slope: slope, slope_std: slopeStd };
  }

  // -------- AR(p) on returns (refit by cadence, predict every bar) --------
  function fitAR(returns, endIdxInclusive, window, p){
    // Fit using data indices [end-window+1 .. end], predicting r_t from [1, r_{t-1..t-p}]
    var W = Math.max(10, Math.floor(Number(window) || 10));
    var pp = Math.max(1, Math.floor(Number(p) || 1));
    var end = Math.floor(Number(endIdxInclusive) || 0);
    var start = Math.max(pp, end - W + 1);
    var n = end - start + 1;
    if(n <= pp + 3) return null;

    // Build normal equations for (pp+1) params: intercept + pp lags
    var d = pp + 1;
    var XtX = new Array(d*d).fill(0);
    var Xty = new Array(d).fill(0);

    for(var t=start; t<=end; t++){
      var y = Number(returns[t]);
      if(!Number.isFinite(y)) continue;
      // x0 = 1
      var x = new Array(d);
      x[0] = 1;
      for(var j=1;j<=pp;j++){
        var rj = Number(returns[t - j]);
        x[j] = Number.isFinite(rj) ? rj : 0;
      }
      for(var a=0;a<d;a++){
        Xty[a] += x[a] * y;
        for(var b=0;b<d;b++){
          XtX[a*d + b] += x[a] * x[b];
        }
      }
    }

    // Ridge to avoid singularity
    var lam = 1e-6;
    for(var k=0;k<d;k++) XtX[k*d + k] += lam;

    // Solve via Gauss-Jordan (d <= 4)
    var A = new Array(d);
    for(var i=0;i<d;i++){
      A[i] = new Array(d+1);
      for(var j=0;j<d;j++) A[i][j] = XtX[i*d + j];
      A[i][d] = Xty[i];
    }
    for(var col=0; col<d; col++){
      // pivot
      var piv = col;
      var best = Math.abs(A[col][col]);
      for(var r=col+1; r<d; r++){
        var v = Math.abs(A[r][col]);
        if(v > best){ best = v; piv = r; }
      }
      if(best < 1e-14) return null;
      if(piv !== col){
        var tmp = A[piv]; A[piv] = A[col]; A[col] = tmp;
      }
      var div = A[col][col];
      for(var j2=col; j2<=d; j2++) A[col][j2] /= div;
      for(var r2=0; r2<d; r2++){
        if(r2 === col) continue;
        var f = A[r2][col];
        if(f === 0) continue;
        for(var j3=col; j3<=d; j3++){
          A[r2][j3] -= f * A[col][j3];
        }
      }
    }
    var beta = new Array(d);
    for(var i2=0;i2<d;i2++) beta[i2] = A[i2][d];
    return beta; // [c, phi1, phi2, ...]
  }

  function arRootsStability(beta){
    // Polynomial: z^p - phi1 z^{p-1} - ... - phip = 0
    // For p<=3, use Durand–Kerner (robust enough for small degrees).
    if(!Array.isArray(beta) || beta.length < 2) return { stable: false, margin: NaN };
    var p = beta.length - 1;
    var phi = beta.slice(1); // length p
    if(p === 1){
      var r1 = phi[0];
      var rad = Math.abs(r1);
      return { stable: rad < 1, margin: 1 - rad };
    }

    // Complex helpers
    function c(re, im){ return { re: re, im: im }; }
    function cadd(a,b){ return c(a.re+b.re, a.im+b.im); }
    function csub(a,b){ return c(a.re-b.re, a.im-b.im); }
    function cmul(a,b){ return c(a.re*b.re - a.im*b.im, a.re*b.im + a.im*b.re); }
    function cdiv(a,b){
      var den = b.re*b.re + b.im*b.im;
      if(den < 1e-18) return c(0,0);
      return c((a.re*b.re + a.im*b.im)/den, (a.im*b.re - a.re*b.im)/den);
    }
    function cabs(a){ return Math.sqrt(a.re*a.re + a.im*a.im); }

    function poly(z){
      // z^p - sum_{j=1..p} phi[j-1] z^{p-j}
      var out = c(0,0);
      // start with z^p
      var zp = c(1,0);
      for(var i=0;i<p;i++) zp = cmul(zp, z);
      out = cadd(out, zp);
      for(var j=1;j<=p;j++){
        var coeff = -Number(phi[j-1] || 0);
        // z^{p-j}
        var zpow = c(1,0);
        for(var k=0;k<(p-j);k++) zpow = cmul(zpow, z);
        out = cadd(out, c(coeff * zpow.re, coeff * zpow.im));
      }
      return out;
    }

    var roots = new Array(p);
    // init guesses on circle
    for(var i0=0;i0<p;i0++){
      var ang = 2*Math.PI*i0/p;
      roots[i0] = c(Math.cos(ang), Math.sin(ang));
    }
    for(var it=0; it<40; it++){
      var maxDelta = 0;
      for(var i1=0;i1<p;i1++){
        var zi = roots[i1];
        var denom = c(1,0);
        for(var j1=0;j1<p;j1++){
          if(j1 === i1) continue;
          denom = cmul(denom, csub(zi, roots[j1]));
        }
        var fz = poly(zi);
        var step = cdiv(fz, denom);
        var next = csub(zi, step);
        var dlt = cabs(csub(next, zi));
        if(dlt > maxDelta) maxDelta = dlt;
        roots[i1] = next;
      }
      if(maxDelta < 1e-9) break;
    }
    var maxRad = 0;
    for(var i2=0;i2<p;i2++){
      var rad2 = cabs(roots[i2]);
      if(rad2 > maxRad) maxRad = rad2;
    }
    return { stable: maxRad < 1, margin: 1 - maxRad };
  }

  // -------- Logistic regression (L2, batch GD) --------
  function fitLogisticGD(X, y, l2, steps, lr){
    // X: array of feature vectors (already includes intercept)
    var n = Array.isArray(X) ? X.length : 0;
    if(n <= 10) return null;
    var d = Array.isArray(X[0]) ? X[0].length : 0;
    if(d <= 0) return null;

    var w = new Array(d).fill(0);
    var lam = Math.max(0, Number(l2) || 0);
    var iters = Math.max(5, Math.floor(Number(steps) || 20));
    var alpha = Math.max(1e-4, Number(lr) || 0.05);

    for(var it=0; it<iters; it++){
      var grad = new Array(d).fill(0);
      var cnt = 0;
      for(var i=0;i<n;i++){
        var xi = X[i];
        var yi = y[i];
        if(!(yi === 0 || yi === 1)) continue;
        var z = 0;
        for(var j=0;j<d;j++) z += w[j] * xi[j];
        var p = sigmoid(z);
        var e = (p - yi);
        for(var j2=0;j2<d;j2++) grad[j2] += e * xi[j2];
        cnt++;
      }
      if(cnt <= 0) break;
      for(var k=0;k<d;k++){
        // L2 on non-intercept
        var reg = (k === 0) ? 0 : (lam * w[k]);
        w[k] -= alpha * ((grad[k] / cnt) + reg);
      }
    }
    return w;
  }

  // -------- Feature computation core --------
  function computeFeaturesNow(){
    var cfg = getEffectiveCfg();
    var st = window.state;
    if(!cfg.enabled) return null;
    if(!st || !Array.isArray(st.data) || st.data.length < 10) return null;

    var data = st.data;
    var n = data.length;
    var sym = (typeof window.getSymbol === 'function') ? String(window.getSymbol() || '') : '';
    var barS = Math.floor(Number(st.windowSec) || 60);
    var firstT = Number(data[0] && data[0].t);
    var lastT = Number(data[n-1] && data[n-1].t);
    var sessFlags = (typeof window.getSessionFilterFlags === 'function') ? window.getSessionFilterFlags() : {};
    var ovFlags = (typeof window.getOverlaySettings === 'function') ? window.getOverlaySettings() : {};
    var baseKey = sym + '|' + barS + '|' + firstT + '|' + lastT + '|' + n + '|' +
      (sessFlags.pre?1:0) + (sessFlags.after?1:0) + (sessFlags.closed?1:0) + '|' +
      (ovFlags.vwap?1:0) + (ovFlags.ema9?1:0) + (ovFlags.ema21?1:0) + (ovFlags.ema50?1:0) + '|' +
      cfgHash(cfg);

    // Cache: if we already computed for this exact window, skip.
    try{
      if(st.features && st.features._baseKey === baseKey) return st.features;
    } catch(_eCache){}

    var close = new Array(n);
    var logP = new Array(n);
    for(var i=0;i<n;i++){
      var c = Number(data[i] && data[i].c);
      close[i] = c;
      logP[i] = safeLog(c);
    }
    var r = new Array(n);
    r[0] = NaN;
    for(var i2=1;i2<n;i2++){
      var lp0 = logP[i2-1], lp1 = logP[i2];
      r[i2] = (Number.isFinite(lp0) && Number.isFinite(lp1)) ? (lp1 - lp0) : NaN;
    }

    var sigma = rollingStd(r, cfg._bars.sigma);
    var sigmaShort = rollingStd(r, cfg._bars.sigmaShort);
    var sigmaEff = new Array(n);
    var volZ = new Array(n);
    for(var i3=0;i3<n;i3++){
      var s = Number(sigma[i3]);
      if(!Number.isFinite(s) || s <= cfg.sigma_floor) s = cfg.sigma_floor;
      sigmaEff[i3] = s;
      var ss = Number(sigmaShort[i3]);
      if(!Number.isFinite(ss) || ss <= cfg.sigma_floor) ss = cfg.sigma_floor;
      volZ[i3] = ss / s;
    }

    // VWAP dev (return units): log(close/vwap) / sigma
    var vwap = getOverlayY('vwap_session');
    var vwapDevZ = new Array(n);
    for(var i4=0;i4<n;i4++){
      var vw = Number(vwap && vwap[i4]);
      var lp = logP[i4];
      if(!Number.isFinite(vw) || vw <= 0 || !Number.isFinite(lp)){
        vwapDevZ[i4] = NaN;
        continue;
      }
      var lvw = Math.log(vw);
      var dev = lp - lvw;
      vwapDevZ[i4] = dev / (sigmaEff[i4] || cfg.sigma_floor);
    }

    // Kalman trend
    var kal = null;
    if(cfg.kalman_enabled){
      kal = kalmanLocalLinearTrend(logP, sigmaEff, cfg.kalman_responsiveness);
    } else {
      kal = { level_log: new Array(n).fill(NaN), slope: new Array(n).fill(NaN), slope_std: new Array(n).fill(NaN) };
    }
    var slopeZ = new Array(n);
    var levelPx = new Array(n);
    for(var i5=0;i5<n;i5++){
      var s0 = Number(kal.slope[i5]);
      var sd0 = Number(kal.slope_std[i5]);
      slopeZ[i5] = (Number.isFinite(s0) && Number.isFinite(sd0) && sd0 > 1e-12) ? (s0 / sd0) : NaN;
      var ll = Number(kal.level_log[i5]);
      levelPx[i5] = Number.isFinite(ll) ? Math.exp(ll) : NaN;
    }

    // Rolling drift stats (mean return) for k horizons
    var meanStd = rollingMeanStd(r, cfg._bars.ols);
    var mu1 = meanStd.mean;
    var sig1 = meanStd.std;
    var olsMu = {};
    var olsT = {};
    for(var hk=0; hk<cfg.horizons_k.length; hk++){
      var kH = cfg.horizons_k[hk];
      var key = 'k' + kH;
      var mu = new Array(n);
      var tt = new Array(n);
      for(var i6=0;i6<n;i6++){
        var m0 = Number(mu1[i6]);
        var sd1 = Number(sig1[i6]);
        if(!Number.isFinite(m0) || !Number.isFinite(sd1) || sd1 <= 0){
          mu[i6] = NaN;
          tt[i6] = NaN;
        } else {
          mu[i6] = m0 * kH;
          // crude t-stat for mean: mean / (std/sqrt(N))
          var Nw = Math.min(cfg._bars.ols, i6 + 1);
          tt[i6] = (sd1 > 0 && Nw > 1) ? ((m0) / (sd1 / Math.sqrt(Nw))) : NaN;
        }
      }
      olsMu[key] = mu;
      olsT[key] = tt;
    }

    // AR(p) fits + per-bar forecasts/innovations
    var arOut = {};
    if(cfg.ar_enabled){
      for(var oi=0; oi<cfg.ar_orders.length; oi++){
        var p = cfg.ar_orders[oi];
        var beta = null;
        var lastFit = -1;
        var prevFc = NaN;
        var muHat = new Array(n).fill(NaN);
        var innovZ = new Array(n).fill(NaN);
        var stable = new Array(n).fill(NaN);
        var margin = new Array(n).fill(NaN);

        for(var t2=0; t2<n; t2++){
          // innovation at time t2 is realized (r_t2 - prev forecast)
          if(t2 > 0 && Number.isFinite(prevFc) && Number.isFinite(r[t2])){
            innovZ[t2] = (r[t2] - prevFc) / (sigmaEff[t2] || cfg.sigma_floor);
          }

          var warm = (t2 >= (cfg._bars.ar + p + 5));
          var shouldFit = warm && (lastFit < 0 || ((t2 - lastFit) >= cfg._stride.ar));
          if(shouldFit){
            beta = fitAR(r, t2, cfg._bars.ar, p);
            lastFit = t2;
          }

          // forecast next return at t2 (mu_hat.k1)
          if(beta && t2 >= p){
            var fc = Number(beta[0]) || 0;
            for(var j=1;j<=p;j++){
              var rr = Number(r[t2 - j + 1]); // latest return is r[t2], used for next forecast; shift by +1
              if(!Number.isFinite(rr)) rr = 0;
              fc += (Number(beta[j]) || 0) * rr;
            }
            muHat[t2] = fc;
            prevFc = fc;
            // stability snapshot on fit bars (hold constant between fits)
            if(t2 === lastFit){
              var st2 = arRootsStability(beta);
              stable[t2] = st2.stable ? 1 : 0;
              margin[t2] = st2.margin;
            } else if(t2 > 0){
              stable[t2] = stable[t2-1];
              margin[t2] = margin[t2-1];
            }
          } else if(t2 > 0){
            stable[t2] = stable[t2-1];
            margin[t2] = margin[t2-1];
          }
        }

        arOut['ar' + p] = {
          mu_hat_k1: muHat,
          innov_z: innovZ,
          is_stable: stable,
          stability_margin: margin
        };
      }
    }

    // Classifier: logistic regression, refit on cadence, predict every bar
    var clfOut = {};
    if(cfg.clf_enabled){
      for(var hk2=0; hk2<cfg.horizons_k.length; hk2++){
        var kC = cfg.horizons_k[hk2];
        var label = new Array(n).fill(NaN);
        // y_up(k): 1 if sum_{i=1..k} r_{t+i} > 0
        for(var t3=0; t3<n; t3++){
          if(t3 + kC >= n) break;
          var sRet = 0;
          var ok = true;
          for(var jx=1; jx<=kC; jx++){
            var rv = Number(r[t3 + jx]);
            if(!Number.isFinite(rv)){ ok = false; break; }
            sRet += rv;
          }
          if(ok) label[t3] = (sRet > 0) ? 1 : 0;
        }

        var w = null;
        var lastFitIdx = -1;
        var pUp = new Array(n).fill(NaN);
        var ent = new Array(n).fill(NaN);
        var brier = new Array(n).fill(NaN);
        var calOk = new Array(n).fill(NaN);
        var bq = []; // rolling brier window values

        for(var t4=0; t4<n; t4++){
          // Build x_t (intercept + 3 core features)
          var x1t = Number(slopeZ[t4]);
          var x2t = Number(vwapDevZ[t4]);
          var x3t = Number(volZ[t4]);
          var xt = [1,
            Number.isFinite(x1t) ? x1t : 0,
            Number.isFinite(x2t) ? x2t : 0,
            Number.isFinite(x3t) ? x3t : 0
          ];

          // Train using examples that are "label-known" at time t4:
          // use indices <= t4-kC (so label doesn't peek beyond t4).
          var endTrain = t4 - kC;
          var warmClf = (endTrain >= 20);
          var shouldFitClf = warmClf && (lastFitIdx < 0 || ((t4 - lastFitIdx) >= cfg._stride.clf));
          if(shouldFitClf){
            var startTrain = Math.max(0, endTrain - cfg._bars.clfTrain);
            var X = [];
            var yv = [];
            for(var ti=startTrain; ti<endTrain; ti++){
              var yy = label[ti];
              if(!(yy === 0 || yy === 1)) continue;
              var a1 = Number(slopeZ[ti]);
              var a2 = Number(vwapDevZ[ti]);
              var a3 = Number(volZ[ti]);
              X.push([1,
                Number.isFinite(a1) ? a1 : 0,
                Number.isFinite(a2) ? a2 : 0,
                Number.isFinite(a3) ? a3 : 0
              ]);
              yv.push(yy);
            }
            w = fitLogisticGD(X, yv, cfg.clf_l2, cfg.clf_gd_steps, cfg.clf_lr);
            lastFitIdx = t4;
          }

          var pp = (w ? (function(){
            var z = 0;
            for(var kk=0; kk<w.length; kk++) z += w[kk] * xt[kk];
            return sigmoid(z);
          })() : 0.5);
          pUp[t4] = pp;
          ent[t4] = entropyBernoulli(pp);

          // Rolling Brier (only when label exists for this bar)
          var yy2 = label[t4];
          if(yy2 === 0 || yy2 === 1){
            var br = (pp - yy2) * (pp - yy2);
            bq.push(br);
            var maxB = cfg._bars.clfBrier;
            while(bq.length > maxB) bq.shift();
            var sumB = 0;
            for(var bi=0; bi<bq.length; bi++) sumB += bq[bi];
            var brMean = (bq.length ? (sumB / bq.length) : NaN);
            brier[t4] = brMean;
            // cal_ok is optional; keep conservative and simple
            calOk[t4] = Number.isFinite(brMean) ? (brMean < 0.25 ? 1 : 0) : NaN;
          } else if(t4 > 0){
            // carry forward last value for smoothness
            brier[t4] = brier[t4-1];
            calOk[t4] = calOk[t4-1];
          }
        }

        clfOut['k' + kC] = {
          p_up: pUp,
          entropy: ent,
          brier: brier,
          cal_ok: calOk
        };
      }
    }

    // Assemble registry
    var features = {
      _baseKey: baseKey,
      cfg: cfg,
      // core scale features
      sigma: sigmaEff,
      vol_z: volZ,
      vwap_dev_z: vwapDevZ,
      // kalman
      kalman: {
        level: levelPx,
        level_log: kal.level_log,
        slope_per_bar: kal.slope,
        slope_std: kal.slope_std,
        slope_z: slopeZ,
        is_warm: new Array(n).fill(0),
        fit_ok: new Array(n).fill(0)
      },
      // ols/mean drift
      ols: {
        mu_hat: olsMu,
        t_stat: olsT,
        is_warm: new Array(n).fill(0),
        fit_ok: new Array(n).fill(0)
      },
      ar: arOut,
      clf: clfOut
    };

    // Quality flags / warmup (simple booleans per notes2 defaults)
    for(var i7=0;i7<n;i7++){
      // warmups
      features.ols.is_warm[i7] = (i7 >= cfg._bars.ols + 5) ? 1 : 0;
      features.kalman.is_warm[i7] = (i7 >= 20) ? 1 : 0;

      // fit_ok flags (conservative)
      // OLS: |t_stat(mu_hat)| >= 1.0 (use k1)
      try{
        var t1 = Number(features.ols.t_stat.k1 ? features.ols.t_stat.k1[i7] : NaN);
        features.ols.fit_ok[i7] = (Number.isFinite(t1) && Math.abs(t1) >= cfg.ols_fit_ok_t_min) ? 1 : 0;
      } catch(_eOlsOk){ features.ols.fit_ok[i7] = 0; }

      // Kalman: slope_z finite; optional threshold |slope_z|>=0.5 is left to agent
      var sz = Number(features.kalman.slope_z[i7]);
      features.kalman.fit_ok[i7] = Number.isFinite(sz) ? 1 : 0;
    }

    // Store in state for downstream usage / export.
    st.features = features;
    // Optional debug: provide a stable accessor.
    window.getFeatureSeries = function(key){
      // Minimal helper for devtools.
      // key examples: 'kalman.slope_z', 'sigma', 'vwap_dev_z', 'clf.k3.p_up', 'ar.ar1.mu_hat_k1'
      try{
        var f = (window.state && window.state.features) ? window.state.features : null;
        if(!f) return null;
        var parts = String(key || '').split('.');
        var cur = f;
        for(var i=0;i<parts.length;i++){
          cur = cur[parts[i]];
          if(cur == null) return null;
        }
        return cur;
      } catch(_e){
        return null;
      }
    };

    if(cfg._debug){
      try{ console.log('[features] computed', { n: n, bar_s: barS, sym: sym, cfg: cfg }); } catch(_eDbg){}
    }

    return features;
  }

  // Hook called by the chart pipeline.
  window.FEATURES_onStateUpdated = function(opts){
    try{
      // Don't compute if chart is idle / empty.
      if(!(window.state && Array.isArray(window.state.data) && window.state.data.length)) return null;
      return computeFeaturesNow();
    } catch(e){
      try{ console.warn('[features] compute failed', e); } catch(_e2){}
      return null;
    }
  };

  // Expose defaults for future UI wiring (advanced panel).
  window.FEATURES_DEFAULT_CFG = FEATURES_DEFAULT_CFG;
})();


