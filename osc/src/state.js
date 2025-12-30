/**
 * state.js
 * Exports:
 *  - OSC.state object
 *  - OSC.state.applyFromUI(elements)
 * State object + applyFromUI + serialization
 */

(function(OSC) {
  'use strict';

  const { DEFAULT_SCAN_MIN_PERIOD, DEFAULT_SCAN_MAX_PERIOD, DEFAULT_SCAN_STEP } = OSC.config;

  function createInitialState(elements){
    return {
      ticker: elements.ticker ? elements.ticker.value : "QQQ",
      days: elements.days ? Number(elements.days.value) : 5,
      seed: 1337,
      showDetrend: elements.toggleDetrend ? !!elements.toggleDetrend.checked : true,
      showTurns: elements.toggleTurns ? !!elements.toggleTurns.checked : false,
      showSineFit: elements.toggleSineFit ? !!elements.toggleSineFit.checked : true,
      showFourierOverlay: elements.spectrumOverlayRecon ? !!elements.spectrumOverlayRecon.checked : (elements.toggleFourierOverlay ? !!elements.toggleFourierOverlay.checked : false),
      gateEnabled: elements.toggleGate ? !!elements.toggleGate.checked : true,

      detrendHours: elements.detrendHours ? Number(elements.detrendHours.value) || 2.0 : 2.0,
      scanWindow: elements.scanWindow ? Number(elements.scanWindow.value) || 780 : 780,
      scanMinPeriod: elements.scanMinPeriod ? Number(elements.scanMinPeriod.value) || DEFAULT_SCAN_MIN_PERIOD : DEFAULT_SCAN_MIN_PERIOD,
      scanMaxPeriod: elements.scanMaxPeriod ? Number(elements.scanMaxPeriod.value) || DEFAULT_SCAN_MAX_PERIOD : DEFAULT_SCAN_MAX_PERIOD,
      scanStepPeriod: elements.scanStepPeriod ? Number(elements.scanStepPeriod.value) || DEFAULT_SCAN_STEP : DEFAULT_SCAN_STEP,
      scanLogSpacing: elements.scanLogSpacing ? !!(elements.scanLogSpacing.checked) : false,
      periods: null,

      selectedPeriodMin: null,
      bestPeriodMin: null,

      days1m: null,
      flat1m: null,

      scanHitboxes: [],
      scanHitboxesAnalysis: [],
      scanHitboxesScan: [],
      hoverPeriodMin: null,
      hoverLabel: null,

      spectrumTopOnly: elements.spectrumTopOnly ? !!elements.spectrumTopOnly.checked : true,
      spectrumHitboxes: [],

      // Projection spectrum (sine projection) settings + cache
      fourierK: 5,
      _fourierCacheKey: null,
      _fourierCacheData: null,

      // Local match-strength (segmented sine) cache for the selected rhythm panel
      _segSineCacheKey: null,
      _segSineCacheData: null
    };
  }

  function applyFromUI(state, elements){
    if (elements.ticker) state.ticker = elements.ticker.value;
    if (elements.days) state.days = Number(elements.days.value);
    if (elements.toggleDetrend) state.showDetrend = !!elements.toggleDetrend.checked;
    if (elements.toggleTurns) state.showTurns = !!elements.toggleTurns.checked;
    if (elements.toggleSineFit) state.showSineFit = !!elements.toggleSineFit.checked;
    if (elements.spectrumTopOnly) state.spectrumTopOnly = !!elements.spectrumTopOnly.checked;
    if (elements.spectrumOverlayRecon) state.showFourierOverlay = !!elements.spectrumOverlayRecon.checked;
    else if (elements.toggleFourierOverlay) state.showFourierOverlay = !!elements.toggleFourierOverlay.checked;
    if (elements.toggleGate) state.gateEnabled = !!elements.toggleGate.checked;
    if (elements.detrendHours) state.detrendHours = Number(elements.detrendHours.value) || state.detrendHours;
    if (elements.scanWindow) state.scanWindow = Number(elements.scanWindow.value) || state.scanWindow;
  }

  OSC.state = {
    createInitialState,
    applyFromUI
  };

})(window.OSC || (window.OSC = {}));

