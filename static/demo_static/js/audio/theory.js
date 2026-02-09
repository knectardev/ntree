/**
 * audio/theory.js — Music Theory Utility Functions
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: Scale/chord utilities, regime detection, note quantization,
 * pattern detection, voice separation, and viewport price range tracking.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    // Dependencies
    const musicState = _am.musicState;
    const audioState = _am.audioState;
    const GENRES = _am.GENRES;
    const SCALES = _am.SCALES;
    const CHORD_PROGRESSIONS = _am.CHORD_PROGRESSIONS;
    const CHORD_MAP_MAJOR = _am.CHORD_MAP_MAJOR;
    const CHORD_MAP_MINOR = _am.CHORD_MAP_MINOR;
    const NOTE_CONFIG = _am.NOTE_CONFIG;

    // ========================================================================
    // REGIME DETECTION
    // ========================================================================

    /**
     * Update regime based on price trend (UPTREND or DOWNTREND)
     * Uses the current genre's scales for melodic generation
     */
    function updateRegimeFromPrice(currentClose) {
        if (musicState.prevBarClose === null) {
            musicState.prevBarClose = currentClose;
            return;
        }
        
        if (currentClose < musicState.prevBarClose) {
            musicState.consecutiveDownBars++;
            musicState.consecutiveUpBars = 0;
            if (musicState.consecutiveDownBars >= musicState.regimeSwitchThreshold) {
                if (musicState.regime !== 'DOWNTREND') {
                    musicState.regime = 'DOWNTREND';
                    const genre = GENRES[musicState.currentGenre];
                    console.log(`[Music] Regime -> DOWNTREND (${genre.label})`);
                }
            }
        } else if (currentClose > musicState.prevBarClose) {
            musicState.consecutiveUpBars++;
            musicState.consecutiveDownBars = 0;
            if (musicState.consecutiveUpBars >= musicState.regimeSwitchThreshold) {
                if (musicState.regime !== 'UPTREND') {
                    musicState.regime = 'UPTREND';
                    const genre = GENRES[musicState.currentGenre];
                    console.log(`[Music] Regime -> UPTREND (${genre.label})`);
                }
            }
        }
        musicState.prevBarClose = currentClose;
    }

    // ========================================================================
    // SCALE & CHORD UTILITIES
    // ========================================================================

    /**
     * Get all scale notes within a range using current genre's scales
     * Falls back to legacy SCALES if genre not found
     */
    function getScaleNotes(regime, rootMidi, minMidi, maxMidi) {
        // Try to get intervals from current genre
        let intervals;
        const genre = GENRES[musicState.currentGenre];
        if (genre && genre.scales) {
            // Map MAJOR/MINOR to UPTREND/DOWNTREND for backwards compatibility
            if (regime === 'MAJOR') regime = 'UPTREND';
            if (regime === 'MINOR') regime = 'DOWNTREND';
            intervals = genre.scales[regime] || genre.scales.UPTREND;
        } else {
            // Fallback to legacy SCALES
            intervals = SCALES[regime] || SCALES.MAJOR;
        }
        
        const notes = [];
        for (let midi = minMidi; midi <= maxMidi; midi++) {
            if (intervals.includes((midi - rootMidi + 120) % 12)) {
                notes.push(midi);
            }
        }
        return notes;
    }

    /**
     * Get current chord tones as mod-12 set
     */
    function getCurrentChordToneMods() {
        const progressionKey = audioState.chordProgression || 'canon';
        const progression = CHORD_PROGRESSIONS[progressionKey] || CHORD_PROGRESSIONS.canon;
        const regime = musicState.regime;
        
        // Map UPTREND/DOWNTREND to MAJOR/MINOR for chord progressions
        const chordRegime = (regime === 'DOWNTREND' || regime === 'MINOR') ? 'MINOR' : 'MAJOR';
        
        const degree = progression[chordRegime][musicState.progressionStep % 16];
        const chordMap = chordRegime === 'MAJOR' ? CHORD_MAP_MAJOR : CHORD_MAP_MINOR;
        const intervals = chordMap[degree] || [0, 4, 7];
        
        // Return chord tones as mod-12 set
        return new Set(intervals.map(i => (musicState.rootMidi + i) % 12));
    }

    /**
     * Quantize a raw MIDI note to the nearest chord tone with voice-leading preference
     * Uses the current chord progression step and regime to select chord tones
     * @param {number} rawMidi - Raw MIDI note from price mapping
     * @param {string} voice - 'soprano' or 'bass'
     * @param {number|null} prevNote - Previous note for voice-leading smoothness
     * @returns {number} Quantized MIDI note
     */
    function quantizeToChord(rawMidi, voice, prevNote) {
        if (!Number.isFinite(rawMidi)) return prevNote || (voice === 'soprano' ? 72 : 48);
        
        const regime = musicState.regime;
        const chordRegime = (regime === 'DOWNTREND' || regime === 'MINOR') ? 'MINOR' : 'MAJOR';
        
        // Get current chord degree from progression
        const progressionKey = audioState.chordProgression || 'canon';
        const progression = CHORD_PROGRESSIONS[progressionKey] || CHORD_PROGRESSIONS.canon;
        const degree = progression[chordRegime][musicState.progressionStep % 16];
        const chordMap = chordRegime === 'MAJOR' ? CHORD_MAP_MAJOR : CHORD_MAP_MINOR;
        const intervals = chordMap[degree] || [0, 4, 7];
        
        // Build chord tones across the voice's MIDI range
        const dynamicRange = getDynamicMidiRange(voice);
        const chordTones = [];
        for (let oct = -2; oct <= 8; oct++) {
            for (const interval of intervals) {
                const midi = musicState.rootMidi + (oct * 12) + interval;
                if (midi >= dynamicRange.min && midi <= dynamicRange.max) {
                    chordTones.push(midi);
                }
            }
        }
        
        if (chordTones.length === 0) return rawMidi;
        
        // If we have a previous note, prefer voice-leading (minimize leap)
        if (prevNote !== null && prevNote !== undefined) {
            // Find chord tones near the raw target AND near the previous note
            const candidates = chordTones.map(ct => ({
                note: ct,
                targetDist: Math.abs(ct - rawMidi),
                leapDist: Math.abs(ct - prevNote)
            }));
            // Score: weighted blend of proximity to target and smooth voice-leading
            candidates.sort((a, b) => {
                const scoreA = a.targetDist * 0.6 + a.leapDist * 0.4;
                const scoreB = b.targetDist * 0.6 + b.leapDist * 0.4;
                return scoreA - scoreB;
            });
            return candidates[0].note;
        }
        
        // No previous note: just find nearest chord tone
        return chordTones.reduce((a, b) => Math.abs(a - rawMidi) < Math.abs(b - rawMidi) ? a : b);
    }

    /**
     * Find nearest note in a scale pool (like Market Inventions _nearest_scale_note)
     */
    function nearestScaleNote(targetMidi, scalePool, maxDistance) {
        if (maxDistance === undefined) maxDistance = 12;
        if (!scalePool || scalePool.length === 0) return targetMidi;
        
        // First try to find a note within maxDistance
        const nearby = scalePool.filter(note => Math.abs(note - targetMidi) <= maxDistance);
        if (nearby.length > 0) {
            return nearby.reduce((a, b) => Math.abs(a - targetMidi) < Math.abs(b - targetMidi) ? a : b);
        }
        // Fallback: find absolute nearest
        return scalePool.reduce((a, b) => Math.abs(a - targetMidi) < Math.abs(b - targetMidi) ? a : b);
    }

    /**
     * Offset by scale degrees (like Market Inventions _offset_scale_degree)
     */
    function offsetScaleDegree(note, scalePool, offset) {
        if (!scalePool || scalePool.length === 0) return note;
        const pool = [...scalePool].sort((a, b) => a - b);
        
        // Find current index
        let index = 0;
        let minDist = Infinity;
        for (let i = 0; i < pool.length; i++) {
            const dist = Math.abs(pool[i] - note);
            if (dist < minDist) {
                minDist = dist;
                index = i;
            }
        }
        
        // Apply offset and clamp
        const nextIndex = Math.max(0, Math.min(pool.length - 1, index + offset));
        return pool[nextIndex];
    }

    /**
     * Find nearest scale note at or above target
     */
    function nearestScaleNoteAbove(targetMidi, scalePool) {
        const candidates = scalePool.filter(note => note >= targetMidi);
        if (candidates.length === 0) return null;
        return Math.min(...candidates);
    }

    // ========================================================================
    // VIEWPORT & PRICE RANGE
    // ========================================================================

    /**
     * Update the visible price range from chart data
     * Uses the VISIBLE VIEWPORT (respecting zoom/scroll) for tight wick-hugging
     * Falls back to full data range if viewport info unavailable
     */
    function updateVisiblePriceRange() {
        if (typeof state === 'undefined' || !state.data || state.data.length < 2) {
            return;
        }
        
        // Try to get the visible viewport range (respects zoom/scroll)
        let priceMin = Infinity;
        let priceMax = -Infinity;
        let usedViewport = false;
        
        // Calculate visible bar range from xOffset and visible bar count
        if (typeof computeVisibleBars === 'function') {
            try {
                const n = state.data.length;
                const vb = computeVisibleBars(n, state.xZoom);
                const startBar = Math.max(0, Math.floor(state.xOffset || 0));
                const endBar = Math.min(n - 1, startBar + Math.ceil(vb.barsVisibleData || 50));
                
                for (let i = startBar; i <= endBar; i++) {
                    const bar = state.data[i];
                    if (bar && bar.l !== undefined && bar.h !== undefined) {
                        if (bar.l < priceMin) priceMin = bar.l;
                        if (bar.h > priceMax) priceMax = bar.h;
                    }
                }
                if (Number.isFinite(priceMin) && Number.isFinite(priceMax) && priceMax > priceMin) {
                    usedViewport = true;
                }
            } catch (e) {
                // Fall through to full data range
            }
        }
        
        // Fallback: full data range
        if (!usedViewport) {
            priceMin = Infinity;
            priceMax = -Infinity;
            for (let i = 0; i < state.data.length; i++) {
                const bar = state.data[i];
                if (bar && bar.l !== undefined && bar.h !== undefined) {
                    if (bar.l < priceMin) priceMin = bar.l;
                    if (bar.h > priceMax) priceMax = bar.h;
                }
            }
        }
        
        if (Number.isFinite(priceMin) && Number.isFinite(priceMax) && priceMax > priceMin) {
            // Add small padding
            const range = priceMax - priceMin;
            musicState.visiblePriceMin = priceMin - (range * 0.02);
            musicState.visiblePriceMax = priceMax + (range * 0.02);
        }
    }

    // ========================================================================
    // PATTERN DETECTION & VOICE RANGES
    // ========================================================================

    /**
     * Detect genuinely STUCK patterns in note history
     * Returns: 'stuck' if actually stuck on same note 3+ times, 'trill' if ping-ponging, null if fine
     * 
     * IMPORTANT: This is intentionally LESS sensitive than before.
     * Normal scale movement (close notes) should NOT trigger this — that's healthy motion.
     * Only flag when the melody is genuinely stuck or ping-ponging.
     */
    function detectMelodicPattern(history) {
        if (history.length < 3) return null;
        
        const last6 = history.slice(-6);
        const last3 = history.slice(-3);
        
        // Check for EXACT same note 3+ times in a row (truly stuck)
        if (last3.length >= 3 && last3[0] === last3[1] && last3[1] === last3[2]) {
            return 'stuck';
        }
        
        // Check for trill pattern (A-B-A-B) with exact notes over 4+ notes
        if (last6.length >= 4) {
            const [a, b, c, d] = last6.slice(-4);
            if (a === c && b === d && a !== b) {
                return 'trill';
            }
        }
        
        // Check for 6 notes all being the exact same note (really stuck)
        if (last6.length >= 6) {
            const allSame = last6.every(n => n === last6[0]);
            if (allSame) return 'stuck';
        }
        
        return null;
    }
    
    /**
     * Get MIDI range for voice - voice-specific ranges for separation
     * Soprano: upper half (54-84), Bass: lower half (24-54)
     * This creates natural voice separation while hugging wicks
     */
    function getDynamicMidiRange(voice) {
        if (voice === 'soprano') {
            return { min: 54, max: 84 };  // F#3 to C6 - upper half
        } else {
            return { min: 24, max: 54 };  // C1 to F#3 - lower half
        }
    }

    /**
     * Get chord tones within a MIDI range for the current progression step
     */
    function getChordTonesInRange(minMidi, maxMidi) {
        const regime = musicState.regime;
        const chordRegime = (regime === 'DOWNTREND' || regime === 'MINOR') ? 'MINOR' : 'MAJOR';
        
        const progressionKey = audioState.chordProgression || 'canon';
        const progression = CHORD_PROGRESSIONS[progressionKey] || CHORD_PROGRESSIONS.canon;
        const degree = progression[chordRegime][musicState.progressionStep % 16];
        const chordMap = chordRegime === 'MAJOR' ? CHORD_MAP_MAJOR : CHORD_MAP_MINOR;
        const intervals = chordMap[degree] || [0, 4, 7];
        
        const tones = [];
        for (let oct = -2; oct <= 8; oct++) {
            for (const interval of intervals) {
                const midi = musicState.rootMidi + (oct * 12) + interval;
                if (midi >= minMidi && midi <= maxMidi) {
                    tones.push(midi);
                }
            }
        }
        return tones;
    }

    // ========================================================================
    // ANTI-REPETITION
    // ========================================================================

    /**
     * Force a note to be different from the last N notes
     * Returns a guaranteed different note
     */
    function forceNoteDifference(note, scalePool, minSemitoneDiff) {
        const history = musicState.sopranoHistory.slice(-4);
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        
        // Check if this note is too close to recent notes
        const tooClose = history.some(h => Math.abs(note - h) < minSemitoneDiff);
        
        if (tooClose && sortedPool.length > 3) {
            // Pick a random note from the pool that's far from recent notes
            const farNotes = sortedPool.filter(n => {
                return history.every(h => Math.abs(n - h) >= minSemitoneDiff);
            });
            
            if (farNotes.length > 0) {
                return farNotes[Math.floor(Math.random() * farNotes.length)];
            }
            
            // If no far notes, just pick a random note from the pool
            return sortedPool[Math.floor(Math.random() * sortedPool.length)];
        }
        
        return note;
    }
    
    /**
     * STRICT anti-repetition: GUARANTEES a different note from history
     * Will never return the same note as any of the last 3 notes
     */
    function forceNoteDifferenceStrict(note, scalePool, history) {
        const last3 = history.slice(-3);
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        
        if (sortedPool.length <= 3) {
            // Pool too small, just return something different from last note
            const lastNote = last3[last3.length - 1];
            const differentNotes = sortedPool.filter(n => n !== lastNote);
            return differentNotes.length > 0 
                ? differentNotes[Math.floor(Math.random() * differentNotes.length)]
                : sortedPool[Math.floor(Math.random() * sortedPool.length)];
        }
        
        // Check if note is in recent history
        const isRecent = last3.includes(note);
        
        if (isRecent) {
            // Find all notes NOT in recent history
            const freshNotes = sortedPool.filter(n => !last3.includes(n));
            
            if (freshNotes.length > 0) {
                // Pick a random fresh note
                return freshNotes[Math.floor(Math.random() * freshNotes.length)];
            }
        }
        
        // Also check if too close (within 2 semitones of last note)
        const lastNote = last3[last3.length - 1];
        if (lastNote !== undefined && Math.abs(note - lastNote) <= 2) {
            // Find notes at least 3 semitones away from last note
            const farNotes = sortedPool.filter(n => Math.abs(n - lastNote) >= 3);
            if (farNotes.length > 0) {
                return farNotes[Math.floor(Math.random() * farNotes.length)];
            }
        }
        
        return note;
    }

    // ========================================================================
    // VOICE SEPARATION & PROGRESSION
    // ========================================================================

    /**
     * Ensure voice separation (minimum 12 semitones between soprano and bass)
     */
    function ensureVoiceSeparation(soprano, bass) {
        const minSeparation = 12;
        if (bass !== null && soprano < bass + minSeparation) {
            const sopranoPool = getScaleNotes(musicState.regime, musicState.rootMidi, NOTE_CONFIG.sopranoMin, NOTE_CONFIG.sopranoMax);
            const adjusted = nearestScaleNoteAbove(bass + minSeparation, sopranoPool);
            if (adjusted !== null) {
                return adjusted;
            }
        }
        return soprano;
    }

    /**
     * Advance the chord progression by one step
     */
    function advanceProgression() {
        musicState.progressionStep = (musicState.progressionStep + 1) % 16;
    }

    // ========================================================================
    // EXPORTS
    // ========================================================================

    _am.updateRegimeFromPrice = updateRegimeFromPrice;
    _am.getScaleNotes = getScaleNotes;
    _am.getCurrentChordToneMods = getCurrentChordToneMods;
    _am.quantizeToChord = quantizeToChord;
    _am.nearestScaleNote = nearestScaleNote;
    _am.offsetScaleDegree = offsetScaleDegree;
    _am.nearestScaleNoteAbove = nearestScaleNoteAbove;
    _am.updateVisiblePriceRange = updateVisiblePriceRange;
    _am.detectMelodicPattern = detectMelodicPattern;
    _am.getDynamicMidiRange = getDynamicMidiRange;
    _am.getChordTonesInRange = getChordTonesInRange;
    _am.forceNoteDifference = forceNoteDifference;
    _am.forceNoteDifferenceStrict = forceNoteDifferenceStrict;
    _am.ensureVoiceSeparation = ensureVoiceSeparation;
    _am.advanceProgression = advanceProgression;
})();
