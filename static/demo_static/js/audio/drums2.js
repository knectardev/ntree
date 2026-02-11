/**
 * audio/drums2.js — Local-sample Drum Engine (override)
 *
 * Primary mode: local one-shot files in static/demo_static/audio/drums/.
 * Fallback mode: midi-js-soundfonts sampler sources when local files are missing.
 *
 * This module is now the primary drum engine in chart.html and preserves
 * existing UI state, beat patterns, and conductor wiring through _audioModule.
 */
(function() {
    'use strict';
    const _am = window._audioModule = window._audioModule || {};
    const audioState = _am.audioState || window.audioState || {};

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

    // Local drop-in sample convention (any existing files in each list are used).
    const LOCAL_FILES = {
        // Canonical + numbered variants + compatibility aliases for your current folder set.
        kick: [
            'static/demo_static/audio/drums/kick/kick.wav',
            'static/demo_static/audio/drums/kick/kick_01.wav',
            'static/demo_static/audio/drums/kick/kick_02.wav',
            'static/demo_static/audio/drums/kick/kick1.wav',
            'static/demo_static/audio/drums/kick/kick2.wav',
            'static/demo_static/audio/drums/kick/kick3.wav',
            'static/demo_static/audio/drums/kick/kick4.wav'
        ],
        snare: [
            'static/demo_static/audio/drums/snare/snare.wav',
            'static/demo_static/audio/drums/snare/snare_01.wav',
            'static/demo_static/audio/drums/snare/snare_02.wav',
            'static/demo_static/audio/drums/snare/snare1.wav',
            'static/demo_static/audio/drums/snare/snare2.wav',
            'static/demo_static/audio/drums/snare/snare3.wav',
            'static/demo_static/audio/drums/snare/snare4.wav'
        ],
        hihat: [
            'static/demo_static/audio/drums/hihat/hihat_closed.wav',
            'static/demo_static/audio/drums/hihat/hihat.wav',
            'static/demo_static/audio/drums/hihat/hihat_01.wav',
            // Folder alias: hat/
            'static/demo_static/audio/drums/hat/hat.wav',
            'static/demo_static/audio/drums/hat/hat1.wav',
            'static/demo_static/audio/drums/hat/hat2.wav',
            'static/demo_static/audio/drums/hat/hat3.wav'
        ],
        tom: [
            'static/demo_static/audio/drums/tom/tom.wav',
            'static/demo_static/audio/drums/tom/tom_01.wav',
            'static/demo_static/audio/drums/tom/tom_02.wav',
            'static/demo_static/audio/drums/tom/tom1.wav'
        ],
        conga: [
            'static/demo_static/audio/drums/conga/conga.wav',
            'static/demo_static/audio/drums/conga/conga_01.wav',
            'static/demo_static/audio/drums/conga/conga_02.wav',
            // Temporary aliases until dedicated conga folder exists.
            'static/demo_static/audio/drums/tabla/tabla1.wav',
            'static/demo_static/audio/drums/tabla/tabla2.wav',
            'static/demo_static/audio/drums/timbale/timbale1.wav',
            'static/demo_static/audio/drums/timbale/timbale2.wav',
            'static/demo_static/audio/drums/cajon/cajon1.wav'
        ],
        cymbal: [
            'static/demo_static/audio/drums/cymbal/cymbal.wav',
            'static/demo_static/audio/drums/cymbal/crash.wav',
            'static/demo_static/audio/drums/cymbal/ride.wav',
            // Folder alias: ride/
            'static/demo_static/audio/drums/ride/ride1.wav'
        ],
        clave: [
            'static/demo_static/audio/drums/clave/clave.wav',
            'static/demo_static/audio/drums/clave/clave_01.wav',
            // Temporary aliases until dedicated clave folder exists.
            'static/demo_static/audio/drums/log/log1.wav',
            'static/demo_static/audio/drums/log/log2.wav',
            'static/demo_static/audio/drums/clap/clap1.wav'
        ]
    };

    // Fallback source files when local files are not present.
    const FALLBACK = {
        kick: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/taiko_drum-mp3/',
        snare: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_drum-mp3/',
        hihat: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/agogo-mp3/',
        tom: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/melodic_tom-mp3/',
        conga: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/steel_drums-mp3/',
        cymbal: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/reverse_cymbal-mp3/',
        clave: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/woodblock-mp3/'
    };

    const ROUND_ROBIN_NOTES = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3'];
    const FALLBACK_NOTES = ['C2', 'C3', 'C4', 'C5'];
    const PIECES = ['kick', 'snare', 'hihat', 'tom', 'conga', 'cymbal', 'clave'];

    const _pieceState = {
        kick: { sampler: null, keys: [], source: 'none' },
        snare: { sampler: null, keys: [], source: 'none' },
        hihat: { sampler: null, keys: [], source: 'none' },
        tom: { sampler: null, keys: [], source: 'none' },
        conga: { sampler: null, keys: [], source: 'none' },
        cymbal: { sampler: null, keys: [], source: 'none' },
        clave: { sampler: null, keys: [], source: 'none' }
    };

    let _drumBus = null;
    let _roomSend = null;
    let _roomVerb = null;
    let _kitReady = false;
    let _kitLoadPromise = null;

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

    const drumVol = () => (audioState.drumVolume !== undefined ? Number(audioState.drumVolume) : -12);
    const realismEnabled = () => (audioState.drumNaturalRoom !== false);

    function ensureBus() {
        if (typeof Tone === 'undefined') return null;
        if (_drumBus) return _drumBus;
        _drumBus = new Tone.Gain(1.0).toDestination();
        _roomSend = new Tone.Gain(0.12);
        _roomVerb = new Tone.Freeverb({ roomSize: 0.74, dampening: 5200 });
        _roomSend.chain(_roomVerb, Tone.Destination);
        _roomSend.gain.value = realismEnabled() ? 0.12 : 0;
        return _drumBus;
    }

    function connectVoice(node) {
        if (!node) return;
        const bus = ensureBus();
        if (!bus) return;
        node.connect(bus);
        if (_roomSend) node.connect(_roomSend);
    }

    async function urlExists(url) {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            return !!(res && res.ok);
        } catch (_e) {
            return false;
        }
    }

    function createFallbackSampler(baseUrl) {
        return new Tone.Sampler({
            urls: { C2: 'C2.mp3', C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3' },
            baseUrl: baseUrl,
            release: 0.05
        });
    }

    async function createPieceSampler(piece) {
        const localCandidates = Array.isArray(LOCAL_FILES[piece]) ? LOCAL_FILES[piece] : [];
        const available = [];
        for (let i = 0; i < localCandidates.length; i++) {
            const u = localCandidates[i];
            if (await urlExists(u)) available.push(u);
        }

        if (available.length > 0) {
            const urls = {};
            const lim = Math.min(available.length, ROUND_ROBIN_NOTES.length);
            for (let i = 0; i < lim; i++) urls[ROUND_ROBIN_NOTES[i]] = available[i];
            const sampler = new Tone.Sampler({ urls: urls, release: 0.04 });
            return { sampler: sampler, keys: Object.keys(urls), source: 'local' };
        }

        const sampler = createFallbackSampler(FALLBACK[piece]);
        return { sampler: sampler, keys: FALLBACK_NOTES.slice(), source: 'fallback' };
    }

    async function loadSampledKitAsync() {
        if (typeof Tone === 'undefined') return false;
        ensureBus();
        const built = await Promise.all(PIECES.map(p => createPieceSampler(p)));
        for (let i = 0; i < PIECES.length; i++) {
            const piece = PIECES[i];
            const b = built[i];
            _pieceState[piece].sampler = b.sampler;
            _pieceState[piece].keys = b.keys;
            _pieceState[piece].source = b.source;
            connectVoice(_pieceState[piece].sampler);
        }
        _kitReady = true;
        applyDrumVoiceVolumes(drumVol());
        try {
            const summary = PIECES.map(p => p + ':' + _pieceState[p].source).join(' | ');
            console.log('[Audio][drums2] sample sources ->', summary);
        } catch (_e) {}
        return true;
    }

    function ensureSampledKit() {
        if (_kitReady) return true;
        if (!_kitLoadPromise) {
            _kitLoadPromise = loadSampledKitAsync().catch(function(err) {
                console.warn('[Audio][drums2] sample kit load failed:', err);
                _kitReady = false;
                return false;
            });
        }
        return false;
    }

    function primeDrumSamples() {
        if (_kitReady) return Promise.resolve(true);
        if (!_kitLoadPromise) _kitLoadPromise = loadSampledKitAsync();
        return _kitLoadPromise;
    }

    function applyDrumVoiceVolumes(baseVol) {
        const v = Number(baseVol);
        const k = kitCfg();
        const muted = -120;
        const setVol = (piece, on, db) => {
            const s = _pieceState[piece] && _pieceState[piece].sampler;
            if (s) s.volume.value = on ? db : muted;
        };
        setVol('kick', k.kickOn, v + k.kickLevel - 2);
        setVol('snare', k.snareOn, v + k.snareLevel - 1);
        setVol('hihat', k.hihatOn, v + k.hihatLevel - 3);
        setVol('tom', k.tomOn, v + k.tomLevel - 2);
        setVol('conga', k.congaOn, v + k.congaLevel - 2);
        setVol('cymbal', k.cymbalOn, v + k.cymbalLevel - 4);
        setVol('clave', k.claveOn, v + k.claveLevel - 2);
    }

    function setDrumVolume(val) {
        audioState.drumVolume = Number(val);
        applyDrumVoiceVolumes(audioState.drumVolume);
    }

    function setDrumNaturalRoom(enabled) {
        audioState.drumNaturalRoom = !!enabled;
        if (_roomSend) _roomSend.gain.value = audioState.drumNaturalRoom ? 0.12 : 0;
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
        applyDrumVoiceVolumes(drumVol());
    }

    function vel(base, stoch) {
        if (!stoch) return base;
        return Math.max(0.2, Math.min(1, base + ((Math.random() * 0.2) - 0.1) * stoch));
    }

    function pickKey(piece, preferredNote) {
        const ps = _pieceState[piece];
        if (!ps || !ps.keys || !ps.keys.length) return preferredNote || 'C3';
        if (ps.source === 'fallback' && preferredNote && ps.keys.indexOf(preferredNote) >= 0) return preferredNote;
        return ps.keys[Math.floor(Math.random() * ps.keys.length)];
    }

    function hit(piece, preferredNote, dur, t, v) {
        const ps = _pieceState[piece];
        if (!ps || !ps.sampler) return;
        const key = pickKey(piece, preferredNote);
        ps.sampler.triggerAttackRelease(key, Math.max(0.02, dur), t, v);
    }

    function playDrumStep(beatKey, subStepInBar, now) {
        const pattern = DRUM_BEATS[beatKey];
        if (!pattern) return null;
        if (!audioState._initialized) return null;
        if (!ensureSampledKit()) return null;

        const cfg = kitCfg();
        const stoch = Number(audioState.beatStochasticity || 0);
        const t = now + (stoch > 0 ? ((Math.random() - 0.5) * 0.01 * stoch) : 0);
        const inKick = Array.isArray(pattern.kick) && pattern.kick.includes(subStepInBar);
        const inSnare = Array.isArray(pattern.snare) && pattern.snare.includes(subStepInBar);
        const hasHihatPattern = Array.isArray(pattern.hihat) && pattern.hihat.length > 0;
        const hasRidePattern = Array.isArray(pattern.ride) && pattern.ride.length > 0;
        const hasTomPattern = Array.isArray(pattern.tom) && pattern.tom.length > 0;
        const hasCongaPattern = Array.isArray(pattern.conga) && pattern.conga.length > 0;
        const hasCymbalPattern = Array.isArray(pattern.cymbal) && pattern.cymbal.length > 0;
        const inHihat = hasHihatPattern ? pattern.hihat.includes(subStepInBar) : (hasRidePattern ? pattern.ride.includes(subStepInBar) : (subStepInBar % 2 === 0));
        const inRide = hasRidePattern && pattern.ride.includes(subStepInBar);
        const inTom = hasTomPattern ? pattern.tom.includes(subStepInBar) : (subStepInBar === 6 || subStepInBar === 14);
        const inConga = hasCongaPattern ? pattern.conga.includes(subStepInBar) : false;
        const inCymbal = hasCymbalPattern ? pattern.cymbal.includes(subStepInBar) : (subStepInBar === 0 || subStepInBar === 8);
        const inClave = Array.isArray(pattern.clave) && pattern.clave.includes(subStepInBar);

        const hits = { kick: false, snare: false, hihat: false, ride: false, tom: false, conga: false, cymbal: false, clave: false };

        if (cfg.kickOn && inKick) { hit('kick', 'C2', cfg.kickDecay, t, vel(0.85, stoch)); hits.kick = true; }
        if (cfg.snareOn && inSnare) { hit('snare', 'D3', cfg.snareDecay, t, vel(0.78, stoch)); hits.snare = true; }
        if (cfg.hihatOn && inHihat) { hit('hihat', 'C5', cfg.hihatDecay, t, vel(0.58, stoch)); hits.hihat = true; }
        if (cfg.cymbalOn && inRide) { hit('cymbal', 'C5', Math.max(0.1, cfg.cymbalDecay * 0.6), t + 0.003, vel(0.5, stoch)); hits.ride = true; }
        if (cfg.tomOn && inTom) { hit('tom', (subStepInBar % 8 === 6) ? 'D3' : 'A2', cfg.tomDecay, t, vel(0.72, stoch)); hits.tom = true; }
        if (cfg.congaOn && inConga) {
            const cNote = (subStepInBar % 4 === 2) ? 'D4' : ((subStepInBar % 8 === 4) ? 'F4' : 'C4');
            hit('conga', cNote, cfg.congaDecay, t - 0.002, vel(0.7, stoch));
            hits.conga = true;
        }
        if (cfg.cymbalOn && inCymbal) { hit('cymbal', 'C4', Math.max(0.12, cfg.cymbalDecay), t + 0.004, vel(0.66, stoch)); hits.cymbal = true; }
        if (cfg.claveOn && inClave) { hit('clave', 'C5', cfg.claveDecay, t, vel(0.6, stoch)); hits.clave = true; }

        return (hits.kick || hits.snare || hits.hihat || hits.ride || hits.tom || hits.conga || hits.cymbal || hits.clave) ? hits : null;
    }

    function previewDrumPiece(piece, when) {
        if (!audioState._initialized || typeof Tone === 'undefined') return false;
        if (!ensureSampledKit()) return false;
        const t = Number.isFinite(when) ? when : Tone.now();
        const cfg = kitCfg();
        try {
            switch (String(piece || '')) {
                case 'kick': if (!cfg.kickOn) return false; hit('kick', 'C2', cfg.kickDecay, t, 0.9); return true;
                case 'snare': if (!cfg.snareOn) return false; hit('snare', 'D3', cfg.snareDecay, t, 0.84); return true;
                case 'hihat': if (!cfg.hihatOn) return false; hit('hihat', 'C5', cfg.hihatDecay, t, 0.72); return true;
                case 'tom': if (!cfg.tomOn) return false; hit('tom', 'A2', cfg.tomDecay, t, 0.8); return true;
                case 'conga': if (!cfg.congaOn) return false; hit('conga', 'C4', cfg.congaDecay, t, 0.82); return true;
                case 'cymbal': if (!cfg.cymbalOn) return false; hit('cymbal', 'C4', cfg.cymbalDecay, t, 0.8); return true;
                case 'clave': if (!cfg.claveOn) return false; hit('clave', 'C5', cfg.claveDecay, t, 0.8); return true;
                default: return false;
            }
        } catch (_e) {
            return false;
        }
    }

    function previewFullKit(when) {
        if (!audioState._initialized || typeof Tone === 'undefined') return false;
        const t0 = Number.isFinite(when) ? when : Tone.now();
        const delta = 0.085;
        previewDrumPiece('kick', t0);
        previewDrumPiece('snare', t0 + delta);
        previewDrumPiece('hihat', t0 + (delta * 2));
        previewDrumPiece('tom', t0 + (delta * 3));
        previewDrumPiece('conga', t0 + (delta * 4));
        previewDrumPiece('cymbal', t0 + (delta * 5));
        previewDrumPiece('clave', t0 + (delta * 6));
        return true;
    }

    function disposeDrums() {
        for (let i = 0; i < PIECES.length; i++) {
            const p = PIECES[i];
            const s = _pieceState[p].sampler;
            if (s) {
                try { s.dispose(); } catch (_e) {}
            }
            _pieceState[p].sampler = null;
            _pieceState[p].keys = [];
            _pieceState[p].source = 'none';
        }
        if (_roomVerb) { try { _roomVerb.dispose(); } catch (_e) {} }
        if (_roomSend) { try { _roomSend.dispose(); } catch (_e) {} }
        if (_drumBus) { try { _drumBus.dispose(); } catch (_e) {} }
        _roomVerb = null;
        _roomSend = null;
        _drumBus = null;
        _kitReady = false;
        _kitLoadPromise = null;
    }

    // Override drum exports from drums.js with sample-based implementation.
    _am.drumEngineMode = 'samples_only';
    _am.DRUM_BEATS = DRUM_BEATS;
    _am.playDrumStep = playDrumStep;
    _am.disposeDrums = disposeDrums;
    _am.setDrumVolume = setDrumVolume;
    _am.setDrumKitParams = setDrumKitParams;
    _am.setDrumNaturalRoom = setDrumNaturalRoom;
    _am.previewDrumPiece = previewDrumPiece;
    _am.previewFullKit = previewFullKit;
    _am.primeDrumSamples = primeDrumSamples;
})();

