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
      elements.insightText.innerHTML = "No clear repeating rhythm detected. This often happens during strong trends or noisy conditions. Try a longer lookback window or a preset.";
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
    
    // Use structural descriptors that align with stability/clarity metrics, not amplitude
    const stabilityDesc = good ? "highly stable" : (mid ? "moderately stable" : "unstable");
    const clarityDesc = (sep != null && sep >= 1.35) ? "clearly favored" : (sep != null && sep >= 1.20) ? "somewhat favored" : null;

    // Compute sine fit correlation and rhythm coherence if we have an active period
    // Use tail window for consistency with other metrics
    let sineCorr = null;
    let explainedMotion = null;
    let rhythmCoherence = null;
    if (activePeriodMin != null && resid1m && resid1m.length >= 5) {
      const sineFit = fitSineAtPeriod(resid1m, activePeriodMin, 1);
      if (sineFit && sineFit.fit) {
        // Use tail window for correlation to match other metrics
        const tailSineFit = sineFit.fit.slice(sineFit.fit.length - tailN);
        sineCorr = pearsonCorrelation(tailResid, tailSineFit);
        explainedMotion = Math.round(Math.max(0, Math.min(100, sineCorr * sineCorr * 100)));
        
        // Compute normalized projection power (rhythm coherence)
        // coherence = ||projection of x onto sine||² / ||x||² = (RMS of fitted sine)² / (RMS of signal)²
        const rmsSine = rms(tailSineFit);
        const rmsSignal = rR; // Already computed above
        const coherenceValue = clamp((rmsSine * rmsSine) / ((rmsSignal * rmsSignal) + 1e-9), 0, 1);
        rhythmCoherence = coherenceValue;
      }
    }

    const parts = [];
    
    // First paragraph: main description + variance share (together)
    const amplitudeDesc = sharePct < 5 ? "subtle but persistent oscillation rather than a dominant driver" : 
                          sharePct < 20 ? "moderate oscillatory component" : "dominant oscillatory pattern";
    const firstPara = `${selTxt} a ${stabilityDesc} repeating rhythm around ${perLbl}. This rhythm contributes ~${sharePct}% of total cleaned signal movement within the lookback window, indicating a ${amplitudeDesc}.`;
    parts.push(firstPara);
    
    // Metrics section - each on its own line
    const metrics = [];
    if (sep != null) {
      const clarityNote = clarityDesc ? ` (${clarityDesc} over nearby alternatives)` : "";
      metrics.push(`<strong>Clarity:</strong> ${sep.toFixed(2)}×${clarityNote}`);
    }
    metrics.push(`<strong>Repeatability:</strong> ${coh.toFixed(2)}`);
    if (dom != null) {
      const consistencyNote = dom >= 0.9 ? " (same rhythm across all recent windows)" : "";
      metrics.push(`<strong>Consistency:</strong> ${Math.round(dom*100)}%${consistencyNote}`);
    }
    if (pRaw != null) {
      metrics.push(`<strong>Noise baseline:</strong> stronger than ${pRaw}% of random price behavior`);
    }
    
    if (metrics.length > 0) {
      parts.push(metrics.join("<br>"));
    }
    
    // Sine fit quality section
    if (sineCorr != null) {
      const sineFitParts = [];
      sineFitParts.push(`<strong>Sine fit quality:</strong> Pearson correlation r = ${sineCorr.toFixed(2)}.`);
      if (explainedMotion != null && rhythmCoherence != null) {
        const coherencePct = Math.round(rhythmCoherence * 100);
        const coherenceDesc = rhythmCoherence < 0.15 ? "low" : rhythmCoherence < 0.35 ? "moderate" : "high";
        sineFitParts.push(`Within the oscillatory portion of the signal, the sine explains ~${explainedMotion}% of that motion, but overall coherence is ${coherenceDesc} (${coherencePct}%).`);
      }
      parts.push(sineFitParts.join(" "));
    } else if (rhythmCoherence != null) {
      const coherencePct = Math.round(rhythmCoherence * 100);
      parts.push(`<strong>Rhythm coherence:</strong> ${rhythmCoherence.toFixed(2)} (${coherencePct}% of cleaned motion).`);
    }

    // Join with double line breaks for paragraph separation
    elements.insightText.innerHTML = parts.join("<br><br>");
    if (elements.insightWhy){
      elements.insightWhy.textContent = (level === "good")
        ? "Why this matters: stable rhythms often indicate gentle back-and-forth behavior at this timescale, even when overall price movement is dominated by trends or noise."
        : (level === "mid")
          ? "Why this matters: a moderately stable rhythm may appear, but it can fade quickly in trends/noise—treat it as tentative."
          : "Why this matters: unstable rhythms often suggest price movement is mostly random at this timescale right now.";
    }
  }

  OSC.insight = {
    computeInsight
  };

})(window.OSC || (window.OSC = {}));

