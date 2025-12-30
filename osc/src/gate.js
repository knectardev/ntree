/**
 * gate.js
 * Exports:
 *  - OSC.gate.gateDecision(stab, closes1m, resid1m, gate)
 *  - OSC.gate.renderGateUI(gateEnabled, gateRes, elements)
 * Gate decision logic + UI rendering
 */

(function(OSC) {
  'use strict';

  const { clamp } = OSC.utils;
  const { rms } = OSC.scan;

  function gateDecision(stab, closes1m, resid1m, gate){
    const reasons=[];
    const checks=[];
    let ok = true;

    if (gate.enabled){
      if (gate.requireRange){
        const slopeSig = OSC.detrend.computeSlopeSigmaPerHr(closes1m, gate.detrendHoursForSlope);
        if (slopeSig == null){
          checks.push({key:"Avoid trends", status:"off", detail:"⏸ not enough data"});
        } else {
          const v = Math.abs(slopeSig);
          const thr = gate.maxSlopeSigmaPerHr;
          const borderline = (v > thr && v <= thr*1.10);
          const pass = v <= thr;
          const status = pass ? "pass" : (borderline ? "warn" : "fail");
          checks.push({key:"Avoid trends", status, detail:`|slope| ${v.toFixed(2)}σ/hr ≤ ${thr.toFixed(2)}σ/hr`});
          if (!pass){
            ok = false;
            reasons.push(`trendiness ${v.toFixed(2)}σ/hr > ${thr.toFixed(2)}σ/hr`);
          }
        }
      } else {
        checks.push({key:"Avoid trends", status:"off", detail:"⏸ ignored"});
      }

      if (gate.useStability){
        const dom = (stab && stab.dominance != null && isFinite(stab.dominance)) ? Number(stab.dominance) : null;
        const domThr = gate.minDominance;
        if (dom == null){
          checks.push({key:"Consistency over time", status:"off", detail:"⏸ not enough data"});
        } else {
          const borderline = (dom < domThr && dom >= Math.max(0, domThr - 0.10));
          const pass = dom >= domThr;
          const status = pass ? "pass" : (borderline ? "warn" : "fail");
          checks.push({key:"Consistency over time", status, detail:`${Math.round(dom*100)}% ≥ ${Math.round(domThr*100)}%`});
          if (!pass){
            ok = false;
            reasons.push(`consistency ${Math.round(dom*100)}% < ${Math.round(domThr*100)}%`);
          }
        }

        const sep = (stab && stab.medRatio != null && isFinite(stab.medRatio)) ? Number(stab.medRatio) : null;
        const sepThr = gate.minSeparation;
        if (sep == null){
          checks.push({key:"Clarity vs alternatives", status:"off", detail:"⏸ not enough data"});
        } else {
          const borderline = (sep < sepThr && sep >= Math.max(1, sepThr - 0.10));
          const pass = sep >= sepThr;
          const status = pass ? "pass" : (borderline ? "warn" : "fail");
          checks.push({key:"Clarity vs alternatives", status, detail:`${sep.toFixed(2)}× ≥ ${sepThr.toFixed(2)}×`});
          if (!pass){
            ok = false;
            reasons.push(`clarity ${sep.toFixed(2)}× < ${sepThr.toFixed(2)}×`);
          }
        }
      } else {
        checks.push({key:"Consistency over time", status:"off", detail:"⏸ ignored"});
        checks.push({key:"Clarity vs alternatives", status:"off", detail:"⏸ ignored"});
      }

      if (gate.suppressHighVol){
        const curVol = rms(resid1m.slice(resid1m.length - clamp(Math.floor(gate.volWindowMinutes), 60, resid1m.length)));
        const base = (stab && stab.medVol != null) ? stab.medVol : null;
        if (base == null || !isFinite(base)){
          checks.push({key:"Avoid noisy periods", status:"off", detail:"⏸ no baseline σ"});
        } else {
          const thr = gate.volMult*base;
          const borderline = (curVol > thr && curVol <= thr*1.10);
          const pass = curVol <= thr;
          const status = pass ? "pass" : (borderline ? "warn" : "fail");
          checks.push({key:"Avoid noisy periods", status, detail:`${curVol.toFixed(3)} ≤ ${gate.volMult.toFixed(2)}×${base.toFixed(3)}`});
          if (!pass){
            ok = false;
            reasons.push(`noise ${curVol.toFixed(3)} > ${gate.volMult.toFixed(2)}×${base.toFixed(3)}`);
          }
        }
      } else {
        checks.push({key:"Avoid noisy periods", status:"off", detail:"⏸ ignored"});
      }
    }

    return {eligible: ok, reasons, checks};
  }

  function renderGateUI(gateEnabled, gateRes, elements){
    if (!elements || !elements.gateVerdictLight || !elements.gateVerdictTitle || !elements.gateVerdictReason || !elements.gateChecks) return;

    if (!gateEnabled){
      elements.gateVerdictLight.className = "light mid";
      elements.gateVerdictTitle.textContent = "⏸ Filter off";
      elements.gateVerdictReason.textContent = "Reason: showing all turning points (no filtering)";
      elements.gateChecks.innerHTML = "";
      return;
    }

    const checks = (gateRes && gateRes.checks) ? gateRes.checks : [];
    const eligible = !!(gateRes && gateRes.eligible);
    const hasFail = checks.some(c=>c.status==="fail");
    const hasWarn = checks.some(c=>c.status==="warn");

    const light = eligible ? "good" : (hasWarn && !hasFail ? "mid" : "bad");
    elements.gateVerdictLight.className = `light ${light}`;
    elements.gateVerdictTitle.textContent = eligible ? "🟢 Rhythm is stable" : (hasWarn && !hasFail ? "🟡 Rhythm is weak" : "🔴 No reliable rhythm detected");

    const reason = (gateRes && gateRes.reasons && gateRes.reasons.length) ? gateRes.reasons[0] : (eligible ? "passes all checks" : "one or more checks failed");
    elements.gateVerdictReason.textContent = `Reason: ${reason}`;

    const iconFor = (s)=> (s==="pass" ? "✅" : (s==="warn" ? "⚠" : (s==="fail" ? "❌" : "⏸")));
    const clsFor = (s)=> (s==="pass" ? "pass" : (s==="warn" ? "warn" : (s==="fail" ? "fail" : "off")));
    elements.gateChecks.innerHTML = checks.map(c => (
      `<div class="gateCheck ${clsFor(c.status)}"><span class="k">${c.key}</span><span>${iconFor(c.status)}</span></div>`
    )).join("");
  }

  OSC.gate = {
    gateDecision,
    renderGateUI
  };

})(window.OSC || (window.OSC = {}));

