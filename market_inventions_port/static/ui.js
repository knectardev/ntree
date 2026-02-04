// ui.js - DOM and Event Handling
// Manages all DOM element references, UI updates, and event listeners

import { regimeClassMap, regimeBackgroundMap } from './config.js';
import { uiEvents } from './state.js';

// DOM element references - populated by initUI()
export const elements = {
  statusEl: null,
  logEl: null,
  startButton: null,
  instrumentQqqSelect: null,
  instrumentSpySelect: null,
  toggleQqq: null,
  toggleSpy: null,
  toggleNoteLabels: null,
  sensitivitySlider: null,
  sensitivityValueEl: null,
  priceNoiseSlider: null,
  priceNoiseValueEl: null,
  sopranoVolumeSlider: null,
  sopranoVolumeValueEl: null,
  bassVolumeSlider: null,
  bassVolumeValueEl: null,
  sopranoRhythmSelect: null,
  bassRhythmSelect: null,
  trendCycleSlider: null,
  trendCycleValueEl: null,
  chordProgressionSelect: null,
  sopranoEl: null,
  bassEl: null,
  regimeEl: null,
  chordEl: null,
  rootOffsetEl: null,
  rootOffsetNoteEl: null,
  tickEl: null,
  rvolEl: null,
  buildIdEl: null,
  buildRuntimeEl: null,
  qqqPriceEl: null,
  spyPriceEl: null,
  syncOffsetSlider: null,
  syncOffsetValueEl: null,
  glowDurationSlider: null,
  glowDurationValueEl: null,
  futureVisibilitySlider: null,
  futureVisibilityValueEl: null,
};

export const initUI = () => {
  elements.statusEl = document.getElementById("status");
  elements.logEl = document.getElementById("log");
  elements.startButton = document.getElementById("start");
  elements.instrumentQqqSelect = document.getElementById("instrument-qqq");
  elements.instrumentSpySelect = document.getElementById("instrument-spy");
  elements.toggleQqq = document.getElementById("toggle-qqq");
  elements.toggleSpy = document.getElementById("toggle-spy");
  elements.toggleNoteLabels = document.getElementById("toggle-note-labels");
  elements.sensitivitySlider = document.getElementById("sensitivity");
  elements.sensitivityValueEl = document.getElementById("sensitivity-value");
  elements.priceNoiseSlider = document.getElementById("price-noise");
  elements.priceNoiseValueEl = document.getElementById("price-noise-value");
  elements.sopranoVolumeSlider = document.getElementById("soprano-volume");
  elements.sopranoVolumeValueEl = document.getElementById("soprano-volume-value");
  elements.bassVolumeSlider = document.getElementById("bass-volume");
  elements.bassVolumeValueEl = document.getElementById("bass-volume-value");
  elements.sopranoRhythmSelect = document.getElementById("soprano-rhythm");
  elements.bassRhythmSelect = document.getElementById("bass-rhythm");
  elements.trendCycleSlider = document.getElementById("trend-cycle");
  elements.trendCycleValueEl = document.getElementById("trend-cycle-value");
  elements.chordProgressionSelect = document.getElementById("chord-progression");
  elements.sopranoEl = document.getElementById("soprano");
  elements.bassEl = document.getElementById("bass");
  elements.regimeEl = document.getElementById("regime");
  elements.chordEl = document.getElementById("chord");
  elements.rootOffsetEl = document.getElementById("root-offset");
  elements.rootOffsetNoteEl = document.getElementById("root-offset-note");
  elements.tickEl = document.getElementById("tick");
  elements.rvolEl = document.getElementById("rvol");
  elements.buildIdEl = document.getElementById("build-id");
  elements.buildRuntimeEl = document.getElementById("build-runtime");
  elements.qqqPriceEl = document.getElementById("qqq-price");
  elements.spyPriceEl = document.getElementById("spy-price");
  elements.syncOffsetSlider = document.getElementById("sync-offset");
  elements.syncOffsetValueEl = document.getElementById("sync-offset-value");
  elements.glowDurationSlider = document.getElementById("glow-duration");
  elements.glowDurationValueEl = document.getElementById("glow-duration-value");
  elements.futureVisibilitySlider = document.getElementById("future-visibility");
  elements.futureVisibilityValueEl = document.getElementById("future-visibility-value");
};

export const logLine = (message) => {
  const { logEl } = elements;
  if (!logEl) return;
  
  const line = document.createElement("div");
  line.textContent = message;
  const firstChild = logEl.firstElementChild;
  if (firstChild && firstChild.classList.contains("log-title")) {
    logEl.insertBefore(line, firstChild.nextSibling);
  } else {
    logEl.prepend(line);
  }
};

export const updateStatus = (message) => {
  const { statusEl } = elements;
  if (statusEl) {
    statusEl.textContent = message;
  }
};

export const updateSensitivityDisplay = (value) => {
  const { sensitivityValueEl } = elements;
  if (sensitivityValueEl) {
    sensitivityValueEl.textContent = `${Number(value).toFixed(1)}x`;
  }
};

export const updatePriceNoiseDisplay = (value) => {
  const { priceNoiseValueEl } = elements;
  if (priceNoiseValueEl) {
    priceNoiseValueEl.textContent = `${Number(value).toFixed(1)}x`;
  }
};

export const setButtonState = (label, disabled) => {
  const { startButton } = elements;
  if (startButton) {
    startButton.textContent = label;
    startButton.disabled = disabled;
  }
};

export const processUIUpdates = (now) => {
  const {
    sopranoEl, bassEl, regimeEl, chordEl,
    rootOffsetEl, rootOffsetNoteEl, tickEl, rvolEl,
    qqqPriceEl, spyPriceEl
  } = elements;
  
  // Find the UI event that is closest to 'now' without being in the future
  let currentUIState = null;

  for (let i = uiEvents.length - 1; i >= 0; i--) {
    if (uiEvents[i].time <= now) {
      currentUIState = uiEvents[i];
      break;
    }
  }

  if (currentUIState) {
    if (sopranoEl) sopranoEl.textContent = currentUIState.soprano ?? "--";
    if (bassEl) bassEl.textContent = currentUIState.bass ?? "--";
    if (regimeEl) regimeEl.textContent = currentUIState.regime || "--";
    if (chordEl) chordEl.textContent = currentUIState.chord ?? "--";
    if (rootOffsetEl) rootOffsetEl.textContent = currentUIState.rootOffset ?? "--";
    if (rootOffsetNoteEl) rootOffsetNoteEl.textContent = currentUIState.rootOffsetNote || "--";
    if (tickEl) tickEl.textContent = currentUIState.tick ?? "--";
    if (rvolEl) rvolEl.textContent = currentUIState.rvol ?? "--";
    if (qqqPriceEl) qqqPriceEl.textContent = currentUIState.qqqPrice ? `$${currentUIState.qqqPrice.toFixed(2)}` : "--";
    if (spyPriceEl) spyPriceEl.textContent = currentUIState.spyPrice ? `$${currentUIState.spyPrice.toFixed(2)}` : "--";

    // Update regime styling
    const regimeKey = String(currentUIState.regime || "").toUpperCase();
    if (regimeEl) {
      regimeEl.classList.remove(...Object.values(regimeClassMap));
      if (regimeClassMap[regimeKey]) {
        regimeEl.classList.add(regimeClassMap[regimeKey]);
      }
    }
    document.body.classList.remove(...Object.values(regimeBackgroundMap));
    if (regimeBackgroundMap[regimeKey]) {
      document.body.classList.add(regimeBackgroundMap[regimeKey]);
    }
  }
};
