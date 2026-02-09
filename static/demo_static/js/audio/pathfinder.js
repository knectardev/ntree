/**
 * audio/pathfinder.js — Melodic Cell System & Note Generation
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: Voice-specific pathfinder cells (scale runs, orbits, arpeggios,
 * enclosures, sequences, chord skips, leap+fills), walking bass, wick gravity,
 * genre complexity, and soprano/bass note generation.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    // Dependencies
    const musicState = _am.musicState;
    const audioState = _am.audioState;
    const GENRES = _am.GENRES;
    const nearestScaleNote = _am.nearestScaleNote;
    const offsetScaleDegree = _am.offsetScaleDegree;
    const getScaleNotes = _am.getScaleNotes;
    const getDynamicMidiRange = _am.getDynamicMidiRange;

    // ========================================================================
    // NOTE GENERATION (price-tracking with anti-repetition)
    // ========================================================================

    /**
     * Generate soprano note - PRICE-TRACKING with smart anti-repetition
     * Notes "hug" the wick lines while avoiding monotonous repetition
     * Approach: Start from price-derived MIDI, vary within ±3 semitones to avoid repeats
     * Voice separation is handled by priceToMidi mapping to voice-specific MIDI ranges
     */
    function generateSopranoNote(rawMidi, subStepInBar) {
        const regime = musicState.regime;
        const dynamicRange = getDynamicMidiRange('soprano');
        const sopranoPool = getScaleNotes(regime, musicState.rootMidi, dynamicRange.min, dynamicRange.max);
        const sortedPool = [...sopranoPool].sort((a, b) => a - b);
        
        // Get price-derived target (the "wick hugging" target)
        const targetMidi = nearestScaleNote(rawMidi, sortedPool, 24);
        const targetIndex = sortedPool.indexOf(targetMidi);
        
        // Get nearby notes (within ±3 scale degrees of target)
        const nearbyRange = 3;
        const minIdx = Math.max(0, targetIndex - nearbyRange);
        const maxIdx = Math.min(sortedPool.length - 1, targetIndex + nearbyRange);
        const nearbyNotes = sortedPool.slice(minIdx, maxIdx + 1);
        
        let soprano = targetMidi;
        
        // Anti-repetition: if target would repeat recent notes, pick a different nearby note
        const recentNotes = musicState.sopranoHistory.slice(-3);
        
        if (recentNotes.includes(soprano)) {
            // Find nearby notes that aren't in recent history
            const freshNotes = nearbyNotes.filter(n => !recentNotes.includes(n));
            
            if (freshNotes.length > 0) {
                // Pick the fresh note closest to the target
                soprano = freshNotes.reduce((a, b) => 
                    Math.abs(a - targetMidi) < Math.abs(b - targetMidi) ? a : b
                );
            } else {
                // All nearby notes used recently - pick based on price direction
                const priceDir = musicState._sopranoDirection || 0;
                const stepDir = priceDir !== 0 ? priceDir : (subStepInBar % 2 === 0 ? 1 : -1);
                const nextIndex = Math.max(0, Math.min(sortedPool.length - 1, targetIndex + stepDir));
                soprano = sortedPool[nextIndex];
            }
        }
        
        // Clamp to range
        soprano = Math.max(dynamicRange.min, Math.min(dynamicRange.max, soprano));
        
        updateSopranoHistory(soprano);
        return soprano;
    }
    
    /**
     * Get next note in a scale run toward a target
     * Moves monotonically (always up or always down) by 1-2 degrees per step
     */
    function getScaleRunNote(scalePool, currentNote, targetNote, direction, phrasePos) {
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        
        // Find current position
        let currentIndex = sortedPool.findIndex(n => Math.abs(n - currentNote) <= 2);
        if (currentIndex === -1) currentIndex = Math.floor(sortedPool.length / 2);
        
        // Move 1-2 degrees in direction, varying by phrase position for interest
        const stepSize = 1 + (phrasePos % 2);  // 1 or 2 degrees
        const nextIndex = Math.max(0, Math.min(sortedPool.length - 1, currentIndex + (direction * stepSize)));
        
        return sortedPool[nextIndex];
    }
    
    /**
     * Get arpeggio note - cycles through chord tones: 1st, 3rd, 5th, 8th
     */
    function getArpeggioNote(chordPool, measurePos, prevNote) {
        if (chordPool.length === 0) return prevNote || 72;
        
        const sortedChord = [...chordPool].sort((a, b) => a - b);
        
        // Map measure position to arpeggio degree: 0->root, 1->3rd, 2->5th, 3->octave
        const arpeggioPattern = [0, 1, 2, 3];  // Indices into sorted chord tones
        const patternIndex = arpeggioPattern[measurePos % 4];
        
        // Find the chord tone near the previous note to maintain register
        const baseIndex = Math.floor(sortedChord.length / 2);
        const targetIndex = Math.min(sortedChord.length - 1, baseIndex + patternIndex);
        
        return sortedChord[targetIndex];
    }
    
    /**
     * Apply genre-specific phrasing
     */
    function applyGenrePhrasing(note, scalePool, chordPool, subStepInBar, priceDirection) {
        const genre = musicState.currentGenre;
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        const dynamicRange = getDynamicMidiRange('soprano');
        
        // CLASSICAL: Move primarily by steps (1-2 degrees)
        if (genre === 'classical') {
            // On weak beats, add neighbor tones
            if (subStepInBar % 4 === 2) {
                const neighborDir = Math.random() < 0.5 ? 1 : -1;
                const neighborNote = offsetScaleDegree(note, scalePool, neighborDir);
                if (neighborNote && neighborNote >= dynamicRange.min && neighborNote <= dynamicRange.max) {
                    return neighborNote;
                }
            }
        }
        
        // JAZZ: Add enclosures (above-below-target) when price stable
        if (genre === 'jazz' && priceDirection === 0) {
            const phrasePos = subStepInBar % 3;
            if (phrasePos === 0) {
                // Note above target
                return Math.min(dynamicRange.max, note + 1);
            } else if (phrasePos === 1) {
                // Note below target
                return Math.max(dynamicRange.min, note - 1);
            }
            // phrasePos 2 = target note (return as-is)
        }
        
        // INDIAN RAAGS: Wider intervals on expanding wicks (handled in Tone.js with rampTo)
        if (genre === 'indian_raags') {
            // Gamaka-like oscillation
            if (subStepInBar % 2 === 1) {
                const oscillation = Math.random() < 0.5 ? 1 : -1;
                const gamaka = note + oscillation;
                if (gamaka >= dynamicRange.min && gamaka <= dynamicRange.max) {
                    return gamaka;
                }
            }
        }
        
        // ROCK: Add blue notes on strong beats
        if (genre === 'rock_bluegrass' && subStepInBar % 4 === 0) {
            if (Math.random() < 0.3) {
                const blueOffsets = [3, 6, 10];  // b3, b5, b7
                const blueOffset = blueOffsets[Math.floor(Math.random() * blueOffsets.length)];
                const blueNote = musicState.rootMidi + blueOffset;
                const octaveShift = Math.floor((note - blueNote) / 12) * 12;
                const adjustedBlue = blueNote + octaveShift;
                if (adjustedBlue >= dynamicRange.min && adjustedBlue <= dynamicRange.max) {
                    return adjustedBlue;
                }
            }
        }
        
        // TECHNO: Random octave jumps
        if (genre === 'techno_experimental' && subStepInBar === 0) {
            if (Math.random() < 0.25) {
                const jump = Math.random() < 0.5 ? 12 : -12;
                const jumped = note + jump;
                if (jumped >= dynamicRange.min && jumped <= dynamicRange.max) {
                    return jumped;
                }
            }
        }
        
        return note;
    }

    // ========================================================================
    // HISTORY TRACKING
    // ========================================================================

    /**
     * Update soprano history (keep last 8 notes)
     */
    function updateSopranoHistory(note) {
        musicState.sopranoHistory.push(note);
        if (musicState.sopranoHistory.length > 8) {
            musicState.sopranoHistory.shift();
        }
    }
    
    /**
     * Update bass history (keep last 8 notes)
     */
    function updateBassHistory(note) {
        musicState.bassHistory.push(note);
        if (musicState.bassHistory.length > 8) {
            musicState.bassHistory.shift();
        }
    }

    // ========================================================================
    // LEGACY MELODIC RUN SYSTEM
    // ========================================================================

    /**
     * Start a melodic run (scale or arpeggio)
     */
    function startMelodicRun(runType, targetMidi, scalePool, chordPool) {
        musicState.runMode = runType;
        musicState.runStepsRemaining = 4;  // 4-step runs
        musicState.runTargetNote = nearestScaleNote(targetMidi, scalePool, 24);
        musicState.arpeggioIndex = 0;
    }
    
    /**
     * Execute one step of a melodic run - AGGRESSIVE motion (2-3 scale degrees)
     */
    function executeRunStep(voice, scalePool, chordPool) {
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        const prev = voice === 'soprano' ? musicState.prevSoprano : musicState.prevBass;
        const prevIndex = sortedPool.findIndex(n => Math.abs(n - prev) <= 2);
        
        // Move 2-3 scale degrees per step for real motion
        const stepSize = 2 + Math.floor(Math.random() * 2);  // 2 or 3
        
        if (musicState.runMode === 'scale_up') {
            // Move up the scale by 2-3 degrees
            const nextIndex = Math.min(sortedPool.length - 1, (prevIndex !== -1 ? prevIndex : 0) + stepSize);
            return sortedPool[nextIndex];
        } else if (musicState.runMode === 'scale_down') {
            // Move down the scale by 2-3 degrees
            const nextIndex = Math.max(0, (prevIndex !== -1 ? prevIndex : sortedPool.length - 1) - stepSize);
            return sortedPool[nextIndex];
        } else if (musicState.runMode === 'arpeggio') {
            // Cycle through ALL chord tones in the range (not just nearby)
            if (chordPool.length > 0) {
                const sortedChord = [...chordPool].sort((a, b) => a - b);
                musicState.arpeggioIndex = (musicState.arpeggioIndex + 1) % sortedChord.length;
                return sortedChord[musicState.arpeggioIndex];
            }
            // Fallback: big leap
            const leapSize = 3 + Math.floor(Math.random() * 3);  // 3-5 scale degrees
            const nextIndex = Math.min(sortedPool.length - 1, (prevIndex !== -1 ? prevIndex : 0) + leapSize);
            return sortedPool[nextIndex];
        }
        
        return prev || scalePool[0];
    }

    // ========================================================================
    // WICK GRAVITY — the wick is always the attractor / magnet / rail
    // ========================================================================

    /**
     * Apply wick gravity: pulls a generated note back toward the wick target.
     * The wick is always the "home" — melody orbits it but MUST return.
     * 
     * How it works:
     * - maxDrift: maximum allowed semitones from target (scales with Melodic Range)
     * - If note is beyond maxDrift: HARD CLAMP to maxDrift boundary
     * - If note is beyond softDrift (maxDrift * 0.6): PULL toward target by blending
     * - This creates an elastic "leash" — melody can explore but snaps back
     * 
     * @param {number} note - The generated MIDI note
     * @param {number} target - The wick-derived target MIDI note
     * @param {Array} scalePool - Available scale notes for quantization
     * @param {string} voice - 'soprano' or 'bass'
     * @returns {number} Gravity-adjusted MIDI note
     */
    function applyWickGravity(note, target, scalePool, voice) {
        if (!Number.isFinite(note) || !Number.isFinite(target)) return note;
        
        const melodicRange = audioState.melodicRange || 1.0;
        const dynamicRange = getDynamicMidiRange(voice);
        
        // Maximum drift from wick target (in semitones) — WIDER than before
        // The cell pathfinding system now handles normal wick-tracking; gravity is
        // only a safety net for extreme drift. Scale runs need room to develop.
        // At melodicRange 0.3: 8 semitones  (was 5)
        // At melodicRange 1.0: 15 semitones (was 7.5)
        // At melodicRange 3.0: 22 semitones (was 14.5)
        const maxDrift = Math.round(8 + melodicRange * 5);
        const softDrift = Math.round(maxDrift * 0.7);  // Start pulling at 70% of max
        
        const drift = note - target;
        const absDrift = Math.abs(drift);
        
        if (absDrift <= softDrift) {
            return note;
        }
        
        let corrected;
        
        if (absDrift > maxDrift) {
            // HARD CLAMP: beyond max drift
            const clampedMidi = target + (drift > 0 ? maxDrift : -maxDrift);
            corrected = nearestScaleNote(clampedMidi, scalePool, 4);
        } else {
            // SOFT PULL: gentle blend back toward target
            const pullZone = maxDrift - softDrift;
            const pullAmount = (absDrift - softDrift) / pullZone;
            const pullStrength = pullAmount * 0.3;  // Gentler: 30% max (was 50%)
            
            const blended = note - (drift * pullStrength);
            corrected = nearestScaleNote(Math.round(blended), scalePool, 4);
        }
        
        return Math.max(dynamicRange.min, Math.min(dynamicRange.max, corrected));
    }

    /**
     * Check if the current note position has drifted too far from the wick target.
     * Used by the conductor to FORCE a scale_run back to target when needed.
     * Returns true if the melody needs to come home.
     * 
     * NOTE: This is now LESS sensitive — the pathfinding cell system handles normal
     * wick-tracking via its distance-based cell selection. This only fires for
     * truly extreme drift situations.
     */
    function needsWickReturn(prevNote, target) {
        if (!Number.isFinite(prevNote) || !Number.isFinite(target)) return false;
        const melodicRange = audioState.melodicRange || 1.0;
        // Wider threshold: 80% of the (now wider) max drift
        const returnThreshold = Math.round((8 + melodicRange * 5) * 0.8);
        return Math.abs(prevNote - target) > returnThreshold;
    }

    // ========================================================================
    // VOICE CELL SYSTEM (startVoiceCell + executeSopranoRunStep + executeWalkingStep)
    // ========================================================================

    /**
     * Start a melodic cell for a specific voice (soprano or bass)
     * 
     * DYNAMIC CELL SIZING: Cell length depends on distance to target and cell type:
     * - scale_run: 4 + floor(distance/3), capped at 8 (longer runs when far = real scale passages)
     * - orbit: 6-8 steps (full orbit pattern around wick)
     * - arpeggio: 4 (standard chord cycle)
     * - enclosure: 4 (fixed: above-below-target-neighbor)
     * - walk_up/walk_down: 4 + floor(distance/4), capped at 6
     * - other: 4 (default)
     */
    function startVoiceCell(voice, runType, targetMidi, scalePool, chordPool) {
        const vs = voice === 'soprano' ? musicState.soprano : musicState.bass;
        const prev = voice === 'soprano' ? (musicState.prevSoprano || 72) : (musicState.prevBass || 48);
        const distance = Math.abs(targetMidi - prev);
        
        vs.runMode = runType;
        vs.runTargetNote = nearestScaleNote(targetMidi, scalePool, 24);
        vs.arpeggioIndex = 0;
        vs.walkDegreeIndex = 0;
        vs.enclosurePhase = 0;
        
        // Dynamic cell sizing based on cell type and distance to target
        if (runType === 'scale_run') {
            // Longer runs when further away = audible scale passages
            vs.cellSize = Math.min(8, 4 + Math.floor(distance / 3));
        } else if (runType === 'orbit') {
            // Orbit cycles are 6-8 steps to complete the dance pattern
            vs.cellSize = distance < 3 ? 8 : 6;
        } else if (runType === 'enclosure') {
            vs.cellSize = 4;  // Fixed: above-below-target-neighbor
        } else if (runType === 'walk_up' || runType === 'walk_down') {
            vs.cellSize = Math.min(6, 4 + Math.floor(distance / 4));
        } else {
            vs.cellSize = 4;  // Default for arpeggio, chord_skip, etc.
        }
        
        vs.runStepsRemaining = vs.cellSize;
    }
    
    /**
     * Execute one step of a soprano melodic cell
     * TARGET-AWARE: scale runs walk CONSISTENTLY toward the target using scale degrees.
     * When near the target, transitions to orbit patterns that "dance around" the wick.
     * Supports cell types: scale_run, orbit, arpeggio, enclosure, sequence, chord_skip, leap_fill
     */
    function executeSopranoRunStep(scalePool, chordPool) {
        const vs = musicState.soprano;
        const prev = musicState.prevSoprano || 72;
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        const prevIndex = sortedPool.findIndex(n => Math.abs(n - prev) <= 2);
        const dynamicRange = getDynamicMidiRange('soprano');
        const target = vs.runTargetNote || prev;
        
        const clamp = (n) => Math.max(dynamicRange.min, Math.min(dynamicRange.max, n));
        
        // ── SCALE RUN (the core pathfinding move: walk 1 degree per step toward target) ──
        // This is the PRIMARY melodic engine. Steps are ALWAYS exactly 1 scale degree
        // for clear, audible scale passages in the selected genre's mode.
        // When the run reaches within 2 degrees of the target, it lands ON the target
        // and transitions to orbit (no early termination that kills momentum).
        if (vs.runMode === 'scale_run') {
            const distToTarget = target - prev;
            // If within 2 scale degrees: land on the target note
            if (Math.abs(distToTarget) <= 3) {
                // Don't end the cell — let remaining steps become a mini-orbit
                // This avoids the "snap and stop" that sounds like a chord hit
                if (vs.runStepsRemaining <= 1) {
                    return clamp(nearestScaleNote(target, sortedPool, 6));
                }
                // Transition to mini-orbit: alternate around target
                const stepInRun = vs.cellSize - vs.runStepsRemaining;
                const orbitOffsets = [0, 1, -1, 2, 0, -2, 1, 0]; // Dance around target
                const offset = orbitOffsets[stepInRun % orbitOffsets.length];
                return clamp(offsetScaleDegree(nearestScaleNote(target, sortedPool, 6), scalePool, offset));
            }
            // Walk EXACTLY 1 scale degree toward target (clear scale passage)
            // Occasionally step 2 degrees for variety (20% chance with high complexity)
            const dir = distToTarget > 0 ? 1 : -1;
            const complexity = audioState.sensitivity || 0.5;
            const stepSize = (complexity > 0.6 && Math.random() < 0.2) ? 2 : 1;
            const baseIndex = prevIndex !== -1 ? prevIndex : Math.floor(sortedPool.length / 2);
            const nextIndex = Math.max(0, Math.min(sortedPool.length - 1, baseIndex + dir * stepSize));
            return clamp(sortedPool[nextIndex]);
        }
        
        // ── ORBIT (the "wick-hugging dance": Target → +2 → -1 → Target → +1 → -2 → Target → +3) ──
        // This is the second key pattern from the notes: when price is stable or near target,
        // the melody "dances around" the wick level using scale degrees above and below.
        // Creates the musical "orbit" effect described in the Pathfinder architecture.
        if (vs.runMode === 'orbit') {
            const targetNote = nearestScaleNote(target, sortedPool, 6);
            const stepInCell = vs.cellSize - vs.runStepsRemaining;
            // Orbit pattern: alternates above and below target with increasing reach
            // This creates a natural melodic "breathing" around the wick
            const orbitPattern = [0, 2, -1, 0, 1, -2, 0, 3];
            const offset = orbitPattern[stepInCell % orbitPattern.length];
            const orbitNote = offsetScaleDegree(targetNote, scalePool, offset);
            return clamp(orbitNote);
        }
        
        // ── ARPEGGIO (cycle chord tones near target — interval work) ──
        // Chord-connected intervals as described in the notes: uses the underlying
        // chord progression to create harmonic interest while staying near the wick.
        if (vs.runMode === 'arpeggio') {
            if (chordPool.length > 0) {
                const sortedChord = [...chordPool].sort((a, b) => a - b);
                // Chord tones within 7 semitones of target for tight orbit
                const nearChord = sortedChord.filter(n => Math.abs(n - target) <= 7);
                const pool = nearChord.length >= 2 ? nearChord : sortedChord.filter(n => Math.abs(n - target) <= 12);
                if (pool.length > 0) {
                    vs.arpeggioIndex = (vs.arpeggioIndex + 1) % pool.length;
                    return clamp(pool[vs.arpeggioIndex]);
                }
            }
            return clamp(offsetScaleDegree(prev, scalePool, vs.direction * 2));
        }
        
        // ── ENCLOSURE (above → below → target → chord tone) ──
        // Jazz-inspired: approach the target from above, then below, then land.
        if (vs.runMode === 'enclosure') {
            const targetNote = nearestScaleNote(target, sortedPool, 6);
            const phase = vs.enclosurePhase;
            vs.enclosurePhase++;
            
            if (phase === 0) return clamp(offsetScaleDegree(targetNote, scalePool, 1));   // Step above
            if (phase === 1) return clamp(offsetScaleDegree(targetNote, scalePool, -1));  // Step below
            if (phase === 2) return clamp(targetNote);                                     // Land on target
            // Phase 3: neighboring chord tone
            if (chordPool.length > 0) {
                const nearChord = chordPool.filter(n => Math.abs(n - targetNote) <= 7 && n !== targetNote);
                if (nearChord.length > 0) return clamp(nearChord[Math.floor(Math.random() * nearChord.length)]);
            }
            return clamp(offsetScaleDegree(targetNote, scalePool, 2));
        }
        
        // ── SEQUENCE (ascending/descending overlapping groups toward target) ──
        if (vs.runMode === 'sequence') {
            const step = vs.cellSize - vs.runStepsRemaining;
            const toTarget = target - prev;
            const seqDir = toTarget >= 0 ? 1 : -1;
            // Overlapping groups: +1, +2, +1, +3 (net progress toward target)
            const seqPattern = [1, 2, -1, 3, 1, 2, 0, 1];
            const movement = seqDir * seqPattern[step % seqPattern.length];
            return clamp(offsetScaleDegree(prev, scalePool, movement));
        }
        
        // ── CHORD SKIP (leap between chord tones NEAR TARGET, connected by scale step) ──
        if (vs.runMode === 'chord_skip') {
            const step = vs.cellSize - vs.runStepsRemaining;
            if (step % 2 === 0) {
                if (chordPool.length > 0) {
                    const sortedChord = [...chordPool].sort((a, b) => a - b);
                    const nearTarget = sortedChord.filter(n => Math.abs(n - target) <= 7);
                    const pool = nearTarget.length >= 2 ? nearTarget : sortedChord.filter(n => Math.abs(n - target) <= 12);
                    if (pool.length > 0) {
                        const candidates = pool.filter(n => Math.abs(n - prev) >= 2);
                        const selection = candidates.length > 0 ? candidates : pool;
                        selection.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
                        const topN = selection.slice(0, Math.min(3, selection.length));
                        return clamp(topN[Math.floor(Math.random() * topN.length)]);
                    }
                }
            }
            const toTarget = target - prev;
            const stepDir = toTarget >= 0 ? 1 : -1;
            return clamp(offsetScaleDegree(prev, scalePool, stepDir));
        }
        
        // ── LEAP + FILL (leap TOWARD target, then stepwise fill back) ──
        if (vs.runMode === 'leap_fill') {
            const step = vs.cellSize - vs.runStepsRemaining;
            const toTarget = target - prev;
            const leapDir = toTarget >= 0 ? 1 : -1;
            
            if (step === 0) {
                const leapSize = 3 + Math.floor(Math.random() * 3);
                const leaped = offsetScaleDegree(prev, scalePool, leapDir * leapSize);
                if (leapDir > 0 && leaped > target + 4) return clamp(nearestScaleNote(target + 2, sortedPool, 4));
                if (leapDir < 0 && leaped < target - 4) return clamp(nearestScaleNote(target - 2, sortedPool, 4));
                return clamp(leaped);
            }
            // Fill back stepwise (away from target, creating approach-and-retreat orbit)
            return clamp(offsetScaleDegree(prev, scalePool, -leapDir));
        }
        
        return clamp(prev);
    }

    /**
     * Execute one step of a walking bass cell — root/4th/5th leaps, chromatic approaches
     * High stability: moves in strong harmonic intervals, not stepwise runs
     */
    function executeWalkingStep(scalePool, chordPool) {
        const vs = musicState.bass;
        const prev = musicState.prevBass;
        const sortedPool = [...scalePool].sort((a, b) => a - b);
        const dynamicRange = getDynamicMidiRange('bass');
        const target = vs.runTargetNote || prev;
        
        // Walking bass patterns: root → 5th → 4th → chromatic approach to next root
        // Pattern intervals from root (in semitones): [0, 7, 5, chromatic]
        const WALK_PATTERN_UP = [0, 7, 5, 1];    // Root, 5th, 4th, chromatic step up
        const WALK_PATTERN_DOWN = [0, -5, -7, -1]; // Root, 4th below, 5th below, chromatic step down
        
        if (vs.runMode === 'walk_up' || vs.runMode === 'walk_down') {
            const pattern = vs.runMode === 'walk_up' ? WALK_PATTERN_UP : WALK_PATTERN_DOWN;
            const stepIndex = vs.walkDegreeIndex % pattern.length;
            vs.walkDegreeIndex++;
            
            // Apply pattern interval relative to the target
            const rawNote = target + pattern[stepIndex];
            // Quantize to scale
            const quantized = nearestScaleNote(rawNote, sortedPool, 6);
            return Math.max(dynamicRange.min, Math.min(dynamicRange.max, quantized));
            
        } else if (vs.runMode === 'chromatic_approach') {
            // Chromatic approach: walk half-steps toward target
            const diff = target - prev;
            const step = diff > 0 ? 1 : -1;
            const approached = prev + step;
            // Clamp to range
            return Math.max(dynamicRange.min, Math.min(dynamicRange.max, approached));
            
        } else if (vs.runMode === 'arpeggio') {
            // Bass arpeggio: cycle through chord tones in register
            if (chordPool.length > 0) {
                const sortedChord = [...chordPool].sort((a, b) => a - b);
                const nearChord = sortedChord.filter(n => Math.abs(n - target) <= 12);
                const pool = nearChord.length >= 2 ? nearChord : sortedChord;
                vs.arpeggioIndex = (vs.arpeggioIndex + 1) % pool.length;
                return Math.max(dynamicRange.min, Math.min(dynamicRange.max, pool[vs.arpeggioIndex]));
            }
        }
        
        // Fallback: move toward target by scale degree
        const direction = target > prev ? 1 : -1;
        return offsetScaleDegree(prev, scalePool, direction * 2);
    }

    // ========================================================================
    // GENRE COMPLEXITY (beat-gated stochastic interruptions)
    // ========================================================================

    /**
     * Apply genre-specific complexity using beat-based triggers
     * 
     * The Complexity slider (audioState.sensitivity, 0..1) acts as a MULTIPLIER
     * on each genre's base probability configs. At 0 = pure runs/arpeggios,
     * at 1 = maximum genre-specific ornamentation (constant enclosures in Jazz,
     * trills in Classical, gamaka in Raags, etc.)
     */
    function applyGenreComplexity(note, scalePool, chordPool, subStepInBar, voice) {
        const genre = GENRES[musicState.currentGenre] || GENRES.classical;
        const genreChances = genre.complexity || {};
        const dynamicRange = getDynamicMidiRange(voice);
        
        // Complexity slider scales all genre probabilities (0 = off, 1 = full)
        const complexityMul = audioState.sensitivity || 0.5;
        
        // Helper: roll against a genre chance scaled by complexity
        const roll = (baseChance) => Math.random() < (baseChance * complexityMul * 2);
        // ×2 so at complexity=0.5 we get the base chance; at 1.0 we get 2× base
        
        // BAROQUE/CLASSICAL: Passing tones, neighbor tones, trills
        if (musicState.currentGenre === 'classical') {
            if (subStepInBar % 4 === 2 && roll(genreChances.passingToneChance || 0.08)) {
                const passingDir = Math.random() < 0.5 ? 1 : -1;
                const passingNote = offsetScaleDegree(note, scalePool, passingDir);
                if (passingNote && passingNote >= dynamicRange.min && passingNote <= dynamicRange.max) {
                    return passingNote;
                }
            }
            if (subStepInBar % 8 === 4 && roll(genreChances.ornamentChance || 0.1)) {
                const neighborDir = Math.random() < 0.5 ? 1 : -1;
                const neighborNote = note + neighborDir;
                if (neighborNote >= dynamicRange.min && neighborNote <= dynamicRange.max) {
                    return neighborNote;
                }
            }
            if (subStepInBar % 8 === 6 && roll(genreChances.trillChance || 0.05)) {
                // Trill: alternate with upper neighbor
                const trillNote = offsetScaleDegree(note, scalePool, 1);
                if (trillNote && trillNote >= dynamicRange.min && trillNote <= dynamicRange.max) {
                    return trillNote;
                }
            }
        }
        
        // INDIAN RAAGS: Gamaka (oscillation), Meend (slides)
        if (musicState.currentGenre === 'indian_raags') {
            if (subStepInBar % 2 === 1 && roll(genreChances.gamakaChance || 0.12)) {
                const gamakaOffset = Math.random() < 0.5 ? 1 : -1;
                const gamakaNote = note + gamakaOffset;
                if (gamakaNote >= dynamicRange.min && gamakaNote <= dynamicRange.max) {
                    return gamakaNote;
                }
            }
            if (subStepInBar === 8 && roll(genreChances.meendChance || 0.15)) {
                const prev = voice === 'soprano' ? musicState.prevSoprano : musicState.prevBass;
                if (prev !== null) {
                    const midPoint = Math.round((prev + note) / 2);
                    const meendNote = nearestScaleNote(midPoint, scalePool, 6);
                    if (meendNote !== note && meendNote >= dynamicRange.min && meendNote <= dynamicRange.max) {
                        return meendNote;
                    }
                }
            }
        }
        
        // JAZZ: Chromatic approaches, bebop enclosures, tritone subs
        if (musicState.currentGenre === 'jazz') {
            if (subStepInBar % 4 === 3 && roll(genreChances.chromaticPassingChance || 0.20)) {
                const chromaticNote = note + (Math.random() < 0.5 ? -1 : 1);
                if (chromaticNote >= dynamicRange.min && chromaticNote <= dynamicRange.max) {
                    return chromaticNote;
                }
            }
            if ((subStepInBar === 0 || subStepInBar === 8) && roll(genreChances.bebopEnclosureChance || 0.12)) {
                // Enclosure: half-step above then below target
                const enclosureNote = note + (subStepInBar === 0 ? 1 : -1);
                if (enclosureNote >= dynamicRange.min && enclosureNote <= dynamicRange.max) {
                    return enclosureNote;
                }
            }
            if (subStepInBar === 4 && roll(genreChances.tritoneSubChance || 0.08)) {
                // Tritone substitution: 6 semitones away
                const tritoneNote = nearestScaleNote(note + 6, scalePool, 6);
                if (tritoneNote >= dynamicRange.min && tritoneNote <= dynamicRange.max) {
                    return tritoneNote;
                }
            }
        }
        
        // ROCK/BLUEGRASS: Blue notes, bends, slides
        if (musicState.currentGenre === 'rock_bluegrass') {
            if ((subStepInBar === 4 || subStepInBar === 12) && roll(genreChances.blueNoteChance || 0.15)) {
                const blueIntervals = [3, 6, 10]; // b3, b5, b7
                const randomBlue = blueIntervals[Math.floor(Math.random() * blueIntervals.length)];
                const blueNote = musicState.rootMidi + randomBlue;
                const octaveShift = Math.floor((note - blueNote) / 12) * 12;
                const adjustedBlue = blueNote + octaveShift;
                if (adjustedBlue >= dynamicRange.min && adjustedBlue <= dynamicRange.max) {
                    return adjustedBlue;
                }
            }
            if (subStepInBar % 4 === 1 && roll(genreChances.slideChance || 0.08)) {
                // Slide: move 1-2 semitones toward previous note
                const prev = voice === 'soprano' ? musicState.prevSoprano : musicState.prevBass;
                if (prev !== null) {
                    const slideDir = note > prev ? -1 : 1;
                    const slideNote = note + slideDir;
                    if (slideNote >= dynamicRange.min && slideNote <= dynamicRange.max) {
                        return slideNote;
                    }
                }
            }
        }
        
        // TECHNO/EXPERIMENTAL: Random jumps, clusters, rests
        if (musicState.currentGenre === 'techno_experimental') {
            if (subStepInBar === 0 && roll(genreChances.randomJumpChance || 0.18)) {
                const octaveJump = Math.random() < 0.5 ? 12 : -12;
                const jumpedNote = note + octaveJump;
                if (jumpedNote >= dynamicRange.min && jumpedNote <= dynamicRange.max) {
                    return jumpedNote;
                }
            }
            if (subStepInBar % 4 === 2 && roll(genreChances.clusterChance || 0.10)) {
                // Note cluster: random semitone offset
                const clusterOffset = Math.floor(Math.random() * 5) - 2;
                const clusterNote = note + clusterOffset;
                if (clusterNote >= dynamicRange.min && clusterNote <= dynamicRange.max) {
                    return clusterNote;
                }
            }
        }
        
        return note;
    }

    // ========================================================================
    // BASS NOTE GENERATION
    // ========================================================================

    /**
     * Generate bass note - PRICE-TRACKING with smart anti-repetition
     * Notes "hug" the wick lines while avoiding monotonous repetition
     * Approach: Start from price-derived MIDI, vary within ±3 semitones to avoid repeats
     * Voice separation is handled by priceToMidi mapping to voice-specific MIDI ranges
     */
    function generateBassNote(rawMidi, priceDirection) {
        const regime = musicState.regime;
        const dynamicRange = getDynamicMidiRange('bass');
        const bassPool = getScaleNotes(regime, musicState.rootMidi, dynamicRange.min, dynamicRange.max);
        const sortedPool = [...bassPool].sort((a, b) => a - b);
        
        // Get price-derived target (the "wick hugging" target)
        const targetMidi = nearestScaleNote(rawMidi, sortedPool, 24);
        const targetIndex = sortedPool.indexOf(targetMidi);
        
        // Get nearby notes (within ±3 scale degrees of target)
        const nearbyRange = 3;
        const minIdx = Math.max(0, targetIndex - nearbyRange);
        const maxIdx = Math.min(sortedPool.length - 1, targetIndex + nearbyRange);
        const nearbyNotes = sortedPool.slice(minIdx, maxIdx + 1);
        
        let bassNote = targetMidi;
        
        // Anti-repetition: if target would repeat recent notes, pick a different nearby note
        const recentNotes = musicState.bassHistory.slice(-3);
        
        if (recentNotes.includes(bassNote)) {
            // Find nearby notes that aren't in recent history
            const freshNotes = nearbyNotes.filter(n => !recentNotes.includes(n));
            
            if (freshNotes.length > 0) {
                // Pick the fresh note closest to the target
                bassNote = freshNotes.reduce((a, b) => 
                    Math.abs(a - targetMidi) < Math.abs(b - targetMidi) ? a : b
                );
            } else {
                // All nearby notes used recently - pick based on price direction
                const stepDir = priceDirection !== 0 ? priceDirection : 1;
                const nextIndex = Math.max(0, Math.min(sortedPool.length - 1, targetIndex + stepDir));
                bassNote = sortedPool[nextIndex];
            }
        }
        
        // Clamp to range
        bassNote = Math.max(dynamicRange.min, Math.min(dynamicRange.max, bassNote));
        
        updateBassHistory(bassNote);
        return bassNote;
    }

    // ========================================================================
    // EXPORTS
    // ========================================================================

    _am.generateSopranoNote = generateSopranoNote;
    _am.getScaleRunNote = getScaleRunNote;
    _am.getArpeggioNote = getArpeggioNote;
    _am.applyGenrePhrasing = applyGenrePhrasing;
    _am.updateSopranoHistory = updateSopranoHistory;
    _am.updateBassHistory = updateBassHistory;
    _am.startMelodicRun = startMelodicRun;
    _am.executeRunStep = executeRunStep;
    _am.applyWickGravity = applyWickGravity;
    _am.needsWickReturn = needsWickReturn;
    _am.startVoiceCell = startVoiceCell;
    _am.executeSopranoRunStep = executeSopranoRunStep;
    _am.executeWalkingStep = executeWalkingStep;
    _am.applyGenreComplexity = applyGenreComplexity;
    _am.generateBassNote = generateBassNote;
})();
