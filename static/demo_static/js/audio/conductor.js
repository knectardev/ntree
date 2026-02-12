/**
 * audio/conductor.js — Animation Loop & The Conductor (processSubStep)
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: Smooth animation loop (RAF-based), processSubStep (the central
 * orchestrator), sub-step note emission, chart scroll sync, playback
 * integration (onBarAdvance), and replay system hook.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    // Dependencies
    const musicState = _am.musicState;
    const audioState = _am.audioState;
    const ui = _am.ui;
    const updateStatus = _am.updateStatus;
    const midiToNoteName = _am.midiToNoteName;
    const rhythmToDuration = _am.rhythmToDuration;
    const rhythmToDurationMs = _am.rhythmToDurationMs;
    const updateRegimeFromPrice = _am.updateRegimeFromPrice;
    const advanceProgression = _am.advanceProgression;
    const updateVisiblePriceRange = _am.updateVisiblePriceRange;
    const getDynamicMidiRange = _am.getDynamicMidiRange;
    const getScaleNotes = _am.getScaleNotes;
    const getTonalContext = _am.getTonalContext;
    const getChordTonesInRange = _am.getChordTonesInRange;
    const nearestScaleNote = _am.nearestScaleNote;
    const nearestStructuralNote = _am.nearestStructuralNote;
    const isAvoidNoteForTonalContext = _am.isAvoidNoteForTonalContext;
    const detectMelodicPattern = _am.detectMelodicPattern;
    const ensureVoiceSeparation = _am.ensureVoiceSeparation;
    const priceToMidi = _am.priceToMidi;
    const updatePriceRange = _am.updatePriceRange;
    const getChordLabel = _am.getChordLabel;
    const getChordComponentPCs = _am.getChordComponentPCs;
    const startVoiceCell = _am.startVoiceCell;
    const executeSopranoRunStep = _am.executeSopranoRunStep;
    const executeWalkingStep = _am.executeWalkingStep;
    const applyGenreComplexity = _am.applyGenreComplexity;
    const applyWickGravity = _am.applyWickGravity;
    const updateSopranoHistory = _am.updateSopranoHistory;
    const updateBassHistory = _am.updateBassHistory;
    const playDrumStep = _am.playDrumStep;
    const HARMONY_STYLES = _am.HARMONY_STYLES || {};

    // ========================================================================
    // CONSTANTS
    // ========================================================================

    // Playhead position as fraction of chart width (0.5 = center of screen)
    const PLAYHEAD_POSITION = 0.5;
    
    // Sub-step configuration (matching Market Inventions) 
    const SUB_STEP_COUNT = 16;
    const SUB_STEP_SECONDS = 1 / SUB_STEP_COUNT;  // 62.5ms per sub-step
    
    // Expose for renderer
    window._audioSubStepSeconds = SUB_STEP_SECONDS;
    
    // Track current held notes for extension (module scope)
    let currentSopranoNote = null;
    let currentBassNote = null;
    let _activeSopranoNote = null;
    const _sopranoSlide = {
        synth: null,
        vibrato: null,
        drive: null,
        compressor: null,
        limiter: null,
        active: false,
        currentMidi: null,
        holdUntil: 0,
        samplerSuppressed: false,
        failSafeUntil: 0,
        errorCount: 0,
        lastUpdateSec: 0
    };
    const _phrasingState = {
        soprano: { lastMidi: null, lastPrice: null },
        bass: { lastMidi: null, lastPrice: null }
    };
    const _euclidCache = {};

    function clamp01(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(1, n));
    }

    function getEuclideanPattern(hits, steps) {
        const n = Math.max(1, Math.floor(Number(steps) || 16));
        const k = Math.max(1, Math.min(n, Math.floor(Number(hits) || 8)));
        const key = k + ':' + n;
        if (_euclidCache[key]) return _euclidCache[key];
        const pattern = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            if (((i * k) % n) < k) pattern[i] = 1;
        }
        _euclidCache[key] = pattern;
        return pattern;
    }

    function shouldTriggerRhythmicPulse(subStepInBar, voice) {
        if (voice === 'bass' && !audioState.phrasingApplyToBass) {
            return false;
        }
        const density = Math.max(1, Math.min(SUB_STEP_COUNT, Math.round(Number(audioState.rhythmDensity) || 8)));
        const pattern = getEuclideanPattern(density, SUB_STEP_COUNT);
        const phaseOffset = (voice === 'bass') ? 2 : 0;
        const idx = ((subStepInBar + phaseOffset) % SUB_STEP_COUNT + SUB_STEP_COUNT) % SUB_STEP_COUNT;
        return pattern[idx] === 1;
    }

    function getSopranoRhythmMode() {
        return String(audioState.upperWick && audioState.upperWick.rhythm ? audioState.upperWick.rhythm : '4');
    }

    function getSopranoTriggerIntervalFromMode(mode) {
        const raw = String(mode || '4');
        if (raw === 'random_4_8_16') return 1; // 16th-grid onsets, random duration per note
        if (raw === 'random_4_8') return 2;    // 8th-grid onsets, random duration per note
        const div = parseInt(raw, 10);
        if (div === 1 || div === 2 || div === 4 || div === 8 || div === 16) {
            return Math.max(1, Math.round(SUB_STEP_COUNT / div));
        }
        return 4; // Quarter fallback
    }

    function shouldTriggerSopranoPulse(subStepInBar) {
        const mode = getSopranoRhythmMode();
        const interval = getSopranoTriggerIntervalFromMode(mode);
        const onGrid = (subStepInBar % interval) === 0;
        if (!onGrid) {
            return { shouldPlay: false, mode: mode };
        }

        const baseHits = Math.max(1, Math.floor(SUB_STEP_COUNT / interval));
        const density = Math.max(1, Math.min(SUB_STEP_COUNT, Math.round(Number(audioState.rhythmDensity) || 8)));
        if (density >= baseHits) {
            return { shouldPlay: true, mode: mode };
        }

        // Pattern density acts as controlled sparsity over the selected rhythm grid.
        const sparseMask = getEuclideanPattern(density, baseHits);
        const gridIndex = Math.floor(subStepInBar / interval) % baseHits;
        return { shouldPlay: sparseMask[gridIndex] === 1, mode: mode };
    }

    function getRangeNormForBar(barIndex) {
        const d = state && Array.isArray(state.data) ? state.data : [];
        if (!d.length) return 0.5;
        const i1 = Math.max(0, Math.min(d.length - 1, Math.floor(barIndex)));
        const i0 = Math.max(0, i1 - 47);
        let minR = Infinity;
        let maxR = -Infinity;
        for (let i = i0; i <= i1; i++) {
            const bar = d[i];
            if (!bar) continue;
            const r = Math.max(0, Number(bar.h) - Number(bar.l));
            if (!Number.isFinite(r)) continue;
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
        }
        const cur = d[i1];
        const curR = cur ? Math.max(0, Number(cur.h) - Number(cur.l)) : NaN;
        if (!Number.isFinite(curR)) return 0.5;
        if (!Number.isFinite(minR) || !Number.isFinite(maxR) || maxR <= minR) return 0.5;
        return Math.max(0, Math.min(1, (curR - minR) / (maxR - minR)));
    }

    function computeDynamicDurationSec(barIndex, voice) {
        const sustain = clamp01(audioState.sustainFactor ?? 0.35);
        const norm = getRangeNormForBar(barIndex);
        const minSec = 0.05 + sustain * 0.08;
        const maxSec = 0.22 + sustain * 0.55;
        let sec = minSec + (maxSec - minSec) * norm;
        if (voice === 'bass') sec *= 1.1;
        if (!Number.isFinite(sec)) sec = 0.18;
        return Math.max(0.04, Math.min(1.2, sec));
    }

    function shouldTieNote(voice, midi, price) {
        if (voice === 'bass' && !audioState.phrasingApplyToBass) return false;
        const st = _phrasingState[voice];
        if (!st) return false;
        const sustain = clamp01(audioState.sustainFactor ?? 0.35);
        if (sustain <= 0) return false;
        if (st.lastMidi === null) return false;
        const visMin = Number(musicState.visiblePriceMin);
        const visMax = Number(musicState.visiblePriceMax);
        const span = (Number.isFinite(visMin) && Number.isFinite(visMax) && visMax > visMin) ? (visMax - visMin) : 1;
        const pNow = Number(price);
        const pPrev = Number(st.lastPrice);
        if (!Number.isFinite(pNow) || !Number.isFinite(pPrev)) return false;

        const slurAmount = clamp01(audioState.slurAmount ?? 0.5);
        const semitoneGap = Math.abs(Number(st.lastMidi) - Number(midi));
        // Keep tie as same-pitch only; legato between different pitches is handled
        // via long overlap durations to avoid hidden pitch-skip artifacts.
        if (semitoneGap !== 0) return false;

        const delta = Math.abs(pNow - pPrev);
        // Non-linear scaling gives stronger legato response near slider max.
        // 0.0 -> ~0.20x, 0.5 -> ~1.20x, 1.0 -> ~6.20x threshold.
        const slurMul = 0.2 + (Math.pow(slurAmount, 2.6) * 6.0);
        const threshold = span * (0.001 + sustain * 0.02) * slurMul;
        return delta <= threshold;
    }

    function applySlurDurationScale(durationSec, voice) {
        if (!Number.isFinite(durationSec)) return 0.12;
        const slur = clamp01(audioState.slurAmount ?? 0.5);
        // Strongly nonlinear: low values stay short, high values become very legato.
        // 0.0 -> 0.35x, 0.5 -> ~0.78x, 1.0 -> 3.55x.
        const mul = 0.35 + (Math.pow(slur, 2.4) * 3.2);
        const scaled = durationSec * mul;
        // Soprano gets slightly more headroom for expressive slide-style phrasing.
        const cap = (voice === 'soprano') ? 4.0 : 3.0;
        return Math.max(0.04, Math.min(cap, scaled));
    }

    function isSopranoSlideInstrumentActive() {
        return String(audioState.upperWick && audioState.upperWick.instrument || '') === 'slide_guitar';
    }

    function isSopranoSlidePathEnabled() {
        if (Number.isFinite(_sopranoSlide.failSafeUntil) && Tone.now() < _sopranoSlide.failSafeUntil) {
            return false;
        }
        const slur = clamp01(audioState.slurAmount ?? 0.5);
        // High slur should always engage continuous-slide behavior so users can
        // clearly hear the difference even if they don't switch instruments.
        if (slur >= 0.8) return true;
        // Slide guitar enables glide behavior earlier.
        if (isSopranoSlideInstrumentActive()) return slur >= 0.12;
        return false;
    }

    function ensureSopranoSlideVoice() {
        if (_sopranoSlide.synth) return _sopranoSlide.synth;
        if (typeof Tone === 'undefined') return null;
        try {
            const vibrato = new Tone.Vibrato(3.6, 0.11).start();
            const drive = new Tone.Distortion(0.12);
            drive.wet.value = 0.0;
            const compressor = new Tone.Compressor(-28, 3);
            const limiter = new Tone.Limiter(-6);
            const synth = new Tone.MonoSynth({
                oscillator: { type: 'sawtooth' },
                filter: { Q: 2.2, type: 'lowpass', rolloff: -12 },
                envelope: {
                    attack: 0.05,
                    decay: 0.2,
                    sustain: 0.8,
                    release: 0.8
                },
                filterEnvelope: {
                    attack: 0.02,
                    decay: 0.18,
                    sustain: 0.3,
                    release: 0.45,
                    baseFrequency: 200,
                    octaves: 4
                },
                portamento: 0.02
            });
            synth.chain(vibrato, drive, compressor, limiter, Tone.Destination);
            synth.volume.value = Number.isFinite(audioState.upperWick.volume) ? audioState.upperWick.volume : -18;
            _sopranoSlide.synth = synth;
            _sopranoSlide.vibrato = vibrato;
            _sopranoSlide.drive = drive;
            _sopranoSlide.compressor = compressor;
            _sopranoSlide.limiter = limiter;
            return synth;
        } catch (_e) {
            return null;
        }
    }

    function updateSopranoSlideVoiceLevel() {
        if (!_sopranoSlide.synth) return;
        const requested = Number.isFinite(audioState.upperWick.volume) ? audioState.upperWick.volume : -18;
        // Keep headroom for the saturated slide chain and user +dB settings.
        _sopranoSlide.synth.volume.value = Math.min(requested, -2);
    }

    function suppressSopranoSamplerForSlide() {
        if (_sopranoSlide.samplerSuppressed) return;
        if (!audioState._sopranoSampler) return;
        try { audioState._sopranoSampler.releaseAll?.(); } catch (_e) {}
        _sopranoSlide.samplerSuppressed = true;
    }

    function clearSopranoSamplerSuppression() {
        _sopranoSlide.samplerSuppressed = false;
    }

    function releaseSopranoSlideVoice(nowSec) {
        if (!_sopranoSlide.synth || !_sopranoSlide.active) return;
        try {
            _sopranoSlide.synth.triggerRelease(Number.isFinite(nowSec) ? nowSec : Tone.now());
        } catch (_e) {}
        _sopranoSlide.active = false;
        _sopranoSlide.currentMidi = null;
        _sopranoSlide.holdUntil = 0;
        _sopranoSlide.lastUpdateSec = 0;
        _activeSopranoNote = null;
    }

    function armSopranoSlideFailSafe(nowSec, err) {
        _sopranoSlide.errorCount = (_sopranoSlide.errorCount || 0) + 1;
        _sopranoSlide.failSafeUntil = (Number.isFinite(nowSec) ? nowSec : Tone.now()) + 30;
        _activeSopranoNote = null;
        clearSopranoSamplerSuppression();
        releaseSopranoSlideVoice(nowSec);
        if (err) {
            console.warn('[Audio] Slide lane fail-safe engaged (30s). Falling back to sampler.', err);
        }
    }

    function shouldSlideToNextSoprano(nextMidi, price) {
        if (!_activeSopranoNote) return false;
        const st = _phrasingState.soprano;
        if (!st || st.lastMidi === null) return false;
        const slurAmount = clamp01(audioState.slurAmount ?? 0.5);
        if (slurAmount >= 0.8) return true;
        if (slurAmount < 0.62) return false;
        const semitoneGap = Math.abs(Number(st.lastMidi) - Number(nextMidi));
        if (!Number.isFinite(semitoneGap) || semitoneGap <= 0 || semitoneGap > 12) return false;

        const visMin = Number(musicState.visiblePriceMin);
        const visMax = Number(musicState.visiblePriceMax);
        const span = (Number.isFinite(visMin) && Number.isFinite(visMax) && visMax > visMin) ? (visMax - visMin) : 1;
        const pNow = Number(price);
        const pPrev = Number(st.lastPrice);
        if (!Number.isFinite(pNow) || !Number.isFinite(pPrev)) return false;
        const priceDeltaNorm = Math.abs(pNow - pPrev) / Math.max(1e-9, span);
        const sustain = clamp01(audioState.sustainFactor ?? 0.35);
        const movementAllowance = 0.0015 + (sustain * 0.01) + (Math.pow(slurAmount, 2.2) * 0.055);
        return priceDeltaNorm <= movementAllowance;
    }

    function playSopranoSlideVoice(midi, nowSec, durationSec, doSlide) {
        const synth = ensureSopranoSlideVoice();
        if (!synth) return false;
        updateSopranoSlideVoiceLevel();

        const slurAmount = clamp01(audioState.slurAmount ?? 0.5);
        if (_sopranoSlide.vibrato && _sopranoSlide.vibrato.depth) {
            // Keep vibrato static/light to avoid automation churn artifacts.
            _sopranoSlide.vibrato.depth.value = 0.06 + (slurAmount * 0.05);
        }
        const midiGap = _sopranoSlide.currentMidi === null
            ? 0
            : Math.abs(Number(_sopranoSlide.currentMidi) - Number(midi));
        const note = Tone.Frequency(midi, 'midi').toNote();

        // Avoid redundant automation churn when target pitch did not change.
        if (_sopranoSlide.active && doSlide && _sopranoSlide.currentMidi === midi) {
            const holdMul = 0.45 + (Math.pow(slurAmount, 2.0) * 1.6);
            _sopranoSlide.holdUntil = nowSec + Math.max(0.05, Math.min(3.2, durationSec * holdMul));
            if (_activeSopranoNote) _activeSopranoNote.midi = midi;
            return true;
        }

        if (!_sopranoSlide.active || !doSlide) {
            // Hard purge before a new phrase to avoid ghost-voice buildup.
            try {
                synth.triggerRelease(nowSec);
            } catch (_e) {}
            const scoopCents = -Math.round(25 + (slurAmount * 90));
            const scoopDur = 0.02 + (slurAmount * 0.07);
            synth.portamento = 0;
            try {
                synth.detune.cancelScheduledValues(nowSec);
                synth.detune.setValueAtTime(scoopCents, nowSec);
                synth.detune.linearRampToValueAtTime(0, nowSec + scoopDur);
            } catch (_e) {}
            try {
                // Tiny offset helps release register before the next attack.
                synth.triggerAttack(note, nowSec + 0.01, 0.78);
            } catch (_e) {
                return false;
            }
            _sopranoSlide.active = true;
            _activeSopranoNote = { midi: midi, startTime: nowSec };
        } else {
            // Throttle glide control updates slightly to reduce high-slur audio-thread churn.
            if (Number.isFinite(_sopranoSlide.lastUpdateSec) && (nowSec - _sopranoSlide.lastUpdateSec) < 0.04) {
                const holdMul = 0.45 + (Math.pow(slurAmount, 2.0) * 1.6);
                _sopranoSlide.holdUntil = nowSec + Math.max(0.05, Math.min(3.2, durationSec * holdMul));
                _sopranoSlide.currentMidi = midi;
                if (_activeSopranoNote) _activeSopranoNote.midi = midi;
                return true;
            }
            const glideSec = Math.max(0.025, Math.min(0.5, Math.pow(midiGap, 0.7) * (0.04 + slurAmount * 0.06)));
            synth.portamento = glideSec;
            try {
                // Use explicit frequency ramps for stability in long-running loops.
                const targetHz = Tone.Frequency(midi, 'midi').toFrequency();
                if (!Number.isFinite(targetHz) || targetHz <= 0) return false;
                if (synth.frequency && synth.frequency.cancelScheduledValues && synth.frequency.linearRampToValueAtTime) {
                    synth.frequency.cancelScheduledValues(nowSec);
                    synth.frequency.linearRampToValueAtTime(targetHz, nowSec + glideSec);
                } else {
                    // Conservative fallback: one controlled re-attack if frequency param
                    // is unavailable on this Tone build.
                    synth.triggerAttack(note, nowSec, 0.72);
                }
            } catch (_e) {
                return false;
            }
            if (_activeSopranoNote) {
                _activeSopranoNote.midi = midi;
            } else {
                _activeSopranoNote = { midi: midi, startTime: nowSec };
            }
        }

        _sopranoSlide.currentMidi = midi;
        _sopranoSlide.lastUpdateSec = nowSec;
        const holdMul = 0.45 + (Math.pow(slurAmount, 2.0) * 1.6);
        _sopranoSlide.holdUntil = nowSec + Math.max(0.05, Math.min(3.2, durationSec * holdMul));
        return true;
    }

    function tickSopranoSlideVoice(nowSec) {
        if (!_sopranoSlide.active) return;
        // Guard against very long uninterrupted mono-voice lifetimes which can
        // degrade in some browser/audio-driver combinations.
        if (_activeSopranoNote && Number.isFinite(_activeSopranoNote.startTime)) {
            const activeFor = nowSec - _activeSopranoNote.startTime;
            if (activeFor > 6.0) {
                releaseSopranoSlideVoice(nowSec);
                return;
            }
        }
        if (Number.isFinite(_sopranoSlide.holdUntil) && nowSec >= _sopranoSlide.holdUntil) {
            releaseSopranoSlideVoice(nowSec);
        }
    }

    function extendLastNoteEvent(voice, durationMs, nowMs) {
        if (!window._audioNoteEvents || !window._audioNoteEvents.length) return;
        for (let i = window._audioNoteEvents.length - 1; i >= 0; i--) {
            const ev = window._audioNoteEvents[i];
            if (!ev || ev.voice !== voice) continue;
            ev.endTime = Math.max(Number(ev.endTime) || 0, nowMs + durationMs);
            ev.durationMs = Math.max(Number(ev.durationMs) || 0, ev.endTime - (Number(ev.time) || nowMs));
            return;
        }
    }

    function pickSopranoRhythmValue(modeOverride) {
        const raw = String(modeOverride || getSopranoRhythmMode());
        if (raw === 'random_4_8_16') {
            const opts = ['4', '8', '16'];
            return opts[Math.floor(Math.random() * opts.length)];
        }
        if (raw === 'random_4_8') {
            return (Math.random() < 0.5) ? '4' : '8';
        }
        if (raw === '1' || raw === '2' || raw === '4' || raw === '8' || raw === '16') return raw;
        return '4';
    }

    function rhythmDurationScale(rhythm) {
        switch (String(rhythm)) {
            case '1': return 1.85;
            case '2': return 1.35;
            case '4': return 1.0;
            case '8': return 0.72;
            case '16': return 0.5;
            default: return 1.0;
        }
    }

    function rhythmBaseDurationSec(rhythm) {
        switch (String(rhythm)) {
            case '1': return SUB_STEP_SECONDS * 16;
            case '2': return SUB_STEP_SECONDS * 8;
            case '4': return SUB_STEP_SECONDS * 4;
            case '8': return SUB_STEP_SECONDS * 2;
            case '16': return SUB_STEP_SECONDS;
            default: return SUB_STEP_SECONDS * 4;
        }
    }

    function clampToRange(v, lo, hi, fb) {
        const n = Number(v);
        const d = Number.isFinite(fb) ? fb : lo;
        if (!Number.isFinite(n)) return d;
        return Math.max(lo, Math.min(hi, n));
    }

    function pickMidiForPcInRange(pc, minMidi, maxMidi, pivotMidi) {
        let best = null;
        let bestDist = Infinity;
        const lo = Math.floor(minMidi);
        const hi = Math.floor(maxMidi);
        for (let m = lo; m <= hi; m++) {
            if ((m % 12) !== pc) continue;
            const dist = Math.abs(m - pivotMidi);
            if (dist < bestDist) {
                best = m;
                bestDist = dist;
            }
        }
        if (best === null) return clampToRange(pivotMidi, minMidi, maxMidi, minMidi);
        return best;
    }

    function wrapMidiToRange(midi, minMidi, maxMidi) {
        if (!Number.isFinite(midi)) return minMidi;
        const lo = Math.floor(minMidi);
        const hi = Math.floor(maxMidi);
        if (hi <= lo) return lo;
        let m = Math.round(midi);
        while (m < lo) m += 12;
        while (m > hi) m -= 12;
        return clampToRange(m, lo, hi, lo);
    }

    function isHarmonicAwareEnabled() {
        return audioState.harmonicAwareScale !== false;
    }

    function buildVoicePools(voice, regime, range) {
        const fallbackScalePool = getScaleNotes(regime, musicState.rootMidi, range.min, range.max);
        const chordPool = getChordTonesInRange(range.min, range.max);
        if (!isHarmonicAwareEnabled() || typeof getTonalContext !== 'function') {
            return {
                scalePool: fallbackScalePool,
                chordPool: chordPool,
                tonalContext: null
            };
        }
        const tonalContext = getTonalContext({
            regime: regime,
            rootMidi: musicState.rootMidi,
            minMidi: range.min,
            maxMidi: range.max,
            voice: voice,
            chordStep: musicState.progressionStep
        });
        const playable = tonalContext && tonalContext.playableNotes && tonalContext.playableNotes.length > 0
            ? tonalContext.playableNotes
            : fallbackScalePool;
        return {
            scalePool: playable,
            chordPool: chordPool,
            tonalContext: tonalContext
        };
    }

    function applyAvoidGravity(midi, tonalContext) {
        if (!isHarmonicAwareEnabled() || !tonalContext) return midi;
        if (!Number.isFinite(midi)) return midi;
        if (!isAvoidNoteForTonalContext || !nearestStructuralNote) return midi;
        if (!isAvoidNoteForTonalContext(midi, tonalContext)) return midi;
        return nearestStructuralNote(midi, tonalContext, 12);
    }

    function applyStrongBeatLanding(midi, tonalContext, subStepInBar) {
        if (!isHarmonicAwareEnabled() || !tonalContext) return midi;
        if (!nearestStructuralNote) return midi;
        const isStrongBeat = subStepInBar === 0 || subStepInBar === 8;
        if (!isStrongBeat) return midi;
        return nearestStructuralNote(midi, tonalContext, 18);
    }

    function snapHarmonyMidiToTonalContext(candidateMidi, tonalContext, forceStructural) {
        if (!isHarmonicAwareEnabled() || !tonalContext || !Number.isFinite(candidateMidi)) {
            return candidateMidi;
        }
        let midi = candidateMidi;
        if (Array.isArray(tonalContext.playableNotes) && tonalContext.playableNotes.length > 0) {
            midi = nearestScaleNote(midi, tonalContext.playableNotes, 8);
        }
        midi = applyAvoidGravity(midi, tonalContext);
        if (forceStructural) {
            midi = nearestStructuralNote(midi, tonalContext, 12);
        }
        return midi;
    }

    // ========================================================================
    // PATTERN OVERRIDE STATE & GENERATOR
    // ========================================================================

    // Per-voice state for the simple pattern override mode.
    // Reset in startAudioAnimation(), read by generatePatternNote().
    const _overrideState = {
        soprano: { idx: 0, dir: 1, lastProgStep: -1, altToggle: false, altCounter: 0, prevMidi: 72 },
        bass:    { idx: 0, dir: 1, lastProgStep: -1, altToggle: false, altCounter: 0, prevMidi: 48 }
    };

    function resetOverrideState() {
        _overrideState.soprano = { idx: 0, dir: 1, lastProgStep: -1, altToggle: false, altCounter: 0, prevMidi: 72 };
        _overrideState.bass    = { idx: 0, dir: 1, lastProgStep: -1, altToggle: false, altCounter: 0, prevMidi: 48 };
    }

    /**
     * Generate a MIDI note using a simple, deterministic pattern.
     * These are diagnostic/test patterns that bypass the deep pathfinder.
     *
     * @param {'soprano'|'bass'} voice
     * @param {string} pattern       - Pattern key from the dropdown
     * @param {number[]} scalePool   - Sorted scale notes in voice range
     * @param {number[]} chordPool   - Sorted chord tones in voice range
     * @param {{root:number, third:number, fifth:number}} chordPCs - Pitch classes
     * @param {boolean} restartOnChord - Reset index when chord changes
     * @returns {number} MIDI note
     */
    function generatePatternNote(voice, pattern, scalePool, chordPool, chordPCs, restartOnChord) {
        const os = _overrideState[voice];
        const currentProgStep = musicState.progressionStep;
        const chordChanged = (currentProgStep !== os.lastProgStep);
        os.lastProgStep = currentProgStep;

        // ── Determine the pool for this pattern ──
        let pool;
        let isChordPool = false;

        switch (pattern) {
            case 'scale_asc':
            case 'scale_asc_desc':
                pool = scalePool;  // already sorted ascending
                break;
            case 'arp_asc':
            case 'arp_asc_desc':
            case 'random_chord':
                pool = chordPool;
                isChordPool = true;
                break;
            case 'scale_arp_alt':
            case 'scale_arp_alt_ad':
                pool = os.altToggle ? chordPool : scalePool;
                isChordPool = os.altToggle;
                break;
            case 'root_only': {
                // Filter to root pitch class only
                const roots = chordPool.filter(n => n % 12 === chordPCs.root);
                pool = roots.length > 0 ? roots : chordPool;
                isChordPool = true;
                break;
            }
            case 'root_3rd_5th':
                pool = chordPool;
                isChordPool = true;
                break;
            default:
                pool = scalePool;
        }

        if (!pool || pool.length === 0) return os.prevMidi;

        // ── Handle chord change ──
        if (chordChanged) {
            if (restartOnChord) {
                // Find the chord root in the current pool and reset index there
                const rootIdx = pool.findIndex(n => n % 12 === chordPCs.root);
                os.idx = rootIdx !== -1 ? rootIdx : 0;
                os.dir = 1;
                if (pattern === 'scale_arp_alt' || pattern === 'scale_arp_alt_ad') {
                    os.altToggle = false;
                    os.altCounter = 0;
                    os.dir = 1;
                }
            } else if (isChordPool) {
                // Pool changed (new chord tones) — snap index to nearest note
                let bestIdx = 0;
                let bestDist = Infinity;
                for (let i = 0; i < pool.length; i++) {
                    const d = Math.abs(pool[i] - os.prevMidi);
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                }
                os.idx = bestIdx;
            }
        }

        // ── Generate the note ──
        let midi;

        switch (pattern) {
            case 'scale_asc':
            case 'arp_asc':
            case 'root_only':
            case 'root_3rd_5th':
                // Ascending only, wrap at end
                os.idx = ((os.idx % pool.length) + pool.length) % pool.length;
                midi = pool[os.idx];
                os.idx++;
                break;

            case 'scale_asc_desc':
            case 'arp_asc_desc':
                // Ping-pong
                if (pool.length <= 1) {
                    midi = pool[0];
                    break;
                }
                os.idx = Math.max(0, Math.min(os.idx, pool.length - 1));
                midi = pool[os.idx];
                os.idx += os.dir;
                if (os.idx >= pool.length) {
                    os.idx = pool.length - 2;
                    os.dir = -1;
                } else if (os.idx < 0) {
                    os.idx = 1;
                    os.dir = 1;
                }
                break;

            case 'scale_arp_alt':
                // Ascending in current pool; switch between scale & arpeggio every 4 notes
                os.idx = ((os.idx % pool.length) + pool.length) % pool.length;
                midi = pool[os.idx];
                os.idx++;
                os.altCounter++;
                if (os.altCounter >= 4) {
                    os.altToggle = !os.altToggle;
                    os.altCounter = 0;
                    // Snap index into the new pool
                    const newPool = os.altToggle ? chordPool : scalePool;
                    if (newPool && newPool.length > 0) {
                        let bi = 0;
                        let bd = Infinity;
                        for (let i = 0; i < newPool.length; i++) {
                            const d = Math.abs(newPool[i] - midi);
                            if (d < bd) { bd = d; bi = i; }
                        }
                        os.idx = bi;
                    }
                }
                break;

            case 'scale_arp_alt_ad':
                // Like scale_arp_alt but flips direction (asc↔desc) on each pool switch
                // Cycle: scale ascending → arpeggio descending → scale ascending → ...
                if (pool.length <= 1) {
                    midi = pool[0] || os.prevMidi;
                } else {
                    os.idx = Math.max(0, Math.min(os.idx, pool.length - 1));
                    midi = pool[os.idx];
                    os.idx += os.dir;
                    // Bounce at pool edges (prevents note repeats from clamping)
                    if (os.idx >= pool.length) {
                        os.idx = pool.length - 2;
                        os.dir = -1;
                    } else if (os.idx < 0) {
                        os.idx = 1;
                        os.dir = 1;
                    }
                }
                os.altCounter++;
                if (os.altCounter >= 4) {
                    os.altToggle = !os.altToggle;
                    os.dir = -os.dir;  // Flip primary direction on each pool switch
                    os.altCounter = 0;
                    const newPool2 = os.altToggle ? chordPool : scalePool;
                    if (newPool2 && newPool2.length > 1) {
                        // Snap to nearest note in new pool
                        let bi2 = 0;
                        let bd2 = Infinity;
                        for (let i = 0; i < newPool2.length; i++) {
                            const d = Math.abs(newPool2[i] - midi);
                            if (d < bd2) { bd2 = d; bi2 = i; }
                        }
                        // Step past the snap point so the first note of the new phase
                        // is different from the last note of the previous phase
                        os.idx = bi2 + os.dir;
                        if (os.idx >= newPool2.length) os.idx = newPool2.length - 2;
                        if (os.idx < 0) os.idx = 1;
                    }
                }
                break;

            case 'random_chord':
                midi = pool[Math.floor(Math.random() * pool.length)];
                break;

            default:
                midi = pool[0];
        }

        os.prevMidi = midi;
        return midi;
    }

    // ========================================================================
    // ANIMATION LOOP
    // ========================================================================

    /**
     * Start the audio playback animation loop
     * This creates its own animation that advances through chart data
     * Uses SMOOTH continuous scrolling (time-based, like Market Inventions demo)
     */
    function startAudioAnimation() {
        if (audioState._animationRunning) return;
        
        // Get current chart data
        if (typeof state === 'undefined' || !state.data || state.data.length < 2) {
            console.warn('[Audio] No chart data available for animation');
            updateStatus('Load chart data first');
            return;
        }

        audioState._animationRunning = true;
        
        // Store original scroll state to restore later
        audioState._originalFollowLatest = state.followLatest;
        audioState._originalXOffset = state.xOffset;
        
        // Disable auto-follow so we can control scrolling
        state.followLatest = false;
        
        // Calculate bars per millisecond based on speed slider
        // Speed value IS the BPM (bars per minute)
        const speedValue = ui.speed ? parseInt(ui.speed.value, 10) : 60;
        const bpm = speedValue;
        audioState._barsPerMs = bpm / 60000;  // Convert BPM to bars per millisecond
        audioState._currentBpm = bpm;  // Store for reference
        
        // Calculate how many bars are visible so we can position correctly
        const n = state.data.length;
        const vb = typeof computeVisibleBars === 'function' ? computeVisibleBars(n, state.xZoom) : { barsVisibleData: 50 };
        const barsVisible = vb.barsVisibleData;
        
        // For the playhead to show the CURRENT bar at CENTER from the very start,
        // and for the chart to scroll immediately, we must start smoothPosition
        // at a value where xOffset = 0, which is: smoothPosition = PLAYHEAD_POSITION * barsVisible
        // This means audio starts from bar ~(barsVisible/2), not bar 0
        const startBarIndex = Math.floor(PLAYHEAD_POSITION * barsVisible);
        audioState._smoothPosition = startBarIndex;
        audioState._subStepPosition = startBarIndex * SUB_STEP_COUNT;  // Track sub-steps
        audioState._lastSubStep = (startBarIndex * SUB_STEP_COUNT) - 1;
        audioState._animStartTime = performance.now();
        audioState._lastFrameTime = audioState._animStartTime;
        
        // Reset held note tracking
        currentSopranoNote = null;
        currentBassNote = null;
        _activeSopranoNote = null;
        _phrasingState.soprano.lastMidi = null;
        _phrasingState.soprano.lastPrice = null;
        _phrasingState.bass.lastMidi = null;
        _phrasingState.bass.lastPrice = null;
        releaseSopranoSlideVoice(Tone.now());
        
        // Reset reference prices for fresh MIDI mapping
        audioState._referencePrice = null;
        audioState._sopranoRef = null;
        audioState._bassRef = null;
        musicState._prevSopranoPrice = null;
        musicState._prevBassPrice = null;
        // Pre-advance sentinel so first processed bar is progression step 0.
        musicState.progressionStep = 15;
        window._audioChordEvents = [];  // Reset chord overlay events
        window._audioDrumEvents = [];   // Reset drum highlight events
        window._audioDrumStep = null;   // Legacy active-step marker
        resetOverrideState();           // Reset pattern override state
        musicState.prevBarClose = null;
        musicState.consecutiveDownBars = 0;
        musicState.consecutiveUpBars = 0;
        musicState.regime = 'UPTREND';
        musicState.subStepCounter = 0;  // Reset sub-step counter
        
        // Reset melodic state (per-voice pathfinder cells)
        musicState.sopranoHistory = [];
        musicState.bassHistory = [];
        musicState.soprano.runMode = null;
        musicState.soprano.runStepsRemaining = 0;
        musicState.soprano.runTargetNote = null;
        musicState.soprano.arpeggioIndex = 0;
        musicState.soprano.lastCellType = null;
        musicState.soprano.sequenceBase = 0;
        musicState.soprano.enclosurePhase = 0;
        musicState.soprano.direction = 1;
        musicState.bass.runMode = null;
        musicState.bass.runStepsRemaining = 0;
        musicState.bass.runTargetNote = null;
        musicState.bass.arpeggioIndex = 0;
        musicState.bass.walkDegreeIndex = 0;
        musicState.bass.lastCellType = null;
        musicState.bass.direction = 1;
        // Legacy aliases
        musicState.runMode = null;
        musicState.runStepsRemaining = 0;
        musicState.arpeggioIndex = 0;
        
        // Update visible price range from chart data
        updateVisiblePriceRange();
        
        // Set initial reference prices from starting bar
        const startBar = state.data[startBarIndex];
        if (startBar) {
            audioState._sopranoRef = startBar.h;
            audioState._bassRef = startBar.l;
            console.log('[Audio] Initial refs - soprano:', startBar.h.toFixed(2), 'bass:', startBar.l.toFixed(2));
        }
        
        // Initial scroll position: xOffset = startBarIndex - PLAYHEAD_POSITION * barsVisible ≈ 0
        state.xOffset = 0;
        
        console.log('[Audio] Starting from bar', startBarIndex, 'of', n, '(chart scrolls immediately, playhead at center)');
        
        console.log('[Audio] Starting SMOOTH animation, bars:', n, 'barsVisible:', barsVisible, 'barsPerMs:', audioState._barsPerMs.toFixed(6));
        updateStatus('Playing...');
        
        // Resume audio context (required by browsers after user interaction)
        if (Tone.context.state !== 'running') {
            Tone.context.resume().then(() => {
                console.log('[Audio] Context resumed');
            });
        }
        
        // Initial draw to show playhead immediately
        if (typeof draw === 'function') {
            draw();
        }
        
        // Start the animation loop
        audioState._animationFrame = requestAnimationFrame(smoothAnimationLoop);
    }

    /**
     * Stop the audio animation loop (full stop — resets position)
     */
    function stopAudioAnimation() {
        audioState._animationRunning = false;
        if (audioState._animationFrame) {
            cancelAnimationFrame(audioState._animationFrame);
            audioState._animationFrame = null;
        }
        
        // Restore original view settings
        if (typeof audioState._originalFollowLatest !== 'undefined') {
            state.followLatest = audioState._originalFollowLatest;
        }
        
        // Clear playhead and chord overlay
        window._audioPlayheadIndex = -1;
        window._audioChordEvents = [];
        window._audioDrumEvents = [];
        window._audioDrumStep = null;
        audioState._smoothPosition = 0;
        _phrasingState.soprano.lastMidi = null;
        _phrasingState.soprano.lastPrice = null;
        _phrasingState.bass.lastMidi = null;
        _phrasingState.bass.lastPrice = null;
        _activeSopranoNote = null;
        releaseSopranoSlideVoice(Tone.now());
        if (typeof window.requestDraw === 'function') {
            window.requestDraw('audio_stop');
        }
    }

    /**
     * Pause the audio animation — stops the loop and silences audio but
     * preserves all position state so playback can be resumed from the same spot.
     */
    function pauseAudioAnimation() {
        audioState._animationRunning = false;
        if (audioState._animationFrame) {
            cancelAnimationFrame(audioState._animationFrame);
            audioState._animationFrame = null;
        }
        // Silence any currently ringing notes
        if (audioState._sopranoSampler) audioState._sopranoSampler.releaseAll();
        if (audioState._bassSampler) audioState._bassSampler.releaseAll();
        _activeSopranoNote = null;
        releaseSopranoSlideVoice(Tone.now());
        // Pause Tone.Transport so scheduled events don't fire
        if (Tone.Transport.state === 'started') {
            Tone.Transport.pause();
        }
        console.log('[Audio] Paused at position', audioState._smoothPosition.toFixed(2));
    }

    /**
     * Resume the audio animation from the paused position.
     * Re-enters the RAF loop from where it left off.
     */
    function resumeAudioAnimation() {
        if (audioState._animationRunning) return;  // Already running
        
        audioState._animationRunning = true;
        // Reset the frame timer so the first frame doesn't produce a huge dt
        audioState._lastFrameTime = performance.now();
        
        // Resume Tone.Transport
        if (Tone.Transport.state === 'paused') {
            Tone.Transport.start();
        } else if (Tone.context.state !== 'running') {
            Tone.context.resume();
        }
        
        console.log('[Audio] Resumed from position', audioState._smoothPosition.toFixed(2));
        audioState._animationFrame = requestAnimationFrame(smoothAnimationLoop);
    }

    /**
     * SMOOTH animation loop - runs every frame for continuous scrolling
     * Now with 16 sub-steps per bar like Market Inventions
     */
    function smoothAnimationLoop(timestamp) {
        if (!audioState._animationRunning || !audioState.playing) {
            console.warn('[Audio] Animation stopped - running:', audioState._animationRunning, 'playing:', audioState.playing);
            stopAudioAnimation();
            return;
        }
        
        if (!audioState._initialized) {
            console.warn('[Audio] Animation running but not initialized');
            stopAudioAnimation();
            return;
        }
        // Auto-resume audio context if browser suspended it during long playback.
        if (Tone && Tone.context && Tone.context.state !== 'running') {
            const nowMs = performance.now();
            const lastTry = Number(audioState._lastContextResumeTryMs || 0);
            if ((nowMs - lastTry) > 2000) {
                audioState._lastContextResumeTryMs = nowMs;
                Tone.context.resume().catch(() => {});
            }
        }

        // Calculate time delta since last frame
        const deltaMs = timestamp - audioState._lastFrameTime;
        audioState._lastFrameTime = timestamp;
        
        // Clamp delta to avoid huge jumps if tab was backgrounded
        const clampedDelta = Math.min(deltaMs, 100);
        
        // Calculate sub-steps per millisecond based on BPM
        // At 60 BPM: 1 bar/sec, 16 sub-steps/bar → 16 sub-steps/sec → 0.016 sub-steps/ms
        const bpm = audioState._currentBpm || 60;
        const subStepsPerMs = (bpm / 60) * SUB_STEP_COUNT / 1000;
        
        // Track old sub-step position
        const oldSubStepPos = audioState._subStepPosition || 0;
        
        // Advance sub-step position
        audioState._subStepPosition = (audioState._subStepPosition || 0) + clampedDelta * subStepsPerMs;
        
        // Calculate bar position from sub-steps
        audioState._smoothPosition = audioState._subStepPosition / SUB_STEP_COUNT;
        
        // Check if we've reached the end
        const maxPosition = state.data.length - 1;
        if (audioState._smoothPosition >= maxPosition) {
            // Loop back to start
            audioState._smoothPosition = 0;
            audioState._subStepPosition = 0;
            audioState._lastSubStep = -1;
            // Reset music state for fresh start
            // Pre-advance sentinel so loop restarts from progression step 0.
            musicState.progressionStep = 15;
            musicState.prevBarClose = null;
            currentSopranoNote = null;
            currentBassNote = null;
            _phrasingState.soprano.lastMidi = null;
            _phrasingState.soprano.lastPrice = null;
            _phrasingState.bass.lastMidi = null;
            _phrasingState.bass.lastPrice = null;
        }
        
        // Get current sub-step (global across all bars)
        const currentSubStep = Math.floor(audioState._subStepPosition);
        const lastSubStep = audioState._lastSubStep ?? -1;
        
        // Process each sub-step we've crossed
        if (currentSubStep > lastSubStep) {
            for (let subStep = lastSubStep + 1; subStep <= currentSubStep; subStep++) {
                const barIndex = Math.floor(subStep / SUB_STEP_COUNT);
                const subStepInBar = subStep % SUB_STEP_COUNT;
                
                if (barIndex < state.data.length) {
                    try {
                        processSubStep(barIndex, subStepInBar, subStep);
                    } catch (e) {
                        console.error('[Audio] Error in processSubStep:', e);
                    }
                }
            }
            audioState._lastSubStep = currentSubStep;
        }
        
        // Update the chart scroll position EVERY FRAME for smooth animation
        try {
            updateSmoothScroll(audioState._smoothPosition);
        } catch (e) {
            console.error('[Audio] Error in updateSmoothScroll:', e);
        }
        
        // Debug: log every ~2 seconds (120 frames at 60fps)
        if (!audioState._frameCount) audioState._frameCount = 0;
        audioState._frameCount++;
        if (audioState._frameCount % 120 === 0) {
            console.log('[Audio] Frame', audioState._frameCount, 'bar:', Math.floor(audioState._smoothPosition), 'subStep:', currentSubStep);
        }
        
        // Continue the loop
        audioState._animationFrame = requestAnimationFrame(smoothAnimationLoop);
    }

    // ========================================================================
    // THE CONDUCTOR (processSubStep)
    // ========================================================================

    /**
     * Process a single sub-step (1/16th of a bar)
     * 
     * THE CONDUCTOR: Orchestrates the Pathfinding Sequencer
     * 
     * Flow:
     * 1. On bar boundaries: update regime, advance progression, update viewport range
     * 2. On soprano rhythm boundaries: run soprano pathfinder (scale runs, arpeggios, orbits)
     * 3. On bass rhythm boundaries: run bass pathfinder (walking bass, chord leaps)
     * 4. Apply genre-specific complexity (stochastic interruptions scaled by Complexity slider)
     * 5. Trigger audio and emit visual events
     * 
     * 4-note cells (runs/arpeggios) cross bar boundaries for fluid sound.
     * New bar only updates the TARGET — the current cell completes before a new one starts.
     */
    function processSubStep(barIndex, subStepInBar, globalSubStep) {
        if (!audioState.playing || !audioState._initialized) {
            return;
        }
        
        const barData = state.data[barIndex];
        if (!barData) {
            return;
        }
        
        const now = Tone.now();
        const perfNow = performance.now();
        tickSopranoSlideVoice(now);
        let regime = musicState.regime;
        const complexity = audioState.sensitivity || 0.5;  // Complexity slider (0=pure, 1=chaotic)
        
        // Drum beat (every sub-step; pattern decides what to play)
        if (playDrumStep) {
            const drumBeat = audioState.drumBeat || 'standard_11piece';
            const drumHits = playDrumStep(drumBeat, subStepInBar, now);
            if (drumHits) {
                emitDrumStepEvent(barIndex, subStepInBar, drumHits, perfNow);
            }
        }
        
        // ── BAR BOUNDARY: Update targets, regime, progression ──
        if (subStepInBar === 0) {
            updateRegimeFromPrice(barData.c);
            advanceProgression();
            regime = musicState.regime;
            // Periodic cleanup guard against stuck sampler voices.
            if ((barIndex % 4) === 0) {
                try { audioState._sopranoSampler && audioState._sopranoSampler.releaseAll?.(); } catch (_e) {}
                try { audioState._bassSampler && audioState._bassSampler.releaseAll?.(); } catch (_e) {}
                try { audioState._harmonySampler && audioState._harmonySampler.releaseAll?.(); } catch (_e) {}
            }

            // Emit chord event for visual overlay
            emitChordEvent(barIndex);
            
            // Refresh viewport price range every bar for tight wick-hugging
            updateVisiblePriceRange();
            
            // Update targets for both voices (but DON'T reset current cells)
            const rawSopranoTarget = priceToMidi(barData.h, 'soprano');
            const rawBassTarget = priceToMidi(barData.l, 'bass');
            if (rawSopranoTarget !== null) musicState.soprano.runTargetNote = rawSopranoTarget;
            if (rawBassTarget !== null) musicState.bass.runTargetNote = rawBassTarget;
            
            if (barIndex % 10 === 0) {
                console.log('[Audio] Bar', barIndex, 'regime:', regime, 
                    'soprano cell:', musicState.soprano.runMode, '(' + musicState.soprano.runStepsRemaining + ')',
                    'bass cell:', musicState.bass.runMode, '(' + musicState.bass.runStepsRemaining + ')');
            }
        }
        
        // Calculate precise bar position for visual events
        const preciseBarIndex = barIndex + (subStepInBar / SUB_STEP_COUNT);
        
        // Build scale and chord pools (shared by both voices)
        const sopranoRange = getDynamicMidiRange('soprano');
        const bassRange = getDynamicMidiRange('bass');
        const sopranoPools = buildVoicePools('soprano', regime, sopranoRange);
        const bassPools = buildVoicePools('bass', regime, bassRange);
        const sopranoScalePool = sopranoPools.scalePool;
        const bassScalePool = bassPools.scalePool;
        const sopranoChordPool = sopranoPools.chordPool;
        const bassChordPool = bassPools.chordPool;
        const sopranoTonalContext = sopranoPools.tonalContext;
        const bassTonalContext = bassPools.tonalContext;
        
        // ── SOPRANO PATHFINDER (High Agility: runs, arpeggios, orbits) ──
        const sopranoPulse = shouldTriggerSopranoPulse(subStepInBar);
        const shouldPlaySoprano = sopranoPulse.shouldPlay;
        const slidePathEnabled = isSopranoSlidePathEnabled();
        if (audioState.upperWick.enabled && !shouldPlaySoprano && slidePathEnabled && _sopranoSlide.active) {
            // Strict monophonic policy: no orphan tails when soprano is gated off.
            releaseSopranoSlideVoice(now);
            clearSopranoSamplerSuppression();
        }
        
        let sopranoMidi = musicState.prevSoprano || 72;
        
        if (audioState.upperWick.enabled && shouldPlaySoprano) {
            // ── PATTERN OVERRIDE: deterministic test patterns bypass the pathfinder ──
            if (audioState.upperWick.patternOverride) {
                const chordPCs = getChordComponentPCs();
                sopranoMidi = generatePatternNote('soprano', audioState.upperWick.pattern,
                    sopranoScalePool, sopranoChordPool, chordPCs, audioState.upperWick.restartOnChord);
            }
            // ── DEEP PATHFINDER (Complexity / Melodic Range controlled) ──
            else {
                const vs = musicState.soprano;
                const rawTarget = priceToMidi(barData.h, 'soprano');
                let targetMidi = rawTarget !== null 
                    ? nearestScaleNote(rawTarget, sopranoScalePool, 24)
                    : musicState.prevSoprano || 72;
                targetMidi = applyAvoidGravity(targetMidi, sopranoTonalContext);
                
                // Update target (allows mid-cell target drift)
                vs.runTargetNote = targetMidi;
                
                if (vs.runStepsRemaining > 0) {
                    // ── CONTINUE CURRENT CELL (no interference — let the cell breathe) ──
                    sopranoMidi = executeSopranoRunStep(sopranoScalePool, sopranoChordPool);
                    vs.runStepsRemaining--;
                    const extremeDrift = Math.abs(sopranoMidi - targetMidi) > 18;
                    if (extremeDrift) {
                        vs.runStepsRemaining = 0;
                    }
                } else {
                    // ══════════════════════════════════════════════════════════════
                    // PATHFINDER CELL SELECTION — the core algorithm:
                    //   Distance > 4 semitones from wick → SCALE RUN
                    //   Distance ≤ 4 semitones from wick → ORBIT
                    //   Complexity slider controls chance of INTERRUPTION
                    // ══════════════════════════════════════════════════════════════
                    const pattern = detectMelodicPattern(musicState.sopranoHistory);
                    const prev = musicState.prevSoprano || 72;
                    const distance = Math.abs(targetMidi - prev);
                    const direction = targetMidi >= prev ? 1 : -1;
                    
                    let cellType;
                    
                    if (pattern === 'stuck') {
                        cellType = 'leap_fill';
                    } else if (pattern === 'trill') {
                        cellType = 'sequence';
                    } else if (distance > 4) {
                        const interruptChance = complexity * 0.3;
                        if (Math.random() < interruptChance) {
                            const roll = Math.random();
                            if (roll < 0.4)       cellType = 'leap_fill';
                            else if (roll < 0.7)  cellType = 'sequence';
                            else                  cellType = 'chord_skip';
                        } else {
                            cellType = 'scale_run';
                        }
                    } else {
                        const interruptChance = complexity * 0.4;
                        if (Math.random() < interruptChance) {
                            const roll = Math.random();
                            if (roll < 0.3)       cellType = 'arpeggio';
                            else if (roll < 0.55) cellType = 'enclosure';
                            else if (roll < 0.75) cellType = 'sequence';
                            else                  cellType = 'chord_skip';
                        } else {
                            cellType = 'orbit';
                        }
                    }
                    
                    if (cellType === vs.lastCellType && complexity > 0.15) {
                        const nearAlts = ['orbit', 'arpeggio', 'enclosure', 'sequence'];
                        const farAlts = ['scale_run', 'leap_fill', 'sequence', 'chord_skip'];
                        const alternatives = distance > 4 ? farAlts : nearAlts;
                        const filtered = alternatives.filter(t => t !== cellType);
                        cellType = filtered[Math.floor(Math.random() * filtered.length)];
                    }
                    
                    vs.lastCellType = cellType;
                    vs.direction = direction;
                    vs.enclosurePhase = 0;
                    
                    if (cellType === 'sequence') {
                        const sortedPool = [...sopranoScalePool].sort((a, b) => a - b);
                        const curIdx = sortedPool.findIndex(n => Math.abs(n - prev) <= 2);
                        vs.sequenceBase = curIdx !== -1 ? curIdx : Math.floor(sortedPool.length / 2);
                    }
                    
                    startVoiceCell('soprano', cellType, targetMidi, sopranoScalePool, sopranoChordPool);
                    sopranoMidi = executeSopranoRunStep(sopranoScalePool, sopranoChordPool);
                    vs.runStepsRemaining--;
                }
                
                // Genre-specific complexity: BEAT-GATED interruptions only
                const isMidCell = musicState.soprano.runStepsRemaining > 0 && musicState.soprano.runStepsRemaining < (musicState.soprano.cellSize - 1);
                const isRunOrOrbit = (musicState.soprano.runMode === 'scale_run' || musicState.soprano.runMode === 'orbit');
                if (!isMidCell || !isRunOrOrbit) {
                    sopranoMidi = applyGenreComplexity(sopranoMidi, sopranoScalePool, sopranoChordPool, subStepInBar, 'soprano');
                }
                
                // Wick gravity: SAFETY NET only for extreme drift
                const sopranoDrift = Math.abs(sopranoMidi - targetMidi);
                if (sopranoDrift > 14) {
                    sopranoMidi = applyWickGravity(sopranoMidi, targetMidi, sopranoScalePool, 'soprano');
                }
            }

            // Harmonic safety in the conductor: avoid-note gravity + strong-beat landing.
            sopranoMidi = applyAvoidGravity(sopranoMidi, sopranoTonalContext);
            sopranoMidi = applyStrongBeatLanding(sopranoMidi, sopranoTonalContext, subStepInBar);
            
            // ── COMMON: clamp, history, trigger, emit ──
            sopranoMidi = Math.max(sopranoRange.min, Math.min(sopranoRange.max, sopranoMidi));
            updateSopranoHistory(sopranoMidi);
            
            const sopranoRhythmForNote = pickSopranoRhythmValue(sopranoPulse.mode);
            const baseSopranoDurationSec = computeDynamicDurationSec(barIndex, 'soprano') * rhythmDurationScale(sopranoRhythmForNote);
            const sopranoDurationSec = applySlurDurationScale(baseSopranoDurationSec, 'soprano');
            const sopranoDurationMs = sopranoDurationSec * 1000;
            const tieSoprano = shouldTieNote('soprano', sopranoMidi, barData.h);
            const hadActiveSoprano = !!_activeSopranoNote;
            const slideTransition = slidePathEnabled && shouldSlideToNextSoprano(sopranoMidi, barData.h);
            let slidePlayed = false;
            if (audioState._sopranoSampler) {
                const noteFreq = Tone.Frequency(sopranoMidi, 'midi').toNote();
                if (!tieSoprano && !slidePathEnabled) {
                    try {
                        audioState._sopranoSampler.triggerAttackRelease(noteFreq, sopranoDurationSec, now, 0.7);
                    } catch (e) {}
                }
            }
            if (slidePathEnabled) {
                // Stop sampler tails once when entering slide mode; avoid per-step
                // release spam that can cause audible zipper/static artifacts.
                suppressSopranoSamplerForSlide();
                try {
                    slidePlayed = playSopranoSlideVoice(sopranoMidi, now, sopranoDurationSec, slideTransition);
                } catch (slideErr) {
                    slidePlayed = false;
                    armSopranoSlideFailSafe(now, slideErr);
                }
            } else {
                clearSopranoSamplerSuppression();
                _activeSopranoNote = null;
                releaseSopranoSlideVoice(now);
            }
            if (tieSoprano || (slidePathEnabled && hadActiveSoprano && slidePlayed)) {
                if (tieSoprano && !slidePathEnabled && audioState._sopranoSampler) {
                    try {
                        // Keep tied notes audible even when reattack is reduced.
                        const noteFreq = Tone.Frequency(sopranoMidi, 'midi').toNote();
                        audioState._sopranoSampler.triggerAttackRelease(noteFreq, Math.max(0.08, sopranoDurationSec * 0.9), now, 0.42);
                    } catch (_e) {}
                }
                extendLastNoteEvent('soprano', sopranoDurationMs, perfNow);
            } else {
                emitSubStepNote('soprano', sopranoMidi, barData.h, preciseBarIndex, sopranoDurationMs, perfNow, sopranoRhythmForNote);
            }
            if (slidePathEnabled && !slidePlayed && !tieSoprano && audioState._sopranoSampler) {
                const noteFreq = Tone.Frequency(sopranoMidi, 'midi').toNote();
                try {
                    audioState._sopranoSampler.triggerAttackRelease(noteFreq, sopranoDurationSec, now, 0.7);
                } catch (_e) {}
            }
            _phrasingState.soprano.lastMidi = sopranoMidi;
            _phrasingState.soprano.lastPrice = Number(barData.h);
            musicState.prevSoprano = sopranoMidi;
        }
        
        // ── BASS PATHFINDER (High Stability: walking bass, root/4th/5th leaps) ──
        const bassPhrasingEnabled = !!audioState.phrasingApplyToBass;
        const bassRhythm = parseInt(audioState.lowerWick.rhythm) || 2;
        const bassInterval = SUB_STEP_COUNT / bassRhythm;
        const shouldPlayBass = bassPhrasingEnabled
            ? shouldTriggerRhythmicPulse(subStepInBar, 'bass')
            : (subStepInBar % bassInterval === 0);
        
        let bassMidi = musicState.prevBass || 48;
        
        if (audioState.lowerWick.enabled && shouldPlayBass) {
            // ── PATTERN OVERRIDE: deterministic test patterns bypass the pathfinder ──
            if (audioState.lowerWick.patternOverride) {
                const chordPCs = getChordComponentPCs();
                bassMidi = generatePatternNote('bass', audioState.lowerWick.pattern,
                    bassScalePool, bassChordPool, chordPCs, audioState.lowerWick.restartOnChord);
            }
            // ── DEEP PATHFINDER (Complexity / Melodic Range controlled) ──
            else {
                const vb = musicState.bass;
                const rawTarget = priceToMidi(barData.l, 'bass');
                let targetMidi = rawTarget !== null
                    ? nearestScaleNote(rawTarget, bassScalePool, 24)
                    : musicState.prevBass || 48;
                targetMidi = applyAvoidGravity(targetMidi, bassTonalContext);
                
                vb.runTargetNote = targetMidi;
                
                if (vb.runStepsRemaining > 0) {
                    bassMidi = executeWalkingStep(bassScalePool, bassChordPool);
                    vb.runStepsRemaining--;
                    const extremeDrift = Math.abs(bassMidi - targetMidi) > 20;
                    if (extremeDrift) {
                        vb.runStepsRemaining = 0;
                    }
                } else {
                    // ══════════════════════════════════════════════════════════════
                    // BASS PATHFINDER — distance-based logic:
                    //   Distance > 5 semitones → WALK toward target
                    //   Distance ≤ 5 semitones → ARPEGGIO around target
                    //   Complexity adds chromatic approaches and pattern variety
                    // ══════════════════════════════════════════════════════════════
                    const pattern = detectMelodicPattern(musicState.bassHistory);
                    const prev = musicState.prevBass || 48;
                    const distance = Math.abs(targetMidi - prev);
                    const direction = targetMidi >= prev ? 1 : -1;
                    
                    let cellType;
                    
                    if (pattern === 'stuck') {
                        cellType = 'chromatic_approach';
                    } else if (pattern === 'trill') {
                        cellType = 'arpeggio';
                    } else if (distance > 5) {
                        const interruptChance = complexity * 0.25;
                        if (Math.random() < interruptChance) {
                            cellType = 'chromatic_approach';
                        } else {
                            cellType = direction > 0 ? 'walk_up' : 'walk_down';
                        }
                    } else {
                        const interruptChance = complexity * 0.3;
                        if (Math.random() < interruptChance) {
                            const roll = Math.random();
                            if (roll < 0.5) cellType = 'chromatic_approach';
                            else            cellType = direction > 0 ? 'walk_up' : 'walk_down';
                        } else {
                            cellType = 'arpeggio';
                        }
                    }
                    
                    if (cellType === vb.lastCellType && complexity > 0.15) {
                        const bassAlts = ['arpeggio', 'walk_up', 'walk_down', 'chromatic_approach'];
                        const filtered = bassAlts.filter(t => t !== cellType);
                        cellType = filtered[Math.floor(Math.random() * filtered.length)];
                    }
                    
                    vb.lastCellType = cellType;
                    vb.direction = direction;
                    
                    startVoiceCell('bass', cellType, targetMidi, bassScalePool, bassChordPool);
                    bassMidi = executeWalkingStep(bassScalePool, bassChordPool);
                    vb.runStepsRemaining--;
                }
                
                // Genre complexity for bass: beat-gated
                const bassMidCell = musicState.bass.runStepsRemaining > 0 && musicState.bass.runStepsRemaining < (musicState.bass.cellSize - 1);
                const bassIsWalking = (musicState.bass.runMode === 'walk_up' || musicState.bass.runMode === 'walk_down');
                if (!bassMidCell || !bassIsWalking) {
                    bassMidi = applyGenreComplexity(bassMidi, bassScalePool, bassChordPool, subStepInBar, 'bass');
                }
                
                // Wick gravity: SAFETY NET only for extreme drift
                const bassDrift = Math.abs(bassMidi - targetMidi);
                if (bassDrift > 16) {
                    bassMidi = applyWickGravity(bassMidi, targetMidi, bassScalePool, 'bass');
                }
            }

            bassMidi = applyAvoidGravity(bassMidi, bassTonalContext);
            
            // ── COMMON: clamp, history, trigger, emit ──
            bassMidi = Math.max(bassRange.min, Math.min(bassRange.max, bassMidi));
            updateBassHistory(bassMidi);
            
            const baseBassDurationSec = bassPhrasingEnabled
                ? computeDynamicDurationSec(barIndex, 'bass')
                : (bassInterval * SUB_STEP_SECONDS);
            const bassDurationSec = bassPhrasingEnabled
                ? applySlurDurationScale(baseBassDurationSec, 'bass')
                : baseBassDurationSec;
            const bassDurationMs = bassDurationSec * 1000;
            const tieBass = bassPhrasingEnabled ? shouldTieNote('bass', bassMidi, barData.l) : false;
            if (audioState._bassSampler) {
                const noteFreq = Tone.Frequency(bassMidi, 'midi').toNote();
                if (!tieBass) {
                    try {
                        const toneDuration = bassPhrasingEnabled ? bassDurationSec : rhythmToDuration(audioState.lowerWick.rhythm);
                        audioState._bassSampler.triggerAttackRelease(noteFreq, toneDuration, now, 0.7);
                    } catch (e) {}
                }
            }
            if (tieBass) {
                if (audioState._bassSampler) {
                    try {
                        const noteFreq = Tone.Frequency(bassMidi, 'midi').toNote();
                        audioState._bassSampler.triggerAttackRelease(noteFreq, Math.max(0.1, bassDurationSec * 0.9), now, 0.45);
                    } catch (_e) {}
                }
                extendLastNoteEvent('bass', bassDurationMs, perfNow);
            } else {
                emitSubStepNote('bass', bassMidi, barData.l, preciseBarIndex, bassDurationMs, perfNow);
            }
            _phrasingState.bass.lastMidi = bassMidi;
            _phrasingState.bass.lastPrice = Number(barData.l);
            musicState.prevBass = bassMidi;
        }

        // ── INNER HARMONY (body-size driven dyads/triads) ──
        const harmonyCfg = audioState.harmony || {};
        if (harmonyCfg.enabled && audioState._harmonySampler) {
            const rhythm = String(harmonyCfg.rhythm || '4');
            const rhythmDiv = Math.max(1, parseInt(rhythm, 10) || 4);
            const harmonyInterval = Math.max(1, Math.round(SUB_STEP_COUNT / rhythmDiv));
            const shouldPlayHarmony = (subStepInBar % harmonyInterval === 0);
            if (shouldPlayHarmony) {
                const styleKey = String(harmonyCfg.style || 'jazz_shell_voicings');
                const style = HARMONY_STYLES[styleKey] || HARMONY_STYLES.jazz_shell_voicings || null;
                if (style) {
                    const minMidi = clampToRange(style.minMidi, 36, 84, 48);
                    const maxMidi = clampToRange(style.maxMidi, minMidi + 7, 96, 72);
                    const harmonyPools = buildVoicePools('harmony', regime, { min: minMidi, max: maxMidi });
                    const harmonyTonalContext = harmonyPools.tonalContext;

                    const openP = Number(barData.o);
                    const closeP = Number(barData.c);
                    const highP = Number(barData.h);
                    const lowP = Number(barData.l);
                    const bodyAbs = Math.abs(closeP - openP);
                    const rangeAbs = Math.max(0.000001, Math.abs(highP - lowP));
                    const sens = clampToRange(harmonyCfg.bodySensitivity, 0.2, 2.0, 1.0);
                    const bodyNorm = clampToRange((bodyAbs / rangeAbs) * sens, 0, 1.25, 0);
                    const dojiThreshold = clampToRange(harmonyCfg.dojiThreshold, 0.05, 0.40, 0.14);
                    // Inner harmony voicing must track the active progression chord
                    // quality (major/minor/dim), not individual candle color.
                    const chordInfo = getChordLabel(musicState.progressionStep);
                    const chordQuality = chordInfo && chordInfo.quality ? chordInfo.quality : '';
                    const useMinorVoicing = (chordQuality === 'min' || chordQuality === 'dim');
                    const baseOffsets = bodyNorm < dojiThreshold
                        ? (Array.isArray(style.doji) && style.doji.length ? style.doji : [0, 7])
                        : (useMinorVoicing ? style.bearish : style.bullish);

                    const maxVoices = clampToRange(harmonyCfg.maxVoices, 1, 4, 3);
                    let targetVoices = 1;
                    if (bodyNorm >= Math.min(1.0, dojiThreshold + 0.45)) targetVoices = 4;
                    else if (bodyNorm >= Math.min(0.7, dojiThreshold + 0.25)) targetVoices = 3;
                    else if (bodyNorm >= Math.min(0.4, dojiThreshold + 0.12)) targetVoices = 2;
                    targetVoices = Math.max(1, Math.min(maxVoices, targetVoices));

                    const offsets = (Array.isArray(baseOffsets) ? baseOffsets : [0, 7]).slice(0, targetVoices);
                    const pcs = getChordComponentPCs();
                    const rootPc = ((pcs && Number.isFinite(pcs.root)) ? pcs.root : (musicState.rootMidi % 12));
                    const baseMidi = pickMidiForPcInRange(rootPc, minMidi, maxMidi, 60);
                    const nowVel = clampToRange(0.35 + (bodyNorm * 0.5), 0.25, 0.9, 0.55);
                    const durMul = rhythmDurationScale(rhythm);
                    const baseDurSec = rhythmBaseDurationSec(rhythm);
                    const toneDuration = Math.max(0.06, Math.min(1.8, baseDurSec * (0.6 + durMul * 0.45)));
                    const midPrice = Number.isFinite(openP) && Number.isFinite(closeP) ? ((openP + closeP) / 2) : barData.c;

                    for (let i = 0; i < offsets.length; i++) {
                        let midi = wrapMidiToRange(baseMidi + Number(offsets[i] || 0), minMidi, maxMidi);
                        midi = snapHarmonyMidiToTonalContext(midi, harmonyTonalContext, i === 0);
                        try {
                            const startAt = now + (i * 0.004);
                            audioState._harmonySampler.triggerAttackRelease(
                                Tone.Frequency(midi, 'midi').toNote(),
                                toneDuration,
                                startAt,
                                nowVel
                            );
                            emitSubStepNote('harmony', midi, midPrice, preciseBarIndex, toneDuration * 1000, perfNow + (i * 4), rhythm);
                            audioState._lastHarmonyMidi = midi;
                        } catch (_e) {}
                    }
                }
            }
        }
        
        // ── VOICE SEPARATION CHECK ──
        if (audioState.upperWick.enabled && audioState.lowerWick.enabled) {
            const adjustedSoprano = ensureVoiceSeparation(sopranoMidi, bassMidi);
            if (adjustedSoprano !== sopranoMidi) {
                musicState.prevSoprano = adjustedSoprano;
            }
        }
        
        // ── STATUS UPDATE (throttled to bar boundaries) ──
        if (subStepInBar === 0) {
            const sopranoName = musicState.prevSoprano ? midiToNoteName(musicState.prevSoprano) : '--';
            const bassName = musicState.prevBass ? midiToNoteName(musicState.prevBass) : '--';
            const sopInfo = audioState.upperWick.patternOverride
                ? ` [OVR:${audioState.upperWick.pattern}]`
                : (musicState.soprano.runMode ? ` [${musicState.soprano.runMode}]` : '');
            const bassInfo = audioState.lowerWick.patternOverride ? ' OVR' : '';
            updateStatus(`${regime}${sopInfo} | ${sopranoName} / ${bassName}${bassInfo}`);
        }
    }

    // ========================================================================
    // VISUAL EVENT EMISSION
    // ========================================================================

    /**
     * Emit a note event at a specific sub-step position
     */
    function emitSubStepNote(voice, midi, price, barIndex, durationMs, startTime, rhythmOverride) {
        if (!window._audioNoteEvents) window._audioNoteEvents = [];
        
        // Debug: log first few notes to verify they're being created
        if (window._audioNoteEvents.length < 5) {
            console.log('[Audio] Emitting note:', voice, 'MIDI:', midi, 'price:', price?.toFixed(2), 'bar:', barIndex?.toFixed(2));
        }
        
        // Glow duration from slider (units * 200ms base)
        const glowMs = (audioState.glowDuration || 3) * 200;
        
        // Store rhythm for circle display mode
        const rhythm = rhythmOverride || (
            voice === 'soprano'
                ? audioState.upperWick.rhythm
                : (voice === 'harmony' ? (audioState.harmony && audioState.harmony.rhythm) : audioState.lowerWick.rhythm)
        );
        
        window._audioNoteEvents.push({
            voice: voice,
            midi: midi,
            price: price,
            barIndex: barIndex,
            regime: musicState.regime,  // UPTREND (major) or DOWNTREND (minor) at emission time
            rhythm: rhythm,     // '1'=whole, '2'=half, '4'=quarter, '8'=eighth, '16'=sixteenth
            time: startTime,
            endTime: startTime + durationMs,
            durationMs: durationMs,
            glowUntil: startTime + glowMs
        });
        
        // Keep up to 400 events
        while (window._audioNoteEvents.length > 400) {
            window._audioNoteEvents.shift();
        }
    }

    /**
     * Emit a note event for visual feedback - Creates persistent trail
     * Like Market Inventions: notes are horizontal bars that scroll with the chart
     */
    function emitNoteEvent(voice, midi, price, barIndex) {
        // Store note events for the renderer to pick up
        if (!window._audioNoteEvents) window._audioNoteEvents = [];
        
        // Get rhythm-based duration in ms
        const rhythm = voice === 'soprano'
            ? audioState.upperWick.rhythm
            : (voice === 'harmony' ? (audioState.harmony && audioState.harmony.rhythm) : audioState.lowerWick.rhythm);
        const durationMs = rhythmToDurationMs(rhythm);
        
        const now = performance.now();
        window._audioNoteEvents.push({
            voice: voice,
            midi: midi,
            price: price,
            barIndex: barIndex,
            regime: musicState.regime,  // UPTREND (major) or DOWNTREND (minor) at emission time
            rhythm: rhythm,     // '1'=whole, '2'=half, '4'=quarter, '8'=eighth, '16'=sixteenth
            time: now,
            endTime: now + durationMs,
            durationMs: durationMs,
            glowUntil: now + (audioState.glowDuration * 200)  // Active glow period
        });
        
        // Keep up to 300 events for trail
        while (window._audioNoteEvents.length > 300) {
            window._audioNoteEvents.shift();
        }
    }

    /**
     * Emit drum-step highlight events for the drum pulse strip renderer.
     * Uses short-lived glow events, similar to note-event highlighting.
     */
    function emitDrumStepEvent(barIndex, subStepInBar, hits, startTime) {
        if (!hits) return;
        if (!window._audioDrumEvents) window._audioDrumEvents = [];

        const glowMs = (audioState.glowDuration || 3) * 120;
        const event = {
            barIndex: barIndex,
            subStepInBar: subStepInBar,
            hits: {
                kick: !!hits.kick,
                snare: !!hits.snare,
                hihat: !!hits.hihat,
                ride: !!hits.ride,
                tom: !!hits.tom,
                conga: !!hits.conga,
                cymbal: !!hits.cymbal,
                clave: !!hits.clave
            },
            time: startTime,
            glowUntil: startTime + glowMs
        };

        window._audioDrumEvents.push(event);
        window._audioDrumStep = {
            barIndex: barIndex,
            subStepInBar: subStepInBar,
            hits: event.hits,
            time: startTime
        };

        while (window._audioDrumEvents.length > 600) {
            window._audioDrumEvents.shift();
        }
    }

    // ========================================================================
    // CHORD EVENT EMISSION (for visual chord overlay)
    // ========================================================================

    /**
     * Emit a chord event at a bar boundary for the chord progression overlay.
     * Only emits when the chord degree changes (to define chord regions).
     * Stores events on window._audioChordEvents for the renderer to consume.
     */
    function emitChordEvent(barIndex) {
        if (!window._audioChordEvents) window._audioChordEvents = [];

        var info = getChordLabel(musicState.progressionStep);
        var events = window._audioChordEvents;
        var isCycleStart = (musicState.progressionStep === 0) || (events.length === 0);

        // Only push a new entry when the chord actually changes (or first event)
        var last = events.length > 0 ? events[events.length - 1] : null;
        if (last && last.degree === info.degree && !isCycleStart) {
            // Same chord — just extend the region's end bar
            last.endBarIndex = barIndex;
        } else {
            // Count which cycle we're on
            var cycleNum = 1;
            if (isCycleStart && events.length > 0) {
                for (var ei = 0; ei < events.length; ei++) {
                    if (events[ei].cycleStart) cycleNum++;
                }
            }
            events.push({
                startBarIndex: barIndex,
                endBarIndex: barIndex,
                degree: info.degree,
                roman: info.roman,
                noteName: info.noteName,
                quality: info.quality,
                label: info.label,
                progressionStep: musicState.progressionStep,
                regime: musicState.regime,
                cycleStart: isCycleStart,
                cycleNum: isCycleStart ? cycleNum : 0
            });
        }

        // Cap to reasonable size (keep last ~200 chord regions)
        while (events.length > 200) {
            events.shift();
        }
    }

    // ========================================================================
    // CHART SCROLL SYNC
    // ========================================================================

    /**
     * Update chart scroll position smoothly
     * Uses floating-point position for continuous motion
     * The CURRENT AUDIO BAR is positioned at the PLAYHEAD (center of screen)
     */
    function updateSmoothScroll(smoothPosition) {
        // Store playhead position for the renderer
        window._audioPlayheadIndex = smoothPosition;
        
        // Calculate visible bars
        if (typeof computeVisibleBars !== 'function') {
            return;
        }
        
        const n = state.data.length;
        const vb = computeVisibleBars(n, state.xZoom);
        const barsVisible = vb.barsVisibleData;
        
        // Position so smoothPosition (current audio bar) is at the playhead (center)
        // xOffset + PLAYHEAD_POSITION * barsVisible = smoothPosition
        // xOffset = smoothPosition - PLAYHEAD_POSITION * barsVisible
        const newOffset = smoothPosition - (PLAYHEAD_POSITION * barsVisible);
        
        // Clamp to valid range (negative offset not allowed)
        // This means for the first part of playback, the chart stays still
        // and the current bar appears LEFT of the playhead
        const maxOff = Math.max(0, n - barsVisible);
        const clampedOffset = Math.max(0, Math.min(newOffset, maxOff));
        
        // IMPORTANT: Keep followLatest disabled during audio playback
        state.followLatest = false;
        
        // Set the new offset (floating point for smooth scroll)
        state.xOffset = clampedOffset;
        
        // Redraw EVERY frame for smooth animation
        if (typeof draw === 'function') {
            draw();
        }
    }

    // ========================================================================
    // PLAYBACK INTEGRATION
    // ========================================================================

    /**
     * Called when a new bar is consumed during Replay/Practice mode
     * UNIFIED: Only updates targets — all note generation goes through processSubStep
     * This ensures identical sound whether in Live animation or Replay mode
     */
    function onBarAdvance(barData, barIndex) {
        if (!audioState.playing || !audioState._initialized) {
            return;
        }
        if (!barData) {
            return;
        }

        // Update bar tracking and price range
        audioState._lastBarIndex = barIndex;
        updatePriceRange();
        updateVisiblePriceRange();
        
        // Update targets for the pathfinder (actual note gen happens in processSubStep)
        const rawSoprano = priceToMidi(barData.h, 'soprano');
        const rawBass = priceToMidi(barData.l, 'bass');
        if (rawSoprano !== null) musicState.soprano.runTargetNote = rawSoprano;
        if (rawBass !== null) musicState.bass.runTargetNote = rawBass;
    }

    /**
     * Register the global callback that the replay system calls on each bar advance
     * This allows audio to also play when Practice mode is used
     */
    function hookIntoReplaySystem() {
        window.onReplayBarAdvance = function(barData, barIndex, lastState) {
            // Only trigger if audio is active but our own animation isn't running
            // (to avoid double-triggering when using Practice mode with audio)
            if (!audioState.playing || !audioState._initialized) return;
            if (audioState._animationRunning) return;  // Our animation handles it
            
            try {
                // UNIFIED: Update targets via onBarAdvance, then run a full
                // bar of sub-steps through processSubStep for note generation
                onBarAdvance(barData, barIndex);
                for (let sub = 0; sub < SUB_STEP_COUNT; sub++) {
                    processSubStep(barIndex, sub, barIndex * SUB_STEP_COUNT + sub);
                }
            } catch (e) {
                console.warn('[Audio] Error in replay hook:', e);
            }
        };
        
        console.log('[Audio] Registered replay hook callback');
        return true;
    }

    // ========================================================================
    // EXPORTS
    // ========================================================================

    _am.PLAYHEAD_POSITION = PLAYHEAD_POSITION;
    _am.SUB_STEP_COUNT = SUB_STEP_COUNT;
    _am.SUB_STEP_SECONDS = SUB_STEP_SECONDS;
    _am.startAudioAnimation = startAudioAnimation;
    _am.stopAudioAnimation = stopAudioAnimation;
    _am.pauseAudioAnimation = pauseAudioAnimation;
    _am.resumeAudioAnimation = resumeAudioAnimation;
    _am.processSubStep = processSubStep;
    _am.emitSubStepNote = emitSubStepNote;
    _am.emitNoteEvent = emitNoteEvent;
    _am.onBarAdvance = onBarAdvance;
    _am.hookIntoReplaySystem = hookIntoReplaySystem;
})();
