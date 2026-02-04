// networking.js - WebSocket Management
// Handles price and music WebSocket connections and data streaming

import {
  SUB_STEP_COUNT, SUB_STEP_SECONDS, MAX_BUNDLE_QUEUE, DEBUG_BUNDLE
} from './config.js';
import {
  priceSocket, setPriceSocket,
  musicSocket, setMusicSocket,
  isPlaying,
  bundleQueue, uiEvents,
  nextVisualStartTime, setNextVisualStartTime,
  lastDebugTick, setLastDebugTick,
  lastMessageLog, setLastMessageLog,
  buildAnnounced, setBuildAnnounced,
  setDivergenceActive,
  priceAnchors
} from './state.js';
import { logLine, updateStatus, elements } from './ui.js';
import { addVisualBundle, addAnchor, formatRootOffset } from './visualizer.js';
import { handleLegacyTick } from './legacyHandler.js';

export const setConfig = async (sensitivityValue, priceNoiseValue, sopranoRhythmValue, bassRhythmValue, trendCycleValue, chordProgressionValue) => {
  const { sensitivityValueEl, priceNoiseValueEl } = elements;
  
  if (sensitivityValueEl) {
    sensitivityValueEl.textContent = `${Number(sensitivityValue).toFixed(1)}x`;
  }
  if (priceNoiseValueEl) {
    priceNoiseValueEl.textContent = `${Number(priceNoiseValue).toFixed(1)}x`;
  }
  
  try {
    const response = await fetch("config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sensitivity: Number(sensitivityValue),
        price_noise: Number(priceNoiseValue),
        soprano_rhythm: Number(sopranoRhythmValue ?? 8),
        bass_rhythm: Number(bassRhythmValue ?? 2),
        trend_cycle: Number(trendCycleValue ?? 40),
        chord_progression: chordProgressionValue ?? "classical",
      }),
    });
    if (!response.ok) {
      logLine(`Config update failed (${response.status})`);
      return;
    }
    const data = await response.json();
    if (data?.sensitivity !== undefined) {
      logLine(
        `Progression: ${data.chord_progression} | Cycle: ${data.trend_cycle}s`
      );
    }
  } catch (error) {
    logLine(`Config update error: ${error.message}`);
  }
};

// Get base path from current location (e.g., /market_inventions)
const getBasePath = () => {
  const path = window.location.pathname;
  // Remove trailing slash and /index.html if present
  return path.replace(/\/(index\.html)?$/, '');
};

export const connectPriceSocket = () => {
  const currentSocket = priceSocket;
  if (currentSocket) {
    currentSocket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const basePath = getBasePath();
  const socket = new WebSocket(`${protocol}://${window.location.host}${basePath}/ws/prices`);
  setPriceSocket(socket);

  socket.addEventListener("open", () => {
    updateStatus("Price Stream Active");
    logLine("📊 Price stream connected");
  });

  socket.addEventListener("close", () => {
    logLine("📊 Price stream disconnected - reconnecting...");
    setTimeout(connectPriceSocket, 2000);
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    const { qqq_prices, spy_prices, qqq_current, spy_current } = data;

    const { qqqPriceEl, spyPriceEl } = elements;
    if (qqq_current && qqqPriceEl) qqqPriceEl.textContent = `$${qqq_current}`;
    if (spy_current && spyPriceEl) spyPriceEl.textContent = `$${spy_current}`;

    // Add price anchors for visualization ONLY when music is NOT playing
    if (!isPlaying && Array.isArray(qqq_prices) && qqq_prices.length > 0) {
      const now = performance.now();
      for (let i = 0; i < qqq_prices.length; i++) {
        if (i % SUB_STEP_COUNT === 0) {
          const offsetSeconds = i * SUB_STEP_SECONDS;
          const eventTime = now + offsetSeconds * 1000;
          const fakeTick = Math.floor(now / (SUB_STEP_SECONDS * 1000)) + i;

          if (qqq_prices[i]) addAnchor("soprano", qqq_prices[i], fakeTick, eventTime);
          if (spy_prices && spy_prices[i]) addAnchor("bass", spy_prices[i], fakeTick, eventTime);
        }
      }
    }
  });
};

export const connectMusicSocket = (toggleQqq, toggleSpy, sopranoRhythmSelect) => {
  const currentSocket = musicSocket;
  if (currentSocket) {
    currentSocket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const basePath = getBasePath();
  const socket = new WebSocket(`${protocol}://${window.location.host}${basePath}/ws/music`);
  setMusicSocket(socket);

  socket.addEventListener("open", () => {
    updateStatus("Music Connected");
    logLine("🎵 Music stream connected");
  });

  socket.addEventListener("close", () => {
    logLine("🎵 Music stream disconnected");
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    const {
      soprano_midi,
      bass_midi,
      soprano_bundle,
      bass_bundle,
      qqq_prices,
      spy_prices,
      qqq_note_prices,
      spy_note_prices,
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
      start_tick,
    } = data;

    const now = Date.now();
    if (DEBUG_BUNDLE && now - lastMessageLog > 1000) {
      setLastMessageLog(now);
      const keys = Object.keys(data || {}).slice(0, 12).join(", ");
      logLine(`Message keys: ${keys}`);
    }

    if (
      Array.isArray(soprano_bundle) &&
      Array.isArray(qqq_prices) &&
      soprano_bundle.length === qqq_prices.length
    ) {
      const regimeKey = String(regime || "").toUpperCase();
      if (!buildAnnounced) {
        setBuildAnnounced(true);
        if (build_id) {
          logLine(`Build: ${build_id}`);
          updateStatus(`Connected (${build_id})`);
        } else {
          logLine("Build: missing (bundle payload)");
          updateStatus("Connected (build id missing)");
        }
      }

      const bundleDuration = soprano_bundle.length * SUB_STEP_SECONDS;

      if (bundleQueue.length === 0 || nextVisualStartTime < Tone.Transport.seconds) {
        setNextVisualStartTime(Tone.Transport.seconds);
      }

      const visualStartTimeMs = nextVisualStartTime * 1000;

      const safeSpyPrices =
        Array.isArray(spy_prices) && spy_prices.length === qqq_prices.length
          ? spy_prices
          : new Array(qqq_prices.length).fill(undefined);
      const safeQqqNotePrices =
        Array.isArray(qqq_note_prices) &&
        qqq_note_prices.length === qqq_prices.length
          ? qqq_note_prices
          : qqq_prices;
      const safeSpyNotePrices =
        Array.isArray(spy_note_prices) &&
        spy_note_prices.length === qqq_prices.length
          ? spy_note_prices
          : new Array(qqq_prices.length).fill(undefined);

      const realTimeNow = performance.now();
      addVisualBundle(
        {
          soprano_bundle,
          bass_bundle,
          qqq_prices,
          spy_prices: safeSpyPrices,
          qqq_note_prices: safeQqqNotePrices,
          spy_note_prices: safeSpyNotePrices,
          start_tick,
        },
        visualStartTimeMs,
        realTimeNow
      );

      const rootDisplay = formatRootOffset(root_offset);
      const lastIndex = soprano_bundle.length - 1;
      const lastSoprano = lastIndex >= 0 ? soprano_bundle[lastIndex] : undefined;
      const lastBass = Array.isArray(bass_bundle) && lastIndex >= 0 ? bass_bundle[lastIndex] : undefined;

      uiEvents.push({
        time: visualStartTimeMs,
        regime: regimeKey,
        chord: chord,
        rootOffset: rootDisplay.offset,
        rootOffsetNote: rootDisplay.note,
        qqqPrice: qqq_price,
        spyPrice: spy_price,
        tick: start_tick,
        rvol: rvol,
        soprano: lastSoprano,
        bass: lastBass
      });

      if (uiEvents.length > 50) {
        uiEvents.shift();
      }

      setNextVisualStartTime(nextVisualStartTime + bundleDuration);

      bundleQueue.push({
        soprano_bundle,
        bass_bundle,
        qqq_prices,
        spy_prices: safeSpyPrices,
        qqq_note_prices: safeQqqNotePrices,
        spy_note_prices: safeSpyNotePrices,
        start_tick,
        divergence,
      });

      if (bundleQueue.length > MAX_BUNDLE_QUEUE) {
        bundleQueue.shift();
      }

      if (DEBUG_BUNDLE && start_tick !== lastDebugTick) {
        setLastDebugTick(start_tick);
        logLine(`Bundle ${start_tick}: VisualAnchor ${nextVisualStartTime.toFixed(2)}s`);
      }

      setDivergenceActive(Boolean(divergence));
      return;
    }

    if (soprano_midi !== undefined || bass_midi !== undefined) {
      handleLegacyTick({
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
      }, toggleQqq, toggleSpy);
    } else if (DEBUG_BUNDLE) {
      logLine("Message missing bundle/legacy note fields.");
    }
  });
};

export const fetchBuildId = async () => {
  const { buildIdEl, buildRuntimeEl } = elements;
  if (!buildIdEl) {
    return;
  }
  try {
    const response = await fetch("build");
    if (!response.ok) {
      logLine(`Build fetch failed (${response.status})`);
      return;
    }
    const data = await response.json();
    if (data?.build_id) {
      buildIdEl.textContent = data.build_id;
      if (buildRuntimeEl && data?.server_time) {
        buildRuntimeEl.textContent = data.server_time;
      }
      logLine(`Build (http): ${data.build_id}`);
    } else {
      logLine("Build (http): missing build_id");
    }
  } catch (error) {
    logLine(`Build fetch error: ${error.message}`);
  }
};
