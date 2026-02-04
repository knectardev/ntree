// audioEngine.js - Tone.js Audio Logic
// Handles audio loading, scheduling, playback control

import { instrumentMap, SUB_STEP_SECONDS } from './config.js';
import {
  sopranoSampler, bassSampler,
  setSopranoSampler, setBassSampler,
  isPlaying, setIsPlaying,
  transportLoop, setTransportLoop,
  transportStarted, setTransportStarted,
  bundleQueue, clearBundleQueue, clearUIEvents,
  incrementLoadCounter, getLoadCounter,
  musicSocket, setMusicSocket,
  syncOffsetMs,
  lastPlayedSoprano, lastPlayedBass,
  setLastPlayedSoprano, setLastPlayedBass,
  setNextVisualStartTime,
  resetPlaybackState
} from './state.js';
import { logLine, updateStatus, setButtonState, elements } from './ui.js';
import { connectMusicSocket } from './networking.js';

export const loadSampler = async (instrumentKey) => {
  const config = instrumentMap[instrumentKey] || instrumentMap.harpsichord;
  let sampler = null;

  const loadPromise = new Promise((resolve) => {
    sampler = new Tone.Sampler({
      urls: {
        C2: "C2.mp3",
        C3: "C3.mp3",
        C4: "C4.mp3",
        C5: "C5.mp3",
      },
      baseUrl: config.baseUrl,
      release: 0.2, // Reduced from 1 to 0.2 to prevent massive overlaps at high sensitivity
      onload: () => resolve(sampler),
    }).toDestination();
  });

  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve("timeout"), 7000)
  );

  const result = await Promise.race([loadPromise, timeoutPromise]);
  if (result === "timeout") {
    if (sampler) {
      sampler.dispose();
    }
    throw new Error(`Sample load timed out for ${config.label}.`);
  }
  return result;
};

export const scheduleBundle = (bundle, time, toggleQqq, toggleSpy, sopranoRhythmSelect, bassRhythmSelect) => {
  const currentSopranoSampler = sopranoSampler;
  const currentBassSampler = bassSampler;
  
  if (!currentSopranoSampler || !currentBassSampler) {
    return;
  }
  
  currentSopranoSampler.volume.mute = !toggleQqq.checked;
  currentBassSampler.volume.mute = !toggleSpy.checked;
  const detuneTarget = bundle.divergence ? -100 : 0;

  if (currentSopranoSampler.detune) {
    currentSopranoSampler.detune.rampTo(detuneTarget, 0.3);
  }
  if (currentBassSampler.detune) {
    currentBassSampler.detune.rampTo(detuneTarget, 0.3);
  }

  // Get soprano note duration based on rhythm setting
  const sopranoRhythm = Number(sopranoRhythmSelect?.value ?? 4);
  const sopranoDuration = sopranoRhythm === 4 ? "4n" : sopranoRhythm === 8 ? "8n" : "16n";
  
  // Get bass note duration based on rhythm setting
  // bass_rhythm: 4=quarter, 2=half, 1=whole
  const bassRhythm = Number(bassRhythmSelect?.value ?? 4);
  const bassDuration = bassRhythm === 4 ? "4n" : bassRhythm === 2 ? "2n" : "1n";

  // Use persistent tracking to avoid retriggering across bundle boundaries
  let prevSopranoMidi = lastPlayedSoprano;
  let prevBassMidi = lastPlayedBass;

  for (let i = 0; i < bundle.soprano_bundle.length; i += 1) {
    const offsetSeconds = i * SUB_STEP_SECONDS;
    const scheduledTime = time + offsetSeconds;

    if (toggleQqq.checked) {
      const sopranoMidi = bundle.soprano_bundle[i];
      const shouldTriggerSoprano =
        sopranoMidi !== null &&
        sopranoMidi !== undefined &&
        sopranoMidi !== prevSopranoMidi;

      if (shouldTriggerSoprano) {
        currentSopranoSampler.triggerAttackRelease(
          Tone.Frequency(sopranoMidi, "midi"),
          sopranoDuration,
          scheduledTime
        );
        prevSopranoMidi = sopranoMidi;
        setLastPlayedSoprano(sopranoMidi);
      }
    }

    if (toggleSpy.checked && Array.isArray(bundle.bass_bundle)) {
      const bassMidi = bundle.bass_bundle[i];
      const shouldTriggerBass =
        bassMidi !== null &&
        bassMidi !== undefined &&
        bassMidi !== prevBassMidi;

      if (shouldTriggerBass) {
        currentBassSampler.triggerAttackRelease(
          Tone.Frequency(bassMidi, "midi"),
          bassDuration,
          scheduledTime
        );
        prevBassMidi = bassMidi;
        setLastPlayedBass(bassMidi);
      }
    }
  }
};

export const stopPlayback = () => {
  resetPlaybackState();
  
  const currentTransportLoop = transportLoop;
  if (currentTransportLoop) {
    currentTransportLoop.stop();
    currentTransportLoop.dispose();
    setTransportLoop(null);
  }
  
  Tone.Transport.stop();
  Tone.Transport.cancel();
  
  // Only close MUSIC socket - price socket keeps running
  const currentMusicSocket = musicSocket;
  if (currentMusicSocket) {
    currentMusicSocket.close();
    setMusicSocket(null);
  }
  
  const currentSopranoSampler = sopranoSampler;
  if (currentSopranoSampler) {
    currentSopranoSampler.releaseAll?.();
    currentSopranoSampler.dispose();
    setSopranoSampler(null);
  }
  
  const currentBassSampler = bassSampler;
  if (currentBassSampler) {
    currentBassSampler.releaseAll?.();
    currentBassSampler.dispose();
    setBassSampler(null);
  }
  
  setButtonState("Start Audio", false);
  updateStatus("Price Stream Active");
};

export const startPlayback = async (
  instrumentQqqSelect,
  instrumentSpySelect,
  sopranoVolumeSlider,
  bassVolumeSlider,
  toggleQqq,
  toggleSpy,
  sopranoRhythmSelect,
  bassRhythmSelect
) => {
  await Tone.start();

  logLine(`Sync: offset=${syncOffsetMs}ms | Use sliders to tune!`);

  const loadToken = incrementLoadCounter();
  const shouldReconnect = !isPlaying;
  setButtonState("Loading Samples...", true);

  // Reset engine state for fresh random prices on each playback start
  if (shouldReconnect) {
    try {
      await fetch("reset", { method: "POST" });
      logLine("Engine reset - fresh random prices generated");
    } catch (error) {
      logLine(`Reset warning: ${error.message}`);
    }
  }

  try {
    const [qqqSampler, spySampler] = await Promise.all([
      loadSampler(instrumentQqqSelect.value),
      loadSampler(instrumentSpySelect.value),
    ]);

    if (loadToken !== getLoadCounter()) {
      qqqSampler.dispose();
      spySampler.dispose();
      return;
    }

    const currentSopranoSampler = sopranoSampler;
    const currentBassSampler = bassSampler;
    
    if (currentSopranoSampler) {
      currentSopranoSampler.dispose();
    }
    if (currentBassSampler) {
      currentBassSampler.dispose();
    }

    setSopranoSampler(qqqSampler);
    setBassSampler(spySampler);

    // Set initial volumes from sliders
    if (sopranoVolumeSlider) {
      qqqSampler.volume.value = parseFloat(sopranoVolumeSlider.value);
    }
    if (bassVolumeSlider) {
      spySampler.volume.value = parseFloat(bassVolumeSlider.value);
    }
  } catch (error) {
    logLine(error.message);
    updateStatus("Sample load timed out");
    setButtonState("Start Audio", false);
    return;
  }
  
  setIsPlaying(true);

  if (shouldReconnect) {
    connectMusicSocket(toggleQqq, toggleSpy, sopranoRhythmSelect);
  }
  
  if (!transportLoop) {
    Tone.Transport.bpm.value = 60;
    const loop = new Tone.Loop((time) => {
      const bundle = bundleQueue.shift();
      if (!bundle) {
        return;
      }
      scheduleBundle(bundle, time, toggleQqq, toggleSpy, sopranoRhythmSelect, bassRhythmSelect);
    }, 1).start(0);
    setTransportLoop(loop);
  }
  
  if (!transportStarted) {
    Tone.Transport.start();
    setTransportStarted(true);
  }
  
  setButtonState("Stop Audio", false);
};
