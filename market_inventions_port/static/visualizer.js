// visualizer.js - Canvas Rendering
// Handles piano roll visualization, price lines, and note drawing

import {
  noteConfig, playheadFraction, playheadColors, canvasBackground,
  SUB_STEP_COUNT, SUB_STEP_SECONDS, noteNames
} from './config.js';
import {
  noteEvents, priceAnchors,
  isPlaying, transportStarted,
  syncOffsetMs, glowDurationUnits, futureVisibilityMs,
  divergenceActive
} from './state.js';
import { processUIUpdates, elements } from './ui.js';

// Canvas elements
let canvas = null;
let canvasCtx = null;

export const initCanvas = () => {
  canvas = document.getElementById("piano-roll");
  canvasCtx = canvas.getContext("2d");
};

export const getCanvas = () => canvas;
export const getCanvasCtx = () => canvasCtx;

export const scaleY = (value, min, max, top, bottom) => {
  if (max - min < 0.001) {
    return (top + bottom) / 2;
  }
  const ratio = (value - min) / (max - min);
  return bottom - ratio * (bottom - top);
};

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const midiToNoteName = (midi) => {
  if (midi === undefined || midi === null || Number.isNaN(midi)) {
    return "--";
  }
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[pitchClass]}${octave}`;
};

export const formatRootOffset = (rootOffset) => {
  if (rootOffset === undefined || rootOffset === null) {
    return { offset: "--", note: "--" };
  }
  const rootMidi = 60 + Number(rootOffset);
  return { offset: rootOffset, note: midiToNoteName(rootMidi) };
};

export const addNoteEvent = (midi, voice, price, tick, offset, eventTime, durationUnits = 1) => {
  const startTime = eventTime ?? performance.now();
  const durationMs = durationUnits * SUB_STEP_SECONDS * 1000;
  const endTime = startTime + durationMs;

  noteEvents.push({
    midi,
    voice,
    price,
    tick,
    offset,
    time: startTime,
    endTime,
    durationUnits,
  });
  if (noteEvents.length > 400) {
    noteEvents.splice(0, noteEvents.length - 400);
  }
};

export const addAnchor = (voice, price, tick, eventTime) => {
  priceAnchors[voice].push({
    price,
    tick,
    time: eventTime ?? performance.now(),
  });
  if (priceAnchors[voice].length > 120) {
    priceAnchors[voice].splice(0, priceAnchors[voice].length - 120);
  }
};

export const addVisualBundle = (bundle, baseTransportTimeMs, realTimeBaseMs) => {
  let prevSopranoMidi = null;
  let prevBassMidi = null;
  let sopranoNoteRef = null;
  let bassNoteRef = null;

  const priceTimeBase = realTimeBaseMs ?? performance.now();

  for (let i = 0; i < bundle.soprano_bundle.length; i++) {
    const offsetMs = i * SUB_STEP_SECONDS * 1000;
    const eventTime = baseTransportTimeMs + offsetMs;
    const priceEventTime = priceTimeBase + offsetMs;
    const tick = (bundle.start_tick ?? 0) + i;

    // --- Soprano Processing ---
    const sopranoMidi = bundle.soprano_bundle[i];
    if (sopranoMidi !== null && sopranoMidi !== undefined && sopranoMidi !== prevSopranoMidi) {
      if (sopranoNoteRef) {
        sopranoNoteRef.endTime = eventTime;
      }

      sopranoNoteRef = {
        midi: sopranoMidi,
        voice: "soprano",
        price: bundle.qqq_note_prices[i],
        tick: tick,
        time: eventTime,
        endTime: eventTime + (SUB_STEP_SECONDS * 1000),
        durationUnits: 1
      };
      noteEvents.push(sopranoNoteRef);
      prevSopranoMidi = sopranoMidi;
    } else if (sopranoMidi === prevSopranoMidi && sopranoNoteRef) {
      sopranoNoteRef.durationUnits++;
      sopranoNoteRef.endTime += (SUB_STEP_SECONDS * 1000);
    }

    // --- Bass Processing ---
    const bassMidi = bundle.bass_bundle ? bundle.bass_bundle[i] : null;
    if (bassMidi !== null && bassMidi !== undefined && bassMidi !== prevBassMidi) {
      if (bassNoteRef) {
        bassNoteRef.endTime = eventTime;
      }
      bassNoteRef = {
        midi: bassMidi,
        voice: "bass",
        price: bundle.spy_note_prices ? bundle.spy_note_prices[i] : null,
        tick: tick,
        time: eventTime,
        endTime: eventTime + (SUB_STEP_SECONDS * 1000),
        durationUnits: 1
      };
      noteEvents.push(bassNoteRef);
      prevBassMidi = bassMidi;
    } else if (bassMidi === prevBassMidi && bassNoteRef) {
      bassNoteRef.durationUnits++;
      bassNoteRef.endTime += (SUB_STEP_SECONDS * 1000);
    }

    // --- Price Anchors (use real-world time, NOT Transport time) ---
    if (tick % SUB_STEP_COUNT === 0) {
      if (bundle.qqq_prices && bundle.qqq_prices[i] !== undefined) {
        addAnchor("soprano", bundle.qqq_prices[i], tick, priceEventTime);
      }
      if (bundle.spy_prices && bundle.spy_prices[i] !== undefined) {
        addAnchor("bass", bundle.spy_prices[i], tick, priceEventTime);
      }
    }
  }

  if (noteEvents.length > 500) {
    noteEvents.splice(0, noteEvents.length - 500);
  }
};

const filterRecent = (events, now, maxMs = 15000) =>
  events.filter((event) => now - event.time <= maxMs);

const drawPriceLine = (events, min, max, top, bottom, color) => {
  if (events.length < 2) {
    return;
  }
  const realNow = performance.now();
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 2;
  canvasCtx.beginPath();
  events.forEach((event, index) => {
    const secondsFromNow = (event.time - realNow) / 1000;
    const x = (canvas.clientWidth * playheadFraction) +
      secondsFromNow * noteConfig.pixelsPerSecond;
    const y = scaleY(event.price, min, max, top, bottom);
    if (index === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
  });
  canvasCtx.stroke();
};

// Helper to round to "nice" increment values
const getNiceIncrement = (rawIncrement) => {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawIncrement)));
  const normalized = rawIncrement / magnitude;

  let nice;
  if (normalized < 1.5) {
    nice = 1;
  } else if (normalized < 2.25) {
    nice = 2;
  } else if (normalized < 3.5) {
    nice = 2.5;
  } else if (normalized < 7.5) {
    nice = 5;
  } else {
    nice = 10;
  }

  return nice * magnitude;
};

// Helper function to draw graduated price labels with constant pixel spacing
const drawPriceLabels = (min, max, top, bottom, color, side, ticker, width) => {
  canvasCtx.fillStyle = color;
  canvasCtx.textAlign = side;

  const verticalHeight = Math.abs(bottom - top);
  const targetSpacing = 40;
  const maxLabels = Math.floor(verticalHeight / targetSpacing);

  if (maxLabels < 2) {
    const xPos = side === "left" ? 8 : width - 8;
    canvasCtx.fillText(min.toFixed(2), xPos, bottom - 4);
    canvasCtx.fillText(max.toFixed(2), xPos, top + 12);
    return;
  }

  const range = max - min;
  const rawIncrement = range / (maxLabels - 1);
  const increment = getNiceIncrement(rawIncrement);

  const startPrice = Math.floor(min / increment) * increment;
  const endPrice = Math.ceil(max / increment) * increment;

  for (let price = startPrice; price <= endPrice; price += increment) {
    if (price < min - increment * 0.1 || price > max + increment * 0.1) continue;

    const y = scaleY(price, min, max, top, bottom);
    const xPos = side === "left" ? 8 : width - 8;

    canvasCtx.fillText(price.toFixed(2), xPos, y + 4);
  }

  canvasCtx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  const tickerXPos = side === "left" ? 8 : width - 8;
  canvasCtx.fillText(ticker, tickerXPos, top - 6);
  canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
};

// Helper function to draw current price highlight with dotted line
const drawCurrentPriceHighlight = (currentPrice, min, max, top, bottom, color, side, width, playheadX) => {
  if (!currentPrice || currentPrice < min || currentPrice > max) return;

  const y = scaleY(currentPrice, min, max, top, bottom);
  const labelWidth = 60;
  const labelHeight = 18;

  const labelY = Math.max(top + labelHeight / 2, Math.min(bottom - labelHeight / 2, y));

  const lineStart = side === "left" ? labelWidth + 8 : width - labelWidth - 8;
  const lineEnd = playheadX;

  canvasCtx.strokeStyle = color;
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.lineWidth = 1;
  canvasCtx.beginPath();
  canvasCtx.moveTo(lineStart, y);
  canvasCtx.lineTo(lineEnd, y);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);

  const boxX = side === "left" ? 8 : width - labelWidth - 8;
  canvasCtx.fillStyle = color;
  canvasCtx.fillRect(boxX, labelY - labelHeight / 2, labelWidth, labelHeight);

  canvasCtx.fillStyle = "#0a0b0d";
  canvasCtx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  canvasCtx.textAlign = "center";
  canvasCtx.fillText(currentPrice.toFixed(2), boxX + labelWidth / 2, labelY + 4);
  canvasCtx.textAlign = side;
};

export const drawVisualizer = (toggleNoteLabels) => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvasCtx.clearRect(0, 0, width, height);
  canvasCtx.fillStyle = divergenceActive
    ? canvasBackground.alert
    : canvasBackground.normal;
  canvasCtx.fillRect(0, 0, width, height);

  // Use Tone.Transport clock when playing, performance.now() when stopped
  let now;
  if (isPlaying && transportStarted) {
    now = (Tone.Transport.seconds * 1000) - syncOffsetMs;
  } else {
    now = performance.now();
  }

  processUIUpdates(now);

  const playheadX = width * playheadFraction;
  const visibleEvents = filterRecent(noteEvents, now);
  const qqqEvents = visibleEvents.filter((event) => event.voice === "soprano");
  const spyEvents = visibleEvents.filter((event) => event.voice === "bass");
  const visibleMidis = visibleEvents
    .map((event) => event.midi)
    .filter((value) => value !== null && value !== undefined);
  const rawMinMidi = visibleMidis.length
    ? Math.min(...visibleMidis)
    : noteConfig.minMidi;
  const rawMaxMidi = visibleMidis.length
    ? Math.max(...visibleMidis)
    : noteConfig.maxMidi;
  const midiPadding = 3;
  const noteMin = clamp(
    rawMinMidi - midiPadding,
    noteConfig.minDisplayMidi,
    noteConfig.maxDisplayMidi
  );
  const noteMax = clamp(
    rawMaxMidi + midiPadding,
    noteConfig.minDisplayMidi,
    noteConfig.maxDisplayMidi
  );

  const realNow = performance.now();
  const qqqAnchors = filterRecent(priceAnchors.soprano, realNow);
  const spyAnchors = filterRecent(priceAnchors.bass, realNow);

  const qqqPrices = [
    ...qqqAnchors.map((event) => event.price),
    ...qqqEvents.map((event) => event.price).filter((price) => price !== undefined),
  ];
  const spyPrices = [
    ...spyAnchors.map((event) => event.price),
    ...spyEvents.map((event) => event.price).filter((price) => price !== undefined),
  ];
  const qqqMin = qqqPrices.length ? Math.min(...qqqPrices) : 420;
  const qqqMax = qqqPrices.length ? Math.max(...qqqPrices) : 440;
  const spyMin = spyPrices.length ? Math.min(...spyPrices) : 500;
  const spyMax = spyPrices.length ? Math.max(...spyPrices) : 520;

  const lanePadding = 16;
  const bottomAxisReserve = 56;
  const mid = height / 2;
  const qqqTop = lanePadding;
  const qqqBottom = mid - lanePadding;
  const spyTop = mid + lanePadding;
  const spyBottom = height - bottomAxisReserve;

  drawPriceLine(
    qqqAnchors,
    qqqMin,
    qqqMax,
    qqqTop,
    qqqBottom,
    "rgba(124, 255, 194, 0.35)"
  );
  drawPriceLine(
    spyAnchors,
    spyMin,
    spyMax,
    spyTop,
    spyBottom,
    "rgba(122, 167, 255, 0.35)"
  );

  for (const event of visibleEvents) {
    const msFromNow = event.time - now;
    const secondsFromNow = msFromNow / 1000;

    if (msFromNow > futureVisibilityMs) {
      continue;
    }

    const x = playheadX + secondsFromNow * noteConfig.pixelsPerSecond;

    if (x < -200 || x > width + 200) {
      continue;
    }

    // Position notes by PRICE (not MIDI) so they dance around the price line
    // This keeps notes visually aligned with the price they represent
    const notePrice = event.price;
    let y;
    if (event.voice === "soprano") {
      // Use price scaling so notes stay near the QQQ price line
      y = notePrice !== undefined 
        ? scaleY(notePrice, qqqMin, qqqMax, qqqTop, qqqBottom)
        : scaleY(clamp(event.midi, noteMin, noteMax), noteMin, noteMax, qqqTop, qqqBottom);
    } else {
      // Use price scaling so notes stay near the SPY price line
      y = notePrice !== undefined
        ? scaleY(notePrice, spyMin, spyMax, spyTop, spyBottom)
        : scaleY(clamp(event.midi, noteMin, noteMax), noteMin, noteMax, spyTop, spyBottom);
    }

    const glowDurationMs = glowDurationUnits * SUB_STEP_SECONDS * 1000;
    const isNoteActive = now >= event.time && now <= (event.time + glowDurationMs);

    if (isNoteActive) {
      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.shadowColor = event.voice === "soprano" ? noteConfig.sopranoColor : noteConfig.bassColor;
      canvasCtx.shadowBlur = 15;
    } else {
      canvasCtx.fillStyle = event.voice === "soprano" ? noteConfig.sopranoColor : noteConfig.bassColor;
      canvasCtx.shadowBlur = 0;
    }

    const noteDurationMs = (event.endTime || (event.time + SUB_STEP_SECONDS * 1000)) - event.time;
    const noteWidth = (noteDurationMs / 1000) * noteConfig.pixelsPerSecond;
    const noteHeight = isNoteActive ? 10 : 6;
    canvasCtx.fillRect(x, y - (noteHeight / 2), noteWidth, noteHeight);
    canvasCtx.shadowBlur = 0;

    if (toggleNoteLabels?.checked) {
      canvasCtx.fillStyle =
        event.voice === "soprano"
          ? "rgba(124, 255, 194, 0.8)"
          : "rgba(122, 167, 255, 0.8)";
      canvasCtx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      canvasCtx.textAlign = "center";
      canvasCtx.textBaseline = "top";
      canvasCtx.fillText(midiToNoteName(event.midi), x + noteWidth / 2, y + 6);
    }
  }

  canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, mid);
  canvasCtx.lineTo(width, mid);
  canvasCtx.stroke();

  // Y-axis price labels
  canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";

  drawPriceLabels(spyMin, spyMax, spyTop, spyBottom, noteConfig.bassColor, "right", "SPY", width);
  drawPriceLabels(qqqMin, qqqMax, qqqTop, qqqBottom, noteConfig.sopranoColor, "right", "QQQ", width);

  const latestQqqAnchor = qqqAnchors[qqqAnchors.length - 1];
  const latestSpyAnchor = spyAnchors[spyAnchors.length - 1];

  if (latestQqqAnchor) {
    drawCurrentPriceHighlight(latestQqqAnchor.price, qqqMin, qqqMax, qqqTop, qqqBottom, noteConfig.sopranoColor, "right", width, playheadX);
  }

  if (latestSpyAnchor) {
    drawCurrentPriceHighlight(latestSpyAnchor.price, spyMin, spyMax, spyTop, spyBottom, noteConfig.bassColor, "right", width, playheadX);
  }

  // X-axis time labels
  canvasCtx.textAlign = "center";
  canvasCtx.textBaseline = "bottom";
  canvasCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
  canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";

  const visibleTimeRange = width / noteConfig.pixelsPerSecond;
  const labelIntervalSeconds = 1;

  const currentTime = new Date();

  const startSeconds = Math.floor(-playheadX / noteConfig.pixelsPerSecond);
  const endSeconds = Math.ceil(visibleTimeRange + Math.abs(startSeconds));

  const xAxisY = height - 18;

  for (let sec = startSeconds; sec <= endSeconds; sec += labelIntervalSeconds) {
    const x = playheadX + (sec * noteConfig.pixelsPerSecond);
    if (x < 0 || x > width) {
      continue;
    }

    const timeAtPosition = new Date(currentTime.getTime() + (sec * 1000));

    const hours = String(timeAtPosition.getHours()).padStart(2, '0');
    const minutes = String(timeAtPosition.getMinutes()).padStart(2, '0');
    const seconds = String(timeAtPosition.getSeconds()).padStart(2, '0');
    const timeLabel = `${hours}:${minutes}:${seconds}`;

    if (sec === 0) {
      canvasCtx.fillStyle = "rgba(0, 255, 153, 0.9)";
      canvasCtx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      canvasCtx.fillText(timeLabel, x, xAxisY);
      canvasCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
      canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    } else {
      canvasCtx.fillText(timeLabel, x, xAxisY);
    }
  }

  canvasCtx.strokeStyle = divergenceActive
    ? playheadColors.alert
    : playheadColors.normal;
  canvasCtx.beginPath();
  canvasCtx.moveTo(playheadX, 0);
  canvasCtx.lineTo(playheadX, height);
  canvasCtx.stroke();

  for (let i = noteEvents.length - 1; i >= 0; i -= 1) {
    if (now - noteEvents[i].time > 15000) {
      noteEvents.splice(0, i + 1);
      break;
    }
  }

  requestAnimationFrame(() => drawVisualizer(toggleNoteLabels));
};

export const resizeCanvas = () => {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  canvasCtx.setTransform(scale, 0, 0, scale, 0, 0);
};
