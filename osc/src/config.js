/**
 * config.js
 * Exports:
 *  - OSC.config (constants / defaults)
 */
(function(){
  const OSC = (window.OSC = window.OSC || {});

  OSC.config = {
    // RTH only: 9:30-16:00
    MINUTES_PER_DAY: 390,

    // Rendering layout
    OUTER_PAD: 16,
    GUTTER_W: 230,

    // Scan defaults
    DEFAULT_SCAN_MIN_PERIOD: 5,
    DEFAULT_SCAN_MAX_PERIOD: 180,
    // When log spacing is enabled, `scanStepPeriod` represents COUNT (see `syncScanPeriodLabel()`).
    DEFAULT_SCAN_STEP: 15,

    // Guardrails
    MAX_CANDIDATE_COUNT: 80
  };
})();


