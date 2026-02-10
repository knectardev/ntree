/**
 * audio/drums.js — Drum Beat Patterns & Percussion Engine
 * Part of the Audio Visual Settings module
 *
 * Contains: Beat pattern definitions (16 sub-steps per bar), percussion synth
 * creation, and playDrumStep() for conductor integration.
 * Sub-steps: 0=downbeat, 4=beat2, 8=beat3, 12=beat4.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    const audioState = _am.audioState;

    // ========================================================================
    // DRUM BEAT PATTERNS (16 sub-steps per bar)
    // ========================================================================

    const DRUM_BEATS = {
        simple: {
            label: 'Simple (downbeat only)',
            kick: [0],
            snare: [],
            hihat: [],
            ride: []
        },
        minimal_jazz: {
            label: 'Minimal Jazz (sticks on rim/cymbal)',
            kick: [],
            snare: [4, 12],
            hihat: [],
            ride: [0, 2, 4, 6, 8, 10, 12, 14]
        },
        latin_salsa: {
            label: 'Latin / Salsa (Palmieri, Puente)',
            kick: [0, 4, 8, 12],
            snare: [2, 4, 6, 10, 12, 14],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            ride: [],
            clave: [0, 3, 6, 10, 12]
        },
        reggaeton_trap: {
            label: 'Reggaeton / Latin Trap (Bad Bunny)',
            kick: [0, 6, 8, 12, 14],
            snare: [4, 8, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            ride: []
        },
        folk_country: {
            label: 'Folk-Country Shuffle (Grateful Dead)',
            kick: [0, 8],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            ride: []
        },
        indian_tabla: {
            label: 'Indian Tabla',
            kick: [0, 4, 8, 12],
            snare: [2, 6, 10, 14],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            ride: []
        },
        afrobeat: {
            label: 'Afrobeat / West African (Fela Kuti)',
            kick: [0, 4, 8, 12],
            snare: [2, 4, 6, 10, 12, 14],
            hihat: [0, 2, 4, 5, 6, 8, 10, 12, 13, 14],
            ride: []
        },
        funk_pocket: {
            label: 'Funk Pocket (James Brown)',
            kick: [0, 2, 6, 8, 10, 12, 14],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            ride: []
        },
        lofi_dilla: {
            label: 'Lo-Fi / Neo-Soul / Dilla Feel',
            kick: [0, 7, 8, 14],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            ride: []
        },
        brazilian_samba: {
            label: 'Brazilian Samba / Bossa Nova',
            kick: [0, 4, 8, 12],
            snare: [2, 4, 6, 8, 10, 12, 14],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            ride: []
        },
        electronic_house: {
            label: 'Electronic House / Minimal Techno',
            kick: [0, 4, 8, 12],
            snare: [4, 12],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            ride: []
        }
    };

    // ========================================================================
    // PERCUSSION SYNTHS (lazy init)
    // ========================================================================

    let _snareSynth = null;
    let _hihatSynth = null;
    let _rideSynth = null;
    let _claveSynth = null;

    const drumVol = () => (audioState.drumVolume !== undefined ? audioState.drumVolume : -12);

    function ensurePercussionSynths() {
        if (typeof Tone === 'undefined') return;
        const vol = drumVol();
        if (!_snareSynth) {
            const noise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).toDestination();
            noise.volume.value = vol;
            const tone = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 1, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).toDestination();
            tone.volume.value = vol;
            _snareSynth = { noise, tone };
        }
        if (!_hihatSynth) {
            _hihatSynth = new Tone.MetalSynth({
                frequency: 200,
                envelope: { attack: 0.001, decay: 0.05, release: 0.05 },
                harmonicity: 5.1,
                modulationIndex: 32,
                resonance: 4000,
                octaves: 0.5
            }).toDestination();
            _hihatSynth.volume.value = vol;
        }
        if (!_rideSynth) {
            _rideSynth = new Tone.MetalSynth({
                frequency: 400,
                envelope: { attack: 0.001, decay: 0.2, release: 0.3 },
                harmonicity: 3,
                modulationIndex: 20,
                resonance: 6000,
                octaves: 0.5
            }).toDestination();
            _rideSynth.volume.value = vol;
        }
        if (!_claveSynth) {
            _claveSynth = new Tone.MetalSynth({
                frequency: 800,
                envelope: { attack: 0.001, decay: 0.1, release: 0.1 },
                harmonicity: 2,
                modulationIndex: 8,
                resonance: 8000,
                octaves: 0.3
            }).toDestination();
            _claveSynth.volume.value = vol;
        }
    }

    /**
     * Set drum layer volume (kick + all percussion). Call from UI when slider changes.
     */
    function setDrumVolume(val) {
        audioState.drumVolume = val;
        if (audioState._kickSynth) {
            audioState._kickSynth.volume.value = val;
        }
        if (_snareSynth) {
            _snareSynth.noise.volume.value = val;
            _snareSynth.tone.volume.value = val;
        }
        if (_hihatSynth) _hihatSynth.volume.value = val;
        if (_rideSynth) _rideSynth.volume.value = val;
        if (_claveSynth) _claveSynth.volume.value = val;
    }

    /**
     * Play drum sounds for the current sub-step based on the selected beat.
     * Humanization (when beatStochasticity > 0): note dropout, ghost notes,
     * velocity variation, micro-timing jitter.
     * @param {string} beatKey - Key from DRUM_BEATS (e.g. 'minimal_jazz')
     * @param {number} subStepInBar - 0-15
     * @param {number} now - Tone.now() time
     */
    function playDrumStep(beatKey, subStepInBar, now) {
        const pattern = DRUM_BEATS[beatKey];
        if (!pattern) return null;
        if (!audioState._initialized || !audioState._kickSynth) return null;

        ensurePercussionSynths();

        const stoch = audioState.beatStochasticity !== undefined ? audioState.beatStochasticity : 0;
        const jitter = stoch > 0 ? (Math.random() - 0.5) * stoch * 0.02 : 0;
        const t = now + jitter;

        const shouldTrigger = (inPattern) => {
            if (inPattern) {
                if (stoch === 0) return true;
                return Math.random() > (stoch * 0.3);
            }
            return false;
        };

        const ghostChance = () => stoch > 0 && Math.random() < stoch * 0.06;

        const velocity = (base) => {
            if (stoch === 0) return base;
            const v = base - (Math.random() * stoch * 0.4);
            return Math.max(0.15, Math.min(1, v));
        };

        const inKick = pattern.kick && pattern.kick.includes(subStepInBar);
        const inSnare = pattern.snare && pattern.snare.includes(subStepInBar);
        const inHihat = pattern.hihat && pattern.hihat.includes(subStepInBar);
        const inRide = pattern.ride && pattern.ride.includes(subStepInBar);
        const inClave = pattern.clave && pattern.clave.includes(subStepInBar);
        const hits = { kick: false, snare: false, hihat: false, ride: false, clave: false };

        if (inKick && shouldTrigger(true)) {
            audioState._kickSynth.triggerAttackRelease('C1', '8n', t, velocity(0.5));
            hits.kick = true;
        }
        if (inSnare && shouldTrigger(true) && _snareSynth) {
            _snareSynth.noise.triggerAttackRelease('16n', t);
            _snareSynth.tone.triggerAttackRelease('C2', '16n', t, velocity(0.5));
            hits.snare = true;
        }
        if (inHihat && shouldTrigger(true) && _hihatSynth) {
            _hihatSynth.triggerAttackRelease('32n', t, velocity(0.3));
            hits.hihat = true;
        }
        if (inRide && shouldTrigger(true) && _rideSynth) {
            _rideSynth.triggerAttackRelease('16n', t, velocity(0.25));
            hits.ride = true;
        }
        if (inClave && shouldTrigger(true) && _claveSynth) {
            _claveSynth.triggerAttackRelease('16n', t, velocity(0.35));
            hits.clave = true;
        }

        if (stoch > 0 && !inHihat && !inRide && ghostChance() && _hihatSynth) {
            _hihatSynth.triggerAttackRelease('32n', t, velocity(0.15));
        }
        if (stoch > 0 && !inSnare && ghostChance() && _snareSynth) {
            _snareSynth.noise.triggerAttackRelease('16n', t);
            _snareSynth.tone.triggerAttackRelease('C2', '16n', t, velocity(0.2));
        }

        if (hits.kick || hits.snare || hits.hihat || hits.ride || hits.clave) {
            return hits;
        }
        return null;
    }

    /**
     * Dispose percussion synths (call on engine stop)
     */
    function disposeDrums() {
        if (_snareSynth) {
            try { _snareSynth.noise.dispose(); _snareSynth.tone.dispose(); } catch (e) {}
            _snareSynth = null;
        }
        if (_hihatSynth) {
            try { _hihatSynth.dispose(); } catch (e) {}
            _hihatSynth = null;
        }
        if (_rideSynth) {
            try { _rideSynth.dispose(); } catch (e) {}
            _rideSynth = null;
        }
        if (_claveSynth) {
            try { _claveSynth.dispose(); } catch (e) {}
            _claveSynth = null;
        }
    }

    // ========================================================================
    // EXPORTS
    // ========================================================================

    _am.DRUM_BEATS = DRUM_BEATS;
    _am.playDrumStep = playDrumStep;
    _am.disposeDrums = disposeDrums;
    _am.setDrumVolume = setDrumVolume;
})();
