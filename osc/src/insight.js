/**
 * insight.js
 * Exports:
 *  - OSC.insight.computeInsight(scan, stab, resid1m, activePeriodMin, state, elements)
 * Computes and displays insight summary
 */

(function(OSC) {
  'use strict';

  const { clamp } = OSC.utils;
  const { rms, percentileRank, bandpassApprox, fitSineAtPeriod, pearsonCorrelation } = OSC.scan;

  function computeInsight(scan, stab, resid1m, activePeriodMin, state, elements, baseline){
    if (!elements || !elements.insightText || !elements.insightLight) return;
    if (!scan || !scan.best || activePeriodMin == null || !resid1m || !resid1m.length){
      elements.insightLight.className = "light bad";
      elements.insightText.textContent = "No clear repeating rhythm detected. This often happens during strong trends or noisy conditions. Try a longer lookback window or a preset.";
      if (elements.insightWhy) elements.insightWhy.textContent = "Why this matters: unstable rhythms often suggest price movement is mostly random at this timescale right now.";
      return;
    }

    const coh = Number(scan.best.coh || 0);
    const sep = (scan.bestRatio != null && isFinite(scan.bestRatio)) ? Number(scan.bestRatio) : null;
    const dom = (stab && stab.dominance != null && isFinite(stab.dominance)) ? Number(stab.dominance) : null;

    // Approx. variance share of the bandpassed rhythm vs cleaned signal (tail window)
    const tailN = clamp(Math.floor(Number(state.scanWindow) || 780), 120, resid1m.length);
    const tailResid = resid1m.slice(resid1m.length - tailN);
    const bp = bandpassApprox(resid1m, activePeriodMin);
    const tailCycle = bp.slice(bp.length - tailN);
    const rR = rms(tailResid);
    const rC = rms(tailCycle);
    const share = clamp((rC*rC) / ((rR*rR) + 1e-9), 0, 1);
    const sharePct = Math.round(share * 100);

    let pRaw = null;
    if (baseline && baseline.key && OSC.baseline && OSC.baseline.baselineKey && baseline.key === OSC.baseline.baselineKey(state) && baseline.bestRaw && scan.best){
      pRaw = percentileRank(baseline.bestRaw, scan.best.raw);
    }

    const good = (pRaw != null ? (pRaw >= 85) : false) || ((sep != null && sep >= 1.35) && coh >= 0.25 && (dom == null || dom >= 0.55));
    const mid = (!good) && (((sep != null && sep >= 1.20) && coh >= 0.15) || (pRaw != null && pRaw >= 70));
    const level = good ? "good" : (mid ? "mid" : "bad");
    elements.insightLight.className = `light ${level}`;

    const perLbl = OSC.scan.fmtPeriodLabel(activePeriodMin);
    const selTxt = (state.selectedPeriodMin != null) ? "You selected" : "Auto found";
    const confTxt = good ? "Strong" : (mid ? "Moderate" : "Weak");

    // Compute sine fit correlation if we have an active period
    // Use tail window for consistency with other metrics
    let sineCorr = null;
    let explainedMotion = null;
    if (activePeriodMin != null && resid1m && resid1m.length >= 5) {
      const sineFit = fitSineAtPeriod(resid1m, activePeriodMin, 1);
      if (sineFit && sineFit.fit) {
        // Use tail window for correlation to match other metrics
        const tailSineFit = sineFit.fit.slice(sineFit.fit.length - tailN);
        sineCorr = pearsonCorrelation(tailResid, tailSineFit);
        explainedMotion = Math.round(Math.max(0, Math.min(100, sineCorr * sineCorr * 100)));
      }
    }

    const bits = [];
    bits.push(`${selTxt} a ${confTxt.toLowerCase()} repeating rhythm around ${perLbl}.`);
    bits.push(`This rhythm explains ~${sharePct}% of the cleaned signal's movement (within the lookback window).`);
    if (sep != null) bits.push(`Clarity: ${sep.toFixed(2)}×.`);
    bits.push(`Repeatability: ${coh.toFixed(2)}.`);
    if (dom != null) bits.push(`Consistency: ${Math.round(dom*100)}%.`);
    if (pRaw != null) bits.push(`Stronger than ${pRaw}% of random price behavior (score).`);
    if (sineCorr != null) {
      bits.push(`Pearson Sine fit correlation: r = ${sineCorr.toFixed(2)}.`);
      bits.push(`Explained motion: ${explainedMotion}% of cleaned signal.`);
    }

    elements.insightText.textContent = bits.join(" ");
    if (elements.insightWhy){
      elements.insightWhy.textContent = (level === "good")
        ? "Why this matters: stable rhythms often come with more back-and-forth at this timescale (less one-way randomness)."
        : (level === "mid")
          ? "Why this matters: a weak rhythm may appear, but it can fade quickly in trends/noise—treat it as tentative."
          : "Why this matters: unstable rhythms often suggest price movement is mostly random at this timescale right now.";
    }
  }

  OSC.insight = {
    computeInsight
  };

})(window.OSC || (window.OSC = {}));

