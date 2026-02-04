// state.js - Reactive Application State
// Single source of truth for the application's runtime state

// WebSocket connections
export let priceSocket = null;
export let musicSocket = null;

// Audio samplers
export let sopranoSampler = null;
export let bassSampler = null;

// Playback state
export let isPlaying = false;
export let loadCounter = 0;
export let transportLoop = null;
export let transportStarted = false;

// Sync parameters (tunable via UI sliders)
export let syncOffsetMs = 1670; // Total milliseconds to subtract from visual timeline
export let glowDurationUnits = 3; // How many 16th-note units the glow lasts
export let futureVisibilityMs = 2000; // How far ahead (in ms) future notes are visible

// Data queues
export const bundleQueue = [];
export let uiEvents = []; // Queue for Regime, Chord, and Price text updates
export let nextVisualStartTime = 0; // Persistent anchor for visual timing

// Note and anchor data for visualization
export const noteEvents = [];
export const priceAnchors = {
  soprano: [],
  bass: [],
};

// Debug/status tracking
export let lastDebugTick = null;
export let lastMessageLog = 0;
export let buildAnnounced = false;
export let divergenceActive = false;

// Track last played notes across bundles to prevent retriggering
export let lastPlayedSoprano = null;
export let lastPlayedBass = null;

// Setters for mutable state
export const setPriceSocket = (socket) => { priceSocket = socket; };
export const setMusicSocket = (socket) => { musicSocket = socket; };
export const setSopranoSampler = (sampler) => { sopranoSampler = sampler; };
export const setBassSampler = (sampler) => { bassSampler = sampler; };
export const setIsPlaying = (value) => { isPlaying = value; };
export const incrementLoadCounter = () => { loadCounter += 1; return loadCounter; };
export const getLoadCounter = () => loadCounter;
export const setTransportLoop = (loop) => { transportLoop = loop; };
export const setTransportStarted = (value) => { transportStarted = value; };
export const setSyncOffsetMs = (value) => { syncOffsetMs = value; };
export const setGlowDurationUnits = (value) => { glowDurationUnits = value; };
export const setFutureVisibilityMs = (value) => { futureVisibilityMs = value; };
export const setNextVisualStartTime = (value) => { nextVisualStartTime = value; };
export const setLastDebugTick = (value) => { lastDebugTick = value; };
export const setLastMessageLog = (value) => { lastMessageLog = value; };
export const setBuildAnnounced = (value) => { buildAnnounced = value; };
export const setDivergenceActive = (value) => { divergenceActive = value; };
export const setLastPlayedSoprano = (value) => { lastPlayedSoprano = value; };
export const setLastPlayedBass = (value) => { lastPlayedBass = value; };

// Clear queues
export const clearBundleQueue = () => { bundleQueue.length = 0; };
export const clearUIEvents = () => { uiEvents.length = 0; };

// Reset state for fresh playback
export const resetPlaybackState = () => {
  loadCounter += 1;
  isPlaying = false;
  transportStarted = false;
  bundleQueue.length = 0;
  uiEvents.length = 0;
  lastPlayedSoprano = null;
  lastPlayedBass = null;
  nextVisualStartTime = 0;
};
