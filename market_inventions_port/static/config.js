// config.js - Constants and Global Configuration
// Centralized settings for regime maps, instruments, and note visualization

export const regimeClassMap = {
  MAJOR: "regime-major",
  MINOR: "regime-minor",
  WHOLE_TONE: "regime-whole-tone",
  DIMINISHED: "regime-diminished",
};

export const regimeBackgroundMap = {
  MAJOR: "regime-bg-major",
  MINOR: "regime-bg-minor",
  WHOLE_TONE: "regime-bg-whole-tone",
  DIMINISHED: "regime-bg-diminished",
};

export const instrumentMap = {
  // Classic/Baroque
  harpsichord: {
    label: "Harpsichord",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/harpsichord-mp3/",
  },
  pipe_organ: {
    label: "Pipe Organ",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/church_organ-mp3/",
  },
  strings: {
    label: "Strings",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/string_ensemble_1-mp3/",
  },
  electric_organ: {
    label: "Electric Organ",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/drawbar_organ-mp3/",
  },
  flute: {
    label: "Flute",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/flute-mp3/",
  },
  // Electronica/Synth
  synth_lead: {
    label: "Synth Lead",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/lead_1_square-mp3/",
  },
  synth_saw: {
    label: "Synth Saw",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/lead_2_sawtooth-mp3/",
  },
  synth_pad: {
    label: "Synth Pad",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/",
  },
  synth_brass: {
    label: "Synth Brass",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synthbrass_1-mp3/",
  },
  // Bass
  acoustic_bass: {
    label: "Acoustic Bass",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_bass-mp3/",
  },
  electric_bass: {
    label: "Electric Bass",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/electric_bass_finger-mp3/",
  },
  slap_bass: {
    label: "Slap Bass",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/slap_bass_1-mp3/",
  },
};

export const noteConfig = {
  minMidi: 36,
  maxMidi: 84,
  minDisplayMidi: 24,
  maxDisplayMidi: 96,
  pixelsPerSecond: 90,
  sopranoColor: "#7cffc2",
  bassColor: "#7aa7ff",
};

export const playheadFraction = 0.5;

export const playheadColors = {
  normal: "rgba(0, 255, 153, 0.6)",
  alert: "rgba(255, 68, 68, 0.85)",
};

export const canvasBackground = {
  normal: "rgba(8, 9, 12, 0.7)",
  alert: "rgba(6, 6, 8, 0.85)",
};

// Timing constants
export const SUB_STEP_COUNT = 16;
export const SUB_STEP_SECONDS = 1 / SUB_STEP_COUNT;
export const MAX_BUNDLE_QUEUE = 4;

// Manual fallback if baseLatency is not available (in seconds)
export const FALLBACK_BASE_LATENCY = 0.2; // 200ms - typical hardware output delay

export const DEBUG_BUNDLE = true;

export const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
