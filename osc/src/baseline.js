/**
 * baseline.js
 * Exports:
 *  - OSC.baseline.baselineKey(state)
 *  - OSC.baseline.clearBaseline()
 *  - OSC.baseline.maybeInvalidateBaseline(state)
 *  - OSC.baseline.buildNoiseBaseline(state, elBaselineRuns, elBaselineStatus, elBaselineSummary, elBaselineRunBtn, elBaselineClearBtn, renderAll)
 * Noise baseline runner + caching + cancellation
 */

(function(OSC) {
  'use strict';

  const { clamp } = OSC.utils;
  const { median } = OSC.scan;

  let baselineRunToken = 0;
  let baseline = {
    key: null,          // settings signature
    n: 0,
    bestRaw: null,      // sorted arrays
    bestRatio: null,
    dominance: null,
    flipCount: null,
    running: false
  };

  function baselineKey(state){
    // baseline should match the current scan configuration
    const p = state.periods || [];
    const pKey = p.map(x => x.min).join(",");
    return [
      "v1",
      `days=${state.days}`,
      `detrend=${Number(state.detrendHours||0).toFixed(3)}`,
      `scanWin=${Math.round(state.scanWindow||0)}`,
      `periods=${pKey}`
    ].join("|");
  }

  function clearBaseline(elBaselineStatus, elBaselineSummary, elBaselineRunBtn, elBaselineClearBtn){
    // bump token so any in-flight run can detect cancellation
    baselineRunToken++;
    baseline = { key:null, n:0, bestRaw:null, bestRatio:null, dominance:null, flipCount:null, running:false };
    if (elBaselineSummary) elBaselineSummary.textContent = "";
    if (elBaselineStatus) elBaselineStatus.textContent = "Baseline: none";
    if (elBaselineRunBtn) elBaselineRunBtn.disabled = false;
    if (elBaselineClearBtn) elBaselineClearBtn.disabled = false;
  }

  function maybeInvalidateBaseline(state, elBaselineStatus, elBaselineSummary, elBaselineRunBtn, elBaselineClearBtn){
    if (!baseline.key) return;
    if (baseline.running) return;
    if (baseline.key !== baselineKey(state)){
      clearBaseline(elBaselineStatus, elBaselineSummary, elBaselineRunBtn, elBaselineClearBtn);
    }
  }

  async function buildNoiseBaseline(state, elBaselineRuns, elBaselineStatus, elBaselineSummary, elBaselineRunBtn, elBaselineClearBtn, renderAll){
    if (baseline.running) return;
    baseline.running = true;
    const token = ++baselineRunToken;

    // baseline must match the current scan configuration
    const key = baselineKey(state);
    const N = clamp(Math.floor(Number(elBaselineRuns && elBaselineRuns.value) || 200), 20, 2000);

    const bestRaw = [];
    const bestRatio = [];
    const dominance = [];
    const flipCount = [];

    // Prevent multiple concurrent runs, but allow Clear to cancel mid-run.
    if (elBaselineRunBtn) elBaselineRunBtn.disabled = true;
    if (elBaselineClearBtn) elBaselineClearBtn.disabled = false;

    if (elBaselineStatus) elBaselineStatus.textContent = `Baseline: running 0/${N}…`;
    if (elBaselineSummary) elBaselineSummary.textContent = "Running noise simulations…";

    const chunk = 10;
    for (let i=0; i<N; i++){
      // cancelled or settings changed
      if (token !== baselineRunToken){
        baseline.running = false;
        return;
      }
      if (baselineKey(state) !== key){
        baseline.running = false;
        clearBaseline(elBaselineStatus, elBaselineSummary, elBaselineRunBtn, elBaselineClearBtn);
        return;
      }

      const seed = 1000 + i*97;
      const days1m = OSC.synth.genSeries(state.days, seed);
      const flat = OSC.synth.flattenDays(days1m);
      const closes1m = flat.flat.map(k => k.c);

      const L = clamp(Math.floor(state.detrendHours*60), 30, closes1m.length);
      const resid1m = OSC.detrend.detrendRollingLinear(closes1m, L);

      const scan = OSC.scan.computeOscillationScanOnResidual(resid1m, state.scanWindow, state.periods);
      const stab = OSC.scan.computePeriodStability(resid1m, state.scanWindow, state.periods);

      if (scan && scan.best){
        bestRaw.push(scan.best.raw);
        if (scan.bestRatio != null && isFinite(scan.bestRatio)) bestRatio.push(scan.bestRatio);
      }
      if (stab){
        if (stab.dominance != null && isFinite(stab.dominance)) dominance.push(stab.dominance);
        if (stab.flipCount != null && isFinite(stab.flipCount)) flipCount.push(stab.flipCount);
      }

      if ((i+1) % chunk === 0){
        if (elBaselineStatus) elBaselineStatus.textContent = `Baseline: running ${i+1}/${N}…`;
        await new Promise(r => setTimeout(r, 0));
      }
    }

    bestRaw.sort((a,b)=>a-b);
    bestRatio.sort((a,b)=>a-b);
    dominance.sort((a,b)=>a-b);
    flipCount.sort((a,b)=>a-b);

    // cancelled late
    if (token !== baselineRunToken){
      baseline.running = false;
      return;
    }

    baseline = { key, n:N, bestRaw, bestRatio, dominance, flipCount, running:false };
    if (elBaselineStatus) elBaselineStatus.textContent = `Baseline: ready (n=${N})`;

    const mRaw = median(bestRaw);
    const mRatio = median(bestRatio);
    const mDom = median(dominance);
    const mFlip = median(flipCount);
    if (elBaselineSummary){
      elBaselineSummary.textContent =
        `Noise medians → bestScore ${mRaw!=null?mRaw.toFixed(4):"–"}, ` +
        `sep ${mRatio!=null?mRatio.toFixed(2):"–"}, ` +
        `dom ${mDom!=null?Math.round(mDom*100)+"%":"–"}, ` +
        `flips ${mFlip!=null?mFlip:"–"}.`;
    }

    if (elBaselineRunBtn) elBaselineRunBtn.disabled = false;
    if (elBaselineClearBtn) elBaselineClearBtn.disabled = false;

    if (renderAll) renderAll();
  }

  // Expose baseline data for other modules
  function getBaseline(){
    return baseline;
  }

  OSC.baseline = {
    baselineKey,
    clearBaseline,
    maybeInvalidateBaseline,
    buildNoiseBaseline,
    getBaseline
  };

})(window.OSC || (window.OSC = {}));

