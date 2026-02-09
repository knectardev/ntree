/**
 * 13_audio_controls.js — Audio Visual Settings panel + Tone.js Audio Engine
 * Integrates musical playback with the Practice/Replay system
 * 
 * Architecture — Pathfinding Sequencer:
 * - Each replay bar becomes a "musical measure" with 16 sub-steps
 * - High wick → Soprano voice (upper pitch rail, scale runs + orbits)
 * - Low wick → Bass voice (lower pitch rail, walking bass + arpeggios)
 * - Volume → Gain envelope
 * - Speed slider → Tone.Transport BPM
 * 
 * Core Melody Algorithm (processSubStep → "The Conductor"):
 *   1. Price-to-MIDI mapping uses VISIBLE VIEWPORT for tight wick correspondence
 *   2. Distance-based cell selection:
 *      - Far from wick (>4 semitones): SCALE RUN — walk 1 degree per step toward target
 *        (creates audible scale passages in the selected genre's mode)
 *      - Near wick (≤4 semitones): ORBIT — dance around the wick target
 *        (Target → +2 → -1 → Target → +1 → -2 pattern)
 *   3. Complexity slider (0-1): controls probability of stochastic interruptions
 *      (genre ornaments replace pure runs/orbits at higher complexity)
 *   4. Dynamic cell sizing: longer cells when far (4-8 steps), shorter near target
 *   5. Genre-specific ornaments are BEAT-GATED (not applied mid-scale-run)
 *   6. Wick gravity is a SAFETY NET only (extreme drift), not a constant pull
 */
(function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    // Instrument URLs from midi-js-soundfonts (CDN hosted)
    const INSTRUMENT_MAP = {
        // --- Keyboards ---
        harpsichord: {
            label: "Harpsichord",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/harpsichord-mp3/"
        },
        acoustic_grand_piano: {
            label: "Piano",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/"
        },
        electric_piano: {
            label: "Electric Piano",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/electric_piano_1-mp3/"
        },
        music_box: {
            label: "Music Box",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/music_box-mp3/"
        },
        pipe_organ: {
            label: "Pipe Organ",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/church_organ-mp3/"
        },
        accordion: {
            label: "Accordion",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/accordion-mp3/"
        },
        harmonica: {
            label: "Harmonica",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/harmonica-mp3/"
        },
        // --- Strings ---
        strings: {
            label: "Strings",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/string_ensemble_1-mp3/"
        },
        violin: {
            label: "Violin",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/violin-mp3/"
        },
        cello: {
            label: "Cello",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/cello-mp3/"
        },
        contrabass: {
            label: "Contrabass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/contrabass-mp3/"
        },
        acoustic_guitar_nylon: {
            label: "Nylon Guitar",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_nylon-mp3/"
        },
        acoustic_guitar_steel: {
            label: "Steel Guitar",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_steel-mp3/"
        },
        sitar: {
            label: "Sitar",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/sitar-mp3/"
        },
        banjo: {
            label: "Banjo",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/banjo-mp3/"
        },
        // --- Woodwinds ---
        flute: {
            label: "Flute",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/flute-mp3/"
        },
        clarinet: {
            label: "Clarinet",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/clarinet-mp3/"
        },
        oboe: {
            label: "Oboe",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/oboe-mp3/"
        },
        bassoon: {
            label: "Bassoon",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/bassoon-mp3/"
        },
        alto_sax: {
            label: "Alto Sax",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/alto_sax-mp3/"
        },
        baritone_sax: {
            label: "Baritone Sax",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/baritone_sax-mp3/"
        },
        // --- Brass ---
        trumpet: {
            label: "Trumpet",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/trumpet-mp3/"
        },
        trombone: {
            label: "Trombone",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/trombone-mp3/"
        },
        tuba: {
            label: "Tuba",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/tuba-mp3/"
        },
        // --- Percussion / Mallet ---
        vibraphone: {
            label: "Vibraphone",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/vibraphone-mp3/"
        },
        marimba: {
            label: "Marimba",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/marimba-mp3/"
        },
        steel_drums: {
            label: "Steel Drums",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/steel_drums-mp3/"
        },
        timpani: {
            label: "Timpani",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/timpani-mp3/"
        },
        // --- Bass ---
        acoustic_bass: {
            label: "Acoustic Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_bass-mp3/"
        },
        electric_bass: {
            label: "Electric Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/electric_bass_finger-mp3/"
        },
        fretless_bass: {
            label: "Fretless Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/fretless_bass-mp3/"
        },
        slap_bass: {
            label: "Slap Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/slap_bass_1-mp3/"
        },
        synth_bass: {
            label: "Synth Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_bass_1-mp3/"
        },
        // --- Synths ---
        synth_lead: {
            label: "Synth Lead",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/lead_1_square-mp3/"
        },
        synth_pad: {
            label: "Synth Pad",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/"
        },
        synth_brass: {
            label: "Synth Brass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synthbrass_1-mp3/"
        }
    };

    // MIDI note range for price mapping - voice-specific for separation
    const NOTE_CONFIG = {
        minMidi: 24,   // C1 - Full range min
        maxMidi: 84,   // C6 - Full range max
        bassMin: 24,   // C1 - Bass lower half
        bassMax: 54,   // F#3 - Bass upper limit
        sopranoMin: 54, // F#3 - Soprano lower limit
        sopranoMax: 84  // C6 - Soprano upper limit
    };

    // ========================================================================
    // MUSIC THEORY ENGINE (ported from Market Inventions)
    // ========================================================================
    
    // Chord progression presets (16-step patterns for MAJOR and MINOR)
    const CHORD_PROGRESSIONS = {
        classical: {
            MAJOR: [1, 1, 4, 4, 2, 2, 5, 5, 6, 6, 4, 4, 5, 5, 1, 1],
            MINOR: [1, 1, 4, 4, 6, 6, 2, 2, 3, 3, 7, 7, 5, 5, 1, 1]
        },
        pop: {
            MAJOR: [1, 1, 5, 5, 6, 6, 4, 4, 1, 1, 5, 5, 6, 6, 4, 4],
            MINOR: [1, 1, 7, 7, 6, 6, 5, 5, 1, 1, 7, 7, 6, 6, 5, 5]
        },
        blues: {
            MAJOR: [1, 1, 1, 1, 4, 4, 4, 4, 1, 1, 5, 5, 4, 4, 1, 5],
            MINOR: [1, 1, 1, 1, 4, 4, 4, 4, 1, 1, 5, 5, 4, 4, 1, 5]
        },
        jazz: {
            MAJOR: [2, 2, 5, 5, 1, 1, 1, 1, 2, 2, 5, 5, 3, 3, 6, 6],
            MINOR: [2, 2, 5, 5, 1, 1, 1, 1, 4, 4, 7, 7, 3, 3, 6, 6]
        },
        canon: {
            MAJOR: [1, 1, 5, 5, 6, 6, 3, 3, 4, 4, 1, 1, 4, 4, 5, 5],
            MINOR: [1, 1, 5, 5, 6, 6, 3, 3, 4, 4, 1, 1, 4, 4, 5, 5]
        },
        fifties: {
            MAJOR: [1, 1, 1, 1, 6, 6, 6, 6, 4, 4, 4, 4, 5, 5, 5, 5],
            MINOR: [1, 1, 1, 1, 6, 6, 6, 6, 4, 4, 4, 4, 5, 5, 5, 5]
        }
    };

    // Chord maps: scale degree → intervals from root
    // Major key: I=major, ii=minor, iii=minor, IV=major, V=major, vi=minor, vii°=dim
    const CHORD_MAP_MAJOR = {
        1: [0, 4, 7],    // I   - major
        2: [2, 5, 9],    // ii  - minor
        3: [4, 7, 11],   // iii - minor
        4: [5, 9, 12],   // IV  - major
        5: [7, 11, 14],  // V   - major
        6: [9, 12, 16],  // vi  - minor
        7: [11, 14, 17]  // vii°- diminished
    };

    // Minor key: i=minor, ii°=dim, III=major, iv=minor, v=minor, VI=major, VII=major
    const CHORD_MAP_MINOR = {
        1: [0, 3, 7],    // i   - minor
        2: [2, 5, 8],    // ii° - diminished
        3: [3, 7, 10],   // III - major
        4: [5, 8, 12],   // iv  - minor
        5: [7, 10, 14],  // v   - minor
        6: [8, 12, 15],  // VI  - major
        7: [10, 14, 17]  // VII - major
    };

    // Genre-based scale configurations
    // Each genre has two scales: one for uptrend, one for downtrend
    const GENRES = {
        classical: {
            label: "Classical / Baroque",
            scales: { 
                UPTREND: [0, 2, 4, 5, 7, 9, 11],   // Major (Ionian)
                DOWNTREND: [0, 2, 3, 5, 7, 8, 10]  // Natural Minor (Aeolian)
            },
            complexity: {
                ornamentChance: 0.1,      // Chance of adding ornamental notes
                trillChance: 0.05,        // Chance of trill-like patterns
                passingToneChance: 0.08   // Chance of chromatic passing tones
            }
        },
        indian_raags: {
            label: "Indian Raags",
            scales: { 
                UPTREND: [0, 2, 4, 6, 7, 9, 11],   // Yaman (Lydian-like)
                DOWNTREND: [0, 1, 3, 5, 7, 8, 10]  // Bhairavi (Phrygian-like)
            },
            complexity: {
                meendChance: 0.15,        // Glissando/slide between notes
                gamakaChance: 0.12,       // Oscillation around a note
                passingToneChance: 0.05
            }
        },
        jazz: {
            label: "Jazz Bebop",
            scales: { 
                UPTREND: [0, 2, 3, 5, 7, 9, 10],   // Dorian
                DOWNTREND: [0, 1, 3, 4, 6, 8, 10]  // Altered (Super Locrian)
            },
            complexity: {
                chromaticPassingChance: 0.20,  // Chromatic approach notes
                bebopEnclosureChance: 0.12,    // Target note enclosure
                tritoneSubChance: 0.08         // Tritone substitution
            }
        },
        rock_bluegrass: {
            label: "Rock / Bluegrass",
            scales: { 
                UPTREND: [0, 2, 4, 5, 7, 9, 10],   // Mixolydian
                DOWNTREND: [0, 2, 4, 7, 9]         // Major Pentatonic
            },
            complexity: {
                blueNoteChance: 0.15,      // Add blue notes (b3, b5, b7)
                bendChance: 0.10,          // String bend simulation
                slideChance: 0.08
            }
        },
        techno_experimental: {
            label: "Techno / Experimental",
            scales: { 
                UPTREND: [0, 1, 3, 5, 7, 8, 10],   // Phrygian
                DOWNTREND: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]  // Chromatic
            },
            complexity: {
                randomJumpChance: 0.18,    // Random octave jumps
                clusterChance: 0.10,       // Note clusters
                silenceChance: 0.12        // Random rests for rhythmic interest
            }
        }
    };

    // Legacy SCALES mapping for compatibility
    const SCALES = {
        MAJOR: [0, 2, 4, 5, 7, 9, 11],
        MINOR: [0, 2, 3, 5, 7, 8, 10]
    };

    // Root key name → MIDI offset from C (used to compute rootMidi = 60 + offset)
    const ROOT_KEY_OFFSETS = {
        'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
        'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
    };

    // Music theory state
    const musicState = {
        regime: 'UPTREND',  // Now uses UPTREND/DOWNTREND to match genre scales
        currentGenre: 'classical',  // Default genre
        consecutiveDownBars: 0,
        consecutiveUpBars: 0,
        prevBarClose: null,
        regimeSwitchThreshold: 3,
        progressionStep: 0,
        rootMidi: 60,  // C4
        prevSoprano: 72,
        prevBass: 48,
        _prevSopranoPrice: null,  // For trend-aware MIDI mapping
        _prevBassPrice: null,
        
        // ====== MELODIC SEQUENCE STATE (per-voice) ======
        // 4-note history for pattern detection
        sopranoHistory: [],
        bassHistory: [],
        
        // Per-voice pathfinder cell state
        // Soprano: scale runs, arpeggios, orbits, enclosures, sequences (high agility)
        soprano: {
            runMode: null,        // null, 'scale_run', 'orbit', 'arpeggio', 'enclosure', 'sequence', 'chord_skip', 'leap_fill'
            runStepsRemaining: 0,
            runTargetNote: null,
            arpeggioIndex: 0,
            cellSize: 4,          // Notes per cell (can cross bar boundaries)
            lastCellType: null,   // Prevent same-type repetition
            sequenceBase: 0,      // Base index for sequence patterns
            enclosurePhase: 0,    // Phase within enclosure pattern
            direction: 1          // +1 ascending, -1 descending
        },
        // Bass: walking bass (root/4th/5th leaps, chromatic approaches)
        bass: {
            runMode: null,        // null, 'walk_up', 'walk_down', 'arpeggio', 'chromatic_approach'
            runStepsRemaining: 0,
            runTargetNote: null,
            arpeggioIndex: 0,
            cellSize: 4,
            walkDegreeIndex: 0,   // Tracks position in walking pattern
            lastCellType: null,
            direction: 1
        },
        
        // Legacy aliases (kept for backward compat during transition)
        runMode: null,
        runStepsRemaining: 0,
        runTargetNote: null,
        arpeggioIndex: 0,
        
        // Dynamic range from visible chart
        visiblePriceMin: null,
        visiblePriceMax: null,
        
        // Sub-step counter for beat-based ornaments (no time cooldown)
        subStepCounter: 0
    };

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
    function nearestScaleNote(targetMidi, scalePool, maxDistance = 12) {
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
    
    /**
     * Update bass history (keep last 8 notes)
     */
    function updateBassHistory(note) {
        musicState.bassHistory.push(note);
        if (musicState.bassHistory.length > 8) {
            musicState.bassHistory.shift();
        }
    }

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

    // Kick drum for downbeat (using membrane synth)
    const KICK_CONFIG = {
        pitchDecay: 0.05,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: {
            attack: 0.001,
            decay: 0.4,
            sustain: 0.01,
            release: 0.4
        }
    };

    // ========================================================================
    // AUDIO STATE
    // ========================================================================
    
    window.audioState = {
        upperWick: {
            enabled: true,
            volume: -23,
            instrument: 'harpsichord',
            rhythm: '4'  // Quarter notes
        },
        lowerWick: {
            enabled: true,
            volume: -17,
            instrument: 'acoustic_bass',
            rhythm: '2'  // Half notes
        },
        genre: 'classical',
        rootKey: 'C',           // Root key for scales and chord progressions (C, C#, D, ... B)
        chordProgression: 'canon',
        displayNotes: true,
        sensitivity: 0.5,       // Repurposed: Complexity/Stochasticism (0=pure, 1=chaotic)
        melodicRange: 1.0,     // Vertical Zoom: expands/compresses price-to-MIDI mapping
        glowDuration: 3,
        displayMode: 'bars',    // 'bars' (horizontal bars) or 'circles' (radius = note duration)
        panels: {               // Sub-panel open/closed state
            channels: true,
            genre: true,
            tuning: true,
            playback: true
        },
        playing: false,
        paused: false,          // True when playback is paused (engine stays initialized)
        
        // Internal Tone.js state
        _initialized: false,
        _sopranoSampler: null,
        _bassSampler: null,
        _kickSynth: null,
        _transportStarted: false,
        _lastBarIndex: -1,
        _priceRange: { min: 0, max: 100 },  // Updated from data
        _lastSopranoMidi: null,
        _lastBassMidi: null,
        
        // Animation state
        _animationRunning: false,
        _animationFrame: null,
        _animationIndex: 0,
        _lastAnimTime: 0,
        _msPerBar: 1000  // Default: 1 second per bar
    };

    // ========================================================================
    // DOM CACHE
    // ========================================================================
    
    const ui = {
        // Upper wick
        upperWickChk: document.getElementById('audioUpperWick'),
        upperVolume: document.getElementById('audioUpperVolume'),
        upperVolumeLabel: document.getElementById('audioUpperVolumeLabel'),
        upperInstrumentDD: document.getElementById('audioUpperInstrumentDD'),
        upperInstrumentBtn: document.getElementById('audioUpperInstrumentBtn'),
        upperInstrumentMenu: document.getElementById('audioUpperInstrumentMenu'),
        upperInstrumentLabel: document.getElementById('audioUpperInstrumentLabel'),
        upperRhythmDD: document.getElementById('audioUpperRhythmDD'),
        upperRhythmBtn: document.getElementById('audioUpperRhythmBtn'),
        upperRhythmMenu: document.getElementById('audioUpperRhythmMenu'),
        upperRhythmLabel: document.getElementById('audioUpperRhythmLabel'),

        // Lower wick
        lowerWickChk: document.getElementById('audioLowerWick'),
        lowerVolume: document.getElementById('audioLowerVolume'),
        lowerVolumeLabel: document.getElementById('audioLowerVolumeLabel'),
        lowerInstrumentDD: document.getElementById('audioLowerInstrumentDD'),
        lowerInstrumentBtn: document.getElementById('audioLowerInstrumentBtn'),
        lowerInstrumentMenu: document.getElementById('audioLowerInstrumentMenu'),
        lowerInstrumentLabel: document.getElementById('audioLowerInstrumentLabel'),
        lowerRhythmDD: document.getElementById('audioLowerRhythmDD'),
        lowerRhythmBtn: document.getElementById('audioLowerRhythmBtn'),
        lowerRhythmMenu: document.getElementById('audioLowerRhythmMenu'),
        lowerRhythmLabel: document.getElementById('audioLowerRhythmLabel'),

        // Genre selection
        genreDD: document.getElementById('audioGenreDD'),
        genreBtn: document.getElementById('audioGenreBtn'),
        genreMenu: document.getElementById('audioGenreMenu'),
        genreLabel: document.getElementById('audioGenreLabel'),

        // Root key
        rootKeyDD: document.getElementById('audioRootKeyDD'),
        rootKeyBtn: document.getElementById('audioRootKeyBtn'),
        rootKeyMenu: document.getElementById('audioRootKeyMenu'),
        rootKeyLabel: document.getElementById('audioRootKeyLabel'),
        
        // Chord progression
        chordProgressionDD: document.getElementById('audioChordProgressionDD'),
        chordProgressionBtn: document.getElementById('audioChordProgressionBtn'),
        chordProgressionMenu: document.getElementById('audioChordProgressionMenu'),
        chordProgressionLabel: document.getElementById('audioChordProgressionLabel'),
        displayNotesChk: document.getElementById('audioDisplayNotes'),

        // Sync tuning sliders
        sensitivity: document.getElementById('audioSensitivity'),
        sensitivityLabel: document.getElementById('audioSensitivityLabel'),
        melodicRange: document.getElementById('audioMelodicRange'),
        melodicRangeLabel: document.getElementById('audioMelodicRangeLabel'),
        glowDuration: document.getElementById('audioGlowDuration'),
        glowDurationLabel: document.getElementById('audioGlowDurationLabel'),

        // Display mode dropdown
        displayModeDD: document.getElementById('audioDisplayModeDD'),
        displayModeBtn: document.getElementById('audioDisplayModeBtn'),
        displayModeMenu: document.getElementById('audioDisplayModeMenu'),
        displayModeLabel: document.getElementById('audioDisplayModeLabel'),

        // Collapsible sub-panels
        panelChannels: document.getElementById('audioPanelChannels'),
        panelGenre: document.getElementById('audioPanelGenre'),
        panelTuning: document.getElementById('audioPanelTuning'),
        panelPlayback: document.getElementById('audioPanelPlayback'),
        
        // Speed control
        speed: document.getElementById('audioSpeed'),
        speedLabel: document.getElementById('audioSpeedLabel'),

        // Playback controls
        startBtn: document.getElementById('audioStartBtn'),
        stopBtn: document.getElementById('audioStopBtn'),
        statusLabel: document.getElementById('audioStatus')
    };

    // Track all audio dropdowns
    const allAudioDropdowns = [];

    // ========================================================================
    // TONE.JS AUDIO ENGINE
    // ========================================================================

    /**
     * Load a Tone.js Sampler with timeout protection
     */
    async function loadSampler(instrumentKey) {
        const config = INSTRUMENT_MAP[instrumentKey] || INSTRUMENT_MAP.harpsichord;
        console.log('[Audio] Loading sampler from:', config.baseUrl);
        
        return new Promise((resolve, reject) => {
            let resolved = false;
            const sampler = new Tone.Sampler({
                urls: {
                    C2: "C2.mp3",
                    C3: "C3.mp3",
                    C4: "C4.mp3",
                    C5: "C5.mp3"
                },
                baseUrl: config.baseUrl,
                release: 0.5,
                onload: () => {
                    if (!resolved) {
                        resolved = true;
                        console.log('[Audio] Sampler loaded successfully:', config.label);
                        resolve(sampler);
                    }
                },
                onerror: (err) => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error(`Failed to load ${config.label}: ${err}`));
                    }
                }
            }).toDestination();

            // Timeout after 10 seconds
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    console.warn('[Audio] Sampler load timeout, using anyway:', config.label);
                    resolve(sampler);  // Resolve anyway, might work with partial load
                }
            }, 10000);
        });
    }

    /**
     * Hot-swap a sampler during playback (for instrument changes)
     */
    async function reloadSampler(voice, instrumentKey) {
        console.log('[Audio] Reloading', voice, 'sampler to:', instrumentKey);
        updateStatus('Switching instrument...');
        
        try {
            const newSampler = await loadSampler(instrumentKey);
            newSampler.volume.value = -10;
            
            if (voice === 'soprano') {
                // Dispose old sampler
                if (audioState._sopranoSampler) {
                    audioState._sopranoSampler.releaseAll?.();
                    audioState._sopranoSampler.dispose();
                }
                audioState._sopranoSampler = newSampler;
                // Reset last played note to trigger fresh on next bar
                audioState._lastSopranoMidi = null;
            } else {
                // Dispose old sampler
                if (audioState._bassSampler) {
                    audioState._bassSampler.releaseAll?.();
                    audioState._bassSampler.dispose();
                }
                audioState._bassSampler = newSampler;
                // Reset last played note to trigger fresh on next bar
                audioState._lastBassMidi = null;
            }
            
            console.log('[Audio]', voice, 'sampler swapped successfully');
            updateStatus('Playing...');
        } catch (err) {
            console.error('[Audio] Failed to reload sampler:', err);
            updateStatus('Instrument switch failed');
        }
    }

    /**
     * Initialize the Tone.js audio engine
     */
    async function initAudioEngine() {
        if (typeof Tone === 'undefined') {
            console.error('[Audio] Tone.js not found. Check script loading order.');
            updateStatus('Error: Tone.js not loaded');
            throw new Error('Tone.js not loaded - ensure the Tone.js script is included before this file');
        }

        try {
            await Tone.start();
            console.log('[Audio] Tone.js context started, state:', Tone.context.state);
        } catch (e) {
            console.error('[Audio] Failed to start Tone context:', e);
            throw new Error('Failed to start audio context: ' + e.message);
        }

        updateStatus('Loading samples...');

        try {
            // Load soprano (upper wick) sampler
            const sopranoInstrument = getSelectedInstrument('upper');
            audioState._sopranoSampler = await loadSampler(sopranoInstrument);
            audioState._sopranoSampler.volume.value = -10;  // Audible volume
            console.log('[Audio] Soprano sampler loaded:', sopranoInstrument);

            // Load bass (lower wick) sampler
            const bassInstrument = getSelectedInstrument('lower');
            audioState._bassSampler = await loadSampler(bassInstrument);
            audioState._bassSampler.volume.value = -10;  // Audible volume
            console.log('[Audio] Bass sampler loaded:', bassInstrument);

            // Create kick drum synth for downbeat
            audioState._kickSynth = new Tone.MembraneSynth(KICK_CONFIG).toDestination();
            audioState._kickSynth.volume.value = -6;  // Louder kick
            console.log('[Audio] Kick synth initialized');
            
            // Play a test note to verify audio is working
            console.log('[Audio] Playing test note...');
            audioState._kickSynth.triggerAttackRelease('C2', '8n', Tone.now(), 0.8);

            audioState._initialized = true;
            updateStatus('Audio ready');
            return true;
        } catch (err) {
            console.error('[Audio] Init failed:', err);
            updateStatus('Sample load failed: ' + err.message);
            return false;
        }
    }

    /**
     * Get the currently selected instrument for a voice
     */
    function getSelectedInstrument(voice) {
        if (voice === 'upper') {
            const menu = ui.upperInstrumentMenu;
            if (menu) {
                const sel = menu.querySelector('.ddItem.sel');
                if (sel) return sel.getAttribute('data-value') || 'harpsichord';
            }
            return audioState.upperWick.instrument;
        } else {
            const menu = ui.lowerInstrumentMenu;
            if (menu) {
                const sel = menu.querySelector('.ddItem.sel');
                if (sel) return sel.getAttribute('data-value') || 'acoustic_bass';
            }
            return audioState.lowerWick.instrument;
        }
    }

    /**
     * Stop the audio engine and dispose resources
     */
    function stopAudioEngine() {
        audioState.playing = false;
        audioState._lastBarIndex = -1;
        audioState._lastSopranoMidi = null;
        audioState._lastBassMidi = null;

        if (audioState._sopranoSampler) {
            audioState._sopranoSampler.releaseAll();
            audioState._sopranoSampler.dispose();
            audioState._sopranoSampler = null;
        }
        if (audioState._bassSampler) {
            audioState._bassSampler.releaseAll();
            audioState._bassSampler.dispose();
            audioState._bassSampler = null;
        }
        if (audioState._kickSynth) {
            audioState._kickSynth.dispose();
            audioState._kickSynth = null;
        }

        Tone.Transport.stop();
        Tone.Transport.cancel();
        audioState._transportStarted = false;
        audioState._initialized = false;

        console.log('[Audio] Engine stopped');
    }

    // ========================================================================
    // OHLC TO MIDI CONVERSION
    // ========================================================================

    /**
     * Initialize/update reference prices for MIDI mapping
     * Called when playback starts or data changes
     */
    function updatePriceRange() {
        try {
            if (typeof state !== 'undefined' && state.data && state.data.length > 0) {
                // Use the first visible bar as reference (like Market Inventions uses opening price)
                const startIndex = Math.floor(audioState._smoothPosition || 0);
                const refBar = state.data[Math.max(0, startIndex)] || state.data[0];
                
                if (refBar && !audioState._referencePrice) {
                    // Set reference price at the middle of the bar's range
                    audioState._referencePrice = (refBar.h + refBar.l) / 2;
                    audioState._sopranoRef = refBar.h;
                    audioState._bassRef = refBar.l;
                    console.log('[Audio] Set reference prices - soprano:', audioState._sopranoRef.toFixed(2), 
                                'bass:', audioState._bassRef.toFixed(2));
                }
                
                // Also calculate overall range for bounds checking
                let minPrice = Infinity, maxPrice = -Infinity;
                for (let i = 0; i < state.data.length; i++) {
                    const bar = state.data[i];
                    if (bar && Number.isFinite(bar.l) && bar.l < minPrice) minPrice = bar.l;
                    if (bar && Number.isFinite(bar.h) && bar.h > maxPrice) maxPrice = bar.h;
                }
                if (Number.isFinite(minPrice) && Number.isFinite(maxPrice)) {
                    audioState._priceRange = { min: minPrice, max: maxPrice };
                }
            }
        } catch (e) {
            console.warn('[Audio] Could not update price range:', e);
        }
    }

    /**
     * Map a price to a MIDI note number
     * Uses the VISIBLE VIEWPORT price range for tight wick-hugging.
     * The "Melodic Range" slider expands/compresses the mapping around center.
     * 
     * @param {number} price - The price value
     * @param {string} voice - 'soprano' or 'bass'
     * @returns {number} MIDI note number (voice-specific range)
     */
    function priceToMidi(price, voice) {
        if (!Number.isFinite(price)) return null;
        
        const priceMin = musicState.visiblePriceMin;
        const priceMax = musicState.visiblePriceMax;
        
        let midi;
        
        if (priceMin && priceMax && priceMax > priceMin) {
            // Voice-specific MIDI ranges for separation
            let voiceMidiMin, voiceMidiMax;
            if (voice === 'soprano') {
                voiceMidiMin = 54;  // F#3
                voiceMidiMax = 84;  // C6
            } else {
                voiceMidiMin = 24;  // C1
                voiceMidiMax = 54;  // F#3
            }
            
            const voiceMidiRange = voiceMidiMax - voiceMidiMin;  // 30
            
            // Normalize price to 0..1 within visible viewport
            const priceRange = priceMax - priceMin;
            let priceNorm = (price - priceMin) / priceRange;  // 0 to 1
            
            // Apply Melodic Range (Vertical Zoom) multiplier
            // melodicRange > 1 = expanded (wider leaps), < 1 = compressed (tighter)
            const melodicRange = audioState.melodicRange || 1.0;
            priceNorm = 0.5 + (priceNorm - 0.5) * melodicRange;
            
            // Map to voice MIDI range
            midi = voiceMidiMin + (priceNorm * voiceMidiRange);
            
            // Clamp to voice range
            midi = Math.max(voiceMidiMin, Math.min(voiceMidiMax, midi));
        } else {
            // FALLBACK: Use reference-based algorithm if no price range
            const baseMidi = voice === 'soprano' ? 72 : 48;
            const refPrice = voice === 'soprano' ? 
                (audioState._sopranoRef || price) : 
                (audioState._bassRef || price);
            
            const deltaPct = (price - refPrice) / refPrice;
            const melodicRange = audioState.melodicRange || 1.0;
            const baseStepPct = voice === 'soprano' ? 0.0005 : 0.0006;
            const effectiveStepPct = baseStepPct / melodicRange;
            const rawSemitones = deltaPct / effectiveStepPct;
            midi = baseMidi + Math.round(rawSemitones);
        }
        
        // Track price direction for melodic algorithms
        const prevPrice = voice === 'soprano' ? musicState._prevSopranoPrice : musicState._prevBassPrice;
        let direction = 0;
        
        if (prevPrice !== null && prevPrice !== undefined) {
            if (price > prevPrice) direction = 1;
            else if (price < prevPrice) direction = -1;
        }
        
        // Store price and direction
        if (voice === 'soprano') {
            musicState._prevSopranoPrice = price;
            musicState._sopranoDirection = direction;
        } else {
            musicState._prevBassPrice = price;
            musicState._bassDirection = direction;
        }
        
        // Slowly drift reference toward current price (for fallback mode)
        const refDriftRate = 0.02;
        if (voice === 'soprano' && audioState._sopranoRef) {
            audioState._sopranoRef = audioState._sopranoRef * (1 - refDriftRate) + price * refDriftRate;
        } else if (voice === 'bass' && audioState._bassRef) {
            audioState._bassRef = audioState._bassRef * (1 - refDriftRate) + price * refDriftRate;
        }
        
        // Clamp to voice range
        const finalMin = voice === 'soprano' ? 54 : 24;
        const finalMax = voice === 'soprano' ? 84 : 54;
        return Math.max(finalMin, Math.min(finalMax, Math.round(midi)));
    }

    /**
     * Generate a score object from an OHLC bar
     * Uses the Music Theory Engine for chord-aware note generation
     * @param {Object} bar - Bar with o, h, l, c, v properties
     * @returns {Object} Score object with soprano/bass targets and gain
     */
    function generateScore(bar) {
        if (!bar) return null;

        // 1. Update regime based on price trend (MAJOR for up, MINOR for down)
        updateRegimeFromPrice(bar.c);
        
        // 2. Advance chord progression
        advanceProgression();

        // 3. Get raw MIDI from price mapping
        const rawSoprano = priceToMidi(bar.h, 'soprano');  // High wick → Soprano
        const rawBass = priceToMidi(bar.l, 'bass');        // Low wick → Bass

        // 4. Quantize to chord tones with voice leading
        const sopranoMidi = quantizeToChord(rawSoprano, 'soprano', musicState.prevSoprano);
        const bassMidi = quantizeToChord(rawBass, 'bass', musicState.prevBass);
        
        // 5. Update previous notes for voice leading
        musicState.prevSoprano = sopranoMidi;
        musicState.prevBass = bassMidi;

        // Normalize volume for gain (0.1 to 1.0)
        let gain = 0.5;
        try {
            if (typeof state !== 'undefined' && state.dataFull && state.dataFull.length > 0) {
                let maxVol = 0;
                for (let i = 0; i < state.dataFull.length; i++) {
                    const v = state.dataFull[i] && state.dataFull[i].v;
                    if (Number.isFinite(v) && v > maxVol) maxVol = v;
                }
                if (maxVol > 0 && Number.isFinite(bar.v)) {
                    gain = Math.max(0.1, Math.min(1.0, bar.v / maxVol));
                }
            }
        } catch (e) {}

        // Determine trend direction
        const isBullish = bar.c > bar.o;

        return {
            soprano: sopranoMidi,
            bass: bassMidi,
            gain: gain,
            isBullish: isBullish,
            regime: musicState.regime,
            chordStep: musicState.progressionStep,
            high: bar.h,
            low: bar.l,
            open: bar.o,
            close: bar.c,
            volume: bar.v
        };
    }

    // ========================================================================
    // INDEPENDENT ANIMATION LOOP
    // ========================================================================

    // Playhead position as fraction of chart width (0.5 = center of screen)
    const PLAYHEAD_POSITION = 0.5;
    
    // Sub-step configuration (matching Market Inventions) - MUST be defined before startAudioAnimation
    const SUB_STEP_COUNT = 16;
    const SUB_STEP_SECONDS = 1 / SUB_STEP_COUNT;  // 62.5ms per sub-step
    
    // Expose for renderer
    window._audioSubStepSeconds = SUB_STEP_SECONDS;
    
    // Track current held notes for extension (module scope)
    let currentSopranoNote = null;
    let currentBassNote = null;

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
        
        // Reset reference prices for fresh MIDI mapping
        audioState._referencePrice = null;
        audioState._sopranoRef = null;
        audioState._bassRef = null;
        musicState._prevSopranoPrice = null;
        musicState._prevBassPrice = null;
        musicState.progressionStep = 0;
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
        
        // Clear playhead
        window._audioPlayheadIndex = -1;
        audioState._smoothPosition = 0;
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
            musicState.progressionStep = 0;
            musicState.prevBarClose = null;
            currentSopranoNote = null;
            currentBassNote = null;
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
        const regime = musicState.regime;
        const complexity = audioState.sensitivity || 0.5;  // Complexity slider (0=pure, 1=chaotic)
        
        // ── BAR BOUNDARY: Update targets, regime, progression ──
        if (subStepInBar === 0) {
            updateRegimeFromPrice(barData.c);
            advanceProgression();
            
            // Refresh viewport price range every bar for tight wick-hugging
            updateVisiblePriceRange();
            
            // Kick drum on downbeat
            if (audioState._kickSynth) {
                audioState._kickSynth.triggerAttackRelease('C1', '8n', now, 0.4);
            }
            
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
        const sopranoScalePool = getScaleNotes(regime, musicState.rootMidi, sopranoRange.min, sopranoRange.max);
        const bassScalePool = getScaleNotes(regime, musicState.rootMidi, bassRange.min, bassRange.max);
        const sopranoChordPool = getChordTonesInRange(sopranoRange.min, sopranoRange.max);
        const bassChordPool = getChordTonesInRange(bassRange.min, bassRange.max);
        
        // ── SOPRANO PATHFINDER (High Agility: runs, arpeggios, orbits) ──
        const sopranoRhythm = parseInt(audioState.upperWick.rhythm) || 4;
        const sopranoInterval = SUB_STEP_COUNT / sopranoRhythm;
        const shouldPlaySoprano = (subStepInBar % sopranoInterval === 0);
        
        let sopranoMidi = musicState.prevSoprano || 72;
        
        if (audioState.upperWick.enabled && shouldPlaySoprano) {
            const vs = musicState.soprano;
            const rawTarget = priceToMidi(barData.h, 'soprano');
            const targetMidi = rawTarget !== null 
                ? nearestScaleNote(rawTarget, sopranoScalePool, 24)
                : musicState.prevSoprano || 72;
            
            // Update target (allows mid-cell target drift)
            vs.runTargetNote = targetMidi;
            
            if (vs.runStepsRemaining > 0) {
                // ── CONTINUE CURRENT CELL (no interference — let the cell breathe) ──
                sopranoMidi = executeSopranoRunStep(sopranoScalePool, sopranoChordPool);
                vs.runStepsRemaining--;
                // Only abort mid-cell for EXTREME drift (more than double the normal threshold)
                // This lets scale runs develop their full melodic phrase
                const extremeDrift = Math.abs(sopranoMidi - targetMidi) > 18;
                if (extremeDrift) {
                    vs.runStepsRemaining = 0;
                }
            } else {
                // ══════════════════════════════════════════════════════════════
                // PATHFINDER CELL SELECTION — the core algorithm from the notes:
                //   Distance > 4 semitones from wick → SCALE RUN (walk toward target)
                //   Distance ≤ 4 semitones from wick → ORBIT (dance around target)
                //   Complexity slider controls chance of INTERRUPTION (genre ornaments)
                // ══════════════════════════════════════════════════════════════
                const pattern = detectMelodicPattern(musicState.sopranoHistory);
                const prev = musicState.prevSoprano || 72;
                const distance = Math.abs(targetMidi - prev);
                const direction = targetMidi >= prev ? 1 : -1;
                
                let cellType;
                
                // PRIORITY 1: Break out of stuck/trill patterns
                if (pattern === 'stuck') {
                    cellType = 'leap_fill';
                } else if (pattern === 'trill') {
                    cellType = 'sequence';
                }
                // PRIORITY 2: Distance-based pathfinding (the core "Pathfinder" logic)
                // Far from wick (> 4 semitones): MUST travel there via scale run
                // This is what creates the audible scale passages in the selected genre
                else if (distance > 4) {
                    // Scale run is the PRIMARY tool for traveling to the wick
                    // Complexity adds a chance of interruption with other cell types
                    const interruptChance = complexity * 0.3; // 0% at complexity=0, 30% at complexity=1
                    if (Math.random() < interruptChance) {
                        // Stochastic interruption: use a "traveling" cell type instead
                        const roll = Math.random();
                        if (roll < 0.4)       cellType = 'leap_fill';     // Leap toward + fill
                        else if (roll < 0.7)  cellType = 'sequence';      // Undulating approach
                        else                  cellType = 'chord_skip';    // Harmonic leap + step
                    } else {
                        cellType = 'scale_run';  // DEFAULT: walk toward wick via scale degrees
                    }
                }
                // PRIORITY 3: Near the wick (≤ 4 semitones): ORBIT/dance around it
                // This is the "wick-hugging" behavior — melody dances around the price level
                else {
                    // Complexity controls the palette of orbit-like patterns
                    const interruptChance = complexity * 0.4; // More interruption variety near target
                    if (Math.random() < interruptChance) {
                        // Stochastic interruption with genre-flavored patterns
                        const roll = Math.random();
                        if (roll < 0.3)       cellType = 'arpeggio';     // Chord tone cycle
                        else if (roll < 0.55) cellType = 'enclosure';    // Above-below-target
                        else if (roll < 0.75) cellType = 'sequence';     // Overlapping groups
                        else                  cellType = 'chord_skip';   // Leap + connect
                    } else {
                        cellType = 'orbit';  // DEFAULT: dance around the wick target
                    }
                }
                
                // Prevent same cell type twice in a row (diversity guarantee)
                if (cellType === vs.lastCellType && complexity > 0.15) {
                    // Pick appropriate alternative based on distance
                    const nearAlts = ['orbit', 'arpeggio', 'enclosure', 'sequence'];
                    const farAlts = ['scale_run', 'leap_fill', 'sequence', 'chord_skip'];
                    const alternatives = distance > 4 ? farAlts : nearAlts;
                    const filtered = alternatives.filter(t => t !== cellType);
                    cellType = filtered[Math.floor(Math.random() * filtered.length)];
                }
                
                vs.lastCellType = cellType;
                vs.direction = direction;
                vs.enclosurePhase = 0;
                
                // Set sequence base index relative to current position in pool
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
            // Only apply on specific beat positions (weak beats) and ONLY when between cells
            // or at cell boundaries — NOT during the middle of a scale run (which would break it)
            const isMidCell = vs.runStepsRemaining > 0 && vs.runStepsRemaining < (vs.cellSize - 1);
            const isRunOrOrbit = (vs.runMode === 'scale_run' || vs.runMode === 'orbit');
            if (!isMidCell || !isRunOrOrbit) {
                // Safe to apply genre ornaments — we're at a cell boundary or in a non-directional cell
                sopranoMidi = applyGenreComplexity(sopranoMidi, sopranoScalePool, sopranoChordPool, subStepInBar, 'soprano');
            }
            
            // Wick gravity: SAFETY NET only (not a constant pull)
            // Only activate for extreme drift — the cell system handles normal wick-tracking
            const sopranoDrift = Math.abs(sopranoMidi - targetMidi);
            if (sopranoDrift > 14) {
                sopranoMidi = applyWickGravity(sopranoMidi, targetMidi, sopranoScalePool, 'soprano');
            }
            
            // Clamp to range
            sopranoMidi = Math.max(sopranoRange.min, Math.min(sopranoRange.max, sopranoMidi));
            
            // Update history
            updateSopranoHistory(sopranoMidi);
            
            // Calculate note duration
            const sopranoDurationMs = sopranoInterval * SUB_STEP_SECONDS * 1000;
            
            // Trigger audio
            if (audioState._sopranoSampler) {
                const noteFreq = Tone.Frequency(sopranoMidi, 'midi').toNote();
                const toneDuration = rhythmToDuration(audioState.upperWick.rhythm);
                try {
                    audioState._sopranoSampler.triggerAttackRelease(noteFreq, toneDuration, now, 0.7);
                } catch (e) {}
            }
            
            // Emit visual event
            emitSubStepNote('soprano', sopranoMidi, barData.h, preciseBarIndex, sopranoDurationMs, perfNow);
            musicState.prevSoprano = sopranoMidi;
        }
        
        // ── BASS PATHFINDER (High Stability: walking bass, root/4th/5th leaps) ──
        const bassRhythm = parseInt(audioState.lowerWick.rhythm) || 2;
        const bassInterval = SUB_STEP_COUNT / bassRhythm;
        const shouldPlayBass = (subStepInBar % bassInterval === 0);
        
        let bassMidi = musicState.prevBass || 48;
        
        if (audioState.lowerWick.enabled && shouldPlayBass) {
            const vb = musicState.bass;
            const rawTarget = priceToMidi(barData.l, 'bass');
            const targetMidi = rawTarget !== null
                ? nearestScaleNote(rawTarget, bassScalePool, 24)
                : musicState.prevBass || 48;
            
            // Update target
            vb.runTargetNote = targetMidi;
            
            if (vb.runStepsRemaining > 0) {
                // ── CONTINUE CURRENT CELL (let walking bass pattern complete) ──
                bassMidi = executeWalkingStep(bassScalePool, bassChordPool);
                vb.runStepsRemaining--;
                // Only abort for extreme drift (bass is more stable, wider threshold)
                const extremeDrift = Math.abs(bassMidi - targetMidi) > 20;
                if (extremeDrift) {
                    vb.runStepsRemaining = 0;
                }
            } else {
                // ══════════════════════════════════════════════════════════════
                // BASS PATHFINDER — same distance-based logic as soprano:
                //   Distance > 5 semitones → WALK toward target (root/4th/5th pattern)
                //   Distance ≤ 5 semitones → ARPEGGIO around target (chord-tone stability)
                //   Complexity adds chromatic approaches and pattern variety
                // ══════════════════════════════════════════════════════════════
                const pattern = detectMelodicPattern(musicState.bassHistory);
                const prev = musicState.prevBass || 48;
                const distance = Math.abs(targetMidi - prev);
                const direction = targetMidi >= prev ? 1 : -1;
                
                let cellType;
                
                // PRIORITY 1: Break stuck patterns
                if (pattern === 'stuck') {
                    cellType = 'chromatic_approach';
                } else if (pattern === 'trill') {
                    cellType = 'arpeggio';
                }
                // PRIORITY 2: Distance-based pathfinding
                // Far from wick (> 5 semitones): walk toward it
                else if (distance > 5) {
                    const interruptChance = complexity * 0.25;
                    if (Math.random() < interruptChance) {
                        cellType = 'chromatic_approach';  // Chromatic walk adds flavor
                    } else {
                        cellType = direction > 0 ? 'walk_up' : 'walk_down';
                    }
                }
                // Near the wick (≤ 5 semitones): arpeggio/chord-tone stability
                else {
                    const interruptChance = complexity * 0.3;
                    if (Math.random() < interruptChance) {
                        const roll = Math.random();
                        if (roll < 0.5) cellType = 'chromatic_approach';
                        else            cellType = direction > 0 ? 'walk_up' : 'walk_down';
                    } else {
                        cellType = 'arpeggio';  // DEFAULT: chord-tone stability near wick
                    }
                }
                
                // Prevent same bass cell type twice in a row
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
            
            // Genre complexity for bass: beat-gated, don't interrupt mid-walking-pattern
            const bassMidCell = vb.runStepsRemaining > 0 && vb.runStepsRemaining < (vb.cellSize - 1);
            const bassIsWalking = (vb.runMode === 'walk_up' || vb.runMode === 'walk_down');
            if (!bassMidCell || !bassIsWalking) {
                bassMidi = applyGenreComplexity(bassMidi, bassScalePool, bassChordPool, subStepInBar, 'bass');
            }
            
            // Wick gravity: SAFETY NET only for extreme drift
            const bassDrift = Math.abs(bassMidi - targetMidi);
            if (bassDrift > 16) {
                bassMidi = applyWickGravity(bassMidi, targetMidi, bassScalePool, 'bass');
            }
            
            // Clamp to range
            bassMidi = Math.max(bassRange.min, Math.min(bassRange.max, bassMidi));
            
            // Update history
            updateBassHistory(bassMidi);
            
            // Calculate note duration
            const bassDurationMs = bassInterval * SUB_STEP_SECONDS * 1000;
            
            // Trigger audio
            if (audioState._bassSampler) {
                const noteFreq = Tone.Frequency(bassMidi, 'midi').toNote();
                const toneDuration = rhythmToDuration(audioState.lowerWick.rhythm);
                try {
                    audioState._bassSampler.triggerAttackRelease(noteFreq, toneDuration, now, 0.7);
                } catch (e) {}
            }
            
            // Emit visual event
            emitSubStepNote('bass', bassMidi, barData.l, preciseBarIndex, bassDurationMs, perfNow);
            musicState.prevBass = bassMidi;
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
            const cellInfo = musicState.soprano.runMode ? ` [${musicState.soprano.runMode}]` : '';
            updateStatus(`${regime}${cellInfo} | ${sopranoName} / ${bassName}`);
        }
    }
    
    /**
     * Emit a note event at a specific sub-step position
     */
    function emitSubStepNote(voice, midi, price, barIndex, durationMs, startTime) {
        if (!window._audioNoteEvents) window._audioNoteEvents = [];
        
        // Debug: log first few notes to verify they're being created
        if (window._audioNoteEvents.length < 5) {
            console.log('[Audio] Emitting note:', voice, 'MIDI:', midi, 'price:', price?.toFixed(2), 'bar:', barIndex?.toFixed(2));
        }
        
        // Glow duration from slider (units * 200ms base)
        const glowMs = (audioState.glowDuration || 3) * 200;
        
        // Store rhythm for circle display mode
        const rhythm = voice === 'soprano' ? audioState.upperWick.rhythm : audioState.lowerWick.rhythm;
        
        window._audioNoteEvents.push({
            voice: voice,
            midi: midi,
            price: price,
            barIndex: barIndex,
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
     * Convert rhythm setting to Tone.js duration
     */
    function rhythmToDuration(rhythm) {
        switch (String(rhythm)) {
            case '16': return '16n';
            case '8': return '8n';
            case '4': return '4n';
            case '2': return '2n';
            case '1': return '1n';
            default: return '4n';
        }
    }

    /**
     * Convert MIDI note number to note name
     */
    function midiToNoteName(midi) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const note = noteNames[midi % 12];
        return note + octave;
    }
    
    // Expose for renderer to use for note labels
    window._midiToNoteName = midiToNoteName;
    
    // Expose music state for renderer (playhead color based on regime)
    window._musicState = musicState;

    /**
     * Emit a note event for visual feedback - Creates persistent trail
     * Like Market Inventions: notes are horizontal bars that scroll with the chart
     */
    function emitNoteEvent(voice, midi, price, barIndex) {
        // Store note events for the renderer to pick up
        if (!window._audioNoteEvents) window._audioNoteEvents = [];
        
        // Get rhythm-based duration in ms
        const rhythm = voice === 'soprano' ? audioState.upperWick.rhythm : audioState.lowerWick.rhythm;
        const durationMs = rhythmToDurationMs(rhythm);
        
        const now = performance.now();
        window._audioNoteEvents.push({
            voice: voice,
            midi: midi,
            price: price,
            barIndex: barIndex,
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
     * Convert rhythm setting to duration in milliseconds for visual trail
     * Fixed shorter durations for cleaner visual display
     */
    function rhythmToDurationMs(rhythm) {
        // Use fixed short durations for visual - just show note "dot" size
        // These create small bars rather than long trails
        switch (String(rhythm)) {
            case '16': return 60;    // Sixteenth - tiny dot
            case '8': return 100;    // Eighth - small  
            case '4': return 150;    // Quarter - medium
            case '2': return 200;    // Half - slightly longer
            case '1': return 300;    // Whole - longest dot
            default: return 150;
        }
    }

    // ========================================================================
    // HOOK INTO REPLAY SYSTEM (Optional - for Practice mode integration)
    // ========================================================================

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
    // UI SETUP
    // ========================================================================

    function setupDropdown(dd, btn, menu, labelEl, onSelect) {
        if (!dd || !btn || !menu) return;

        allAudioDropdowns.push({ dd, btn });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dd.classList.toggle('open');
            btn.setAttribute('aria-expanded', isOpen);

            if (isOpen) {
                allAudioDropdowns.forEach(({ dd: other, btn: otherBtn }) => {
                    if (other !== dd) {
                        other.classList.remove('open');
                        otherBtn.setAttribute('aria-expanded', 'false');
                    }
                });
            }
        });

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.ddItem');
            if (!item) return;

            const val = item.getAttribute('data-value');
            const text = item.textContent;

            menu.querySelectorAll('.ddItem').forEach(i => i.classList.remove('sel'));
            item.classList.add('sel');
            dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');

            if (labelEl) labelEl.textContent = text;
            if (onSelect) onSelect(val, text);
        });
    }

    function setupSlider(slider, labelEl, suffix, stateKey, transform) {
        if (!slider || !labelEl) return;

        const updateLabel = (shouldSave = false) => {
            const val = parseFloat(slider.value);
            const displayVal = transform ? transform(val) : val;
            labelEl.textContent = displayVal + suffix;
            audioState[stateKey] = val;
            if (shouldSave) saveSettings();
        };

        slider.addEventListener('input', () => updateLabel(true));
        updateLabel(false);
    }

    function setupVolumeSlider(slider, labelEl, wickType) {
        if (!slider || !labelEl) return;

        const updateLabel = (shouldSave = false) => {
            const val = parseInt(slider.value, 10);
            labelEl.textContent = Math.abs(val) + ' DB';
            audioState[wickType + 'Wick'].volume = val;

            // Update sampler volume if playing
            if (audioState.playing && audioState._initialized) {
                if (wickType === 'upper' && audioState._sopranoSampler) {
                    audioState._sopranoSampler.volume.value = val;
                } else if (wickType === 'lower' && audioState._bassSampler) {
                    audioState._bassSampler.volume.value = val;
                }
            }
            if (shouldSave) saveSettings();
        };

        slider.addEventListener('input', () => updateLabel(true));
        updateLabel(false);
    }

    function updateStatus(text) {
        if (ui.statusLabel) {
            ui.statusLabel.textContent = text;
            // Color based on regime: green for uptrend, red for downtrend
            if (audioState.playing) {
                ui.statusLabel.style.color = (musicState.regime === 'MINOR' || musicState.regime === 'DOWNTREND') 
                    ? '#ff4444'   // Red for MINOR/downtrend
                    : '#2ecc71';  // Green for MAJOR/uptrend
            } else {
                ui.statusLabel.style.color = '';
            }
        }
    }

    // ========================================================================
    // SETTINGS PERSISTENCE (localStorage)
    // ========================================================================
    
    const STORAGE_KEY = 'ntree_audio_visual_settings';
    
    /**
     * Save current settings to localStorage
     */
    function saveSettings() {
        try {
            const settings = {
                upperWick: {
                    enabled: audioState.upperWick.enabled,
                    volume: audioState.upperWick.volume,
                    instrument: audioState.upperWick.instrument,
                    rhythm: audioState.upperWick.rhythm
                },
                lowerWick: {
                    enabled: audioState.lowerWick.enabled,
                    volume: audioState.lowerWick.volume,
                    instrument: audioState.lowerWick.instrument,
                    rhythm: audioState.lowerWick.rhythm
                },
                genre: audioState.genre,
                rootKey: audioState.rootKey,
                chordProgression: audioState.chordProgression,
                displayNotes: audioState.displayNotes,
                sensitivity: audioState.sensitivity,
                melodicRange: audioState.melodicRange,
                glowDuration: audioState.glowDuration,
                displayMode: audioState.displayMode,
                panels: audioState.panels,
                speed: audioState._currentBpm || 60
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            console.log('[Audio] Settings saved');
        } catch (e) {
            console.warn('[Audio] Failed to save settings:', e);
        }
    }
    
    /**
     * Load settings from localStorage and apply to UI
     */
    function loadSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;
            
            const settings = JSON.parse(stored);
            console.log('[Audio] Loading saved settings');
            
            // Apply to audioState
            if (settings.upperWick) {
                audioState.upperWick.enabled = settings.upperWick.enabled ?? true;
                audioState.upperWick.volume = settings.upperWick.volume ?? -23;
                audioState.upperWick.instrument = settings.upperWick.instrument || 'harpsichord';
                audioState.upperWick.rhythm = settings.upperWick.rhythm || '4';
            }
            if (settings.lowerWick) {
                audioState.lowerWick.enabled = settings.lowerWick.enabled ?? true;
                audioState.lowerWick.volume = settings.lowerWick.volume ?? -17;
                audioState.lowerWick.instrument = settings.lowerWick.instrument || 'acoustic_bass';
                audioState.lowerWick.rhythm = settings.lowerWick.rhythm || '2';
            }
            audioState.genre = settings.genre || 'classical';
            musicState.currentGenre = audioState.genre;  // Sync with musicState
            audioState.rootKey = settings.rootKey || 'C';
            musicState.rootMidi = 60 + (ROOT_KEY_OFFSETS[audioState.rootKey] || 0);  // Sync with musicState
            audioState.chordProgression = settings.chordProgression || 'canon';
            audioState.displayNotes = settings.displayNotes ?? true;
            audioState.sensitivity = settings.sensitivity ?? 0.5;
            audioState.melodicRange = settings.melodicRange ?? 1.0;
            audioState.glowDuration = settings.glowDuration ?? 3;
            audioState.displayMode = settings.displayMode || 'bars';
            if (settings.panels) {
                audioState.panels.channels = settings.panels.channels ?? true;
                audioState.panels.genre = settings.panels.genre ?? true;
                audioState.panels.tuning = settings.panels.tuning ?? true;
                audioState.panels.playback = settings.panels.playback ?? true;
            }
            audioState._savedSpeed = settings.speed ?? 60;
            
            return true;
        } catch (e) {
            console.warn('[Audio] Failed to load settings:', e);
            return false;
        }
    }
    
    /**
     * Apply loaded settings to UI elements
     */
    function applySettingsToUI() {
        // Upper wick
        if (ui.upperWickChk) ui.upperWickChk.checked = audioState.upperWick.enabled;
        if (ui.upperVolume) {
            ui.upperVolume.value = audioState.upperWick.volume;
            if (ui.upperVolumeLabel) ui.upperVolumeLabel.textContent = audioState.upperWick.volume + ' DB';
        }
        applyDropdownSelection(ui.upperInstrumentMenu, ui.upperInstrumentLabel, audioState.upperWick.instrument);
        applyDropdownSelection(ui.upperRhythmMenu, ui.upperRhythmLabel, audioState.upperWick.rhythm);
        
        // Lower wick
        if (ui.lowerWickChk) ui.lowerWickChk.checked = audioState.lowerWick.enabled;
        if (ui.lowerVolume) {
            ui.lowerVolume.value = audioState.lowerWick.volume;
            if (ui.lowerVolumeLabel) ui.lowerVolumeLabel.textContent = audioState.lowerWick.volume + ' DB';
        }
        applyDropdownSelection(ui.lowerInstrumentMenu, ui.lowerInstrumentLabel, audioState.lowerWick.instrument);
        applyDropdownSelection(ui.lowerRhythmMenu, ui.lowerRhythmLabel, audioState.lowerWick.rhythm);
        
        // Genre
        applyDropdownSelection(ui.genreMenu, ui.genreLabel, audioState.genre);
        
        // Root key
        applyDropdownSelection(ui.rootKeyMenu, ui.rootKeyLabel, audioState.rootKey);
        
        // Chord progression
        applyDropdownSelection(ui.chordProgressionMenu, ui.chordProgressionLabel, audioState.chordProgression);
        
        // Display mode
        applyDropdownSelection(ui.displayModeMenu, ui.displayModeLabel, audioState.displayMode);
        
        // Display notes checkbox
        if (ui.displayNotesChk) ui.displayNotesChk.checked = audioState.displayNotes;
        
        // Sub-panel open/closed state
        if (ui.panelChannels) ui.panelChannels.open = audioState.panels.channels;
        if (ui.panelGenre) ui.panelGenre.open = audioState.panels.genre;
        if (ui.panelTuning) ui.panelTuning.open = audioState.panels.tuning;
        if (ui.panelPlayback) ui.panelPlayback.open = audioState.panels.playback;
        
        // Sliders
        if (ui.sensitivity) {
            ui.sensitivity.value = audioState.sensitivity;
            if (ui.sensitivityLabel) ui.sensitivityLabel.textContent = audioState.sensitivity.toFixed(2);
        }
        if (ui.melodicRange) {
            ui.melodicRange.value = audioState.melodicRange;
            if (ui.melodicRangeLabel) ui.melodicRangeLabel.textContent = audioState.melodicRange.toFixed(1) + 'X';
        }
        if (ui.glowDuration) {
            ui.glowDuration.value = audioState.glowDuration;
            if (ui.glowDurationLabel) ui.glowDurationLabel.textContent = Math.round(audioState.glowDuration) + ' UNITS';
        }
        if (ui.speed && audioState._savedSpeed) {
            ui.speed.value = audioState._savedSpeed;
            if (ui.speedLabel) ui.speedLabel.textContent = audioState._savedSpeed;
        }
    }
    
    /**
     * Helper to apply selection to a dropdown menu
     */
    function applyDropdownSelection(menu, label, value) {
        if (!menu) return;
        const items = menu.querySelectorAll('.ddItem');
        items.forEach(item => {
            if (item.getAttribute('data-value') === value) {
                item.classList.add('sel');
                if (label) label.textContent = item.textContent;
            } else {
                item.classList.remove('sel');
            }
        });
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    function init() {
        // Load saved settings first
        const hasSettings = loadSettings();
        if (hasSettings) {
            applySettingsToUI();
        }
        // Upper Wick controls
        if (ui.upperWickChk) {
            // Sync initial state from checkbox (only if no saved settings)
            if (!hasSettings) audioState.upperWick.enabled = ui.upperWickChk.checked;
            ui.upperWickChk.addEventListener('change', () => {
                audioState.upperWick.enabled = ui.upperWickChk.checked;
                console.log('[Audio] Upper wick enabled:', audioState.upperWick.enabled);
                saveSettings();
            });
        }
        setupVolumeSlider(ui.upperVolume, ui.upperVolumeLabel, 'upper');
        setupDropdown(ui.upperInstrumentDD, ui.upperInstrumentBtn, ui.upperInstrumentMenu, ui.upperInstrumentLabel,
            (val) => { 
                audioState.upperWick.instrument = val;
                saveSettings();
                // Reload sampler if playing
                if (audioState.playing && audioState._initialized) {
                    reloadSampler('soprano', val);
                }
            });
        setupDropdown(ui.upperRhythmDD, ui.upperRhythmBtn, ui.upperRhythmMenu, ui.upperRhythmLabel,
            (val) => { 
                audioState.upperWick.rhythm = val;
                console.log('[Audio] Upper rhythm changed to:', val);
                saveSettings();
            });

        // Lower Wick controls
        if (ui.lowerWickChk) {
            // Sync initial state from checkbox (only if no saved settings)
            if (!hasSettings) audioState.lowerWick.enabled = ui.lowerWickChk.checked;
            ui.lowerWickChk.addEventListener('change', () => {
                audioState.lowerWick.enabled = ui.lowerWickChk.checked;
                console.log('[Audio] Lower wick enabled:', audioState.lowerWick.enabled);
                saveSettings();
            });
        }
        setupVolumeSlider(ui.lowerVolume, ui.lowerVolumeLabel, 'lower');
        setupDropdown(ui.lowerInstrumentDD, ui.lowerInstrumentBtn, ui.lowerInstrumentMenu, ui.lowerInstrumentLabel,
            (val) => { 
                audioState.lowerWick.instrument = val;
                saveSettings();
                // Reload sampler if playing
                if (audioState.playing && audioState._initialized) {
                    reloadSampler('bass', val);
                }
            });
        setupDropdown(ui.lowerRhythmDD, ui.lowerRhythmBtn, ui.lowerRhythmMenu, ui.lowerRhythmLabel,
            (val) => { 
                audioState.lowerWick.rhythm = val;
                console.log('[Audio] Lower rhythm changed to:', val);
                saveSettings();
            });

        // Genre Selection
        setupDropdown(ui.genreDD, ui.genreBtn, ui.genreMenu, ui.genreLabel,
            (val) => { 
                audioState.genre = val;
                musicState.currentGenre = val;
                const genre = GENRES[val];
                console.log(`[Audio] Genre changed to: ${genre ? genre.label : val}`);
                saveSettings();
            });
        
        // Root Key
        setupDropdown(ui.rootKeyDD, ui.rootKeyBtn, ui.rootKeyMenu, ui.rootKeyLabel,
            (val) => {
                audioState.rootKey = val;
                musicState.rootMidi = 60 + (ROOT_KEY_OFFSETS[val] || 0);
                console.log(`[Audio] Root key changed to: ${val} (MIDI root: ${musicState.rootMidi})`);
                saveSettings();
            });

        // Chord Progression
        setupDropdown(ui.chordProgressionDD, ui.chordProgressionBtn, ui.chordProgressionMenu, ui.chordProgressionLabel,
            (val) => { 
                audioState.chordProgression = val; 
                saveSettings();
            });

        if (ui.displayNotesChk) {
            // Sync initial state (only if no saved settings)
            if (!hasSettings) audioState.displayNotes = ui.displayNotesChk.checked;
            ui.displayNotesChk.addEventListener('change', () => {
                audioState.displayNotes = ui.displayNotesChk.checked;
                saveSettings();
            });
        }

        // Sub-panel toggle persistence
        const panelMap = [
            { el: ui.panelChannels, key: 'channels' },
            { el: ui.panelGenre,    key: 'genre' },
            { el: ui.panelTuning,   key: 'tuning' },
            { el: ui.panelPlayback, key: 'playback' }
        ];
        panelMap.forEach(({ el, key }) => {
            if (el) {
                el.addEventListener('toggle', () => {
                    audioState.panels[key] = el.open;
                    saveSettings();
                });
            }
        });

        // Tuning sliders
        setupSlider(ui.sensitivity, ui.sensitivityLabel, '', 'sensitivity', v => v.toFixed(2));
        setupSlider(ui.melodicRange, ui.melodicRangeLabel, 'X', 'melodicRange', v => v.toFixed(1));
        setupSlider(ui.glowDuration, ui.glowDurationLabel, ' UNITS', 'glowDuration', v => Math.round(v));

        // Display Mode dropdown
        setupDropdown(ui.displayModeDD, ui.displayModeBtn, ui.displayModeMenu, ui.displayModeLabel,
            (val) => {
                audioState.displayMode = val;
                saveSettings();
            });

        // Speed slider - directly controls animation/audio tempo
        if (ui.speed) {
            const updateSpeedLabel = () => {
                const val = parseInt(ui.speed.value, 10);
                if (ui.speedLabel) ui.speedLabel.textContent = val;
            };
            updateSpeedLabel();
            
            ui.speed.addEventListener('input', () => {
                updateSpeedLabel();
                const bpm = parseInt(ui.speed.value, 10);
                // Update live during playback
                audioState._barsPerMs = bpm / 60000;
                audioState._currentBpm = bpm;
                console.log('[Audio] Speed updated to', bpm, 'BPM, barsPerMs:', audioState._barsPerMs.toFixed(6));
                saveSettings();
            });
        }

        // ── Helper: update start button appearance for play state ──
        function setStartBtnState(mode) {
            if (!ui.startBtn) return;
            if (mode === 'playing') {
                // Currently playing → button offers "Pause"
                ui.startBtn.textContent = 'Pause';
                ui.startBtn.style.background = '#2ecc71';  // Green
                ui.startBtn.disabled = false;
            } else if (mode === 'paused') {
                // Currently paused → button offers "Resume"
                ui.startBtn.textContent = 'Resume';
                ui.startBtn.style.background = '#ff69b4';  // Pink (same as start)
                ui.startBtn.disabled = false;
            } else {
                // Idle → button offers "Start Audio"
                ui.startBtn.textContent = 'Start Audio';
                ui.startBtn.style.background = '#ff69b4';  // Pink
                ui.startBtn.disabled = false;
            }
        }

        // Playback controls — Start / Pause / Resume tri-state button
        if (ui.startBtn) {
            ui.startBtn.addEventListener('click', async () => {
                // ── STATE 1: Currently playing → PAUSE ──
                if (audioState.playing && !audioState.paused) {
                    audioState.paused = true;
                    pauseAudioAnimation();
                    setStartBtnState('paused');
                    updateStatus('Paused');
                    return;
                }

                // ── STATE 2: Currently paused → RESUME ──
                if (audioState.playing && audioState.paused) {
                    audioState.paused = false;
                    resumeAudioAnimation();
                    setStartBtnState('playing');
                    updateStatus('Playing...');
                    return;
                }

                // ── STATE 3: Idle → START ──
                ui.startBtn.disabled = true;
                updateStatus('Initializing...');

                const success = await initAudioEngine();
                if (success) {
                    audioState.playing = true;
                    audioState.paused = false;
                    ui.stopBtn.disabled = false;
                    
                    // Start the independent animation loop
                    startAudioAnimation();
                    setStartBtnState('playing');
                } else {
                    setStartBtnState('idle');
                }
            });
        }

        // Reset button — full stop, dispose engine, return to idle
        if (ui.stopBtn) {
            ui.stopBtn.addEventListener('click', () => {
                stopAudioAnimation();
                stopAudioEngine();
                audioState.paused = false;
                setStartBtnState('idle');
                ui.stopBtn.disabled = true;
                updateStatus('Audio stopped');
                
                // Clear playhead
                window._audioPlayheadIndex = null;
                if (typeof window.requestDraw === 'function') {
                    window.requestDraw('audio_stop');
                }
            });
        }

        // Spacebar to toggle audio playback (Start / Pause / Resume)
        document.addEventListener('keydown', async (e) => {
            // Only respond to spacebar, ignore if user is typing in an input
            if (e.code !== 'Space' && e.key !== ' ') return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Prevent page scroll
            e.preventDefault();
            
            // Spacebar toggles Start ↔ Pause (not Reset)
            if (ui.startBtn && !ui.startBtn.disabled) {
                ui.startBtn.click();
            }
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            allAudioDropdowns.forEach(({ dd, btn }) => {
                dd.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            });
        });

        // Register the replay hook callback immediately
        hookIntoReplaySystem();

        // Check if Tone.js is available
        if (typeof Tone === 'undefined') {
            console.warn('[Audio] Tone.js not detected at init time - audio will not work');
            updateStatus('Tone.js not loaded');
            if (ui.startBtn) ui.startBtn.disabled = true;
        } else {
            console.log('[Audio] Tone.js detected:', Tone.version || 'version unknown');
        }

        console.log('[Audio] Audio controls initialized');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
