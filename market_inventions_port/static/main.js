// main.js - Application Entry Point
// Initializes the application and wires up all modules

import {
  syncOffsetMs, setSyncOffsetMs,
  glowDurationUnits, setGlowDurationUnits,
  futureVisibilityMs, setFutureVisibilityMs,
  isPlaying,
  sopranoSampler, bassSampler
} from './state.js';
import {
  initUI, elements, updateStatus,
  updateSensitivityDisplay, updatePriceNoiseDisplay
} from './ui.js';
import { initCanvas, resizeCanvas, drawVisualizer } from './visualizer.js';
import { connectPriceSocket, fetchBuildId, setConfig } from './networking.js';
import { startPlayback, stopPlayback } from './audioEngine.js';

// Initialize the application
const init = () => {
  // Initialize UI element references
  initUI();
  
  // Initialize canvas
  initCanvas();
  
  const {
    startButton,
    instrumentQqqSelect,
    instrumentSpySelect,
    toggleQqq,
    toggleSpy,
    toggleNoteLabels,
    sensitivitySlider,
    priceNoiseSlider,
    sopranoVolumeSlider,
    sopranoVolumeValueEl,
    bassVolumeSlider,
    bassVolumeValueEl,
    sopranoRhythmSelect,
    bassRhythmSelect,
    trendCycleSlider,
    trendCycleValueEl,
    chordProgressionSelect,
    syncOffsetSlider,
    syncOffsetValueEl,
    glowDurationSlider,
    glowDurationValueEl,
    futureVisibilitySlider,
    futureVisibilityValueEl
  } = elements;

  // Start button click handler
  startButton.addEventListener("click", async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    await startPlayback(
      instrumentQqqSelect,
      instrumentSpySelect,
      sopranoVolumeSlider,
      bassVolumeSlider,
      toggleQqq,
      toggleSpy,
      sopranoRhythmSelect,
      bassRhythmSelect
    );
  });

  // Initial status
  updateStatus("Connecting Price Stream...");

  // Helper to get current config values
  const getConfigValues = () => ({
    sensitivity: sensitivitySlider?.value ?? 0.7,
    priceNoise: priceNoiseSlider?.value ?? 6.7,
    sopranoRhythm: sopranoRhythmSelect?.value ?? 8,
    bassRhythm: bassRhythmSelect?.value ?? 2,
    trendCycle: trendCycleSlider?.value ?? 40,
    chordProgression: chordProgressionSelect?.value ?? "classical"
  });

  // Sensitivity slider
  if (sensitivitySlider) {
    updateSensitivityDisplay(sensitivitySlider.value);
    sensitivitySlider.addEventListener("input", (event) => {
      updateSensitivityDisplay(event.target.value);
      const cfg = getConfigValues();
      setConfig(event.target.value, cfg.priceNoise, cfg.sopranoRhythm, cfg.bassRhythm, cfg.trendCycle, cfg.chordProgression);
    });
    const cfg = getConfigValues();
    setConfig(cfg.sensitivity, cfg.priceNoise, cfg.sopranoRhythm, cfg.bassRhythm, cfg.trendCycle, cfg.chordProgression);
  }

  // Price noise slider
  if (priceNoiseSlider) {
    updatePriceNoiseDisplay(priceNoiseSlider.value);
    priceNoiseSlider.addEventListener("input", (event) => {
      updatePriceNoiseDisplay(event.target.value);
      const cfg = getConfigValues();
      setConfig(cfg.sensitivity, event.target.value, cfg.sopranoRhythm, cfg.bassRhythm, cfg.trendCycle, cfg.chordProgression);
    });
  }

  // Volume sliders
  if (sopranoVolumeSlider) {
    sopranoVolumeValueEl.textContent = `${sopranoVolumeSlider.value} dB`;
    sopranoVolumeSlider.addEventListener("input", (event) => {
      const volumeDb = parseFloat(event.target.value);
      sopranoVolumeValueEl.textContent = `${volumeDb} dB`;
      if (sopranoSampler) {
        sopranoSampler.volume.value = volumeDb;
      }
    });
  }

  if (bassVolumeSlider) {
    bassVolumeValueEl.textContent = `${bassVolumeSlider.value} dB`;
    bassVolumeSlider.addEventListener("input", (event) => {
      const volumeDb = parseFloat(event.target.value);
      bassVolumeValueEl.textContent = `${volumeDb} dB`;
      if (bassSampler) {
        bassSampler.volume.value = volumeDb;
      }
    });
  }

  // Soprano rhythm select
  if (sopranoRhythmSelect) {
    sopranoRhythmSelect.addEventListener("change", (event) => {
      const cfg = getConfigValues();
      setConfig(cfg.sensitivity, cfg.priceNoise, event.target.value, cfg.bassRhythm, cfg.trendCycle, cfg.chordProgression);
    });
  }

  // Bass rhythm select
  if (bassRhythmSelect) {
    bassRhythmSelect.addEventListener("change", (event) => {
      const cfg = getConfigValues();
      setConfig(cfg.sensitivity, cfg.priceNoise, cfg.sopranoRhythm, event.target.value, cfg.trendCycle, cfg.chordProgression);
    });
  }

  // Trend cycle slider
  if (trendCycleSlider) {
    trendCycleSlider.addEventListener("input", (event) => {
      const value = parseInt(event.target.value, 10);
      if (trendCycleValueEl) {
        trendCycleValueEl.textContent = `${value}s`;
      }
      const cfg = getConfigValues();
      setConfig(cfg.sensitivity, cfg.priceNoise, cfg.sopranoRhythm, cfg.bassRhythm, value, cfg.chordProgression);
    });
  }

  // Chord progression select
  if (chordProgressionSelect) {
    chordProgressionSelect.addEventListener("change", (event) => {
      const cfg = getConfigValues();
      setConfig(cfg.sensitivity, cfg.priceNoise, cfg.sopranoRhythm, cfg.bassRhythm, cfg.trendCycle, event.target.value);
    });
  }

  // Sync tuning sliders
  if (syncOffsetSlider) {
    syncOffsetSlider.addEventListener("input", (event) => {
      const value = parseInt(event.target.value, 10);
      setSyncOffsetMs(value);
      if (syncOffsetValueEl) {
        syncOffsetValueEl.textContent = `${value}ms`;
      }
    });
    // Initialize from slider value
    setSyncOffsetMs(parseInt(syncOffsetSlider.value, 10));
  }

  if (glowDurationSlider) {
    glowDurationSlider.addEventListener("input", (event) => {
      const value = parseInt(event.target.value, 10);
      setGlowDurationUnits(value);
      if (glowDurationValueEl) {
        glowDurationValueEl.textContent = `${value} unit${value > 1 ? 's' : ''}`;
      }
    });
    // Initialize from slider value
    setGlowDurationUnits(parseInt(glowDurationSlider.value, 10));
  }

  if (futureVisibilitySlider) {
    futureVisibilitySlider.addEventListener("input", (event) => {
      const value = parseInt(event.target.value, 10);
      setFutureVisibilityMs(value);
      if (futureVisibilityValueEl) {
        futureVisibilityValueEl.textContent = `${value}ms`;
      }
    });
    // Initialize from slider value
    setFutureVisibilityMs(parseInt(futureVisibilitySlider.value, 10));
  }

  // Instrument change handlers
  instrumentQqqSelect.addEventListener("change", () => {
    if (isPlaying) {
      startPlayback(
        instrumentQqqSelect,
        instrumentSpySelect,
        sopranoVolumeSlider,
        bassVolumeSlider,
        toggleQqq,
        toggleSpy,
        sopranoRhythmSelect,
        bassRhythmSelect
      );
    }
  });

  instrumentSpySelect.addEventListener("change", () => {
    if (isPlaying) {
      startPlayback(
        instrumentQqqSelect,
        instrumentSpySelect,
        sopranoVolumeSlider,
        bassVolumeSlider,
        toggleQqq,
        toggleSpy,
        sopranoRhythmSelect,
        bassRhythmSelect
      );
    }
  });

  // Connect price stream immediately on page load
  connectPriceSocket();

  // Fetch build info
  fetchBuildId();

  // Canvas setup
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // Start the visualization loop
  requestAnimationFrame(() => drawVisualizer(toggleNoteLabels));
};

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
