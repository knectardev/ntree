/**
 * scan.js
 * Exports:
 *  - ema(arr, period)
 *  - bandpassApprox(arr, periodMin)
 *  - rms(arr)
 *  - autocorrAtLag(arr, lag)
 *  - percentileRank(sortedArr, value)
 *  - median(sortedArr)
 *  - fmtPeriodLabel(min)
 *  - buildCandidatePeriods(minMin, maxMin, stepOrCount, useLog)
 *  - computeOscillationScanOnResidual(resid1m, scanWindowMinutes, periods)
 *  - computePeriodStability(resid1m, scanWindowMinutes, periods, K, stepMinutes)
 *  - fitSineAtPeriod(series, periodMin, sampleRateMin)
 * No DOM access here. Pure functions only.
 */

(function(OSC) {
  'use strict';

  const { clamp } = OSC.utils;
  const { DEFAULT_SCAN_MIN_PERIOD, DEFAULT_SCAN_MAX_PERIOD, DEFAULT_SCAN_STEP } = OSC.config;

  function ema(arr, period){
    const alpha = 2 / (period + 1);
    const out = new Array(arr.length);
    let prev = arr[0] || 0;
    out[0] = prev;
    for (let i=1; i<arr.length; i++){
      prev = alpha*arr[i] + (1-alpha)*prev;
      out[i] = prev;
    }
    return out;
  }

  function bandpassApprox(arr, periodMin){
    const fast = Math.max(2, Math.floor(periodMin/2));
    const slow = Math.max(fast+1, Math.floor(periodMin));
    const ef = ema(arr, fast);
    const es = ema(arr, slow);
    const out = new Array(arr.length);
    for (let i=0; i<arr.length; i++) out[i] = ef[i] - es[i];
    return out;
  }

  function rms(arr){
    let s=0;
    for (const v of arr) s += v*v;
    return Math.sqrt(s / Math.max(1, arr.length));
  }

  // Autocorrelation at a specific lag (Pearson correlation of x[t] vs x[t-lag])
  function autocorrAtLag(arr, lag){
    const L = Math.floor(lag);
    const n = arr.length;
    if (n < 8 || L < 1 || L >= n) return 0;
    let mean = 0;
    for (let i=0; i<n; i++) mean += arr[i];
    mean /= n;
    let num = 0, denA = 0, denB = 0;
    for (let i=L; i<n; i++){
      const a = arr[i] - mean;
      const b = arr[i-L] - mean;
      num += a*b;
      denA += a*a;
      denB += b*b;
    }
    const den = Math.sqrt(denA*denB) || 1e-9;
    return num / den; // [-1..1]
  }

  function percentileRank(sortedArr, value){
    // returns 0..100 where 100 means value >= max
    if (!sortedArr || !sortedArr.length) return null;
    let lo = 0, hi = sortedArr.length;
    while (lo < hi){
      const mid = (lo + hi) >> 1;
      if (sortedArr[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return Math.round((lo / sortedArr.length) * 100);
  }

  function median(sortedArr){
    if (!sortedArr || !sortedArr.length) return null;
    return sortedArr[(sortedArr.length/2) | 0];
  }

  function fmtPeriodLabel(min){
    const m = Math.max(1, Math.round(Number(min) || 1));
    if (m < 60) return `${m}m`;
    if (m % 60 === 0){
      const h = m / 60;
      if (h < 24) return `${h}h`;
      const d = h / 24;
      return `${d}d`;
    }
    const h = (m / 60);
    return `${h.toFixed(1)}h`;
  }

  function buildCandidatePeriods(minMin, maxMin, stepOrCount, useLog){
    let minP = Math.max(1, Math.floor(Number(minMin) || DEFAULT_SCAN_MIN_PERIOD));
    let maxP = Math.max(1, Math.floor(Number(maxMin) || DEFAULT_SCAN_MAX_PERIOD));
    if (maxP < minP){ const t = maxP; maxP = minP; minP = t; }

    maxP = Math.min(maxP, 24*60);
    minP = Math.min(minP, maxP);

    const out = [];
    if (!useLog){
      const step = Math.max(1, Math.floor(Number(stepOrCount) || DEFAULT_SCAN_STEP));
      const maxCount = 80;
      for (let m = minP; m <= maxP && out.length < maxCount; m += step){
        out.push({ label: fmtPeriodLabel(m), min: m });
      }
      if (out.length && out[out.length-1].min !== maxP && out.length < maxCount){
        out.push({ label: fmtPeriodLabel(maxP), min: maxP });
      }
    } else {
      const count = clamp(Math.floor(Number(stepOrCount) || 24), 6, 80);
      if (count === 1){
        out.push({ label: fmtPeriodLabel(minP), min: minP });
      } else {
        const a = Math.log(minP);
        const b = Math.log(maxP);
        for (let i=0; i<count; i++){
          const t = i / (count - 1);
          const m = Math.max(1, Math.round(Math.exp(a + (b - a) * t)));
          if (!out.length || out[out.length-1].min !== m){
            out.push({ label: fmtPeriodLabel(m), min: m });
          }
        }
      }
    }
    return out;
  }

  function computeOscillationScanOnResidual(resid1m, scanWindowMinutes, periods){
    const N = resid1m.length;
    const tailN = clamp(Math.floor(Number(scanWindowMinutes) || 780), 120, N);

    const periodsSafe = (periods && periods.length) ? periods : buildCandidatePeriods(DEFAULT_SCAN_MIN_PERIOD, DEFAULT_SCAN_MAX_PERIOD, DEFAULT_SCAN_STEP, false);

    const scores = periodsSafe.map(per => {
      const bp = bandpassApprox(resid1m, per.min);
      const tail = bp.slice(bp.length - tailN);

      const energy = rms(tail);
      // Coherence: does the bandpassed signal resemble itself after ~1 period?
      const lag = Math.max(1, Math.round(per.min));
      const corr = autocorrAtLag(tail, lag);          // [-1..1]
      const coh = Math.max(0, corr);                  // ignore anti-phase / negative
      const raw = energy * coh;

      return {label: per.label, min: per.min, raw, energy, corr, coh};
    });

    let best = null, second = null;
    for (const s of scores){
      if (!best || s.raw > best.raw){ second = best; best = s; }
      else if (!second || s.raw > second.raw){ second = s; }
    }

    const bestRatio = (best && second && second.raw>0) ? (best.raw/second.raw) : null;

    return {scores, best, second, bestRatio, tailN};
  }

  function computePeriodStability(resid1m, scanWindowMinutes, periods, K=12, stepMinutes=60){
    const N = resid1m.length;
    const winLen = clamp(Math.floor(Number(scanWindowMinutes)||780), 120, N);
    const step = clamp(Math.floor(Number(stepMinutes)||60), 5, winLen);

    const windows = [];
    for (let end = N; (end - winLen) >= 0 && windows.length < K; end -= step){
      const windowResid = resid1m.slice(end - winLen, end);
      const scan = computeOscillationScanOnResidual(windowResid, winLen, periods);
      windows.push({end, bestMin: scan.best ? scan.best.min : null, bestRaw: scan.best ? scan.best.raw : null, ratio: scan.bestRatio, vol: rms(windowResid)});
    }

    const counts = new Map();
    for (const w of windows){
      if (w.bestMin == null) continue;
      counts.set(w.bestMin, (counts.get(w.bestMin)||0) + 1);
    }

    let dominantMin = null, dominantCount = 0;
    for (const [min,c] of counts){
      if (c > dominantCount){ dominantCount = c; dominantMin = Number(min); }
    }

    let flipCount = 0;
    for (let i=1; i<windows.length; i++){
      if (windows[i].bestMin !== windows[i-1].bestMin) flipCount++;
    }

    const ratios = windows.map(w=>w.ratio).filter(v=>v!=null && isFinite(v)).sort((a,b)=>a-b);
    const vols = windows.map(w=>w.vol).filter(v=>v!=null && isFinite(v)).sort((a,b)=>a-b);
    const med = arr => arr.length ? arr[Math.floor(arr.length/2)] : null;
    const medRatio = med(ratios);
    const medVol = med(vols);

    const dominance = (windows.length && dominantCount) ? (dominantCount / windows.length) : null;

    return {windows, counts, dominantMin, dominantCount, dominance, flipCount, medRatio, medVol, winLen, step};
  }

  function findTurningPoints(series, minSep=3){
    const out = [];
    for (let i=1; i<series.length-1; i++){
      const a = series[i-1], b = series[i], c = series[i+1];
      if (b>a && b>c) out.push({i, kind:"peak", v:b});
      else if (b<a && b<c) out.push({i, kind:"trough", v:b});
    }
    const filt = [];
    for (const p of out){
      if (!filt.length || (p.i - filt[filt.length-1].i) >= minSep) filt.push(p);
    }
    return filt;
  }

  /**
   * Fit a sine wave to a series at a given period.
   * Returns {fit, amp, phase} where fit is the fitted sine wave array.
   * @param {number[]} series - The input series
   * @param {number} periodMin - Period in minutes
   * @param {number} sampleRateMin - Sample rate in minutes (default 1)
   * @returns {Object|null} - {fit: number[], amp: number, phase: number} or null if invalid
   */
  function fitSineAtPeriod(series, periodMin, sampleRateMin = 1){
    const N = series.length;
    if (!periodMin || N < 5) return null;

    const omega = 2 * Math.PI / (periodMin / sampleRateMin);

    let sinSum = 0, cosSum = 0;
    for (let i = 0; i < N; i++){
      const t = i;
      sinSum += series[i] * Math.sin(omega * t);
      cosSum += series[i] * Math.cos(omega * t);
    }

    const A = (2 / N) * sinSum;
    const B = (2 / N) * cosSum;

    const amp = Math.sqrt(A*A + B*B);
    const phase = Math.atan2(B, A);

    const fit = new Array(N);
    for (let i = 0; i < N; i++){
      fit[i] = amp * Math.sin(omega * i + phase);
    }

    return { fit, amp, phase };
  }

  /**
   * Compute Pearson correlation coefficient between two series.
   * Returns correlation in range [-1, 1].
   * @param {number[]} x - First series
   * @param {number[]} y - Second series (must have same length as x)
   * @returns {number} - Pearson correlation coefficient
   */
  function pearsonCorrelation(x, y){
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;

    let meanX = 0, meanY = 0;
    for (let i = 0; i < n; i++){
      meanX += x[i];
      meanY += y[i];
    }
    meanX /= n;
    meanY /= n;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++){
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY) || 1e-9;
    return clamp(num / den, -1, 1);
  }

  /**
   * Compute correlation between a series window and its best-fit sine at a fixed period,
   * without allocating intermediate arrays (reduces GC/jank).
   *
   * Window is [start, end) in series index space.
   */
  function sineCorrInWindow(series, start, end, periodMin, sampleRateMin=1){
    const a = Math.max(0, Math.floor(start));
    const b = Math.min(series.length, Math.floor(end));
    const n = b - a;
    if (!periodMin || n < 5) return 0;

    const omega = 2 * Math.PI / (periodMin / sampleRateMin);

    // Fit parameters (same math as fitSineAtPeriod) on the window.
    let sinSum = 0, cosSum = 0;
    for (let i=0; i<n; i++){
      const x = series[a + i];
      const t = i;
      sinSum += x * Math.sin(omega * t);
      cosSum += x * Math.cos(omega * t);
    }
    const A = (2 / n) * sinSum;
    const B = (2 / n) * cosSum;
    const amp = Math.sqrt(A*A + B*B);
    const phase = Math.atan2(B, A);

    // Pearson corr(x, y) where y is the fitted sine values.
    let meanX = 0, meanY = 0;
    for (let i=0; i<n; i++){
      meanX += series[a + i];
      meanY += amp * Math.sin(omega * i + phase);
    }
    meanX /= n;
    meanY /= n;

    let num = 0, denX = 0, denY = 0;
    for (let i=0; i<n; i++){
      const x = series[a + i] - meanX;
      const y = (amp * Math.sin(omega * i + phase)) - meanY;
      num += x * y;
      denX += x * x;
      denY += y * y;
    }
    const den = Math.sqrt(denX * denY) || 1e-9;
    return clamp(num / den, -1, 1);
  }

  /**
   * Returns a segmented sine array (same length as series), with NaNs where local fit is weak.
   * Uses a sliding trailing window sine fit at a fixed period, computes local correlation r,
   * smooths r to avoid flicker, and thresholds into active/inactive segments.
   *
   * This is meant as a diagnostic visualization (where does the rhythm "breathe"),
   * not a scoring input.
   */
  function computeSegmentedSineOnTail(series, periodMin, opts){
    opts = opts || {};
    const sampleRateMin = opts.sampleRateMin || 1;
    const cycles = (opts.windowCycles != null) ? Number(opts.windowCycles) : 3.0; // 2–4 typical
    const rThresh = (opts.rThresh != null) ? Number(opts.rThresh) : 0.55;
    const minRun = (opts.minRun != null) ? Math.max(1, Math.floor(Number(opts.minRun))) : 8;
    const smoothN = (opts.smoothN != null) ? Math.max(1, Math.floor(Number(opts.smoothN))) : 5;

    const N = series.length;
    if (!periodMin || N < 10) return { segmented: new Array(N).fill(NaN), r: new Array(N).fill(0) };

    // Window length in samples: cycles * period
    const W = clamp(Math.floor((cycles * periodMin) / sampleRateMin), 10, N);
    const rArr = new Array(N).fill(0);

    // trailing window [i-W+1 .. i]
    for (let i=0; i<N; i++){
      const end = i + 1;
      const start = Math.max(0, end - W);
      const rr = sineCorrInWindow(series, start, end, periodMin, sampleRateMin);
      rArr[i] = (isFinite(rr) ? rr : 0);
    }

    // simple smoothing (moving average) to prevent flicker
    if (smoothN > 1){
      const sm = new Array(N).fill(0);
      const half = Math.floor(smoothN / 2);
      for (let i=0; i<N; i++){
        let s=0, c=0;
        for (let j=i-half; j<=i+half; j++){
          if (j<0 || j>=N) continue;
          s += rArr[j]; c++;
        }
        sm[i] = c ? (s/c) : rArr[i];
      }
      for (let i=0; i<N; i++) rArr[i] = sm[i];
    }

    // build global sine template for the whole series (used as the "shape" to segment)
    const global = fitSineAtPeriod(series, periodMin, sampleRateMin);
    const base = (global && global.fit) ? global.fit : new Array(N).fill(0);

    // active mask + min-run cleanup
    const active = new Array(N).fill(false);
    for (let i=0; i<N; i++) active[i] = (rArr[i] >= rThresh);

    // remove tiny “on” islands
    let runStart = -1;
    for (let i=0; i<=N; i++){
      const on = (i < N) ? active[i] : false;
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0){
        const runLen = i - runStart;
        if (runLen < minRun){
          for (let k=runStart; k<i; k++) active[k] = false;
        }
        runStart = -1;
      }
    }

    // segmented sine: NaN where inactive so rendering breaks the line
    const segmented = new Array(N);
    for (let i=0; i<N; i++){
      segmented[i] = active[i] ? base[i] : NaN;
    }

    return { segmented, r: rArr };
  }

  function mean(arr){
    const n = arr.length;
    if (!n) return 0;
    let s = 0;
    for (let i=0; i<n; i++) s += arr[i];
    return s / n;
  }

  function variance(arr){
    const n = arr.length;
    if (n < 2) return 0;
    const m = mean(arr);
    let ss = 0;
    for (let i=0; i<n; i++){
      const d = arr[i] - m;
      ss += d*d;
    }
    return ss / (n - 1);
  }

  function subtractMean(arr){
    const m = mean(arr);
    const out = new Array(arr.length);
    for (let i=0; i<arr.length; i++) out[i] = arr[i] - m;
    return out;
  }

  /**
   * Projection spectrum / Fourier-like decomposition using sine projection (reuses fitSineAtPeriod).
   *
   * This is intentionally NOT an FFT. It produces a spectrum-like curve across the candidate
   * period grid (period -> variance share) that is directly tied to the reconstructed sine curves.
   *
   * Returns:
   *  - spectrum: per-candidate metrics (period, amp, phase, corr, varShare)
   *  - top: top-K components by varShare
   *  - recon: reconstructed curve per top component (tail window only)
   *  - reconSum: sum of top recon curves (tail window only)
   *  - cumExplained: cumulative explained variance after subtracting top components sequentially
   */
  function computeFourierDecompositionOnResidual(resid1m, scanWindowMinutes, periods, K=5, sampleRateMin=1){
    const N = resid1m.length;
    if (!N) return null;

    const tailN = clamp(Math.floor(Number(scanWindowMinutes) || 780), 120, N);
    const periodsSafe = (periods && periods.length)
      ? periods
      : buildCandidatePeriods(DEFAULT_SCAN_MIN_PERIOD, DEFAULT_SCAN_MAX_PERIOD, DEFAULT_SCAN_STEP, false);

    const tail = resid1m.slice(N - tailN);
    const tail0 = subtractMean(tail); // recommended: mean-remove for stable projection
    const varTail = variance(tail0) || 1e-9;

    const spectrum = periodsSafe.map(per => {
      const fitObj = fitSineAtPeriod(tail0, per.min, sampleRateMin);
      if (!fitObj || !fitObj.fit) {
        return { label: per.label, min: per.min, amp: 0, phase: 0, corr: 0, varShare: 0 };
      }

      const fit = fitObj.fit;
      const varFit = variance(fit);
      const varShare = clamp(varFit / varTail, 0, 1);
      const corr = pearsonCorrelation(tail0, fit);

      return { label: per.label, min: per.min, amp: fitObj.amp, phase: fitObj.phase, corr, varShare };
    });

    const sorted = spectrum
      .slice()
      .sort((a,b)=> (b.varShare - a.varShare) || (Math.abs(b.corr) - Math.abs(a.corr)));

    const top = [];
    for (let i=0; i<sorted.length && top.length < Math.max(1, Math.floor(Number(K)||5)); i++){
      // Skip tiny / degenerate contributions
      if (!sorted[i] || !isFinite(sorted[i].varShare) || sorted[i].varShare <= 0) continue;
      top.push(sorted[i]);
    }

    const recon = [];
    for (let i=0; i<top.length; i++){
      const t = top[i];
      const fitObj = fitSineAtPeriod(tail0, t.min, sampleRateMin);
      recon.push((fitObj && fitObj.fit) ? fitObj.fit : new Array(tailN).fill(0));
    }

    const reconSum = new Array(tailN).fill(0);
    for (let k=0; k<recon.length; k++){
      const f = recon[k];
      for (let i=0; i<tailN; i++) reconSum[i] += f[i];
    }

    // Cumulative explained variance (prevents "top 5 add to 170%" confusion)
    const cumExplained = [];
    if (top.length){
      const resid = tail0.slice(); // working residual
      for (let k=0; k<recon.length; k++){
        const f = recon[k];
        for (let i=0; i<tailN; i++) resid[i] -= f[i];
        const vE = variance(resid) || 0;
        const ce = clamp(1 - (vE / varTail), 0, 1);
        cumExplained.push(ce);
      }
    }

    return { tailN, spectrum, top, recon, reconSum, cumExplained };
  }

  OSC.scan = {
    ema,
    bandpassApprox,
    rms,
    autocorrAtLag,
    percentileRank,
    median,
    fmtPeriodLabel,
    buildCandidatePeriods,
    computeOscillationScanOnResidual,
    computePeriodStability,
    computeFourierDecompositionOnResidual,
    findTurningPoints,
    fitSineAtPeriod,
    pearsonCorrelation,
    computeSegmentedSineOnTail
  };

})(window.OSC || (window.OSC = {}));

