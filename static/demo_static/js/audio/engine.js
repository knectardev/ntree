/**
 * audio/engine.js — Tone.js Audio Engine & Price-to-MIDI Conversion
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: Sampler loading/disposal, audio engine init/stop, hot-swap,
 * price-to-MIDI mapping, price range tracking, and generateScore.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    // Dependencies
    const musicState = _am.musicState;
    const audioState = _am.audioState;
    const ui = _am.ui;
    const INSTRUMENT_MAP = _am.INSTRUMENT_MAP;
    const KICK_CONFIG = _am.KICK_CONFIG;
    const updateStatus = _am.updateStatus;
    const quantizeToChord = _am.quantizeToChord;
    const nearestScaleNote = _am.nearestScaleNote;
    const updateRegimeFromPrice = _am.updateRegimeFromPrice;
    const advanceProgression = _am.advanceProgression;

    // ========================================================================
    // TONE.JS SAMPLER MANAGEMENT
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
            audioState._sopranoSampler.volume.value = Number.isFinite(audioState.upperWick.volume) ? audioState.upperWick.volume : -18;
            console.log('[Audio] Soprano sampler loaded:', sopranoInstrument);

            // Load bass (lower wick) sampler
            const bassInstrument = getSelectedInstrument('lower');
            audioState._bassSampler = await loadSampler(bassInstrument);
            audioState._bassSampler.volume.value = Number.isFinite(audioState.lowerWick.volume) ? audioState.lowerWick.volume : -18;
            console.log('[Audio] Bass sampler loaded:', bassInstrument);

            // Create kick drum synth for downbeat
            audioState._kickSynth = new Tone.MembraneSynth(KICK_CONFIG).toDestination();
            audioState._kickSynth.volume.value = audioState.drumVolume !== undefined ? audioState.drumVolume : -12;
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
        if (_am.disposeDrums) _am.disposeDrums();

        Tone.Transport.stop();
        Tone.Transport.cancel();
        audioState._transportStarted = false;
        audioState._initialized = false;

        console.log('[Audio] Engine stopped');
    }

    // ========================================================================
    // PRICE-TO-MIDI CONVERSION
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

    // ========================================================================
    // SCORE GENERATION
    // ========================================================================

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
    // EXPORTS
    // ========================================================================

    _am.loadSampler = loadSampler;
    _am.reloadSampler = reloadSampler;
    _am.initAudioEngine = initAudioEngine;
    _am.getSelectedInstrument = getSelectedInstrument;
    _am.stopAudioEngine = stopAudioEngine;
    _am.updatePriceRange = updatePriceRange;
    _am.priceToMidi = priceToMidi;
    _am.generateScore = generateScore;
})();
