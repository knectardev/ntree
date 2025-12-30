/**
 * main.js
 * Wires DOM events + calls regen/render
 * Main application entry point
 */

(function(OSC) {
  'use strict';

  const { clamp } = OSC.utils;
  const { setupHiDPICanvas, getCSS, drawText, truncateTextToWidth, colorWithAlpha } = OSC.utils;
  const { MINUTES_PER_DAY, OUTER_PAD, GUTTER_W } = OSC.config;
  const { DEFAULT_SCAN_MIN_PERIOD, DEFAULT_SCAN_MAX_PERIOD, DEFAULT_SCAN_STEP } = OSC.config;

  // Get all DOM elements
  const elements = {
    ticker: document.getElementById("ticker"),
    days: document.getElementById("days"),
    regen: document.getElementById("regen"),
    toggleDetrend: document.getElementById("toggleDetrend"),
    toggleTurns: document.getElementById("toggleTurns"),
    toggleSineFit: document.getElementById("toggleSineFit"),
    toggleFourierOverlay: document.getElementById("toggleFourierOverlay"), // legacy (removed from sidebar; kept for safety)
    toggleGate: document.getElementById("toggleGate"),
    gateDom: document.getElementById("gateDom"),
    gateSep: document.getElementById("gateSep"),
    gateSlope: document.getElementById("gateSlope"),
    gateRequireRange: document.getElementById("gateRequireRange"),
    gateVol: document.getElementById("gateVol"),
    gateSuppressHighVol: document.getElementById("gateSuppressHighVol"),
    status: document.getElementById("status"),
    selPeriod: document.getElementById("selPeriod"),
    detrendLabel: document.getElementById("detrendLabel"),
    scanLabel: document.getElementById("scanLabel"),
    detrendHours: document.getElementById("detrendHours"),
    scanWindow: document.getElementById("scanWindow"),
    scanMinPeriod: document.getElementById("scanMinPeriod"),
    scanMaxPeriod: document.getElementById("scanMaxPeriod"),
    scanStepPeriod: document.getElementById("scanStepPeriod"),
    scanLogSpacing: document.getElementById("scanLogSpacing"),
    scanStepLabel: document.getElementById("scanStepLabel"),
    detrendDial: document.getElementById("detrendDial"),
    scanDial: document.getElementById("scanDial"),
    presetDaily: document.getElementById("presetDaily"),
    presetShort: document.getElementById("presetShort"),
    presetLong: document.getElementById("presetLong"),
    baselineRuns: document.getElementById("baselineRuns"),
    baselineRunBtn: document.getElementById("baselineRunBtn"),
    baselineClearBtn: document.getElementById("baselineClearBtn"),
    baselineStatus: document.getElementById("baselineStatus"),
    baselineSummary: document.getElementById("baselineSummary"),
    insightLight: document.getElementById("insightLight"),
    insightText: document.getElementById("insightText"),
    insightWhy: document.getElementById("insightWhy"),
    hoverTip: document.getElementById("hoverTip"),
    gateVerdict: document.getElementById("gateVerdict"),
    gateVerdictLight: document.getElementById("gateVerdictLight"),
    gateVerdictTitle: document.getElementById("gateVerdictTitle"),
    gateVerdictReason: document.getElementById("gateVerdictReason"),
    gateChecks: document.getElementById("gateChecks"),
    cPrice: document.getElementById("price"),
    cAnalysis: document.getElementById("analysis"),
    spectrumDetails: document.getElementById("spectrumDetails"),
    spectrumPanel: document.getElementById("spectrumPanel"),
    spectrumTopOnly: document.getElementById("spectrumTopOnly"),
    spectrumOverlayRecon: document.getElementById("spectrumOverlayRecon"),
    cSpectrum: document.getElementById("spectrum"),
    cScan: document.getElementById("scan"),
    cConsistency: document.getElementById("consistency"),
    scanPanel: document.getElementById("scanPanel"),
    consistencyPanel: document.getElementById("consistencyPanel"),
    pfDetails: document.getElementById("pfDetails")
  };

  // Create initial state
  let state = OSC.state.createInitialState(elements);

  // Helper functions
  function setStatus(text){
    if (elements.status) elements.status.textContent = text;
  }

  function fmtPeriodLabel(min){
    return OSC.scan.fmtPeriodLabel(min);
  }

  function fmtLookbackShort(min){
    const m = Math.max(0, Math.round(Number(min) || 0));
    if (m < 60) return `last ${m}m`;
    if (m % 60 === 0){
      const h = m/60;
      if (h < 24) return `last ${h}h`;
      const d = h/24;
      return `last ${Number.isInteger(d) ? d : d.toFixed(1)}d`;
    }
    return `last ${(m/60).toFixed(1)}h`;
  }

  function updateSelPeriodLabel(){
    if (!elements.selPeriod) return;
    if (state.selectedPeriodMin == null){
      if (state.bestPeriodMin != null) elements.selPeriod.textContent = `Auto (${fmtPeriodLabel(state.bestPeriodMin)})`;
      else elements.selPeriod.textContent = "Auto";
    } else {
      elements.selPeriod.textContent = fmtPeriodLabel(state.selectedPeriodMin);
    }
  }

  function updateDialLabels(){
    if (elements.detrendLabel) elements.detrendLabel.textContent = `${(state.detrendHours||0).toFixed(1)}h`;
    if (elements.scanLabel) elements.scanLabel.textContent = fmtLookbackShort(state.scanWindow||0);
  }

  function syncScanPeriodLabel(){
    if (!elements.scanStepLabel) return;
    elements.scanStepLabel.textContent = (elements.scanLogSpacing && elements.scanLogSpacing.checked) ? "Count" : "Step";
  }

  function syncCandidatePeriods(){
    state.scanMinPeriod = Number(elements.scanMinPeriod && elements.scanMinPeriod.value) || DEFAULT_SCAN_MIN_PERIOD;
    state.scanMaxPeriod = Number(elements.scanMaxPeriod && elements.scanMaxPeriod.value) || DEFAULT_SCAN_MAX_PERIOD;
    state.scanStepPeriod = Number(elements.scanStepPeriod && elements.scanStepPeriod.value) || DEFAULT_SCAN_STEP;
    state.scanLogSpacing = !!(elements.scanLogSpacing && elements.scanLogSpacing.checked);
    syncScanPeriodLabel();
    state.periods = OSC.scan.buildCandidatePeriods(state.scanMinPeriod, state.scanMaxPeriod, state.scanStepPeriod, state.scanLogSpacing);
  }

  function regenData(){
    state.seed = Math.floor(Math.random()*100000) + 1;
    state.days1m = OSC.synth.genSeries(state.days, state.seed);
    state.flat1m = OSC.synth.flattenDays(state.days1m);
  }

  function renderAll(){
    if (!state.days1m) return;

    // Always use 1-minute resolution - no resampling
    const flat1m = state.flat1m;

    updateSelPeriodLabel();
    const selTxt = (state.selectedPeriodMin != null) ? ` • Sel ${fmtPeriodLabel(state.selectedPeriodMin)}` : (state.bestPeriodMin != null ? ` • Sel Auto(${fmtPeriodLabel(state.bestPeriodMin)})` : "");
    setStatus(`${state.ticker} • ${state.days} days • TF 1m${selTxt} • seed ${state.seed}`);

    if (OSC.render.price && elements.cPrice) {
      OSC.render.price(elements.cPrice, flat1m.flat, flat1m.dayStartIdx, state);
    }

    if (OSC.render.analysis && elements.cAnalysis) {
      OSC.render.analysis(elements.cAnalysis, state, elements);
    }

    if (OSC.render.spectrum && elements.cSpectrum && (!elements.spectrumDetails || elements.spectrumDetails.open)) {
      OSC.render.spectrum(elements.cSpectrum, state, elements);
    }

    if (OSC.render.scanPanel && elements.cScan && (!elements.pfDetails || elements.pfDetails.open)) {
      OSC.render.scanPanel(elements.cScan, state, elements);
    }

    if (OSC.render.consistency && elements.cConsistency) {
      OSC.render.consistency(elements.cConsistency, state, elements);
    }

    updateDialLabels();
  }

  // Mouse tracking for vertical cursor line
  function updateCursorFromMouse(e) {
    if (!state.days1m) return;
    
    // Always use 1-minute resolution
    const dataLength = state.flat1m.flat.length;

    // Check if mouse is over any of the chart canvases
    const priceRect = elements.cPrice ? elements.cPrice.getBoundingClientRect() : null;
    const analysisRect = elements.cAnalysis ? elements.cAnalysis.getBoundingClientRect() : null;

    let cursorDataIndex = null;

    // Try price chart first
    if (priceRect && state.priceXAxis) {
      const mouseX = e.clientX - priceRect.left;
      const { x0, innerW, xStep, dataLength: priceDataLength } = state.priceXAxis;
      if (mouseX >= x0 && mouseX <= x0 + innerW) {
        const relativeX = mouseX - x0;
        const idx = Math.floor(relativeX / xStep);
        if (idx >= 0 && idx < priceDataLength) {
          cursorDataIndex = idx;
        }
      }
    }

    // Try analysis chart if not found in price chart
    if (cursorDataIndex == null && analysisRect && state.analysisXAxis) {
      const mouseX = e.clientX - analysisRect.left;
      const { x0, innerW, xStep, dataLength: analysisDataLength } = state.analysisXAxis;
      if (mouseX >= x0 && mouseX <= x0 + innerW) {
        const relativeX = mouseX - x0;
        const idx = Math.floor(relativeX / xStep);
        if (idx >= 0 && idx < analysisDataLength) {
          cursorDataIndex = idx;
        }
      }
    }

    // Also check if we have x-axis info from previous render
    // Calculate directly from canvas dimensions if x-axis info not available yet
    if (cursorDataIndex == null && priceRect) {
      const mouseX = e.clientX - priceRect.left;
      const pad = OSC.config.OUTER_PAD;
      const gutterW = OSC.config.GUTTER_W;
      const innerX = pad + gutterW;
      const innerW = priceRect.width - innerX - pad;
      if (mouseX >= innerX && mouseX <= innerX + innerW && dataLength > 0) {
        const xStep = innerW / dataLength;
        const relativeX = mouseX - innerX;
        const idx = Math.floor(relativeX / xStep);
        if (idx >= 0 && idx < dataLength) {
          cursorDataIndex = idx;
        }
      }
    }

    if (cursorDataIndex == null && analysisRect) {
      const mouseX = e.clientX - analysisRect.left;
      const pad = OSC.config.OUTER_PAD;
      const gutterW = OSC.config.GUTTER_W;
      const innerX = pad + gutterW;
      const innerW = analysisRect.width - innerX - pad;
      if (mouseX >= innerX && mouseX <= innerX + innerW && dataLength > 0) {
        const xStep = innerW / dataLength;
        const relativeX = mouseX - innerX;
        const idx = Math.floor(relativeX / xStep);
        if (idx >= 0 && idx < dataLength) {
          cursorDataIndex = idx;
        }
      }
    }

    // Update state and re-render if changed
    if (state.cursorDataIndex !== cursorDataIndex) {
      state.cursorDataIndex = cursorDataIndex;
      renderAll();
    }
  }

  function clearCursor() {
    if (state.cursorDataIndex != null) {
      state.cursorDataIndex = null;
      renderAll();
    }
  }

  function applyFromUI(){
    OSC.state.applyFromUI(state, elements);
    OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn);
  }

  // Initialize dials
  let detrendDial, scanDial;
  if (elements.detrendDial) {
    detrendDial = OSC.ui.createDial({
      canvas: elements.detrendDial,
      min: 0.25,
      max: 8.0,
      step: 0.25,
      value: state.detrendHours,
      colorVar: "--accent2",
      format: (v)=>`${Number(v).toFixed(1)}h`,
      onChange: (v)=>{ 
        state.detrendHours = Number(v); 
        if (elements.detrendHours) elements.detrendHours.value = Number(v).toFixed(2); 
        updateDialLabels(); 
        OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); 
        renderAll(); 
      }
    });
  }

  if (elements.scanDial) {
    scanDial = OSC.ui.createDial({
      canvas: elements.scanDial,
      min: 120,
      max: MINUTES_PER_DAY*10,
      step: 30,
      value: state.scanWindow,
      colorVar: "--warn",
      format: (v)=>fmtLookbackShort(v),
      onChange: (v)=>{ 
        state.scanWindow = Math.round(Number(v)); 
        if (elements.scanWindow) elements.scanWindow.value = String(state.scanWindow); 
        updateDialLabels(); 
        OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); 
        renderAll(); 
      }
    });
  }

  // Wire up event listeners
  if (elements.ticker) elements.ticker.addEventListener("change", () => { applyFromUI(); renderAll(); });
  if (elements.days) elements.days.addEventListener("change", () => { applyFromUI(); regenData(); renderAll(); });
  if (elements.regen) elements.regen.addEventListener("click", () => { applyFromUI(); regenData(); renderAll(); });

  if (elements.toggleDetrend) elements.toggleDetrend.addEventListener("change", () => { applyFromUI(); renderAll(); });
  if (elements.toggleTurns) elements.toggleTurns.addEventListener("change", () => { applyFromUI(); renderAll(); });
  if (elements.toggleSineFit) elements.toggleSineFit.addEventListener("change", () => { applyFromUI(); renderAll(); });
  if (elements.toggleFourierOverlay) elements.toggleFourierOverlay.addEventListener("change", () => { applyFromUI(); renderAll(); });
  if (elements.toggleGate) elements.toggleGate.addEventListener("change", () => { applyFromUI(); renderAll(); });

  if (elements.spectrumTopOnly) elements.spectrumTopOnly.addEventListener("change", () => { applyFromUI(); renderAll(); });
  if (elements.spectrumOverlayRecon) elements.spectrumOverlayRecon.addEventListener("change", () => { applyFromUI(); renderAll(); });

  if (elements.gateDom) elements.gateDom.addEventListener("change", () => { renderAll(); });
  if (elements.gateSep) elements.gateSep.addEventListener("change", () => { renderAll(); });
  if (elements.gateSlope) elements.gateSlope.addEventListener("change", () => { renderAll(); });
  if (elements.gateRequireRange) elements.gateRequireRange.addEventListener("change", () => { renderAll(); });
  if (elements.gateVol) elements.gateVol.addEventListener("change", () => { renderAll(); });
  if (elements.gateSuppressHighVol) elements.gateSuppressHighVol.addEventListener("change", () => { renderAll(); });

  if (elements.scanWindow) elements.scanWindow.addEventListener("change", () => { 
    state.scanWindow = Number(elements.scanWindow.value) || 780; 
    OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); 
    renderAll(); 
  });

  if (elements.scanMinPeriod) elements.scanMinPeriod.addEventListener("change", () => { syncCandidatePeriods(); OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); renderAll(); });
  if (elements.scanMaxPeriod) elements.scanMaxPeriod.addEventListener("change", () => { syncCandidatePeriods(); OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); renderAll(); });
  if (elements.scanStepPeriod) elements.scanStepPeriod.addEventListener("change", () => { syncCandidatePeriods(); OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); renderAll(); });
  if (elements.scanLogSpacing) elements.scanLogSpacing.addEventListener("change", () => { syncCandidatePeriods(); OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn); renderAll(); });

  if (elements.baselineRunBtn) elements.baselineRunBtn.addEventListener("click", () => {
    syncCandidatePeriods();
    OSC.baseline.maybeInvalidateBaseline(state, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn);
    OSC.baseline.buildNoiseBaseline(state, elements.baselineRuns, elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn, renderAll);
  });

  if (elements.baselineClearBtn) elements.baselineClearBtn.addEventListener("click", () => {
    OSC.baseline.clearBaseline(elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn);
    renderAll();
  });

  if (elements.pfDetails) {
    elements.pfDetails.addEventListener("toggle", () => {
      if (elements.pfDetails.open && OSC.render.scanPanel && elements.cScan){
        OSC.render.scanPanel(elements.cScan, state, elements);
      }
    });
  }

  if (elements.spectrumDetails) {
    elements.spectrumDetails.addEventListener("toggle", () => {
      if (elements.spectrumDetails.open && OSC.render.spectrum && elements.cSpectrum){
        OSC.render.spectrum(elements.cSpectrum, state, elements);
      }
    });
  }

  // Spectrum interactions: hover tooltip + click-to-select + right-click-to-clear
  function spectrumHitTest(canvas, e){
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = state.spectrumHitboxes || [];
    for (let i=0; i<hit.length; i++){
      const b = hit[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  // Pattern Finder interactions (scan bars): hover tooltip + click-to-select + right-click-to-clear
  function scanHitTest(canvas, e, hitboxes){
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitboxes || [];
    for (let i=0; i<hit.length; i++){
      const b = hit[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  function fmtScanTooltip(b){
    if (!b) return "";
    const lbl = b.label || (b.periodMin != null ? fmtPeriodLabel(b.periodMin) : "");
    const corr = (b.corr != null && isFinite(b.corr)) ? Number(b.corr) : null;
    const coh = (b.coh != null && isFinite(b.coh)) ? Number(b.coh) : null;
    const energy = (b.energy != null && isFinite(b.energy)) ? Number(b.energy) : null;
    const parts = [lbl];
    if (energy != null) parts.push(`energy=${energy.toFixed(3)}`);
    if (corr != null) parts.push(`r=${corr.toFixed(2)}`);
    if (coh != null) parts.push(`coh=${coh.toFixed(2)}`);
    return parts.join(" • ");
  }

  if (elements.cSpectrum) {
    elements.cSpectrum.addEventListener("mousemove", (e) => {
      const b = spectrumHitTest(elements.cSpectrum, e);
      if (b) {
        state.hoverPeriodMin = b.periodMin;
        state.hoverLabel = b.label;
        const vs = Math.round((Number(b.varShare) || 0) * 100);
        const r = (b.corr != null && isFinite(b.corr)) ? Number(b.corr) : 0;
        OSC.ui.setHoverTip(true, e.clientX, e.clientY, `${b.label} • ${vs}% standalone • r=${r.toFixed(2)}`);
      } else {
        state.hoverPeriodMin = null;
        state.hoverLabel = null;
        OSC.ui.setHoverTip(false);
      }
    });

    elements.cSpectrum.addEventListener("mouseleave", () => {
      state.hoverPeriodMin = null;
      state.hoverLabel = null;
      OSC.ui.setHoverTip(false);
    });

    elements.cSpectrum.addEventListener("click", (e) => {
      const b = spectrumHitTest(elements.cSpectrum, e);
      if (!b) return;
      state.selectedPeriodMin = Number(b.periodMin);
      renderAll();
    });

    elements.cSpectrum.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      state.selectedPeriodMin = null;
      renderAll();
    });
  }

  function wireScanCanvasInteractions(canvas, getHitboxes){
    if (!canvas) return;

    canvas.addEventListener("mousemove", (e) => {
      const hitboxes = (typeof getHitboxes === "function") ? getHitboxes() : [];
      const b = scanHitTest(canvas, e, hitboxes);
      if (b) {
        state.hoverPeriodMin = b.periodMin;
        state.hoverLabel = b.label || null;
        OSC.ui.setHoverTip(true, e.clientX, e.clientY, fmtScanTooltip(b));
        // Only re-render if hover target changed (keeps cursor tracking snappy)
        renderAll();
      } else {
        if (state.hoverPeriodMin != null || state.hoverLabel != null) {
          state.hoverPeriodMin = null;
          state.hoverLabel = null;
          renderAll();
        }
        OSC.ui.setHoverTip(false);
      }
    });

    canvas.addEventListener("mouseleave", () => {
      if (state.hoverPeriodMin != null || state.hoverLabel != null) {
        state.hoverPeriodMin = null;
        state.hoverLabel = null;
        renderAll();
      }
      OSC.ui.setHoverTip(false);
    });

    canvas.addEventListener("click", (e) => {
      const hitboxes = (typeof getHitboxes === "function") ? getHitboxes() : [];
      const b = scanHitTest(canvas, e, hitboxes);
      if (!b) return;
      state.selectedPeriodMin = Number(b.periodMin);
      renderAll();
    });

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      state.selectedPeriodMin = null;
      renderAll();
    });
  }

  // Wire Pattern Finder (right panel) bars
  wireScanCanvasInteractions(elements.cScan, () => state.scanHitboxesScan || []);
  // Wire the analysis panel's left-gutter scan bars (same behavior)
  wireScanCanvasInteractions(elements.cAnalysis, () => state.scanHitboxesAnalysis || []);

  // Preset functionality
  function applyPreset(p){
    // Cancels any running baseline and clears selection (presets are "fresh starts").
    OSC.baseline.clearBaseline(elements.baselineStatus, elements.baselineSummary, elements.baselineRunBtn, elements.baselineClearBtn);
    state.selectedPeriodMin = null;

    if (p.detrendHours != null){
      state.detrendHours = Number(p.detrendHours);
      if (elements.detrendHours) elements.detrendHours.value = state.detrendHours.toFixed(2);
      if (detrendDial) detrendDial.setValue(state.detrendHours, false);
    }
    if (p.scanWindow != null){
      state.scanWindow = Math.round(Number(p.scanWindow));
      if (elements.scanWindow) elements.scanWindow.value = String(state.scanWindow);
      if (scanDial) scanDial.setValue(state.scanWindow, false);
    }
    if (p.scanMinPeriod != null && elements.scanMinPeriod) elements.scanMinPeriod.value = String(Math.round(p.scanMinPeriod));
    if (p.scanMaxPeriod != null && elements.scanMaxPeriod) elements.scanMaxPeriod.value = String(Math.round(p.scanMaxPeriod));
    if (p.scanStepPeriod != null && elements.scanStepPeriod) elements.scanStepPeriod.value = String(Math.round(p.scanStepPeriod));
    if (p.scanLogSpacing != null && elements.scanLogSpacing) elements.scanLogSpacing.checked = !!p.scanLogSpacing;

    syncCandidatePeriods();
    updateSelPeriodLabel();
    updateDialLabels();
    renderAll();
  }

  if (elements.presetDaily) elements.presetDaily.addEventListener("click", () => {
    applyPreset({
      // Focus on ~hours/day rhythms
      detrendHours: 4.0,
      scanWindow: MINUTES_PER_DAY*3,
      scanMinPeriod: 30,
      scanMaxPeriod: 24*60,
      scanStepPeriod: 15,
      scanLogSpacing: false
    });
  });

  if (elements.presetShort) elements.presetShort.addEventListener("click", () => {
    applyPreset({
      // Focus on minutes→hours rhythms
      detrendHours: 1.0,
      scanWindow: MINUTES_PER_DAY*1,
      scanMinPeriod: 5,
      scanMaxPeriod: 180,
      scanStepPeriod: 5,
      scanLogSpacing: false
    });
  });

  if (elements.presetLong) elements.presetLong.addEventListener("click", () => {
    applyPreset({
      // Focus on multi-hour / multi-day rhythms
      detrendHours: 8.0,
      scanWindow: MINUTES_PER_DAY*10,
      scanMinPeriod: 60,
      scanMaxPeriod: 24*60,
      scanStepPeriod: 30,
      scanLogSpacing: true
    });
  });

  // Initialize
  syncScanPeriodLabel();
  syncCandidatePeriods();
  regenData();
  updateDialLabels();
  renderAll();

  // Add mouse tracking for vertical cursor line
  const mainPanel = document.querySelector('.main');
  if (mainPanel) {
    mainPanel.addEventListener('mousemove', updateCursorFromMouse);
    mainPanel.addEventListener('mouseleave', clearCursor);
  }

  // Export for debugging
  OSC.app = { state, elements, renderAll, regenData };

})(window.OSC || (window.OSC = {}));
