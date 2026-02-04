Here is your **Market Inventions** requirements document, properly reformatted with Markdown to be clean, scannable, and ready for use in Cursor or any other editor.

---

# Project: Bach Market Invention Engine (BMIE)

## 0. CRITICAL ARCHITECTURAL PRINCIPLE

**⚠️ MANDATORY SEPARATION OF CONCERNS ⚠️**

The system MUST maintain complete decoupling between:

### **Price Data Layer** (Primary)
- **Purpose**: Generate and stream market price data (QQQ, SPY)
- **Independence**: Runs continuously from page load, REGARDLESS of audio state
- **Visibility**: Price lines MUST display immediately on page load without any user interaction
- **Stream**: WebSocket streams price data continuously, whether music is playing or not

### **Music Generation Layer** (Secondary)
- **Purpose**: Consume price data and generate musical notes/MIDI
- **Dependency**: Reads from the Price Data Layer as input
- **User Control**: Only activates when user clicks "Start Audio"
- **Independence**: Can be stopped/started without affecting price data stream

**RULE**: Price generation code MUST NEVER be inside or dependent on music generation code. Price data is the source of truth. Music is an optional interpretation layer.

**Test**: Opening the web page should immediately show continuously updating price lines, even if "Start Audio" is never clicked.

---

## 0B. CRITICAL MUSICAL NOTATION PRINCIPLE

**⚠️ MANDATORY: CONSISTENT NOTE POSITIONING ⚠️**

### **Musical Pitch Consistency (Non-Negotiable)**

In standard music notation, **vertical position = pitch**. This principle MUST be maintained:

- **Same MIDI Note = Same Vertical Position**: A C7 (MIDI 96) must ALWAYS appear at the exact same Y coordinate, regardless of when it occurs or what the price was
- **Higher Pitch = Higher Position**: MIDI 97 must be above MIDI 96, which must be above MIDI 95, etc.
- **Voice Lanes**: Each voice (Soprano/Bass) has its own vertical lane, but within each lane, pitch consistency is absolute

### **Implementation Rule**

Notes MUST be positioned based on their **MIDI pitch value**, NOT their associated price:

```javascript
// CORRECT: Position by MIDI pitch
const y = scaleY(event.midi, noteMin, noteMax, laneTop, laneBottom);

// WRONG: Position by price (breaks musical consistency)
const y = scaleY(event.price, priceMin, priceMax, laneTop, laneBottom);
```

### **Why This Matters**

1. **Musical Readability**: Musicians must be able to "read" the notation
2. **Pattern Recognition**: Melodic patterns become visually recognizable
3. **Educational Value**: The visualization teaches music theory
4. **Professional Standard**: Matches all music notation software

**Test**: Play the same note (e.g., C7) multiple times. All instances must align vertically at identical Y coordinates.

---

## 1. Project Overview

An algorithmic sonification engine that transforms real-time market data (SPY & QQQ) into a two-part Baroque-style counterpoint (Invention). The system maps market volatility, price trends, and asset correlation to musical regimes, harmonic progressions, and dynamic tempo.

---

## 2. Data Strategy

* **Primary Source (Soprano):** QQQ (Nasdaq 100) – drives melodic flourishes and high-frequency movement.
* **Secondary Source (Bass):** SPY (S&P 500) – drives the foundational counter-melody and harmonic floor.
* **Anchor:** Opening Range (OR) High/Low and Midpoint of the first  minutes of the session.
* **Normalization:** All price data converted to percentage distance from the OR Midpoint.
* **Step Sensitivity:** 1 semitone = 0.15% (QQQ) / 0.10% (SPY).


* **Pace:** Tempo (BPM) is driven by **Relative Volume (RVOL)**.

---

## 3. Musical Regime Matrix

The scale and "mood" shift based on the relationship between Price and its Exponential Moving Average (EMA), and Volatility (ATR or Bollinger Band width).

| Market State | Logic | Scale |
| --- | --- | --- |
| **Trending Up** |  | Major |
| **Trending Down** |  | Natural Minor |
| **Bullish Breakout** |  | Whole Tone |
| **Bearish Breakout** |  | Diminished |

---

## 4. Harmonic & Compositional Rules

* **Chromatic Level Shifts:** Every time price crosses a "Level" (defined by the Step Sensitivity), the global root shifts  semitone.
* **The Schmitt Trigger:** To prevent regime flickering, price must mean-revert 20% into the previous zone to "undo" a chromatic or scale shift.
* **The Harmonic Clock:** A modulo-16 counter. Each beat moves through a phase-dependent progression (e.g., ).
* **Voice Leading:** * **Rule of Minimal Distance:** .
* **Contour:** If , prioritize the next scale degree up.


* **Counterpoint:** Parallel motion (3rds/6ths) during high correlation; contrary/oblique motion during divergence.

---

## 5. Technical Stack

* **Backend:** Python (FastAPI).
* **Tasks:** EMA/Volatility calculations, Chromatic offset logic, Note selection.


* **Frontend:** React/Vanilla JS + **Tone.js**.
* **Tasks:** Web Audio synthesis (Sampler/PolySynth), 16th-note Transport scheduling, UI Visualization.


* **Communication:** WebSockets (FastAPI WebSocket) for low-latency streaming of note packets from Python to the Browser.

---

## 6. Implementation Logic Flow

1. **Ingest:** Python fetches tick data for SPY/QQQ.
2. **Analyze:** Determine Regime (Scale) and Chromatic Offset (Key).
3. **Compose:** * Select  (QQQ-driven, 16th-note resolution).
* Select  (SPY-driven, 8th-note resolution).


4. **Broadcast:** Send `{soprano_midi, bass_midi, rvol, regime}` packet via WebSocket.
5. **Perform:** Tone.js schedules the notes on the Transport clock, adjusting BPM based on **RVOL**.

---

## 7. Visual Data Acquisition (The "Optical" Module)
* **Method:** Screen-capture of a defined Bounding Box (ROI - Region of Interest).
* **Price Mapping:** * Top of ROI = Max Note.
    * Bottom of ROI = Min Note.
    * `y_pixel` position is normalized to the current scale degrees.
* **Velocity/Tempo:** * Calculate `abs(y_now - y_prev)`. 
    * If the distance is large, increase RVOL (Pace).
* **Regime Detection:** * Sample pixel colors at the lead price point. 
    * Green Pixels = Major/Whole Tone.
    * Red Pixels = Minor/Diminished.

---


## 8. Two-Part Counterpoint (Invention Logic)
* **Lead Voice (Soprano):** * Source: Ticker A (e.g., QQQ).
    * Rhythm: User-selectable (Quarter, Eighth, or Sixteenth notes).
    * Function: Melodic flourishes and regime definitions.
* **Secondary Voice (Bass):**
    * Source: Ticker B (e.g., SPY).
    * Rhythm: Quarter notes (fixed) for harmonic stability.
    * Function: Harmonic grounding and counter-motion.
* **Divergence Rules:**
    * If Ticker A and B are correlated: Force intervals of 3rds, 5ths, or 10ths.
    * If Ticker A and B diverge: Allow dissonant intervals (2nds, 7ths) that must resolve on the next "Harmonic Clock" beat.
* **Normalization:** Both tickers are normalized to their respective Opening Ranges to ensure they share the same "Middle C" starting point despite price differences.

---

## 9. Intermarket Normalization
* **Anchor Scaling:** All price inputs are converted to `ticks_from_open` using: 
  `delta_pct = (price - open) / open`.
* **Step Sensitivity:** `1 Step = 0.1%` (adjustable). This ensures that volatility is audible; a 2% "God Candle" results in a 20-semitone melodic leap.
* **Spatial Separation:** * **Soprano (Asset A):** Centers around MIDI 60-84.
    * **Bass (Asset B):** Centers around MIDI 36-54.
* **Consonance Filter:** * If `abs(Soprano - Bass) % 12` is a "Perfect Interval" (0, 7, 5), the market is in **Sync**.
    * If the interval is a "Tritone" or "Minor Second" (6, 1), the assets are **Diverging** or in a **Regime Shift**.

---

## 10. System Routing & Latency
* **MIDI Port:** Virtual MIDI Bus (Port Name: "Gemini Bach Port").
* **Clock Sync:** The system uses a 'soft-clock' driven by the `time.sleep()` function.
* **Volume-Tempo Curve:** * Exponential mapping: `Tempo = Base_BPM * (RVOL ^ 1.2)`. 
    * This makes high-volume "blow-off tops" sound significantly more frenetic.
* **Note Velocity:** * Soprano Velocity = 80 (to stand out).
    * Bass Velocity = 60 (to provide a background floor).

---

## 11. Web Interface Implementation
* **Audio Engine:** Tone.js (Web Audio API).
* **Scheduling:** Tone.Transport for millisecond-perfect 16th-note resolution.
* **Visualization:** * **The "Piano Roll" Chart:** A rolling canvas showing the notes being played.
    * **The "Regime Indicator":** Color-coded background (Green=Major, Purple=Whole Tone, Red=Minor, Gold=Diminished).
* **Data Transport:** Server-Sent Events (SSE) or WebSockets to push SPY/QQQ updates from the Python backend to the UI.

---

## 12. UI Controls & Sound Management
* **Transport Control:** The app must start with the audio engine 'suspended'. A 'Start' button must trigger `Tone.start()`.
* **Sample Management:** * Provide at least 3 distinct "Baroque" sounds: Harpsichord, Pipe Organ, and Strings.
    * Use a Loading indicator or disable the Play button until samples are fully cached.
* **Stop Function:** When stopped, clear all scheduled notes and silence the Sampler immediately using `sampler.releaseAll()`.

---

## 13. Active Timeline Visualization
* **Playhead:** A fixed vertical line at 50% X-axis (implemented).
* **Scroll Direction:** Notes enter from the right (future) and move left (past).
* **Audio-Visual Sync:** Sound triggers when notes are scheduled, with visual events timestamped to match audio timing.
* **Price Line Display:** Semi-transparent price lines for both QQQ (green, top) and SPY (blue, bottom) show market movement.
* **Note Rendering:** Notes rendered as rectangular blocks positioned at the price they represent, color-coded by voice.

---


## 14. Harmonic Intelligence & Alerting
* **Cadence Logic:** The engine must resolve to 'home' tones every 16 beats to provide rhythmic structure.
* **Divergence Monitoring:** Audible dissonance (Tritones/Minor Seconds) is triggered when SPY and QQQ correlation breaks.
* **Minimal Jump Constraint:** Melodic leaps are capped at 5 semitones per tick to ensure "Bach-style" smoothness, regardless of price volatility.

--- 

## 15. The "Tritone" Divergence Alert
* **Logic:** Calculate `interval % 12` between Soprano and Bass.
* **Alert Trigger:** If interval is 1, 6, or 11, set `divergence = true`.
* **Audio Response:** Apply a -100 cent detune or a BitCrusher effect to symbolize "Market Friction."
* **Visual Response:** The Playhead line must pulse Red, and the background of the canvas should darken.

--- 

## 16. Dual-Channel Control & Multi-Axis UI
* **Default State:** Initial instrument set to `Electric Organ` for both channels.
* **Instrument Options:** Electric Organ, Harpsichord, Pipe Organ, Strings, Flute (both channels independently selectable).
* **X-Axis Units:** * 1 Unit = 1 Tick (16th Note).
    * 4 Units = 1 Second (Quarter Note). 
    * Labels appear every 16 ticks (1s, 2s, 3s...).
* **Dual Y-Axes:** * **Right:** QQQ Price Scale (tied to Soprano).
    * **Left:** SPY Price Scale (tied to Bass).
    * Scales auto-range based on the min/max price in visible window.
* **Visibility Toggles:** Checkboxes per ticker that control:
    * Audio output (mute sampler)
    * Visual rendering (hide note blocks)
* **Note Labels Toggle:** Optional display of MIDI note names (e.g., "C4", "G5") above note blocks.


--- 

## 17. Integrated Market Score Visualization
* **Price Layer:** A 1-second snapshot line chart for both SPY and QQQ.
* **Note Layer:** Superimposed 16th-note MIDI blocks.
* **X-Axis Granularity:** * 1 Second = 1 major grid line (Quarter Note).
    * 16 Notes per grid line (16th Note resolution).
* **Dual Y-Axes Scaling:** * Left axis auto-scales to SPY 1-second snapshots.
    * Right axis auto-scales to QQQ 1-second snapshots.
* **Visual Hierarchy:** Price lines are semi-transparent; musical notes are high-contrast and opaque.

--- 

## 18. Sub-Second Melodic Fluidity
* **Path Interpolation:** Notes must follow a linear interpolation (LERP) between 1-second snapshots to avoid "blocky" melodic movement.
* **Arpeggiation:** If price is flat, the 16th notes should arpeggiate through the active chord (Root-3rd-5th-3rd) rather than repeating the same pitch.
* **Counterpoint Density:** * Soprano: High density (16th notes).
    * Bass: Lower density (8th or Quarter notes) to provide a stable harmonic floor.

--- 
## 19. Precision Temporal Sync
* **Clock Source:** Tone.Transport (Sample-accurate) set to 60 BPM.
* **Data Delivery:** 16-note JSON bundles delivered via WebSocket every 1000ms.
* **Sub-Second Interpolation:** Linear interpolation (LERP) between 1s price snapshots to determine the "Melodic Axis."
* **Patterning:** 16th-note figurate arpeggios applied to the interpolated axis to ensure continuous melodic movement.

--- 
## 20. Elimination of Note Stagnation
* **Mandatory Movement:** No more than 2 consecutive 16th notes may share the same pitch unless the price is exactly at a scale degree boundary.
* **Pattern Injection:** The 16-step Arpeggio pattern must be added to the LERP-interpolated MIDI anchor for every sub-step.
* **Hocketing:** Soprano (QQQ) and Bass (SPY) must have different rhythmic densities (16th vs 4th notes).

--- 
## 21. Real-Time Volatility Control
* **Slider Range:** 0% (Static) to 100% (Extreme Volatility/Market Crash simulation).
* **Audio Correlation:** High volatility increases the velocity and octave-range of the Sampler notes.
* **Visual Correlation:** The 'Note Beads' on the canvas should vibrate further away from the central 'Price Line' as volatility increases.

--- 

## 22. Dynamic Range Tracking & Ceiling Fix
* **Unclamped Target Tracking:** The engine tracks price movements using an unclamped raw MIDI target, even when the price exceeds the audible range. This ensures immediate response when price reverses from extremes.
* **Dynamic Range Centering:** The note selection range (soprano: ±12 semitones, bass: ±10 semitones) dynamically centers around the current price position, not the opening price. This prevents "ceiling lock" and "floor lock" issues.
* **Visual-Audio Alignment:** Note visual positions are calculated relative to the dynamic range center, ensuring notes always appear at their correct price positions regardless of how far the price has drifted from the opening.
* **Sensitivity-Based Repeat Penalty:** 
    * At sensitivity ≥ 5.0: Repeat penalty is disabled (0.0) for 1:1 price tracking
    * At sensitivity < 5.0: Repeat penalty is 0.2 for musical smoothness
* **Range Constraints:**
    * Soprano: Centered on current price, clamped to MIDI 36-108 (hard limits)
    * Bass: Centered on current price, clamped to MIDI 24-72 (hard limits)
    * Both ranges expand/contract dynamically each second based on price movement

--- 

## 23. Rhythm Control Interface
* **QQQ Rhythm Selector:** Dropdown control with three options:
    * Quarter Notes (1/4) - 4 notes per second, longest sustain
    * Eighth Notes (1/8) - 8 notes per second, moderate sustain
    * Sixteenth Notes (1/16) - 16 notes per second, shortest sustain (default)
* **Implementation:** New notes are generated only at rhythm boundaries; between boundaries, the previous note is held. This creates a "stepped" melodic contour at lower rhythmic densities.
* **Audio Duration Sync:** Tone.js note duration automatically matches the selected rhythm (4n, 8n, or 16n).
* **Real-Time Updates:** Rhythm changes are applied immediately via the `/config` endpoint without restarting playback.

--- 

## 24. Sensitivity System
* **Sensitivity Slider:** Range 0.1x to 10.0x (default 1.0x)
* **Price-to-MIDI Conversion:** Sensitivity inversely affects step percentage:
    * QQQ base: 0.15% per semitone
    * SPY base: 0.10% per semitone
    * Adjusted formula: `step_pct = base_step_pct / sensitivity`
* **High Sensitivity Mode (≥ 4.0):**
    * Direct price tracking with nearest-scale-note selection
    * Stochastic jitter when price is flat to prevent visual stagnation
    * Jitter grows with repeat count (±1 to ±3 scale degrees)
* **Low Sensitivity Mode (< 4.0):**
    * Voice-leading with stepwise motion constraints
    * Maximum degree steps limited to `round(sensitivity)`
    * Repeat penalty applied to avoid jumpy movement

--- 

## 25. Price Noise Simulation
* **Price Noise Slider:** Range 0.1x to 5.0x (default 1.0x)
* **Purpose:** Simulates intra-second price volatility for more organic melodic movement
* **Application:** Random walk noise added to LERP-interpolated price:
    * Noise amplitude = `base_step × price_noise_multiplier`
    * Applied to each 16th-note tick within the 1-second bundle
* **Use Case:** Higher noise values create more melodic variation even when actual price is relatively flat

--- 

## 26. Visual Price Calculation Formula
* **Core Principle:** Note visual position must match the pitch being played
* **Soprano (QQQ) Formula:**
    ```
    soprano_offset_from_center = soprano_midi - dynamic_center_midi
    qqq_note_price = bundle_start_price × (1 + soprano_offset_from_center × qqq_step_pct)
    ```
* **Bass (SPY) Formula:**
    ```
    bass_offset_from_center = bass_midi - dynamic_center_midi
    spy_note_price = bundle_start_price × (1 + bass_offset_from_center × spy_step_pct)
    ```
* **Key Variables:**
    * `dynamic_center_midi`: The MIDI note corresponding to the current price (recalculated each bundle)
    * `bundle_start_price`: The price at the start of the 1-second bundle
    * Notes above center appear above the price line; notes below center appear below

--- 

## 27. Build & Deployment
* **Current Build:** VISUAL_FIX_V28
* **Frontend Cache Management:** 
    * Script version parameter (`script.js?v=34`)
    * Visual cache buster in header (`CACHE TEST V4`)
* **Backend Framework:** FastAPI with WebSocket support
* **Hot Reload:** FastAPI auto-reloads on code changes during development
* **Configuration Endpoint:** POST `/config` accepts:
    * `sensitivity`: float (0.1 to 10.0)
    * `price_noise`: float (0.1 to 5.0)
    * `soprano_rhythm`: int (4, 8, or 16)

--- 

## 28. Known Limitations & Future Enhancements
* **Regime Detection:** Currently locked to MAJOR scale; regime matrix logic not fully implemented
* **Real Market Data:** Using simulated price movement; needs integration with actual market data API
* **Harmonic Clock:** Chord progression system exists but is simplified (fixed to chord degree 1)
* **Root Offset Motion:** Chromatic shifts are disabled (`enable_root_offset_motion = False`)
* **RVOL Tempo:** Volume-based tempo changes not yet implemented (RVOL fixed at 1.0)
* **Optical Module:** Screen-capture price extraction not implemented