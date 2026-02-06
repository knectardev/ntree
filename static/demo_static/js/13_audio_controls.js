/**
 * 13_audio_controls.js — Audio Visual Settings panel + Tone.js Audio Engine
 * Integrates musical playback with the Practice/Replay system
 * 
 * Architecture:
 * - Each replay bar becomes a "musical measure"
 * - High wick → Soprano voice (upper pitch rail)
 * - Low wick → Bass voice (lower pitch rail)
 * - Volume → Gain envelope
 * - Speed slider → Tone.Transport BPM
 */
(function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    // Instrument URLs from midi-js-soundfonts (CDN hosted)
    const INSTRUMENT_MAP = {
        harpsichord: {
            label: "Harpsichord",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/harpsichord-mp3/"
        },
        synth_lead: {
            label: "Synth Lead",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/lead_1_square-mp3/"
        },
        pipe_organ: {
            label: "Pipe Organ",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/church_organ-mp3/"
        },
        strings: {
            label: "Strings",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/string_ensemble_1-mp3/"
        },
        flute: {
            label: "Flute",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/flute-mp3/"
        },
        acoustic_bass: {
            label: "Acoustic Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_bass-mp3/"
        },
        electric_bass: {
            label: "Electric Bass",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/electric_bass_finger-mp3/"
        },
        synth_pad: {
            label: "Synth Pad",
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/"
        }
    };

    // MIDI note range for price mapping
    const NOTE_CONFIG = {
        minMidi: 36,   // C2 - Bass floor
        maxMidi: 84,   // C6 - Soprano ceiling
        bassMin: 36,   // C2
        bassMax: 60,   // C4 - Bass range
        sopranoMin: 60, // C4
        sopranoMax: 84  // C6 - Soprano range
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

    // Scale intervals for quantization
    const SCALES = {
        MAJOR: [0, 2, 4, 5, 7, 9, 11],
        MINOR: [0, 2, 3, 5, 7, 8, 10]
    };

    // Music theory state
    const musicState = {
        regime: 'MAJOR',
        consecutiveDownBars: 0,
        consecutiveUpBars: 0,
        prevBarClose: null,
        regimeSwitchThreshold: 3,
        progressionStep: 0,
        rootMidi: 60,  // C4
        prevSoprano: 72,
        prevBass: 48,
        _prevSopranoPrice: null,  // For trend-aware MIDI mapping
        _prevBassPrice: null
    };

    /**
     * Update regime based on price trend (MAJOR for uptrend, MINOR for downtrend)
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
                if (musicState.regime !== 'MINOR') {
                    musicState.regime = 'MINOR';
                    console.log('[Music] Regime -> MINOR (downtrend)');
                }
            }
        } else if (currentClose > musicState.prevBarClose) {
            musicState.consecutiveUpBars++;
            musicState.consecutiveDownBars = 0;
            if (musicState.consecutiveUpBars >= musicState.regimeSwitchThreshold) {
                if (musicState.regime !== 'MAJOR') {
                    musicState.regime = 'MAJOR';
                    console.log('[Music] Regime -> MAJOR (uptrend)');
                }
            }
        }
        musicState.prevBarClose = currentClose;
    }

    /**
     * Get all scale notes within a range (like Market Inventions _get_scale_notes)
     */
    function getScaleNotes(regime, rootMidi, minMidi, maxMidi) {
        const intervals = SCALES[regime] || SCALES.MAJOR;
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
        
        const degree = progression[regime][musicState.progressionStep % 16];
        const chordMap = regime === 'MAJOR' ? CHORD_MAP_MAJOR : CHORD_MAP_MINOR;
        const intervals = chordMap[degree] || [0, 4, 7];
        
        // Return chord tones as mod-12 set
        return new Set(intervals.map(i => (musicState.rootMidi + i) % 12));
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
     * Generate soprano note with full Market Inventions logic
     */
    function generateSopranoNote(rawMidi, subStepInBar) {
        const regime = musicState.regime;
        const sopranoPool = getScaleNotes(regime, musicState.rootMidi, NOTE_CONFIG.sopranoMin, NOTE_CONFIG.sopranoMax);
        const chordToneMods = getCurrentChordToneMods();
        
        // Build chord pool (scale notes that are also chord tones)
        const chordPool = sopranoPool.filter(note => chordToneMods.has((note - musicState.rootMidi + 120) % 12));
        
        // On chord beats (every 4th sub-step), prefer chord tones
        const allowedPool = (subStepInBar % 4 === 0 && chordPool.length > 0) ? chordPool : sopranoPool;
        
        // Sensitivity-based behavior:
        // HIGH sensitivity = direct price tracking, large jumps allowed
        // LOW sensitivity = musical constraints, melodic variation
        const sensitivity = audioState.sensitivity || 0.7;
        
        let soprano;
        
        if (sensitivity >= 3.5) {
            // HIGH SENSITIVITY: Direct price tracking - find nearest scale note to raw MIDI
            // Allow large jumps (24 semitones = 2 octaves) to follow price closely
            soprano = nearestScaleNote(rawMidi, allowedPool, 24);
        } else if (sensitivity >= 2.0) {
            // MEDIUM SENSITIVITY: Balanced - moderate jump constraint
            soprano = nearestScaleNote(rawMidi, allowedPool, 12);
        } else {
            // LOW SENSITIVITY: Musical mode - constrain jumps, add variation
            const maxJump = 8;
            soprano = nearestScaleNote(rawMidi, allowedPool, maxJump);
            
            // Melodic variation at low sensitivity
            const variationChance = Math.max(0.0, 0.5 - (sensitivity * 0.15));
            if (musicState.prevSoprano !== null && Math.random() < variationChance) {
                // Get notes within ±2 scale degrees
                const nearbyNotes = [-2, -1, 0, 1, 2]
                    .map(offset => offsetScaleDegree(soprano, sopranoPool, offset))
                    .filter(n => n !== null && n >= NOTE_CONFIG.sopranoMin && n <= NOTE_CONFIG.sopranoMax);
                
                const uniqueNotes = [...new Set(nearbyNotes)];
                if (uniqueNotes.length > 1) {
                    soprano = uniqueNotes[Math.floor(Math.random() * uniqueNotes.length)];
                }
            }
        }
        
        return soprano;
    }

    /**
     * Generate bass note with walking bass algorithm (like Market Inventions)
     */
    function generateBassNote(rawMidi, priceDirection) {
        const regime = musicState.regime;
        const bassPool = getScaleNotes(regime, musicState.rootMidi, NOTE_CONFIG.bassMin, NOTE_CONFIG.bassMax);
        const chordToneMods = getCurrentChordToneMods();
        
        // Build chord pool for bass
        const chordBassPool = bassPool.filter(note => chordToneMods.has((note - musicState.rootMidi + 120) % 12));
        const allowedBass = chordBassPool.length > 0 ? chordBassPool : bassPool;
        
        // Sensitivity-based behavior:
        // HIGH sensitivity = direct price tracking, large jumps allowed
        // LOW sensitivity = walking bass patterns, musical movement
        const sensitivity = audioState.sensitivity || 0.7;
        
        let bassNote;
        
        if (sensitivity >= 3.5) {
            // HIGH SENSITIVITY: Direct price tracking - large jumps allowed
            bassNote = nearestScaleNote(rawMidi, allowedBass, 24);
        } else if (sensitivity >= 2.0) {
            // MEDIUM SENSITIVITY: Some walking bass, moderate constraints
            const maxJump = 12;
            if (musicState.prevBass !== null && priceDirection !== 0) {
                if (priceDirection > 0) {
                    const candidates = allowedBass.filter(n => n > musicState.prevBass && Math.abs(n - musicState.prevBass) <= maxJump);
                    bassNote = candidates.length > 0 ? Math.min(...candidates) : nearestScaleNote(rawMidi, allowedBass, maxJump);
                } else {
                    const candidates = allowedBass.filter(n => n < musicState.prevBass && Math.abs(n - musicState.prevBass) <= maxJump);
                    bassNote = candidates.length > 0 ? Math.max(...candidates) : nearestScaleNote(rawMidi, allowedBass, maxJump);
                }
            } else {
                bassNote = nearestScaleNote(rawMidi, allowedBass, maxJump);
            }
        } else {
            // LOW SENSITIVITY: Full walking bass algorithm with musical patterns
            const maxJump = 8;
            if (musicState.prevBass !== null) {
                if (priceDirection > 0) {
                    const candidates = allowedBass.filter(n => n > musicState.prevBass && Math.abs(n - musicState.prevBass) <= maxJump);
                    bassNote = candidates.length > 0 ? Math.min(...candidates) : nearestScaleNote(rawMidi, allowedBass, maxJump);
                } else if (priceDirection < 0) {
                    const candidates = allowedBass.filter(n => n < musicState.prevBass && Math.abs(n - musicState.prevBass) <= maxJump);
                    bassNote = candidates.length > 0 ? Math.max(...candidates) : nearestScaleNote(rawMidi, allowedBass, maxJump);
                } else {
                    // Price FLAT: alternate between root and fifth for musical interest
                    const rootNote = chordBassPool.length > 0 ? Math.min(...chordBassPool) : musicState.prevBass;
                    const fifthCandidates = chordBassPool.filter(n => (n - musicState.rootMidi + 120) % 12 === 7);
                    const fifthNote = fifthCandidates.length > 0 ? 
                        fifthCandidates.reduce((a, b) => Math.abs(a - musicState.prevBass) < Math.abs(b - musicState.prevBass) ? a : b) :
                        rootNote;
                    bassNote = (musicState.prevBass === rootNote) ? fifthNote : rootNote;
                }
            } else {
                bassNote = nearestScaleNote(rawMidi, allowedBass, maxJump);
            }
        }
        
        return bassNote;
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
        chordProgression: 'canon',
        displayNotes: true,
        sensitivity: 0.7,
        glowDuration: 3,
        playing: false,
        
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

        // Chord progression
        chordProgressionDD: document.getElementById('audioChordProgressionDD'),
        chordProgressionBtn: document.getElementById('audioChordProgressionBtn'),
        chordProgressionMenu: document.getElementById('audioChordProgressionMenu'),
        chordProgressionLabel: document.getElementById('audioChordProgressionLabel'),
        displayNotesChk: document.getElementById('audioDisplayNotes'),

        // Sync tuning sliders
        sensitivity: document.getElementById('audioSensitivity'),
        sensitivityLabel: document.getElementById('audioSensitivityLabel'),
        glowDuration: document.getElementById('audioGlowDuration'),
        glowDurationLabel: document.getElementById('audioGlowDurationLabel'),
        
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
     * Map a price to a MIDI note number using Market Inventions algorithm
     * Uses delta from reference price with configurable step percentage
     * @param {number} price - The price value
     * @param {string} voice - 'soprano' or 'bass'
     * @returns {number} MIDI note number
     */
    function priceToMidi(price, voice) {
        if (!Number.isFinite(price)) return null;
        
        // Configuration matching Market Inventions
        const baseMidi = voice === 'soprano' ? 72 : 48;  // C5 for soprano, C3 for bass
        const stepPct = voice === 'soprano' ? 0.0008 : 0.0010;  // Percentage change per semitone
        const refPrice = voice === 'soprano' ? 
            (audioState._sopranoRef || price) : 
            (audioState._bassRef || price);
        
        // Calculate percentage delta from reference
        const deltaPct = (price - refPrice) / refPrice;
        
        // Convert to semitones (sensitivity affects responsiveness)
        const sensitivity = audioState.sensitivity || 0.7;
        const rawSemitones = (deltaPct / stepPct) * sensitivity;
        
        // Trend-aware rounding (like Market Inventions)
        const prevPrice = voice === 'soprano' ? musicState._prevSopranoPrice : musicState._prevBassPrice;
        let semitones;
        if (prevPrice !== null && prevPrice !== undefined) {
            if (price > prevPrice) {
                semitones = Math.ceil(rawSemitones);
            } else if (price < prevPrice) {
                semitones = Math.floor(rawSemitones);
            } else {
                semitones = Math.round(rawSemitones);
            }
        } else {
            semitones = Math.round(rawSemitones);
        }
        
        // Store for next comparison
        if (voice === 'soprano') {
            musicState._prevSopranoPrice = price;
        } else {
            musicState._prevBassPrice = price;
        }
        
        // Calculate final MIDI and clamp to voice range
        const midi = baseMidi + semitones;
        const midiMin = voice === 'soprano' ? NOTE_CONFIG.sopranoMin : NOTE_CONFIG.bassMin;
        const midiMax = voice === 'soprano' ? NOTE_CONFIG.sopranoMax : NOTE_CONFIG.bassMax;
        
        return Math.max(midiMin, Math.min(midiMax, midi));
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
        musicState.regime = 'MAJOR';
        
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
     * Stop the audio animation loop
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
     * Full Market Inventions logic with scale pools, walking bass, melodic variation
     */
    function processSubStep(barIndex, subStepInBar, globalSubStep) {
        if (!audioState.playing || !audioState._initialized) {
            console.warn('[Audio] processSubStep skipped - playing:', audioState.playing, 'init:', audioState._initialized);
            return;
        }
        
        const barData = state.data[barIndex];
        if (!barData) {
            console.warn('[Audio] No bar data at index', barIndex);
            return;
        }
        
        const now = Tone.now();
        const perfNow = performance.now();
        
        // Update regime and progression only on bar boundaries
        if (subStepInBar === 0) {
            updateRegimeFromPrice(barData.c);
            advanceProgression();
            
            // Kick drum on downbeat
            if (audioState._kickSynth) {
                audioState._kickSynth.triggerAttackRelease('C1', '8n', now, 0.4);
            }
            // Log every 10 bars for debugging
            if (barIndex % 10 === 0) {
                console.log('[Audio] Bar', barIndex, 'regime:', musicState.regime, 'upper:', audioState.upperWick.enabled, 'lower:', audioState.lowerWick.enabled);
            }
        }
        
        // Calculate precise bar position for this sub-step
        const preciseBarIndex = barIndex + (subStepInBar / SUB_STEP_COUNT);
        
        // Get previous bar for price direction calculation
        const prevBar = barIndex > 0 ? state.data[barIndex - 1] : barData;
        
        // SOPRANO - rhythm determines when notes trigger
        const sopranoRhythm = parseInt(audioState.upperWick.rhythm) || 4;
        const sopranoInterval = SUB_STEP_COUNT / sopranoRhythm;
        const shouldPlaySoprano = (subStepInBar % sopranoInterval === 0);
        
        let sopranoMidi = musicState.prevSoprano || 72;
        
        if (audioState.upperWick.enabled) {
            if (shouldPlaySoprano) {
                // Get raw MIDI from price
                const rawSoprano = priceToMidi(barData.h, 'soprano');
                if (rawSoprano !== null) {
                    // Use full Market Inventions soprano generation
                    sopranoMidi = generateSopranoNote(rawSoprano, subStepInBar);
                }
                
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
                
                // Emit visual note
                if (audioState.displayNotes) {
                    emitSubStepNote('soprano', sopranoMidi, barData.h, preciseBarIndex, sopranoDurationMs, perfNow);
                }
                
                musicState.prevSoprano = sopranoMidi;
            }
            // Between rhythm boundaries: hold previous note (no re-trigger)
        }
        
        // BASS - rhythm determines when notes trigger
        const bassRhythm = parseInt(audioState.lowerWick.rhythm) || 2;
        const bassInterval = SUB_STEP_COUNT / bassRhythm;
        const shouldPlayBass = (subStepInBar % bassInterval === 0);
        
        let bassMidi = musicState.prevBass || 48;
        
        if (audioState.lowerWick.enabled) {
            if (shouldPlayBass) {
                // Get raw MIDI from price
                const rawBass = priceToMidi(barData.l, 'bass');
                
                // Calculate price direction for walking bass
                let priceDirection = 0;
                if (musicState._prevBassPrice !== null) {
                    const priceDelta = barData.l - musicState._prevBassPrice;
                    if (priceDelta > 0.02) priceDirection = 1;
                    else if (priceDelta < -0.02) priceDirection = -1;
                }
                
                if (rawBass !== null) {
                    // Use full Market Inventions walking bass algorithm
                    bassMidi = generateBassNote(rawBass, priceDirection);
                }
                
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
                
                // Emit visual note
                if (audioState.displayNotes) {
                    emitSubStepNote('bass', bassMidi, barData.l, preciseBarIndex, bassDurationMs, perfNow);
                }
                
                musicState.prevBass = bassMidi;
            }
            // Between rhythm boundaries: hold previous note
        }
        
        // Voice separation check
        if (audioState.upperWick.enabled && audioState.lowerWick.enabled) {
            const adjustedSoprano = ensureVoiceSeparation(sopranoMidi, bassMidi);
            if (adjustedSoprano !== sopranoMidi) {
                musicState.prevSoprano = adjustedSoprano;
            }
        }
        
        // Update status (throttled)
        if (subStepInBar === 0) {
            const sopranoName = musicState.prevSoprano ? midiToNoteName(musicState.prevSoprano) : '--';
            const bassName = musicState.prevBass ? midiToNoteName(musicState.prevBass) : '--';
            updateStatus(`${musicState.regime} | ${sopranoName} / ${bassName}`);
        }
    }
    
    /**
     * Emit a note event at a specific sub-step position
     */
    function emitSubStepNote(voice, midi, price, barIndex, durationMs, startTime) {
        if (!window._audioNoteEvents) window._audioNoteEvents = [];
        
        // Glow duration from slider (units * 200ms base)
        const glowMs = (audioState.glowDuration || 3) * 200;
        
        window._audioNoteEvents.push({
            voice: voice,
            midi: midi,
            price: price,
            barIndex: barIndex,
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
     * Called when a new bar is consumed during animation
     * This is the main hook point for audio generation
     */
    function onBarAdvance(barData, barIndex) {
        if (!audioState.playing || !audioState._initialized) {
            return;
        }
        if (!barData) {
            return;
        }

        // Always process (animation controls the timing now)
        audioState._lastBarIndex = barIndex;
        updatePriceRange();

        const score = generateScore(barData);
        if (!score) {
            return;
        }

        const now = Tone.now();

        // 1. DOWNBEAT: Trigger kick drum on every new bar
        if (audioState._kickSynth) {
            audioState._kickSynth.triggerAttackRelease('C1', '8n', now, score.gain * 0.6);
        }

        // 2. SOPRANO (High Wick): Trigger on EVERY bar when enabled
        if (audioState.upperWick.enabled && score.soprano !== null && audioState._sopranoSampler) {
            const duration = rhythmToDuration(audioState.upperWick.rhythm);
            const noteFreq = Tone.Frequency(score.soprano, 'midi').toNote();
            
            // ALWAYS trigger audio on every bar for continuous sound
            try {
                audioState._sopranoSampler.triggerAttackRelease(noteFreq, duration, now, 0.7);
            } catch (e) {
                console.warn('[Audio] Soprano trigger error:', e);
            }

            // Visual feedback
            if (audioState.displayNotes) {
                emitNoteEvent('soprano', score.soprano, score.high, barIndex);
            }
        }

        // 3. BASS (Low Wick): Trigger on EVERY bar when enabled
        if (audioState.lowerWick.enabled && score.bass !== null && audioState._bassSampler) {
            const duration = rhythmToDuration(audioState.lowerWick.rhythm);
            const noteFreq = Tone.Frequency(score.bass, 'midi').toNote();
            
            // ALWAYS trigger audio on every bar for continuous sound
            try {
                audioState._bassSampler.triggerAttackRelease(noteFreq, duration, now, 0.7);
            } catch (e) {
                console.warn('[Audio] Bass trigger error:', e);
            }

            // Visual feedback
            if (audioState.displayNotes) {
                emitNoteEvent('bass', score.bass, score.low, barIndex);
            }
        }

        // Update status with current notes
        if (audioState.displayNotes) {
            const sopranoNote = score.soprano ? midiToNoteName(score.soprano) : '--';
            const bassNote = score.bass ? midiToNoteName(score.bass) : '--';
            updateStatus(`Playing: ${sopranoNote} / ${bassNote}`);
        }
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
                onBarAdvance(barData, barIndex);
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
            // Color based on regime: green for MAJOR (uptrend), red for MINOR (downtrend)
            if (audioState.playing) {
                ui.statusLabel.style.color = (musicState.regime === 'MINOR') 
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
                chordProgression: audioState.chordProgression,
                displayNotes: audioState.displayNotes,
                sensitivity: audioState.sensitivity,
                glowDuration: audioState.glowDuration,
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
            audioState.chordProgression = settings.chordProgression || 'canon';
            audioState.displayNotes = settings.displayNotes ?? true;
            audioState.sensitivity = settings.sensitivity ?? 0.7;
            audioState.glowDuration = settings.glowDuration ?? 3;
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
        
        // Chord progression
        applyDropdownSelection(ui.chordProgressionMenu, ui.chordProgressionLabel, audioState.chordProgression);
        
        // Display notes checkbox
        if (ui.displayNotesChk) ui.displayNotesChk.checked = audioState.displayNotes;
        
        // Sliders
        if (ui.sensitivity) {
            ui.sensitivity.value = audioState.sensitivity;
            if (ui.sensitivityLabel) ui.sensitivityLabel.textContent = audioState.sensitivity.toFixed(1) + 'X';
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

        // Tuning sliders
        setupSlider(ui.sensitivity, ui.sensitivityLabel, 'X', 'sensitivity', v => v.toFixed(1));
        setupSlider(ui.glowDuration, ui.glowDurationLabel, ' UNITS', 'glowDuration', v => Math.round(v));

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

        // Playback controls
        if (ui.startBtn) {
            ui.startBtn.addEventListener('click', async () => {
                if (audioState.playing) return;

                ui.startBtn.disabled = true;
                updateStatus('Initializing...');

                const success = await initAudioEngine();
                if (success) {
                    audioState.playing = true;
                    ui.stopBtn.disabled = false;
                    
                    // Start the independent animation loop
                    startAudioAnimation();
                } else {
                    ui.startBtn.disabled = false;
                }
            });
        }

        if (ui.stopBtn) {
            ui.stopBtn.addEventListener('click', () => {
                stopAudioAnimation();
                stopAudioEngine();
                ui.startBtn.disabled = false;
                ui.stopBtn.disabled = true;
                updateStatus('Audio stopped');
                
                // Clear playhead
                window._audioPlayheadIndex = null;
                if (typeof window.requestDraw === 'function') {
                    window.requestDraw('audio_stop');
                }
            });
        }

        // Spacebar to toggle audio playback
        document.addEventListener('keydown', async (e) => {
            // Only respond to spacebar, ignore if user is typing in an input
            if (e.code !== 'Space' && e.key !== ' ') return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Prevent page scroll
            e.preventDefault();
            
            if (audioState.playing) {
                // Stop playback
                if (ui.stopBtn && !ui.stopBtn.disabled) {
                    ui.stopBtn.click();
                }
            } else {
                // Start playback
                if (ui.startBtn && !ui.startBtn.disabled) {
                    ui.startBtn.click();
                }
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
