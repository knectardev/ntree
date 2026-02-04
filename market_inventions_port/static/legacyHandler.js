// legacyHandler.js - Legacy Tick Message Handler
// Handles single-tick messages for backward compatibility

import { regimeClassMap, regimeBackgroundMap, SUB_STEP_COUNT } from './config.js';
import {
  sopranoSampler, bassSampler,
  isPlaying,
  buildAnnounced, setBuildAnnounced,
  setDivergenceActive
} from './state.js';
import { logLine, updateStatus, elements } from './ui.js';
import { addNoteEvent, addAnchor, formatRootOffset } from './visualizer.js';

export const handleLegacyTick = ({
  soprano_midi,
  bass_midi,
  rvol,
  regime,
  divergence,
  chord,
  build_id,
  root_offset,
  tick,
  qqq_price,
  spy_price,
  qqq_note_offset,
  spy_note_offset,
}, toggleQqq, toggleSpy) => {
  const {
    sopranoEl, bassEl, regimeEl, chordEl,
    rootOffsetEl, rootOffsetNoteEl, tickEl, rvolEl,
    buildIdEl, qqqPriceEl, spyPriceEl
  } = elements;
  
  const regimeKey = String(regime || "").toUpperCase();
  if (!buildAnnounced) {
    setBuildAnnounced(true);
    if (build_id) {
      logLine(`Build: ${build_id}`);
      updateStatus(`Connected (${build_id})`);
    } else {
      logLine("Build: missing (legacy payload)");
      updateStatus("Connected (build id missing)");
    }
  }

  if (sopranoEl) sopranoEl.textContent = soprano_midi;
  if (bassEl) bassEl.textContent = bass_midi;
  if (regimeEl) regimeEl.textContent = regimeKey || "--";
  if (chordEl) chordEl.textContent = chord ?? "--";
  
  const rootDisplay = formatRootOffset(root_offset);
  if (rootOffsetEl) rootOffsetEl.textContent = rootDisplay.offset;
  if (rootOffsetNoteEl) rootOffsetNoteEl.textContent = rootDisplay.note;
  if (tickEl) tickEl.textContent = tick ?? "--";
  if (rvolEl) rvolEl.textContent = rvol;
  if (buildIdEl) buildIdEl.textContent = build_id ?? "--";
  if (qqqPriceEl) qqqPriceEl.textContent = qqq_price ? `$${qqq_price}` : "--";
  if (spyPriceEl) spyPriceEl.textContent = spy_price ? `$${spy_price}` : "--";

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

  setDivergenceActive(Boolean(divergence));

  const currentSopranoSampler = sopranoSampler;
  const currentBassSampler = bassSampler;
  
  if (currentSopranoSampler && currentBassSampler && isPlaying) {
    const now = Tone.now();
    const detuneTarget = divergence ? -100 : 0;
    if (currentSopranoSampler.detune) {
      currentSopranoSampler.detune.rampTo(detuneTarget, 0.1);
    }
    if (currentBassSampler.detune) {
      currentBassSampler.detune.rampTo(detuneTarget, 0.1);
    }
    if (!toggleQqq.checked) {
      currentSopranoSampler.volume.mute = true;
    } else {
      currentSopranoSampler.volume.mute = false;
      currentSopranoSampler.triggerAttackRelease(
        Tone.Frequency(soprano_midi, "midi"),
        "16n",
        now
      );
    }
    if (!toggleSpy.checked) {
      currentBassSampler.volume.mute = true;
    } else {
      currentBassSampler.volume.mute = false;
      currentBassSampler.triggerAttackRelease(
        Tone.Frequency(bass_midi, "midi"),
        "8n",
        now
      );
    }
  }

  if (toggleQqq.checked) {
    addNoteEvent(soprano_midi, "soprano", qqq_price, tick, qqq_note_offset);
  }
  if (toggleSpy.checked) {
    addNoteEvent(bass_midi, "bass", spy_price, tick, spy_note_offset);
  }

  if (tick % SUB_STEP_COUNT === 0) {
    if (qqq_price !== undefined) {
      addAnchor("soprano", qqq_price, tick);
    }
    if (spy_price !== undefined) {
      addAnchor("bass", spy_price, tick);
    }
  }
};
