from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import random
from typing import Dict, Iterable, List, Optional, Sequence

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, APIRouter
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="ntree API Server")

# Router for Market Inventions API endpoints
market_router = APIRouter(prefix="/market_inventions", tags=["market_inventions"])

BUILD_ID = "CHORD_FIX_V93"

class VoiceLeading:
    """Pick the closest chord tone to the previous note."""

    def __init__(self, root_midi: int) -> None:
        self.root_midi = root_midi

    def _candidates(
        self, chord_tones: Iterable[int], min_midi: int, max_midi: int
    ) -> List[int]:
        tones_mod = {tone % 12 for tone in chord_tones}
        return [
            midi
            for midi in range(min_midi, max_midi + 1)
            if (midi - self.root_midi) % 12 in tones_mod
        ]

    def pick(
        self,
        prev_note: Optional[int],
        chord_tones: Iterable[int],
        min_midi: int,
        max_midi: int,
    ) -> int:
        candidates = self._candidates(chord_tones, min_midi, max_midi)
        if not candidates:
            return prev_note if prev_note is not None else min_midi
        if prev_note is None:
            return candidates[len(candidates) // 2]
        return min(candidates, key=lambda note: abs(note - prev_note))

    def pick_pitch_class(
        self,
        prev_note: Optional[int],
        pitch_class: int,
        min_midi: int,
        max_midi: int,
    ) -> int:
        candidates = [
            midi
            for midi in range(min_midi, max_midi + 1)
            if midi % 12 == pitch_class
        ]
        if not candidates:
            return prev_note if prev_note is not None else min_midi
        if prev_note is None:
            return candidates[len(candidates) // 2]
        return min(candidates, key=lambda note: abs(note - prev_note))

    def pick_near_target(
        self,
        prev_note: Optional[int],
        pitch_class: int,
        target_midi: int,
        min_midi: int,
        max_midi: int,
    ) -> int:
        candidates = [
            midi
            for midi in range(min_midi, max_midi + 1)
            if midi % 12 == pitch_class
        ]
        if not candidates:
            return prev_note if prev_note is not None else target_midi
        if prev_note is None:
            return min(candidates, key=lambda note: abs(note - target_midi))
        return min(
            candidates,
            key=lambda note: abs(note - target_midi) + 0.5 * abs(note - prev_note),
        )


class HarmonicClock:
    """Modulo-16 clock for harmonic progression lookup."""

    def __init__(self) -> None:
        self.step = 0
        self.progression_step = 0  # Advances once per bundle for chord progression

    def tick(self) -> int:
        self.step = (self.step + 1) % 16
        return self.step

    def advance_progression(self) -> int:
        """Advance the chord progression by one step (call once per bundle)."""
        self.progression_step = (self.progression_step + 1) % 16
        return self.progression_step


class InventionEngine:
    """Initial voice-leading and harmonic clock wiring."""

    SCALES = {
        "MAJOR": [0, 2, 4, 5, 7, 9, 11],
        "MINOR": [0, 2, 3, 5, 7, 8, 10],
    }

    def __init__(self) -> None:
        self.clock = HarmonicClock()
        self.voice_leading = VoiceLeading(root_midi=60)
        self.prev_soprano: Optional[int] = 72
        self.prev_bass: Optional[int] = 48
        self.rng = random.Random()
        self.root_offset = 0
        self.tick_count = 0
        self.sub_steps = 16
        self.arpeggio_pattern = [0, 2, 4, 2, 7, 4, 2, 0, 0, 2, 4, 2, 7, 4, 2, 0]
        self.qqq_open = self._generate_random_opening_price(350, 550)
        self.spy_open = self._generate_random_opening_price(450, 600)
        self.qqq_price = self.qqq_open
        self.spy_price = self.spy_open
        self.base_qqq_step_pct = 0.0015
        self.base_spy_step_pct = 0.0010
        self.sensitivity = 0.7
        self.qqq_step_pct = self.base_qqq_step_pct
        self.spy_step_pct = self.base_spy_step_pct
        self.price_noise_multiplier = 6.7
        # Available chord progression presets
        self.progression_presets = {
            "classical": {
                "MAJOR": [1, 1, 4, 4, 2, 2, 5, 5, 6, 6, 4, 4, 5, 5, 1, 1],
                "MINOR": [1, 1, 4, 4, 6, 6, 2, 2, 3, 3, 7, 7, 5, 5, 1, 1],
            },
            "pop": {  # I-V-vi-IV (Axis of Awesome)
                "MAJOR": [1, 1, 1, 1, 5, 5, 5, 5, 6, 6, 6, 6, 4, 4, 4, 4],
                "MINOR": [1, 1, 1, 1, 7, 7, 7, 7, 6, 6, 6, 6, 4, 4, 4, 4],
            },
            "blues": {  # 12-bar blues (extended to 16)
                "MAJOR": [1, 1, 1, 1, 4, 4, 1, 1, 5, 5, 4, 4, 1, 1, 5, 5],
                "MINOR": [1, 1, 1, 1, 4, 4, 1, 1, 5, 5, 4, 4, 1, 1, 5, 5],
            },
            "jazz": {  # ii-V-I turnarounds
                "MAJOR": [2, 2, 5, 5, 1, 1, 1, 1, 2, 2, 5, 5, 1, 1, 6, 6],
                "MINOR": [2, 2, 5, 5, 1, 1, 1, 1, 4, 4, 7, 7, 3, 3, 6, 6],
            },
            "canon": {  # Pachelbel's Canon
                "MAJOR": [1, 1, 5, 5, 6, 6, 3, 3, 4, 4, 1, 1, 4, 4, 5, 5],
                "MINOR": [1, 1, 5, 5, 6, 6, 3, 3, 4, 4, 1, 1, 4, 4, 5, 5],
            },
            "fifties": {  # 50s doo-wop (I-vi-IV-V)
                "MAJOR": [1, 1, 1, 1, 6, 6, 6, 6, 4, 4, 4, 4, 5, 5, 5, 5],
                "MINOR": [1, 1, 1, 1, 6, 6, 6, 6, 4, 4, 4, 4, 5, 5, 5, 5],
            },
        }
        self.current_progression_key = "classical"
        self.chord_progressions = self.progression_presets["classical"]
        # Major chord map: I=major, ii=minor, iii=minor, IV=major, V=major, vi=minor, vii°=dim
        self.chord_map_major = {
            1: [0, 4, 7],    # I   - major
            2: [2, 5, 9],    # ii  - minor
            3: [4, 7, 11],   # iii - minor
            4: [5, 9, 12],   # IV  - major
            5: [7, 11, 14],  # V   - major
            6: [9, 12, 16],  # vi  - minor
            7: [11, 14, 17], # vii°- diminished
        }
        # Minor chord map: i=minor, ii°=dim, III=major, iv=minor, v=minor, VI=major, VII=major
        self.chord_map_minor = {
            1: [0, 3, 7],    # i   - minor (flat 3rd!)
            2: [2, 5, 8],    # ii° - diminished
            3: [3, 7, 10],   # III - major
            4: [5, 8, 12],   # iv  - minor
            5: [7, 10, 14],  # v   - minor (natural minor) or [7, 11, 14] for harmonic minor
            6: [8, 12, 15],  # VI  - major
            7: [10, 14, 17], # VII - major
        }
        self.chord_map = self.chord_map_major  # Default for backward compat
        self.allowed_degrees = list(self.chord_map.keys())
        self.max_root_offset = 0
        self.last_degree = 1
        self.root_degree_index = 0
        self.lock_regime = None  # No longer locked - regime is dynamic based on price trend
        self.current_regime = "MAJOR"  # Current dynamic regime
        self.consecutive_down_bars = 0  # Count of consecutive price-down bars
        self.consecutive_up_bars = 0  # Count of consecutive price-up bars
        self.prev_bar_price = None  # Previous bar's ending price for trend detection
        self.regime_switch_threshold = 3  # Bars of trend to switch regime
        self.enable_root_offset_motion = False
        self.fixed_root_midi = 60
        self.soprano_repeat_count = 0
        self.melody_pattern = [0, 1, 0, 2, 0, 1, 0, -1, 0, 2, 0, 1, 0, -1, 0, 1]
        self.melody_phase = 0
        self.stuck_limit = 8
        self.prev_soprano_base: Optional[int] = None  # Track price-derived anchor before offset
        self.soprano_rhythm = 8  # 4 = quarter notes, 8 = eighth notes, 16 = sixteenth notes
        self.bass_rhythm = 2  # 4 = quarter notes, 2 = half notes, 1 = whole notes
        self.bass_sensitivity_multiplier = 0.5  # Bass needs wider price moves to justify a leap
        self.trend_cycle_seconds = 40  # Duration of full bull/bear cycle in seconds
        self.prev_spy_direction = 0  # Track SPY trend for walking bass: -1=down, 0=flat, 1=up
        self.chord_names = {
            1: "I", 2: "ii", 3: "iii", 4: "IV", 5: "V", 6: "vi", 7: "vii°"
        }
        self.minor_chord_names = {
            1: "i", 2: "ii°", 3: "III", 4: "iv", 5: "V", 6: "VI", 7: "vii°"
        }

    def _current_regime(self) -> str:
        if self.lock_regime:
            return self.lock_regime
        # Dynamic regime based on price trend
        return self.current_regime

    def _update_regime_from_price(self, current_price: float) -> None:
        """
        Update regime based on price trend with symmetric hysteresis:
        - Switch to MINOR after regime_switch_threshold consecutive down bars
        - Switch to MAJOR after regime_switch_threshold consecutive up bars
        """
        if self.prev_bar_price is None:
            self.prev_bar_price = current_price
            return
        
        if current_price < self.prev_bar_price:
            # Price is down
            self.consecutive_down_bars += 1
            self.consecutive_up_bars = 0  # Reset up counter
            if self.consecutive_down_bars >= self.regime_switch_threshold:
                if self.current_regime != "MINOR":
                    self.current_regime = "MINOR"
                    print(f"[REGIME] -> MINOR (down trend: {self.consecutive_down_bars} bars)")
        elif current_price > self.prev_bar_price:
            # Price is up
            self.consecutive_up_bars += 1
            self.consecutive_down_bars = 0  # Reset down counter
            if self.consecutive_up_bars >= self.regime_switch_threshold:
                if self.current_regime != "MAJOR":
                    self.current_regime = "MAJOR"
                    print(f"[REGIME] -> MAJOR (up trend: {self.consecutive_up_bars} bars)")
        # If price is flat, don't change counters or regime
        
        self.prev_bar_price = current_price

    def _minor_adjust(self, offsets: Sequence[int]) -> List[int]:
        adjusted = []
        for offset in offsets:
            if offset % 12 in {4, 9}:
                adjusted.append(offset - 1)
            else:
                adjusted.append(offset)
        return adjusted

    @staticmethod
    def _check_divergence(soprano_note: int, bass_note: int) -> bool:
        interval = abs(soprano_note - bass_note) % 12
        return interval in {1, 6, 11}

    def _next_price(self, current: float, step: float, drift: float) -> float:
        noise_step = step * self.price_noise_multiplier
        noise = self.rng.uniform(-noise_step, noise_step)
        next_price = current + noise + drift
        return max(0.01, next_price)

    def _price_to_midi(
        self,
        price: float,
        open_price: float,
        base_midi: int,
        step_pct: float,
        prev_price: Optional[float] = None,
    ) -> int:
        """Convert price to MIDI with trend-aware rounding to eliminate deadzones."""
        import math
        delta_pct = (price - open_price) / open_price
        raw_semitones = delta_pct / step_pct

        # Use floor/ceil based on price trend direction to be more reactive
        if prev_price is not None:
            if price > prev_price:
                semitones = math.ceil(raw_semitones)
            elif price < prev_price:
                semitones = math.floor(raw_semitones)
            else:
                semitones = round(raw_semitones)
        else:
            semitones = round(raw_semitones)

        return base_midi + semitones

    def _fit_to_range(self, prev_note: Optional[int], target: int, min_midi: int, max_midi: int) -> int:
        candidates = [target + (12 * shift) for shift in range(-4, 5)]
        candidates = [note for note in candidates if min_midi <= note <= max_midi]
        if not candidates:
            return min(max(target, min_midi), max_midi)
        if prev_note is None:
            return min(candidates, key=lambda note: abs(note - target))
        return min(candidates, key=lambda note: abs(note - target) + 0.5 * abs(note - prev_note))

    def _advance_root_offset(self, regime: str) -> None:
        if not self.enable_root_offset_motion:
            return
        scale_degrees = self.SCALES.get(regime, self.SCALES["MAJOR"])
        if not scale_degrees:
            return
        step = self.rng.choice([-1, 1])
        self.root_degree_index = (self.root_degree_index + step) % len(scale_degrees)
        self.root_offset = scale_degrees[self.root_degree_index]
        self.root_offset = max(-self.max_root_offset, min(self.root_offset, self.max_root_offset))

    def set_sensitivity(self, multiplier: float) -> None:
        safe_multiplier = max(0.1, min(multiplier, 10.0))
        self.sensitivity = safe_multiplier
        # MULTIPLY sensitivity to make notes MORE responsive to price changes
        # Higher sensitivity = larger step = more semitones per % price change
        self.qqq_step_pct = self.base_qqq_step_pct * safe_multiplier
        self.spy_step_pct = self.base_spy_step_pct * safe_multiplier

    def set_price_noise(self, multiplier: float) -> None:
        self.price_noise_multiplier = max(0.1, min(multiplier, 5.0))

    def set_soprano_rhythm(self, rhythm: int) -> None:
        """Set soprano rhythm: 4 = quarter notes, 8 = eighth notes, 16 = sixteenth notes"""
        if rhythm in {4, 8, 16}:
            self.soprano_rhythm = rhythm

    def set_bass_rhythm(self, rhythm: int) -> None:
        """Set bass rhythm: 4 = quarter notes, 2 = half notes, 1 = whole notes"""
        if rhythm in {1, 2, 4}:
            self.bass_rhythm = rhythm

    def set_trend_cycle(self, seconds: int) -> None:
        """Set the trend cycle duration in seconds (10-120)"""
        self.trend_cycle_seconds = max(10, min(120, seconds))

    def set_chord_progression(self, key: str) -> None:
        """Set the chord progression preset"""
        if key in self.progression_presets:
            self.current_progression_key = key
            self.chord_progressions = self.progression_presets[key]
            print(f"[CHORD] Progression -> {key}")

    def _generate_random_opening_price(self, min_price: float, max_price: float) -> float:
        """Generate a random opening price within the given range."""
        return self.rng.uniform(min_price, max_price)

    def reset_session(self) -> None:
        """Reset the engine state for a new session with fresh random prices."""
        # Generate wider price ranges so resets are more obvious
        self.qqq_open = self._generate_random_opening_price(350, 550)
        self.spy_open = self._generate_random_opening_price(450, 600)
        self.qqq_price = self.qqq_open
        self.spy_price = self.spy_open
        self.tick_count = 0
        self.prev_soprano = 72
        self.prev_bass = 48
        self.soprano_repeat_count = 0
        self.prev_soprano_base = None
        self.melody_phase = 0
        self.clock = HarmonicClock()
        # Reset regime tracking
        self.current_regime = "MAJOR"
        self.consecutive_down_bars = 0
        self.consecutive_up_bars = 0
        self.prev_bar_price = None
        print(f"[RESET] Session reset: QQQ opening at ${self.qqq_open:.2f}, SPY opening at ${self.spy_open:.2f}")

    @staticmethod
    def _offset_scale_degree(
        note: int, scale_pool: Sequence[int], offset: int
    ) -> int:
        if not scale_pool:
            return note
        pool = sorted(scale_pool)
        index = min(range(len(pool)), key=lambda i: abs(pool[i] - note))
        next_index = max(0, min(len(pool) - 1, index + offset))
        return pool[next_index]

    def _escape_stuck(
        self, note: int, scale_pool: Sequence[int], direction: int
    ) -> int:
        return self._offset_scale_degree(note, scale_pool, 2 * direction)

    def _get_scale_notes(
        self, regime: str, root_midi: int, min_midi: int, max_midi: int
    ) -> List[int]:
        intervals = self.SCALES.get(regime, self.SCALES["MAJOR"])
        return [
            midi
            for midi in range(min_midi, max_midi + 1)
            if (midi - root_midi) % 12 in intervals
        ]

    @staticmethod
    def _nearest_scale_note(target_midi: int, scale_pool: Sequence[int], max_distance: int = 12) -> int:
        """Find nearest scale note, preferring notes within max_distance semitones."""
        if not scale_pool:
            return target_midi
        # First try to find a note within max_distance
        nearby = [note for note in scale_pool if abs(note - target_midi) <= max_distance]
        if nearby:
            return min(nearby, key=lambda note: abs(note - target_midi))
        # If no close notes, find the absolute nearest (fallback)
        return min(scale_pool, key=lambda note: abs(note - target_midi))

    @staticmethod
    def _nearest_scale_note_above(
        target_midi: int, scale_pool: Sequence[int]
    ) -> Optional[int]:
        candidates = [note for note in scale_pool if note >= target_midi]
        if not candidates:
            return None
        return min(candidates, key=lambda note: abs(note - target_midi))

    def _pick_scale_step(
        self,
        prev_note: Optional[int],
        target_midi: int,
        scale_pool: Sequence[int],
        max_degree_step: int,
        repeat_penalty: float = 0.2,
    ) -> int:
        if not scale_pool:
            return prev_note if prev_note is not None else target_midi
        pool = sorted(scale_pool)
        if prev_note is None:
            return min(pool, key=lambda note: abs(note - target_midi))

        prev_index = min(range(len(pool)), key=lambda i: abs(pool[i] - prev_note))
        lo = max(0, prev_index - max_degree_step)
        hi = min(len(pool) - 1, prev_index + max_degree_step)
        window = pool[lo : hi + 1]
        return min(
            window,
            key=lambda note: abs(note - target_midi)
            + (repeat_penalty if note == prev_note else 0),
        )

    @staticmethod
    def _enforce_stepwise_motion(
        prev_note: Optional[int],
        candidate: int,
        scale_pool: Sequence[int],
        min_move: int = 1,
    ) -> int:
        if prev_note is None or candidate is None:
            return candidate
        if abs(candidate - prev_note) >= min_move:
            return candidate
        direction = 1 if candidate >= prev_note else -1
        pool = sorted(scale_pool)
        if not pool:
            return candidate
        if direction > 0:
            higher = [note for note in pool if note > prev_note]
            return higher[0] if higher else candidate
        lower = [note for note in pool if note < prev_note]
        return lower[-1] if lower else candidate

    @staticmethod
    def _step_toward_target(
        prev_note: Optional[int],
        target_midi: int,
        scale_pool: Sequence[int],
        step_degrees: int = 1,
    ) -> Optional[int]:
        if prev_note is None or not scale_pool:
            return None
        pool = sorted(scale_pool)
        prev_index = min(range(len(pool)), key=lambda i: abs(pool[i] - prev_note))
        direction = 1 if target_midi >= prev_note else -1
        next_index = prev_index + (step_degrees * direction)
        next_index = max(0, min(len(pool) - 1, next_index))
        return pool[next_index]

    def _avoid_stagnation(
        self,
        candidate: int,
        prev: Optional[int],
        prev_prev: Optional[int],
        min_midi: int,
        max_midi: int,
    ) -> int:
        if prev is None:
            return candidate
        if candidate != prev:
            return candidate
        if prev_prev is not None and prev_prev == prev:
            # Force movement by octave shift within range.
            if candidate + 12 <= max_midi:
                return candidate + 12
            if candidate - 12 >= min_midi:
                return candidate - 12
        return candidate

    def _pattern_offset(self, chord: Sequence[int], degree: int) -> int:
        if degree == 2:
            return chord[1]
        if degree == 4:
            return chord[2]
        if degree == 7:
            return chord[0] + 12
        return chord[0]

    def _select_chord_degree(self, regime: str) -> int:
        progression = self.chord_progressions[regime]
        base_degree = progression[self.clock.progression_step]
        self.last_degree = base_degree
        return base_degree

    def generate_price_data(self) -> Dict[str, object]:
        """
        Generate ONLY price data - completely decoupled from music.
        This runs continuously and independently of audio/music generation.
        """
        start_qqq = self.qqq_price
        start_spy = self.spy_price
        
        # Oscillating drift: cycles between bullish and bearish phases
        import math
        # Convert cycle duration to angular frequency: 2*pi radians per full cycle
        cycle_speed = (2 * math.pi) / self.trend_cycle_seconds
        cycle_position = math.sin(self.tick_count * cycle_speed)  # Oscillation based on cycle setting
        qqq_drift = 0.05 * cycle_position  # Swings between -0.05 and +0.05
        spy_drift = 0.03 * cycle_position  # Swings between -0.03 and +0.03
        
        end_qqq = self._next_price(start_qqq, step=0.6, drift=qqq_drift)
        end_spy = self._next_price(start_spy, step=0.45, drift=spy_drift)
        self.qqq_price = end_qqq
        self.spy_price = end_spy

        qqq_prices: List[float] = []
        spy_prices: List[float] = []

        for i in range(self.sub_steps):
            lerp_factor = i / (self.sub_steps - 1)
            qqq_price = start_qqq + (end_qqq - start_qqq) * lerp_factor
            spy_price = start_spy + (end_spy - start_spy) * lerp_factor
            # Moderate intra-tick price variation for natural movement
            qqq_price += self.rng.uniform(-0.08, 0.08)
            spy_price += self.rng.uniform(-0.06, 0.06)

            qqq_prices.append(round(qqq_price, 4))
            spy_prices.append(round(spy_price, 4))

        return {
            "qqq_prices": qqq_prices,
            "spy_prices": spy_prices,
            "qqq_current": round(self.qqq_price, 2),
            "spy_current": round(self.spy_price, 2),
        }

    def generate_music_from_prices(self, price_data: Dict[str, object]) -> Dict[str, object]:
        """
        Generate music (MIDI notes) from price data.
        This is completely decoupled - price data comes as input.
        """
        start_tick = self.tick_count + 1
        
        # Extract price data from input
        qqq_prices = price_data["qqq_prices"]
        spy_prices = price_data["spy_prices"]
        start_qqq = qqq_prices[0]
        start_spy = spy_prices[0]
        
        # Update regime based on price trend (QQQ as primary indicator)
        end_qqq = qqq_prices[-1]  # Use end of bar price for trend
        self._update_regime_from_price(end_qqq)
        
        regime = self._current_regime()

        if self.clock.step == 0 and self.rng.random() < 0.35:
            self._advance_root_offset(regime)

        soprano_bundle: List[Optional[int]] = []
        bass_bundle: List[Optional[int]] = []
        qqq_note_prices: List[float] = []
        spy_note_prices: List[Optional[float]] = []
        divergence_steps: List[bool] = []

        self.root_offset = 0
        root_midi = self.fixed_root_midi
        
        # DYNAMIC CHORD PROGRESSION: Advance once per bundle
        # This ensures the chord changes over time, not stuck on one chord
        self.clock.advance_progression()
        chord_degree = self.chord_progressions[regime][self.clock.progression_step]
        first_chord_degree = chord_degree  # Store for UI display
        # Debug: print chord progression info every 4 bundles
        if self.tick_count % 4 == 0:
            print(f"[STEP] {self.clock.progression_step}/16 | Chord: {chord_degree} | Preset: {self.current_progression_key}")
        # Use appropriate chord map based on regime
        active_chord_map = self.chord_map_minor if regime == "MINOR" else self.chord_map_major
        chord = active_chord_map[chord_degree]
        chord_tone_mods = {tone % 12 for tone in chord}
        # Dynamic range: Calculate initial anchor to center the range around price
        # This prevents ceiling/floor lock when price drifts from open
        initial_qqq_anchor = self._price_to_midi(
            start_qqq, self.qqq_open, base_midi=72, step_pct=self.qqq_step_pct
        )
        initial_spy_anchor = self._price_to_midi(
            start_spy, self.spy_open, base_midi=48, step_pct=self.spy_step_pct
        )

        # Constrain MIDI to musical range (3 octaves each, comfortable registers)
        # Soprano: C4 (60) to C7 (96) - bright but not piercing
        # Bass: C2 (36) to C5 (72) - deep but audible
        soprano_min = 60  # C4 - middle C
        soprano_max = 84  # C6 - two octaves above middle C (comfortable soprano range)
        
        bass_min = 36   # C2 - low bass
        bass_max = 60   # C4 - up to middle C (comfortable bass range)

        soprano_pool = self._get_scale_notes(regime, root_midi, soprano_min, soprano_max)
        bass_pool = self._get_scale_notes(regime, root_midi, bass_min, bass_max)

        prev_qqq_price: Optional[float] = None
        prev_spy_price: Optional[float] = None

        for i in range(self.sub_steps):
            self.tick_count += 1
            self.clock.tick()

            # Use prices from input data (already generated by generate_price_data)
            qqq_price = qqq_prices[i]
            spy_price = spy_prices[i]

            # Chord is now set once per bundle (at the start) for consistent harmonic feel
            # The progression advances between bundles, not within them

            # FIX: Calculate unclamped target first to maintain responsiveness
            # This allows tracking price movement even outside the audible MIDI range
            qqq_anchor_midi_raw = self._price_to_midi(
                qqq_price, self.qqq_open, base_midi=72, step_pct=self.qqq_step_pct,
                prev_price=prev_qqq_price
            )
            prev_qqq_price = qqq_price
            
            # Build chord pool based on CURRENT chord (updates every beat)
            chord_pool = [
                note
                for note in soprano_pool
                if (note - root_midi) % 12 in chord_tone_mods
            ]
            
            # On chord beats, prefer chord tones
            if i % 4 == 0:
                allowed_soprano = chord_pool or soprano_pool
            else:
                allowed_soprano = soprano_pool
            soprano_degree_step = max(1, min(7, round(self.sensitivity)))
            
            # FIX: Sensitivity-based repeat penalty (disable at high sensitivity)
            repeat_penalty_value = 0.0 if self.sensitivity >= 5.0 else 0.2
            
            # Rhythm control: Update anchor note at rhythm boundaries
            rhythm_interval = 16 // self.soprano_rhythm  # 1 for 16th, 2 for 8th, 4 for quarter
            should_update_soprano = (i % rhythm_interval == 0)
            
            # Soprano generation - STRICT rhythm adherence to prevent overlaps
            # ONLY update at rhythm boundaries, hold between
            if should_update_soprano:
                # HIGH SENSITIVITY (>=5): Tight tracking within 4 semitones
                # MED SENSITIVITY (2-5): Moderate tracking within 8 semitones  
                # LOW SENSITIVITY (<2): Full octave range
                if self.sensitivity >= 5.0:
                    max_jump = 4  # Very tight - within a major third
                elif self.sensitivity >= 2.0:
                    max_jump = 8  # Moderate - within a major sixth
                else:
                    max_jump = 12  # Full octave
                    
                base_soprano = self._nearest_scale_note(qqq_anchor_midi_raw, allowed_soprano, max_distance=max_jump)
                
                # HIGH SENSITIVITY: NO variation, pure price tracking
                # LOW SENSITIVITY: More melodic variation and independence
                variation_chance = max(0.0, 0.5 - (self.sensitivity * 0.08))  # 0.5 at 1x, ~0.0 at 6.25x+
                
                # Add melodic variation ONLY at low sensitivity
                if self.sensitivity < 3.0 and self.prev_soprano is not None and self.rng.random() < variation_chance:
                    # Get notes within ±2 scale degrees
                    nearby_notes = [
                        self._offset_scale_degree(base_soprano, soprano_pool, offset)
                        for offset in [-2, -1, 0, 1, 2]
                    ]
                    # Remove duplicates and ensure they're in range
                    nearby_notes = list(set([n for n in nearby_notes if n is not None and soprano_min <= n <= soprano_max]))
                    if len(nearby_notes) > 1:
                        # Pick a nearby note for variation
                        soprano = self.rng.choice(nearby_notes)
                    else:
                        soprano = base_soprano
                else:
                    # Use price-derived note (pure tracking at high sensitivity)
                    soprano = base_soprano
                
                self.prev_soprano = soprano
            else:
                # Between rhythm boundaries: hold the previous note
                # This GUARANTEES no overlaps
                soprano = self.prev_soprano if self.prev_soprano is not None else 72

            # BASS LOGIC: Walking bass algorithm responding to SPY price direction
            bass_note: Optional[int] = None
            bass_note_price: Optional[float] = None
            
            # Apply bass sensitivity multiplier (bass needs wider moves to jump)
            bass_step_pct = self.spy_step_pct / self.bass_sensitivity_multiplier
            spy_anchor_midi = self._price_to_midi(
                spy_price, self.spy_open, base_midi=48, step_pct=bass_step_pct,
                prev_price=prev_spy_price
            )
            
            # Track SPY price direction for walking bass
            if prev_spy_price is not None:
                price_delta = spy_price - prev_spy_price
                if abs(price_delta) < 0.02:  # Flat threshold
                    self.prev_spy_direction = 0
                elif price_delta > 0:
                    self.prev_spy_direction = 1  # Trending up
                else:
                    self.prev_spy_direction = -1  # Trending down
            prev_spy_price = spy_price

            # Bass generation - rhythm based on bass_rhythm setting
            # bass_rhythm: 4=quarter (every 4), 2=half (every 8), 1=whole (every 16)
            bass_rhythm_interval = 16 // self.bass_rhythm
            should_update_bass = (i % bass_rhythm_interval == 0)
            
            if should_update_bass:
                # Build chord-tone pool for current chord
                chord_bass_pool = [
                    note
                    for note in bass_pool
                    if (note - root_midi) % 12 in chord_tone_mods
                ]
                allowed_bass = chord_bass_pool or bass_pool
                
                # Sensitivity-based distance constraint
                if self.sensitivity >= 5.0:
                    bass_max_jump = 4  # Very tight
                elif self.sensitivity >= 2.0:
                    bass_max_jump = 8  # Moderate
                else:
                    bass_max_jump = 12  # Full octave
                
                # WALKING BASS ALGORITHM based on SPY direction
                if self.prev_bass is not None and self.sensitivity < 4.0:
                    if self.prev_spy_direction > 0:
                        # SPY trending UP: walk up the scale toward next chord tone
                        candidates = [n for n in allowed_bass if n > self.prev_bass and abs(n - self.prev_bass) <= bass_max_jump]
                        if candidates:
                            # Pick the nearest note above
                            bass_note = min(candidates, key=lambda n: n - self.prev_bass)
                        else:
                            bass_note = self._nearest_scale_note(spy_anchor_midi, allowed_bass, max_distance=bass_max_jump)
                    elif self.prev_spy_direction < 0:
                        # SPY trending DOWN: walk down the scale toward next chord tone
                        candidates = [n for n in allowed_bass if n < self.prev_bass and abs(n - self.prev_bass) <= bass_max_jump]
                        if candidates:
                            # Pick the nearest note below
                            bass_note = max(candidates, key=lambda n: n)
                        else:
                            bass_note = self._nearest_scale_note(spy_anchor_midi, allowed_bass, max_distance=bass_max_jump)
                    else:
                        # SPY FLAT: alternate between Root and Fifth of the chord
                        root_note = min(chord_bass_pool) if chord_bass_pool else self.prev_bass
                        fifth_candidates = [n for n in chord_bass_pool if (n - root_midi) % 12 == 7]
                        fifth_note = min(fifth_candidates, key=lambda n: abs(n - self.prev_bass)) if fifth_candidates else root_note
                        # Alternate between root and fifth
                        if self.prev_bass == root_note or abs(self.prev_bass - root_note) <= 2:
                            bass_note = fifth_note
                        else:
                            bass_note = root_note
                else:
                    # HIGH SENSITIVITY or no previous bass: pure price tracking
                    bass_note = self._nearest_scale_note(spy_anchor_midi, allowed_bass, max_distance=bass_max_jump)
                
                self.prev_bass = bass_note
            else:
                # Between quarter beats: hold the previous note
                bass_note = self.prev_bass

            # Bass note separation check (prevent soprano and bass from colliding)

            if bass_note is not None:
                min_separation = 12
                min_soprano = bass_note + min_separation
                if soprano < min_soprano:
                    adjusted = self._nearest_scale_note_above(min_soprano, soprano_pool)
                    if adjusted is not None:
                        soprano = adjusted

            self.prev_soprano = soprano
            
            # Hybrid visual positioning: stay near price but show melodic variation
            # Add small offset based on MIDI pitch relative to center
            soprano_center_midi = 72  # Reference center
            soprano_midi_offset = soprano - soprano_center_midi  # Semitones from center
            # Scale: 0.3% of price per semitone - keeps notes dancing around price
            soprano_visual_offset = soprano_midi_offset * (qqq_price * 0.003)
            qqq_note_price = qqq_price + soprano_visual_offset
            
            # Bass visual offset
            bass_center_midi = 48  # Reference center for bass
            if bass_note is not None:
                bass_midi_offset = bass_note - bass_center_midi
                bass_visual_offset = bass_midi_offset * (spy_price * 0.003)
                spy_note_price = spy_price + bass_visual_offset
            else:
                spy_note_price = None

            soprano_bundle.append(soprano)
            bass_bundle.append(bass_note)
            qqq_note_prices.append(round(qqq_note_price, 4))
            spy_note_prices.append(round(spy_note_price, 4) if spy_note_price is not None else None)

            if bass_note is None:
                divergence_steps.append(False)
            else:
                divergence_steps.append(self._check_divergence(soprano, bass_note))

        # Get chord name based on regime (major uses uppercase, minor uses lowercase)
        # Use the FIRST chord of this bundle for consistent UI display
        if regime == "MINOR":
            chord_name = self.minor_chord_names.get(first_chord_degree, str(first_chord_degree))
        else:
            chord_name = self.chord_names.get(first_chord_degree, str(first_chord_degree))
        
        return {
            "payload_version": "bundle_v2",
            "server_path": __file__,
            "build_id": BUILD_ID,
            "soprano_bundle": soprano_bundle,
            "bass_bundle": bass_bundle,
            "qqq_prices": qqq_prices,
            "spy_prices": spy_prices,
            "qqq_note_prices": qqq_note_prices,
            "spy_note_prices": spy_note_prices,
            "rvol": 1.0,
            "regime": regime,
            "divergence": any(divergence_steps),
            "chord": chord_name,
            "root_offset": self.root_offset,
            "start_tick": start_tick,
            "tick_count": self.tick_count,
            "qqq_price": round(self.qqq_price, 2),
            "spy_price": round(self.spy_price, 2),
        }

    def generate_complete_bundle(self) -> Dict[str, object]:
        """
        Convenience method that generates both price data and music.
        Calls generate_price_data() first, then generate_music_from_prices().
        This maintains proper separation of concerns.
        """
        price_data = self.generate_price_data()
        music_data = self.generate_music_from_prices(price_data)
        # Merge both datasets
        return {**price_data, **music_data}


engine = InventionEngine()


# ============================================================================
# Market Inventions Routes (at /market_inventions)
# ============================================================================

@market_router.get("/hello", response_class=HTMLResponse)
async def hello() -> str:
    return "<h1>Hello from Market Inventions</h1>"


@market_router.get("/build")
async def build_info() -> Dict[str, str]:
    return {
        "build_id": BUILD_ID,
        "server_path": __file__,
        "server_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@market_router.post("/config")
async def update_config(payload: Dict[str, object]) -> Dict[str, object]:
    multiplier = float(payload.get("sensitivity", 1.0))
    engine.set_sensitivity(multiplier)
    noise = float(payload.get("price_noise", engine.price_noise_multiplier))
    engine.set_price_noise(noise)
    if "soprano_rhythm" in payload:
        rhythm = int(payload["soprano_rhythm"])
        engine.set_soprano_rhythm(rhythm)
    if "bass_rhythm" in payload:
        rhythm = int(payload["bass_rhythm"])
        engine.set_bass_rhythm(rhythm)
    if "trend_cycle" in payload:
        seconds = int(payload["trend_cycle"])
        engine.set_trend_cycle(seconds)
    if "chord_progression" in payload:
        engine.set_chord_progression(payload["chord_progression"])
    return {
        "sensitivity": engine.sensitivity,
        "qqq_step_pct": engine.qqq_step_pct,
        "spy_step_pct": engine.spy_step_pct,
        "price_noise": engine.price_noise_multiplier,
        "soprano_rhythm": engine.soprano_rhythm,
        "bass_rhythm": engine.bass_rhythm,
        "trend_cycle": engine.trend_cycle_seconds,
        "chord_progression": engine.current_progression_key,
    }


@market_router.post("/reset")
async def reset_session() -> Dict[str, object]:
    """Reset engine state with fresh random prices."""
    engine.reset_session()
    return {
        "status": "reset",
        "qqq_open": round(engine.qqq_open, 2),
        "spy_open": round(engine.spy_open, 2),
    }


@market_router.websocket("/ws/prices")
async def prices_websocket(websocket: WebSocket) -> None:
    """
    Price data WebSocket - streams ONLY price data.
    This runs independently and continuously, regardless of audio state.
    """
    await websocket.accept()
    print("[PRICE] Stream connected")
    try:
        while True:
            price_data = engine.generate_price_data()
            await websocket.send_text(json.dumps(price_data))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        print("[PRICE] Stream disconnected")
        return


@market_router.websocket("/ws/music")
async def music_websocket(websocket: WebSocket) -> None:
    """
    Music WebSocket - streams price data + music notes.
    This is only connected when audio is playing.
    """
    await websocket.accept()
    print("[MUSIC] Stream connected - resetting session...")
    engine.reset_session()
    try:
        while True:
            # Generate price data first, then music from that data
            price_data = engine.generate_price_data()
            music_data = engine.generate_music_from_prices(price_data)
            complete_data = {**price_data, **music_data}
            await websocket.send_text(json.dumps(complete_data))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        print("[MUSIC] Stream disconnected")
        return


@market_router.websocket("/ws")
async def legacy_websocket(websocket: WebSocket) -> None:
    """
    Legacy WebSocket endpoint for backward compatibility.
    Redirects to music endpoint.
    """
    await websocket.accept()
    print("[LEGACY] WebSocket connection - resetting session...")
    engine.reset_session()
    try:
        while True:
            data = engine.generate_complete_bundle()
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        print("[LEGACY] WebSocket disconnected")
        return


# ============================================================================
# Root App Configuration  
# ============================================================================

# Include Market Inventions router (routes take precedence over mounts)
app.include_router(market_router)

# Mount static files for Market Inventions at /market_inventions/static/
# Use absolute path based on this file's location (works regardless of cwd)
import os as _os
_static_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "static")
app.mount("/market_inventions/static", StaticFiles(directory=_static_dir), name="market_static")

# Serve index.html at /market_inventions/ explicitly
@app.get("/market_inventions/", response_class=HTMLResponse)
async def market_inventions_index():
    """Serve Market Inventions homepage."""
    import os
    index_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        return f.read()

# Note: Root path "/" is NOT defined here - it's handled by Flask when mounted via run_unified.py
