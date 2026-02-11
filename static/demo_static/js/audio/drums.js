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
            label: 'Simple Kick Pulse (legacy)',
            kick: [0],
            snare: [],
            hihat: [],
            tom: [],
            conga: [],
            cymbal: [],
            ride: [],
            clave: []
        },
        standard_7piece: {
            label: 'Standard 7-Piece Groove',
            kick: [0, 8, 11],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [6, 14],
            conga: [3, 7, 11, 14],
            cymbal: [0],
            ride: [],
            clave: []
        },
        // Backward-compatible key for existing saved settings.
        standard_5piece: {
            label: 'Standard 7-Piece Groove',
            kick: [0, 8, 11],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [6, 14],
            conga: [3, 7, 11, 14],
            cymbal: [0],
            ride: [],
            clave: []
        },
        minimal_jazz: {
            label: 'Minimal Jazz (7-piece ride-led)',
            kick: [0, 10],
            snare: [4, 12],
            hihat: [],
            tom: [14],
            conga: [7, 15],
            cymbal: [0],
            ride: [0, 2, 4, 6, 8, 10, 12, 14],
            clave: []
        },
        latin_salsa: {
            label: 'Latin / Salsa (7-piece conga+clave)',
            kick: [0, 3, 8, 11],
            snare: [4, 10, 12, 15],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [6, 14],
            conga: [0, 2, 4, 6, 8, 10, 12, 14],
            cymbal: [0, 8],
            ride: [],
            clave: [0, 3, 6, 10, 12]
        },
        reggaeton_trap: {
            label: 'Reggaeton / Latin Trap (7-piece)',
            kick: [0, 6, 8, 11, 14],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [7, 15],
            conga: [2, 6, 10, 14],
            cymbal: [0, 8],
            ride: [],
            clave: [3, 6, 10, 12]
        },
        folk_country: {
            label: 'Folk-Country Shuffle (7-piece)',
            kick: [0, 8],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [15],
            conga: [7, 15],
            cymbal: [0],
            ride: [],
            clave: []
        },
        indian_tabla: {
            label: 'Indian Tabla (7-piece hybrid)',
            kick: [0, 4, 8, 12],
            snare: [2, 6, 10, 14],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            tom: [5, 13],
            conga: [1, 3, 7, 9, 11, 15],
            cymbal: [0, 8],
            ride: [],
            clave: []
        },
        afrobeat: {
            label: 'Afrobeat / West African (7-piece)',
            kick: [0, 4, 8, 12],
            snare: [2, 4, 6, 10, 12, 14],
            hihat: [0, 2, 4, 5, 6, 8, 10, 12, 13, 14],
            tom: [7, 15],
            conga: [0, 3, 6, 8, 10, 14],
            cymbal: [0],
            ride: [],
            clave: [0, 3, 6, 10, 12]
        },
        funk_pocket: {
            label: 'Funk Pocket (7-piece)',
            kick: [0, 2, 6, 8, 10, 12, 14],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [7],
            conga: [3, 11, 15],
            cymbal: [0, 8],
            ride: [],
            clave: []
        },
        lofi_dilla: {
            label: 'Lo-Fi / Neo-Soul (7-piece)',
            kick: [0, 7, 8, 14],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [11],
            conga: [5, 13],
            cymbal: [0],
            ride: [],
            clave: []
        },
        brazilian_samba: {
            label: 'Brazilian Samba / Bossa Nova (7-piece)',
            kick: [0, 3, 8, 11],
            snare: [2, 6, 10, 14],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            tom: [7, 15],
            conga: [1, 4, 7, 10, 12, 15],
            cymbal: [0, 8],
            ride: [],
            clave: [0, 4, 7, 10, 12]
        },
        electronic_house: {
            label: 'Electronic House / Techno (7-piece)',
            kick: [0, 4, 8, 12],
            snare: [4, 12],
            hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            tom: [14],
            conga: [6, 14],
            cymbal: [0, 8],
            ride: [],
            clave: []
        }
    };

    // ========================================================================
    // PERCUSSION SYNTHS (lazy init)
    // ========================================================================

    let _snareSynth = null;
    let _snareBodySynth = null;
    let _snareRattleSynth = null;
    let _kickSubSynth = null;
    let _kickClickSynth = null;
    let _hihatSynth = null;
    let _hihatNoiseSynth = null;
    let _hihatFilter = null;
    let _rideSynth = null;
    let _rideWashSynth = null;
    let _tomSynth = null;
    let _congaOpenSynth = null;
    let _congaBassSynth = null;
    let _congaSlapSynth = null;
    let _congaGhostSynth = null;
    let _cymbalSynth = null;
    let _cymbalNoiseSynth = null;
    let _cymbalGlue = null;
    let _claveSynth = null;
    let _drumBusIn = null;
    let _drumEq = null;
    let _drumSaturator = null;
    let _drumComp = null;
    let _drumLimiter = null;
    let _drumRoomSend = null;
    let _drumRoomVerb = null;
    let _kickRoutedToDrumBus = false;

    const drumVol = () => (audioState.drumVolume !== undefined ? audioState.drumVolume : -12);
    const realismEnabled = () => (audioState.drumNaturalRoom !== false);
    const _KIT_DEFAULTS = {
        kickOn: true, snareOn: true, hihatOn: true, tomOn: true, congaOn: true, cymbalOn: true, claveOn: true,
        kickLevel: 0, snareLevel: 0, hihatLevel: 0, tomLevel: -2, congaLevel: -1, cymbalLevel: -1, claveLevel: -4,
        kickDecay: 0.28, snareDecay: 0.14, hihatDecay: 0.06, tomDecay: 0.20, congaDecay: 0.26, cymbalDecay: 0.28, claveDecay: 0.09
    };

    function clamp(v, lo, hi, fb) {
        const n = Number(v);
        const d = Number.isFinite(fb) ? fb : lo;
        if (!Number.isFinite(n)) return d;
        return Math.max(lo, Math.min(hi, n));
    }

    function kitCfg() {
        const k = (audioState && audioState.drumKit) ? audioState.drumKit : {};
        const asBool = (v, fb) => (typeof v === 'boolean' ? v : !!fb);
        return {
            kickOn: asBool(k.kickOn, _KIT_DEFAULTS.kickOn),
            snareOn: asBool(k.snareOn, _KIT_DEFAULTS.snareOn),
            hihatOn: asBool(k.hihatOn, _KIT_DEFAULTS.hihatOn),
            tomOn: asBool(k.tomOn, _KIT_DEFAULTS.tomOn),
            congaOn: asBool(k.congaOn, _KIT_DEFAULTS.congaOn),
            cymbalOn: asBool(k.cymbalOn, _KIT_DEFAULTS.cymbalOn),
            claveOn: asBool(k.claveOn, _KIT_DEFAULTS.claveOn),
            kickLevel: clamp(k.kickLevel, -18, 12, _KIT_DEFAULTS.kickLevel),
            snareLevel: clamp(k.snareLevel, -18, 12, _KIT_DEFAULTS.snareLevel),
            hihatLevel: clamp(k.hihatLevel, -18, 12, _KIT_DEFAULTS.hihatLevel),
            tomLevel: clamp(k.tomLevel, -18, 12, _KIT_DEFAULTS.tomLevel),
            congaLevel: clamp(k.congaLevel, -18, 12, _KIT_DEFAULTS.congaLevel),
            cymbalLevel: clamp(k.cymbalLevel, -18, 12, _KIT_DEFAULTS.cymbalLevel),
            claveLevel: clamp(k.claveLevel, -18, 12, _KIT_DEFAULTS.claveLevel),
            kickDecay: clamp(k.kickDecay, 0.08, 0.7, _KIT_DEFAULTS.kickDecay),
            snareDecay: clamp(k.snareDecay, 0.06, 0.45, _KIT_DEFAULTS.snareDecay),
            hihatDecay: clamp(k.hihatDecay, 0.03, 0.22, _KIT_DEFAULTS.hihatDecay),
            tomDecay: clamp(k.tomDecay, 0.08, 0.6, _KIT_DEFAULTS.tomDecay),
            congaDecay: clamp(k.congaDecay, 0.08, 0.9, _KIT_DEFAULTS.congaDecay),
            cymbalDecay: clamp(k.cymbalDecay, 0.08, 0.9, _KIT_DEFAULTS.cymbalDecay),
            claveDecay: clamp(k.claveDecay, 0.03, 0.25, _KIT_DEFAULTS.claveDecay)
        };
    }

    function ensureDrumBus() {
        if (typeof Tone === 'undefined') return null;
        if (_drumBusIn) return _drumBusIn;
        _drumBusIn = new Tone.Gain(1.0);
        _drumEq = new Tone.EQ3({
            low: 4,      // add body
            mid: 1.5,    // add presence
            high: 2,     // preserve cymbal/hat presence
            lowFrequency: 180,
            highFrequency: 4200
        });
        _drumSaturator = new Tone.Distortion(0.08);
        _drumSaturator.wet.value = 0.2;
        _drumComp = new Tone.Compressor({
            threshold: -24,
            ratio: 3.2,
            attack: 0.004,
            release: 0.18
        });
        _drumLimiter = new Tone.Limiter(-2);
        _drumBusIn.chain(_drumEq, _drumSaturator, _drumComp, _drumLimiter, Tone.Destination);

        // Parallel room ambience for more "real kit in a space" feel.
        _drumRoomSend = new Tone.Gain(0.14);
        _drumRoomVerb = new Tone.Freeverb({
            roomSize: 0.78,
            dampening: 5600
        });
        _drumRoomSend.chain(_drumRoomVerb, Tone.Destination);
        _drumRoomSend.gain.value = realismEnabled() ? 0.14 : 0.0;
        return _drumBusIn;
    }

    function connectDrumVoice(node, out) {
        if (!node || !out) return;
        node.connect(out);
        if (_drumRoomSend) node.connect(_drumRoomSend);
    }

    function setDrumNaturalRoom(enabled) {
        audioState.drumNaturalRoom = !!enabled;
        if (_drumRoomSend) {
            _drumRoomSend.gain.value = audioState.drumNaturalRoom ? 0.14 : 0.0;
        }
    }

    function applyCymbalDecayArticulation(cfg) {
        const d = Math.max(0.08, Math.min(0.9, Number(cfg && cfg.cymbalDecay)));
        if (!Number.isFinite(d)) return;
        if (_rideSynth) {
            _rideSynth.set({
                envelope: {
                    attack: 0.003,
                    decay: 0.08 + (d * 0.35),
                    release: 0.12 + (d * 0.9)
                }
            });
        }
        if (_rideWashSynth) {
            _rideWashSynth.set({
                envelope: {
                    attack: 0.012 + (d * 0.01),
                    decay: 0.2 + (d * 1.8),
                    sustain: 0
                }
            });
        }
        if (_cymbalSynth) {
            _cymbalSynth.set({
                envelope: {
                    attack: 0.008 + (d * 0.015),
                    decay: 0.05 + (d * 0.25),
                    release: 0.2 + (d * 1.6)
                }
            });
        }
        if (_cymbalNoiseSynth) {
            _cymbalNoiseSynth.set({
                envelope: {
                    attack: 0.01 + (d * 0.008),
                    decay: 0.25 + (d * 2.4),
                    sustain: 0
                }
            });
        }
    }

    function applyHandPercDecayArticulation(cfg) {
        const congaD = Math.max(0.08, Math.min(0.9, Number(cfg && cfg.congaDecay)));
        const claveD = Math.max(0.03, Math.min(0.25, Number(cfg && cfg.claveDecay)));
        if (Number.isFinite(congaD)) {
            if (_congaOpenSynth) {
                _congaOpenSynth.set({
                    envelope: { attack: 0.001, decay: 0.14 + (congaD * 0.42), sustain: 0.02, release: 0.05 + (congaD * 0.12) }
                });
            }
            if (_congaBassSynth) {
                _congaBassSynth.set({
                    envelope: { attack: 0.001, decay: 0.1 + (congaD * 0.35), sustain: 0, release: 0.04 + (congaD * 0.1) }
                });
            }
            if (_congaSlapSynth) {
                _congaSlapSynth.set({
                    envelope: { attack: 0.001, decay: 0.03 + (congaD * 0.16), sustain: 0 }
                });
            }
            if (_congaGhostSynth) {
                _congaGhostSynth.set({
                    envelope: { attack: 0.002, decay: 0.045 + (congaD * 0.2), sustain: 0 }
                });
            }
        }
        if (Number.isFinite(claveD) && _claveSynth) {
            _claveSynth.set({
                envelope: {
                    attack: 0.001,
                    decay: 0.03 + (claveD * 0.6),
                    release: 0.01 + (claveD * 0.28)
                }
            });
        }
    }

    function applyDrumVoiceVolumes(baseVol) {
        const v = Number(baseVol);
        const k = kitCfg();
        const muted = -120;
        if (_kickSubSynth) _kickSubSynth.volume.value = k.kickOn ? (v - 4) : muted;
        if (_kickClickSynth) _kickClickSynth.volume.value = k.kickOn ? (v - 14) : muted;
        if (audioState._kickSynth) audioState._kickSynth.volume.value = k.kickOn ? (v + k.kickLevel) : muted;
        if (_snareSynth) {
            _snareSynth.noise.volume.value = k.snareOn ? (v + 1 + k.snareLevel) : muted;
            _snareSynth.tone.volume.value = k.snareOn ? (v - 2 + k.snareLevel) : muted;
        }
        if (_snareBodySynth) _snareBodySynth.volume.value = k.snareOn ? (v - 5 + k.snareLevel) : muted;
        if (_snareRattleSynth) _snareRattleSynth.volume.value = k.snareOn ? (v - 10 + k.snareLevel) : muted;
        if (_hihatSynth) _hihatSynth.volume.value = k.hihatOn ? (v - 2 + k.hihatLevel) : muted;
        if (_hihatNoiseSynth) _hihatNoiseSynth.volume.value = k.hihatOn ? (v + 1 + k.hihatLevel) : muted;
        if (_rideSynth) _rideSynth.volume.value = k.cymbalOn ? (v - 7 + k.cymbalLevel) : muted;
        if (_rideWashSynth) _rideWashSynth.volume.value = k.cymbalOn ? (v + 2 + k.cymbalLevel) : muted;
        if (_cymbalSynth) _cymbalSynth.volume.value = k.cymbalOn ? (v - 6 + k.cymbalLevel) : muted;
        if (_cymbalNoiseSynth) _cymbalNoiseSynth.volume.value = k.cymbalOn ? (v + 4 + k.cymbalLevel) : muted;
        if (_tomSynth) _tomSynth.volume.value = k.tomOn ? (v - 2 + k.tomLevel) : muted;
        if (_congaOpenSynth) _congaOpenSynth.volume.value = k.congaOn ? (v - 3 + k.congaLevel) : muted;
        if (_congaBassSynth) _congaBassSynth.volume.value = k.congaOn ? (v - 1 + k.congaLevel) : muted;
        if (_congaSlapSynth) _congaSlapSynth.volume.value = k.congaOn ? (v - 4 + k.congaLevel) : muted;
        if (_congaGhostSynth) _congaGhostSynth.volume.value = k.congaOn ? (v - 12 + k.congaLevel) : muted;
        if (_claveSynth) _claveSynth.volume.value = k.claveOn ? (v - 6 + k.claveLevel) : muted;
    }

    function ensurePercussionSynths() {
        if (typeof Tone === 'undefined') return;
        const out = ensureDrumBus();
        if (!out) return;
        const vol = drumVol();
        if (audioState._kickSynth && !_kickRoutedToDrumBus) {
            // Keep kick on the same bus as the rest of the kit.
            try { audioState._kickSynth.disconnect(); } catch (e) {}
            connectDrumVoice(audioState._kickSynth, out);
            _kickRoutedToDrumBus = true;
        }
        if (!_snareSynth) {
            const noise = new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.001, decay: 0.12, sustain: 0 }
            });
            connectDrumVoice(noise, out);
            const tone = new Tone.MembraneSynth({
                pitchDecay: 0.03,
                octaves: 1.5,
                envelope: { attack: 0.001, decay: 0.11, sustain: 0 }
            });
            connectDrumVoice(tone, out);
            _snareSynth = { noise, tone };
        }
        if (!_snareBodySynth) {
            _snareBodySynth = new Tone.MembraneSynth({
                pitchDecay: 0.015,
                octaves: 1.2,
                envelope: { attack: 0.001, decay: 0.09, sustain: 0 }
            });
            connectDrumVoice(_snareBodySynth, out);
        }
        if (!_snareRattleSynth) {
            _snareRattleSynth = new Tone.NoiseSynth({
                noise: { type: 'brown' },
                envelope: { attack: 0.001, decay: 0.18, sustain: 0 }
            });
            connectDrumVoice(_snareRattleSynth, out);
        }
        if (!_kickSubSynth) {
            _kickSubSynth = new Tone.MembraneSynth({
                pitchDecay: 0.08,
                octaves: 4.5,
                envelope: { attack: 0.001, decay: 0.28, sustain: 0.01, release: 0.08 }
            });
            connectDrumVoice(_kickSubSynth, out);
        }
        if (!_kickClickSynth) {
            _kickClickSynth = new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.001, decay: 0.02, sustain: 0 }
            });
            connectDrumVoice(_kickClickSynth, out);
        }
        if (!_hihatSynth) {
            if (!_hihatFilter) {
                _hihatFilter = new Tone.Filter(7500, 'highpass');
                _hihatFilter.connect(out);
                if (_drumRoomSend) _hihatFilter.connect(_drumRoomSend);
            }
            _hihatSynth = new Tone.MetalSynth({
                frequency: 450,
                envelope: { attack: 0.001, decay: 0.05, release: 0.05 },
                harmonicity: 5.1,
                modulationIndex: 32,
                resonance: 3000,
                octaves: 1.2
            });
            _hihatSynth.connect(_hihatFilter);
        }
        if (!_hihatNoiseSynth) {
            _hihatNoiseSynth = new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.005, decay: 0.15, sustain: 0 }
            });
            if (!_hihatFilter) {
                _hihatFilter = new Tone.Filter(8000, 'highpass');
                _hihatFilter.connect(out);
                if (_drumRoomSend) _hihatFilter.connect(_drumRoomSend);
            }
            _hihatNoiseSynth.connect(_hihatFilter);
        }
        if (!_rideSynth) {
            _rideSynth = new Tone.MetalSynth({
                // Hi-hat-like timbre, but larger disk => lower center and longer tail
                frequency: 340,
                envelope: { attack: 0.003, decay: 0.16, release: 0.55 },
                harmonicity: 5.0,
                modulationIndex: 22,
                resonance: 2600,
                octaves: 1.05
            });
            connectDrumVoice(_rideSynth, out);
        }
        if (!_rideWashSynth) {
            _rideWashSynth = new Tone.NoiseSynth({
                // Keep same "air/noise quality" family as hi-hat, but slower bloom.
                noise: { type: 'white' },
                envelope: { attack: 0.014, decay: 0.72, sustain: 0 }
            });
            connectDrumVoice(_rideWashSynth, out);
        }
        if (!_tomSynth) {
            _tomSynth = new Tone.MembraneSynth({
                pitchDecay: 0.02,
                octaves: 2.3,
                envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.08 }
            });
            connectDrumVoice(_tomSynth, out);
        }
        if (!_congaOpenSynth) {
            _congaOpenSynth = new Tone.MembraneSynth({
                pitchDecay: 0.015,
                octaves: 2.1,
                envelope: { attack: 0.001, decay: 0.24, sustain: 0.02, release: 0.1 }
            });
            connectDrumVoice(_congaOpenSynth, out);
        }
        if (!_congaBassSynth) {
            _congaBassSynth = new Tone.MembraneSynth({
                pitchDecay: 0.03,
                octaves: 2.8,
                envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 }
            });
            connectDrumVoice(_congaBassSynth, out);
        }
        if (!_congaSlapSynth) {
            _congaSlapSynth = new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.001, decay: 0.055, sustain: 0 }
            });
            connectDrumVoice(_congaSlapSynth, out);
        }
        if (!_congaGhostSynth) {
            _congaGhostSynth = new Tone.NoiseSynth({
                noise: { type: 'brown' },
                envelope: { attack: 0.002, decay: 0.08, sustain: 0 }
            });
            connectDrumVoice(_congaGhostSynth, out);
        }
        if (!_cymbalSynth) {
            if (!_cymbalGlue) {
                _cymbalGlue = new Tone.Distortion(0.08);
                _cymbalGlue.wet.value = 0.04;
                _cymbalGlue.connect(out);
                if (_drumRoomSend) _cymbalGlue.connect(_drumRoomSend);
            }
            _cymbalSynth = new Tone.MetalSynth({
                // Crash is effectively "big hi-hat": similar overtone color, longer resonance.
                frequency: 300,
                envelope: { attack: 0.008, decay: 0.22, release: 0.95 },
                harmonicity: 5.2,
                modulationIndex: 26,
                resonance: 2100,
                octaves: 1.2
            });
            _cymbalSynth.connect(_cymbalGlue);
        }
        if (!_cymbalNoiseSynth) {
            _cymbalNoiseSynth = new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.012, decay: 1.25, sustain: 0 }
            });
            if (!_cymbalGlue) {
                _cymbalGlue = new Tone.Distortion(0.08);
                _cymbalGlue.wet.value = 0.04;
                _cymbalGlue.connect(out);
                if (_drumRoomSend) _cymbalGlue.connect(_drumRoomSend);
            }
            _cymbalNoiseSynth.connect(_cymbalGlue);
        }
        if (!_claveSynth) {
            _claveSynth = new Tone.MetalSynth({
                frequency: 1200,
                envelope: { attack: 0.001, decay: 0.08, release: 0.04 },
                harmonicity: 1.35,
                modulationIndex: 6,
                resonance: 2500,
                octaves: 0.7
            });
            connectDrumVoice(_claveSynth, out);
        }
        applyCymbalDecayArticulation(kitCfg());
        applyHandPercDecayArticulation(kitCfg());
        applyDrumVoiceVolumes(vol);
    }

    /**
     * Set drum layer volume (kick + all percussion). Call from UI when slider changes.
     */
    function setDrumVolume(val) {
        audioState.drumVolume = val;
        applyDrumVoiceVolumes(val);
    }

    function setDrumKitParams(params) {
        if (!audioState.drumKit) audioState.drumKit = {};
        if (params && typeof params === 'object') {
            for (const k in params) {
                if (Object.prototype.hasOwnProperty.call(params, k)) {
                    audioState.drumKit[k] = params[k];
                }
            }
        }
        applyCymbalDecayArticulation(kitCfg());
        applyHandPercDecayArticulation(kitCfg());
        applyDrumVoiceVolumes(drumVol());
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

        // Elvin-inspired cymbal behavior:
        // - micro timing drift (~5-10ms) for humanized feel
        // - broader velocity spread (about MIDI 90-110 equivalent)
        const cymSwingSec = () => {
            const mag = 0.005 + (Math.random() * 0.005);
            return (Math.random() < 0.5 ? -1 : 1) * mag;
        };
        const cymVel = (base) => {
            const v = base + ((Math.random() * 0.16) - 0.08);
            return Math.max(0.7, Math.min(0.9, v));
        };

        const inKick = pattern.kick && pattern.kick.includes(subStepInBar);
        const inSnare = pattern.snare && pattern.snare.includes(subStepInBar);
        const hasHihatPattern = Array.isArray(pattern.hihat) && pattern.hihat.length > 0;
        const hasRidePattern = Array.isArray(pattern.ride) && pattern.ride.length > 0;
        const hasTomPattern = Array.isArray(pattern.tom) && pattern.tom.length > 0;
        const hasCongaPattern = Array.isArray(pattern.conga) && pattern.conga.length > 0;
        const hasCymbalPattern = Array.isArray(pattern.cymbal) && pattern.cymbal.length > 0;
        const inHihat = hasHihatPattern
            ? pattern.hihat.includes(subStepInBar)
            : (hasRidePattern ? pattern.ride.includes(subStepInBar) : (subStepInBar % 2 === 0));
        const inRide = hasRidePattern && pattern.ride.includes(subStepInBar);
        const inTom = hasTomPattern ? pattern.tom.includes(subStepInBar) : (subStepInBar === 6 || subStepInBar === 14);
        const inConga = hasCongaPattern ? pattern.conga.includes(subStepInBar) : false;
        const inCymbal = hasCymbalPattern ? pattern.cymbal.includes(subStepInBar) : (subStepInBar === 0 || subStepInBar === 8);
        const inClave = pattern.clave && pattern.clave.includes(subStepInBar);
        const hits = { kick: false, snare: false, hihat: false, ride: false, tom: false, conga: false, cymbal: false, clave: false };
        const cfg = kitCfg();

        if (cfg.kickOn && inKick && shouldTrigger(true)) {
            audioState._kickSynth.triggerAttackRelease('C1', cfg.kickDecay, t, velocity(0.5));
            if (_kickSubSynth) _kickSubSynth.triggerAttackRelease('C0', cfg.kickDecay * 0.95, t, velocity(0.55));
            if (realismEnabled() && _kickClickSynth) _kickClickSynth.triggerAttackRelease('64n', t, velocity(0.25));
            hits.kick = true;
        }
        if (cfg.snareOn && inSnare && shouldTrigger(true) && _snareSynth) {
            _snareSynth.noise.triggerAttackRelease(cfg.snareDecay, t);
            _snareSynth.tone.triggerAttackRelease('C2', cfg.snareDecay, t, velocity(0.78));
            if (_snareBodySynth) _snareBodySynth.triggerAttackRelease('A1', cfg.snareDecay * 0.7, t, velocity(0.62));
            if (realismEnabled() && _snareRattleSynth) _snareRattleSynth.triggerAttackRelease(cfg.snareDecay * 1.2, t + 0.008, velocity(0.24));
            hits.snare = true;
        }
        if (cfg.hihatOn && inHihat && shouldTrigger(true) && _hihatSynth) {
            // Open/sizzly hat: short metallic tick + longer noisy shimmer.
            const ht = t + cymSwingSec();
            const hatTickDecay = Math.max(0.02, Math.min(0.08, cfg.hihatDecay * 0.4));
            const hatSizzleDecay = Math.max(0.12, Math.min(0.45, cfg.hihatDecay * 2.2));
            if (_hihatFilter) {
                _hihatFilter.frequency.cancelScheduledValues(ht);
                _hihatFilter.frequency.setValueAtTime(7500, ht);
                _hihatFilter.frequency.linearRampToValueAtTime(9800, ht + hatSizzleDecay);
            }
            _hihatSynth.triggerAttackRelease(hatTickDecay, ht, cymVel(0.56));
            if (_hihatNoiseSynth) _hihatNoiseSynth.triggerAttackRelease(hatSizzleDecay, ht + 0.003, cymVel(0.72));
            hits.hihat = true;
        }
        if (cfg.cymbalOn && inRide && shouldTrigger(true) && _rideSynth) {
            // Ride = hi-hat color with larger-disk wash behavior.
            const rt = t + cymSwingSec();
            const ridePingDecay = 0.06 + (cfg.cymbalDecay * 0.42);
            const rideWashDecay = 0.18 + (cfg.cymbalDecay * 2.0);
            _rideSynth.triggerAttackRelease(ridePingDecay, rt, cymVel(0.44));
            if (_rideWashSynth) _rideWashSynth.triggerAttackRelease(rideWashDecay, rt + 0.006, cymVel(0.68));
            hits.ride = true;
        }
        if (cfg.tomOn && inTom && shouldTrigger(true) && _tomSynth) {
            const tomNote = (subStepInBar % 8 === 6) ? 'D1' : 'A1';
            _tomSynth.triggerAttackRelease(tomNote, cfg.tomDecay, t, velocity(0.7));
            hits.tom = true;
        }
        if (cfg.congaOn && inConga && shouldTrigger(true) && (_congaOpenSynth || _congaBassSynth)) {
            const ct = t + ((Math.random() * 0.005) - 0.0025); // slight hand feel timing variance
            const isOffbeat = (subStepInBar % 4) === 2;
            const isBackbeat = (subStepInBar % 8) === 4;
            if (isBackbeat && _congaSlapSynth) {
                if (_congaSlapSynth) _congaSlapSynth.triggerAttackRelease(Math.max(0.03, cfg.congaDecay * 0.28), ct, velocity(0.86));
                if (_congaOpenSynth) _congaOpenSynth.triggerAttackRelease('G2', Math.max(0.09, cfg.congaDecay * 0.45), ct, velocity(0.62));
            } else if (isOffbeat) {
                if (_congaGhostSynth) _congaGhostSynth.triggerAttackRelease(Math.max(0.04, cfg.congaDecay * 0.24), ct, velocity(0.24));
                if (_congaBassSynth) _congaBassSynth.triggerAttackRelease('D2', Math.max(0.08, cfg.congaDecay * 0.36), ct, velocity(0.38));
            } else {
                if (_congaBassSynth) _congaBassSynth.triggerAttackRelease('C2', Math.max(0.1, cfg.congaDecay * 0.5), ct, velocity(0.58));
            }
            hits.conga = true;
        }
        if (cfg.cymbalOn && inCymbal && shouldTrigger(true) && _cymbalSynth) {
            // Crash as bigger hi-hat: familiar noise texture, longer bloom/tail.
            const ct = t + cymSwingSec();
            const crashAtk = 0.05 + (cfg.cymbalDecay * 0.3);
            const crashTail = 0.24 + (cfg.cymbalDecay * 2.8);
            _cymbalSynth.triggerAttackRelease(crashAtk, ct, cymVel(0.5));
            if (_cymbalNoiseSynth) _cymbalNoiseSynth.triggerAttackRelease(crashTail, ct + 0.007, cymVel(0.92));
            hits.cymbal = true;
        }
        if (cfg.claveOn && inClave && shouldTrigger(true) && _claveSynth) {
            _claveSynth.triggerAttackRelease(Math.max(0.02, cfg.claveDecay * 0.65), t, velocity(0.42));
            hits.clave = true;
        }

        if (cfg.hihatOn && stoch > 0 && !inHihat && !inRide && ghostChance() && _hihatSynth) {
            _hihatSynth.triggerAttackRelease('32n', t, velocity(0.15));
        }
        if (cfg.snareOn && stoch > 0 && !inSnare && ghostChance() && _snareSynth) {
            _snareSynth.noise.triggerAttackRelease('16n', t);
            _snareSynth.tone.triggerAttackRelease('C2', '16n', t, velocity(0.2));
        }

        if (hits.kick || hits.snare || hits.hihat || hits.ride || hits.tom || hits.conga || hits.cymbal || hits.clave) {
            return hits;
        }
        return null;
    }

    function previewDrumPiece(piece, when) {
        if (!audioState._initialized || typeof Tone === 'undefined') return false;
        ensurePercussionSynths();
        const t = Number.isFinite(when) ? when : Tone.now();
        const cfg = kitCfg();
        try {
            switch (String(piece || '')) {
                case 'kick':
                    if (!cfg.kickOn) return false;
                    if (audioState._kickSynth) audioState._kickSynth.triggerAttackRelease('C1', cfg.kickDecay, t, 0.75);
                    if (_kickSubSynth) _kickSubSynth.triggerAttackRelease('C0', cfg.kickDecay * 0.95, t, 0.7);
                    if (realismEnabled() && _kickClickSynth) _kickClickSynth.triggerAttackRelease('64n', t, 0.35);
                    return true;
                case 'snare':
                    if (!cfg.snareOn) return false;
                    if (_snareSynth) {
                        _snareSynth.noise.triggerAttackRelease(cfg.snareDecay, t);
                        _snareSynth.tone.triggerAttackRelease('C2', cfg.snareDecay, t, 0.72);
                    }
                    if (_snareBodySynth) _snareBodySynth.triggerAttackRelease('A1', cfg.snareDecay * 0.7, t, 0.55);
                    if (realismEnabled() && _snareRattleSynth) _snareRattleSynth.triggerAttackRelease(cfg.snareDecay * 1.2, t + 0.008, 0.35);
                    return true;
                case 'hihat':
                    if (!cfg.hihatOn) return false;
                    if (_hihatFilter) {
                        _hihatFilter.frequency.cancelScheduledValues(t);
                        _hihatFilter.frequency.setValueAtTime(7500, t);
                        _hihatFilter.frequency.linearRampToValueAtTime(9800, t + Math.max(0.12, Math.min(0.45, cfg.hihatDecay * 2.2)));
                    }
                    if (_hihatSynth) _hihatSynth.triggerAttackRelease(Math.max(0.02, Math.min(0.08, cfg.hihatDecay * 0.4)), t, 0.58);
                    if (_hihatNoiseSynth) _hihatNoiseSynth.triggerAttackRelease(Math.max(0.12, Math.min(0.45, cfg.hihatDecay * 2.2)), t + 0.003, 0.74);
                    return true;
                case 'tom':
                    if (!cfg.tomOn) return false;
                    if (_tomSynth) _tomSynth.triggerAttackRelease('G1', cfg.tomDecay, t, 0.72);
                    return true;
                case 'conga':
                    if (!cfg.congaOn) return false;
                    if (_congaSlapSynth) _congaSlapSynth.triggerAttackRelease(Math.max(0.03, cfg.congaDecay * 0.28), t, 0.82);
                    if (_congaOpenSynth) _congaOpenSynth.triggerAttackRelease('G2', Math.max(0.11, cfg.congaDecay * 0.5), t + 0.002, 0.6);
                    if (_congaGhostSynth) _congaGhostSynth.triggerAttackRelease(Math.max(0.04, cfg.congaDecay * 0.24), t + 0.01, 0.25);
                    return true;
                case 'cymbal':
                    if (!cfg.cymbalOn) return false;
                    if (_cymbalSynth) _cymbalSynth.triggerAttackRelease(0.05 + (cfg.cymbalDecay * 0.3), t, 0.52);
                    if (_cymbalNoiseSynth) _cymbalNoiseSynth.triggerAttackRelease(0.24 + (cfg.cymbalDecay * 2.8), t + 0.007, 0.95);
                    return true;
                case 'clave':
                    if (!cfg.claveOn) return false;
                    if (_claveSynth) _claveSynth.triggerAttackRelease(Math.max(0.02, cfg.claveDecay * 0.65), t, 0.5);
                    return true;
                default:
                    return false;
            }
        } catch (_e) {
            return false;
        }
    }

    function previewFullKit(when) {
        if (!audioState._initialized || typeof Tone === 'undefined') return false;
        const t0 = Number.isFinite(when) ? when : Tone.now();
        const delta = 0.085;
        // Short one-shot audition across all seven kit pieces.
        previewDrumPiece('kick', t0);
        previewDrumPiece('snare', t0 + delta);
        previewDrumPiece('hihat', t0 + (delta * 2));
        previewDrumPiece('tom', t0 + (delta * 3));
        previewDrumPiece('conga', t0 + (delta * 4));
        previewDrumPiece('cymbal', t0 + (delta * 5));
        previewDrumPiece('clave', t0 + (delta * 6));
        return true;
    }

    /**
     * Dispose percussion synths (call on engine stop)
     */
    function disposeDrums() {
        if (_snareSynth) {
            try { _snareSynth.noise.dispose(); _snareSynth.tone.dispose(); } catch (e) {}
            _snareSynth = null;
        }
        if (_snareBodySynth) {
            try { _snareBodySynth.dispose(); } catch (e) {}
            _snareBodySynth = null;
        }
        if (_snareRattleSynth) {
            try { _snareRattleSynth.dispose(); } catch (e) {}
            _snareRattleSynth = null;
        }
        if (_kickSubSynth) {
            try { _kickSubSynth.dispose(); } catch (e) {}
            _kickSubSynth = null;
        }
        if (_kickClickSynth) {
            try { _kickClickSynth.dispose(); } catch (e) {}
            _kickClickSynth = null;
        }
        if (_hihatSynth) {
            try { _hihatSynth.dispose(); } catch (e) {}
            _hihatSynth = null;
        }
        if (_hihatNoiseSynth) {
            try { _hihatNoiseSynth.dispose(); } catch (e) {}
            _hihatNoiseSynth = null;
        }
        if (_hihatFilter) {
            try { _hihatFilter.dispose(); } catch (e) {}
            _hihatFilter = null;
        }
        if (_rideSynth) {
            try { _rideSynth.dispose(); } catch (e) {}
            _rideSynth = null;
        }
        if (_rideWashSynth) {
            try { _rideWashSynth.dispose(); } catch (e) {}
            _rideWashSynth = null;
        }
        if (_tomSynth) {
            try { _tomSynth.dispose(); } catch (e) {}
            _tomSynth = null;
        }
        if (_congaOpenSynth) {
            try { _congaOpenSynth.dispose(); } catch (e) {}
            _congaOpenSynth = null;
        }
        if (_congaBassSynth) {
            try { _congaBassSynth.dispose(); } catch (e) {}
            _congaBassSynth = null;
        }
        if (_congaSlapSynth) {
            try { _congaSlapSynth.dispose(); } catch (e) {}
            _congaSlapSynth = null;
        }
        if (_congaGhostSynth) {
            try { _congaGhostSynth.dispose(); } catch (e) {}
            _congaGhostSynth = null;
        }
        if (_cymbalSynth) {
            try { _cymbalSynth.dispose(); } catch (e) {}
            _cymbalSynth = null;
        }
        if (_cymbalNoiseSynth) {
            try { _cymbalNoiseSynth.dispose(); } catch (e) {}
            _cymbalNoiseSynth = null;
        }
        if (_cymbalGlue) {
            try { _cymbalGlue.dispose(); } catch (e) {}
            _cymbalGlue = null;
        }
        if (_claveSynth) {
            try { _claveSynth.dispose(); } catch (e) {}
            _claveSynth = null;
        }
        if (_drumLimiter) {
            try { _drumLimiter.dispose(); } catch (e) {}
            _drumLimiter = null;
        }
        if (_drumComp) {
            try { _drumComp.dispose(); } catch (e) {}
            _drumComp = null;
        }
        if (_drumSaturator) {
            try { _drumSaturator.dispose(); } catch (e) {}
            _drumSaturator = null;
        }
        if (_drumEq) {
            try { _drumEq.dispose(); } catch (e) {}
            _drumEq = null;
        }
        if (_drumBusIn) {
            try { _drumBusIn.dispose(); } catch (e) {}
            _drumBusIn = null;
        }
        if (_drumRoomVerb) {
            try { _drumRoomVerb.dispose(); } catch (e) {}
            _drumRoomVerb = null;
        }
        if (_drumRoomSend) {
            try { _drumRoomSend.dispose(); } catch (e) {}
            _drumRoomSend = null;
        }
        _kickRoutedToDrumBus = false;
    }

    // ========================================================================
    // EXPORTS
    // ========================================================================

    _am.DRUM_BEATS = DRUM_BEATS;
    _am.playDrumStep = playDrumStep;
    _am.disposeDrums = disposeDrums;
    _am.setDrumVolume = setDrumVolume;
    _am.setDrumKitParams = setDrumKitParams;
    _am.setDrumNaturalRoom = setDrumNaturalRoom;
    _am.previewDrumPiece = previewDrumPiece;
    _am.previewFullKit = previewFullKit;
})();
