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
        standard_11piece: {
            label: 'Standard 11-Instrument Groove',
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
        standard_7piece: {
            label: 'Standard 11-Instrument Groove',
            kick: [0, 8, 11],
            snare: [4, 12],
            hihat: [0, 2, 4, 6, 8, 10, 12, 14],
            tom: [6, 14],
            conga: [3, 7, 11, 14],
            cymbal: [0],
            ride: [],
            clave: []
        },
        standard_5piece: {
            label: 'Standard 11-Instrument Groove',
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
            label: 'Standard Swing Beat',
            kick: [0, 8, 10],
            snare: [4, 12],
            hihat: [4, 12],
            tom: [],
            conga: [],
            cymbal: [],
            ride: [0, 3, 4, 7, 8, 11, 12, 15],
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

    // Local drop-in sample convention based on your current drum folders.
    const LOCAL_FILES = {
        kick: ['static/demo_static/audio/drums/kick/kick.wav', 'static/demo_static/audio/drums/kick/kick1.wav', 'static/demo_static/audio/drums/kick/kick2.wav', 'static/demo_static/audio/drums/kick/kick3.wav', 'static/demo_static/audio/drums/kick/kick4.wav'],
        snare: ['static/demo_static/audio/drums/snare/snare.wav', 'static/demo_static/audio/drums/snare/snare1.wav', 'static/demo_static/audio/drums/snare/snare2.wav', 'static/demo_static/audio/drums/snare/snare3.wav', 'static/demo_static/audio/drums/snare/snare4.wav'],
        hat: ['static/demo_static/audio/drums/hat/hat.wav', 'static/demo_static/audio/drums/hat/hat1.wav', 'static/demo_static/audio/drums/hat/hat2.wav', 'static/demo_static/audio/drums/hat/hat3.wav'],
        tom: ['static/demo_static/audio/drums/tom/tom.wav', 'static/demo_static/audio/drums/tom/tom1.wav', 'static/demo_static/audio/drums/tom/tom2.wav', 'static/demo_static/audio/drums/tom/tom3.wav'],
        ride: ['static/demo_static/audio/drums/ride/ride.wav', 'static/demo_static/audio/drums/ride/ride1.wav', 'static/demo_static/audio/drums/ride/ride2.wav', 'static/demo_static/audio/drums/ride/ride3.wav'],
        cajon: ['static/demo_static/audio/drums/cajon/cajon.wav', 'static/demo_static/audio/drums/cajon/cajon1.wav', 'static/demo_static/audio/drums/cajon/cajon2.wav', 'static/demo_static/audio/drums/cajon/cajon3.wav'],
        clap: ['static/demo_static/audio/drums/clap/clap.wav', 'static/demo_static/audio/drums/clap/clap1.wav', 'static/demo_static/audio/drums/clap/clap2.wav', 'static/demo_static/audio/drums/clap/clap3.wav'],
        log: ['static/demo_static/audio/drums/log/log.wav', 'static/demo_static/audio/drums/log/log1.wav', 'static/demo_static/audio/drums/log/log2.wav', 'static/demo_static/audio/drums/log/log3.wav'],
        tabla: ['static/demo_static/audio/drums/tabla/tabla.wav', 'static/demo_static/audio/drums/tabla/tabla1.wav', 'static/demo_static/audio/drums/tabla/tabla2.wav', 'static/demo_static/audio/drums/tabla/tabla3.wav'],
        timbale: ['static/demo_static/audio/drums/timbale/timbale.wav', 'static/demo_static/audio/drums/timbale/timbale1.wav', 'static/demo_static/audio/drums/timbale/timbale2.wav', 'static/demo_static/audio/drums/timbale/timbale3.wav'],
        misc: ['static/demo_static/audio/drums/misc/misc.wav', 'static/demo_static/audio/drums/misc/misc1.wav', 'static/demo_static/audio/drums/misc/misc2.wav', 'static/demo_static/audio/drums/misc/misc3.wav']
    };

    // Fallback source files when local files are not present.
    const FALLBACK = {
        kick: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/taiko_drum-mp3/',
        snare: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_drum-mp3/',
        hat: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/agogo-mp3/',
        tom: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/melodic_tom-mp3/',
        ride: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/reverse_cymbal-mp3/',
        cajon: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/steel_drums-mp3/',
        clap: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_drum-mp3/',
        log: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/woodblock-mp3/',
        tabla: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/steel_drums-mp3/',
        timbale: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/melodic_tom-mp3/',
        misc: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_drum-mp3/'
    };

    const ROUND_ROBIN_NOTES = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3'];
    const FALLBACK_NOTES = ['C2', 'C3', 'C4', 'C5'];
    const PIECES = ['kick', 'snare', 'hat', 'tom', 'ride', 'cajon', 'clap', 'log', 'tabla', 'timbale', 'misc'];
    const DECAY_META = {
        kick:    { uiMin: 0.08, uiMax: 0.7,  durMin: 0.04, durMax: 0.42, relMin: 0.01, relMax: 0.22 },
        snare:   { uiMin: 0.06, uiMax: 0.45, durMin: 0.03, durMax: 0.32, relMin: 0.01, relMax: 0.18 },
        hat:     { uiMin: 0.03, uiMax: 0.35, durMin: 0.01, durMax: 0.2,  relMin: 0.005, relMax: 0.1 },
        tom:     { uiMin: 0.08, uiMax: 0.6,  durMin: 0.04, durMax: 0.48, relMin: 0.01, relMax: 0.22 },
        ride:    { uiMin: 0.08, uiMax: 1.2,  durMin: 0.05, durMax: 1.4,  relMin: 0.02, relMax: 0.5 },
        cajon:   { uiMin: 0.08, uiMax: 0.9,  durMin: 0.03, durMax: 0.62, relMin: 0.01, relMax: 0.26 },
        clap:    { uiMin: 0.03, uiMax: 0.35, durMin: 0.01, durMax: 0.28, relMin: 0.005, relMax: 0.14 },
        log:     { uiMin: 0.03, uiMax: 0.35, durMin: 0.01, durMax: 0.22, relMin: 0.005, relMax: 0.1 },
        tabla:   { uiMin: 0.08, uiMax: 0.9,  durMin: 0.03, durMax: 0.62, relMin: 0.01, relMax: 0.26 },
        timbale: { uiMin: 0.08, uiMax: 0.9,  durMin: 0.03, durMax: 0.62, relMin: 0.01, relMax: 0.26 },
        misc:    { uiMin: 0.03, uiMax: 0.9,  durMin: 0.01, durMax: 0.7,  relMin: 0.005, relMax: 0.3 }
    };

    const _pieceState = {
        kick: { sampler: null, keys: [], source: 'none' },
        snare: { sampler: null, keys: [], source: 'none' },
        hat: { sampler: null, keys: [], source: 'none' },
        tom: { sampler: null, keys: [], source: 'none' },
        ride: { sampler: null, keys: [], source: 'none' },
        cajon: { sampler: null, keys: [], source: 'none' },
        clap: { sampler: null, keys: [], source: 'none' },
        log: { sampler: null, keys: [], source: 'none' },
        tabla: { sampler: null, keys: [], source: 'none' },
        timbale: { sampler: null, keys: [], source: 'none' },
        misc: { sampler: null, keys: [], source: 'none' }
    };

    let _drumBus = null;
    let _roomSend = null;
    let _roomVerb = null;
    let _kitReady = false;
    let _kitLoadPromise = null;

    const _KIT_DEFAULTS = {
        kickOn: true, snareOn: true, hatOn: true, tomOn: true, rideOn: true, cajonOn: true, clapOn: true, logOn: true, tablaOn: true, timbaleOn: true, miscOn: true,
        kickLevel: 0, snareLevel: 0, hatLevel: 0, tomLevel: -2, rideLevel: -2, cajonLevel: -2, clapLevel: -3, logLevel: -4, tablaLevel: -2, timbaleLevel: -2, miscLevel: -6,
        kickDecay: 0.28, snareDecay: 0.14, hatDecay: 0.08, tomDecay: 0.20, rideDecay: 0.32, cajonDecay: 0.26, clapDecay: 0.12, logDecay: 0.10, tablaDecay: 0.24, timbaleDecay: 0.24, miscDecay: 0.16
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
            hatOn: asBool(k.hatOn, asBool(k.hihatOn, _KIT_DEFAULTS.hatOn)),
            tomOn: asBool(k.tomOn, _KIT_DEFAULTS.tomOn),
            rideOn: asBool(k.rideOn, asBool(k.cymbalOn, _KIT_DEFAULTS.rideOn)),
            cajonOn: asBool(k.cajonOn, asBool(k.congaOn, _KIT_DEFAULTS.cajonOn)),
            clapOn: asBool(k.clapOn, _KIT_DEFAULTS.clapOn),
            logOn: asBool(k.logOn, asBool(k.claveOn, _KIT_DEFAULTS.logOn)),
            tablaOn: asBool(k.tablaOn, _KIT_DEFAULTS.tablaOn),
            timbaleOn: asBool(k.timbaleOn, _KIT_DEFAULTS.timbaleOn),
            miscOn: asBool(k.miscOn, _KIT_DEFAULTS.miscOn),
            kickLevel: clamp(k.kickLevel, -18, 12, _KIT_DEFAULTS.kickLevel),
            snareLevel: clamp(k.snareLevel, -18, 12, _KIT_DEFAULTS.snareLevel),
            hatLevel: clamp((k.hatLevel !== undefined ? k.hatLevel : k.hihatLevel), -18, 12, _KIT_DEFAULTS.hatLevel),
            tomLevel: clamp(k.tomLevel, -18, 12, _KIT_DEFAULTS.tomLevel),
            rideLevel: clamp((k.rideLevel !== undefined ? k.rideLevel : k.cymbalLevel), -18, 12, _KIT_DEFAULTS.rideLevel),
            cajonLevel: clamp((k.cajonLevel !== undefined ? k.cajonLevel : k.congaLevel), -18, 12, _KIT_DEFAULTS.cajonLevel),
            clapLevel: clamp(k.clapLevel, -18, 12, _KIT_DEFAULTS.clapLevel),
            logLevel: clamp((k.logLevel !== undefined ? k.logLevel : k.claveLevel), -18, 12, _KIT_DEFAULTS.logLevel),
            tablaLevel: clamp(k.tablaLevel, -18, 12, _KIT_DEFAULTS.tablaLevel),
            timbaleLevel: clamp(k.timbaleLevel, -18, 12, _KIT_DEFAULTS.timbaleLevel),
            miscLevel: clamp(k.miscLevel, -18, 12, _KIT_DEFAULTS.miscLevel),
            kickDecay: clamp(k.kickDecay, 0.08, 0.7, _KIT_DEFAULTS.kickDecay),
            snareDecay: clamp(k.snareDecay, 0.06, 0.45, _KIT_DEFAULTS.snareDecay),
            hatDecay: clamp((k.hatDecay !== undefined ? k.hatDecay : k.hihatDecay), 0.03, 0.35, _KIT_DEFAULTS.hatDecay),
            tomDecay: clamp(k.tomDecay, 0.08, 0.6, _KIT_DEFAULTS.tomDecay),
            rideDecay: clamp((k.rideDecay !== undefined ? k.rideDecay : k.cymbalDecay), 0.08, 1.2, _KIT_DEFAULTS.rideDecay),
            cajonDecay: clamp((k.cajonDecay !== undefined ? k.cajonDecay : k.congaDecay), 0.08, 0.9, _KIT_DEFAULTS.cajonDecay),
            clapDecay: clamp(k.clapDecay, 0.03, 0.35, _KIT_DEFAULTS.clapDecay),
            logDecay: clamp((k.logDecay !== undefined ? k.logDecay : k.claveDecay), 0.03, 0.35, _KIT_DEFAULTS.logDecay),
            tablaDecay: clamp(k.tablaDecay, 0.08, 0.9, _KIT_DEFAULTS.tablaDecay),
            timbaleDecay: clamp(k.timbaleDecay, 0.08, 0.9, _KIT_DEFAULTS.timbaleDecay),
            miscDecay: clamp(k.miscDecay, 0.03, 0.9, _KIT_DEFAULTS.miscDecay)
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
        setVol('hat', k.hatOn, v + k.hatLevel - 3);
        setVol('tom', k.tomOn, v + k.tomLevel - 2);
        setVol('ride', k.rideOn, v + k.rideLevel - 4);
        setVol('cajon', k.cajonOn, v + k.cajonLevel - 2);
        setVol('clap', k.clapOn, v + k.clapLevel - 2);
        setVol('log', k.logOn, v + k.logLevel - 2);
        setVol('tabla', k.tablaOn, v + k.tablaLevel - 2);
        setVol('timbale', k.timbaleOn, v + k.timbaleLevel - 2);
        setVol('misc', k.miscOn, v + k.miscLevel - 2);
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

    function lerp(a, b, t) {
        return a + ((b - a) * t);
    }

    function decayNorm(piece, uiValue) {
        const m = DECAY_META[piece] || null;
        if (!m) return 0.5;
        const d = clamp(uiValue, m.uiMin, m.uiMax, m.uiMin);
        return (d - m.uiMin) / Math.max(0.0001, (m.uiMax - m.uiMin));
    }

    function decayDuration(piece, uiValue) {
        const m = DECAY_META[piece] || null;
        if (!m) return Math.max(0.02, Number(uiValue) || 0.12);
        const t = decayNorm(piece, uiValue);
        return Math.max(0.02, lerp(m.durMin, m.durMax, t));
    }

    function decayRelease(piece, uiValue) {
        const m = DECAY_META[piece] || null;
        if (!m) return 0.05;
        const t = decayNorm(piece, uiValue);
        return Math.max(0.005, lerp(m.relMin, m.relMax, t));
    }

    function pickKey(piece, preferredNote) {
        const ps = _pieceState[piece];
        if (!ps || !ps.keys || !ps.keys.length) return preferredNote || 'C3';
        if (ps.source === 'fallback' && preferredNote && ps.keys.indexOf(preferredNote) >= 0) return preferredNote;
        return ps.keys[Math.floor(Math.random() * ps.keys.length)];
    }

    function hit(piece, preferredNote, uiDecay, t, v) {
        const ps = _pieceState[piece];
        if (!ps || !ps.sampler) return;
        ps.sampler.release = decayRelease(piece, uiDecay);
        const key = pickKey(piece, preferredNote);
        ps.sampler.triggerAttackRelease(key, decayDuration(piece, uiDecay), t, v);
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
        const hatPattern = Array.isArray(pattern.hat) ? pattern.hat : (Array.isArray(pattern.hihat) ? pattern.hihat : []);
        const ridePattern = Array.isArray(pattern.ride) ? pattern.ride : (Array.isArray(pattern.cymbal) ? pattern.cymbal : []);
        const cajonPattern = Array.isArray(pattern.cajon) ? pattern.cajon : (Array.isArray(pattern.conga) ? pattern.conga : []);
        const clapPattern = Array.isArray(pattern.clap) ? pattern.clap : (Array.isArray(pattern.clave) ? pattern.clave : []);
        const logPattern = Array.isArray(pattern.log) ? pattern.log : (Array.isArray(pattern.clave) ? pattern.clave : []);
        const tablaPattern = Array.isArray(pattern.tabla) ? pattern.tabla : (Array.isArray(pattern.conga) ? pattern.conga : []);
        const timbalePattern = Array.isArray(pattern.timbale) ? pattern.timbale : (Array.isArray(pattern.tom) ? pattern.tom : []);
        const miscPattern = Array.isArray(pattern.misc) ? pattern.misc : [];

        const inHat = hatPattern.length ? hatPattern.includes(subStepInBar) : (subStepInBar % 2 === 0);
        const inRide = ridePattern.length ? ridePattern.includes(subStepInBar) : (subStepInBar === 0 || subStepInBar === 8);
        const inTom = Array.isArray(pattern.tom) && pattern.tom.length ? pattern.tom.includes(subStepInBar) : (subStepInBar === 6 || subStepInBar === 14);
        const inCajon = cajonPattern.includes(subStepInBar);
        const inClap = clapPattern.includes(subStepInBar);
        const inLog = logPattern.includes(subStepInBar);
        const inTabla = tablaPattern.includes(subStepInBar);
        const inTimbale = timbalePattern.includes(subStepInBar);
        const inMisc = miscPattern.includes(subStepInBar);

        const hits = {
            kick: false, snare: false, hihat: false, ride: false, tom: false, conga: false, cymbal: false, clave: false,
            hat: false, cajon: false, clap: false, log: false, tabla: false, timbale: false, misc: false
        };

        if (cfg.kickOn && inKick) { hit('kick', 'C2', cfg.kickDecay, t, vel(0.85, stoch)); hits.kick = true; }
        if (cfg.snareOn && inSnare) { hit('snare', 'D3', cfg.snareDecay, t, vel(0.78, stoch)); hits.snare = true; }
        if (cfg.hatOn && inHat) { hit('hat', 'C5', cfg.hatDecay, t, vel(0.58, stoch)); hits.hihat = true; hits.hat = true; }
        if (cfg.rideOn && inRide) { hit('ride', 'C5', cfg.rideDecay, t + 0.003, vel(0.5, stoch)); hits.ride = true; }
        if (cfg.tomOn && inTom) { hit('tom', (subStepInBar % 8 === 6) ? 'D3' : 'A2', cfg.tomDecay, t, vel(0.72, stoch)); hits.tom = true; }
        if (cfg.cajonOn && inCajon) { hit('cajon', 'C4', cfg.cajonDecay, t - 0.002, vel(0.7, stoch)); hits.cajon = true; }
        if (cfg.clapOn && inClap) { hit('clap', 'C5', cfg.clapDecay, t, vel(0.6, stoch)); hits.clap = true; }
        if (cfg.logOn && inLog) { hit('log', 'C5', cfg.logDecay, t, vel(0.6, stoch)); hits.log = true; }
        if (cfg.tablaOn && inTabla) { hit('tabla', 'D4', cfg.tablaDecay, t, vel(0.62, stoch)); hits.tabla = true; }
        if (cfg.timbaleOn && inTimbale) { hit('timbale', 'F4', cfg.timbaleDecay, t, vel(0.64, stoch)); hits.timbale = true; }
        if (cfg.miscOn && inMisc) { hit('misc', 'E4', cfg.miscDecay, t, vel(0.58, stoch)); hits.misc = true; }

        // Compatibility fields for existing visual/event consumers.
        hits.conga = hits.cajon || hits.tabla || hits.timbale;
        hits.clave = hits.clap || hits.log;

        return (
            hits.kick || hits.snare || hits.hihat || hits.ride || hits.tom ||
            hits.cajon || hits.clap || hits.log || hits.tabla || hits.timbale || hits.misc
        ) ? hits : null;
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
                case 'hat':
                case 'hihat': if (!cfg.hatOn) return false; hit('hat', 'C5', cfg.hatDecay, t, 0.72); return true;
                case 'tom': if (!cfg.tomOn) return false; hit('tom', 'A2', cfg.tomDecay, t, 0.8); return true;
                case 'ride':
                case 'cymbal': if (!cfg.rideOn) return false; hit('ride', 'C4', cfg.rideDecay, t, 0.8); return true;
                case 'cajon':
                case 'conga': if (!cfg.cajonOn) return false; hit('cajon', 'C4', cfg.cajonDecay, t, 0.82); return true;
                case 'clap': if (!cfg.clapOn) return false; hit('clap', 'C5', cfg.clapDecay, t, 0.8); return true;
                case 'log':
                case 'clave': if (!cfg.logOn) return false; hit('log', 'C5', cfg.logDecay, t, 0.8); return true;
                case 'tabla': if (!cfg.tablaOn) return false; hit('tabla', 'D4', cfg.tablaDecay, t, 0.82); return true;
                case 'timbale': if (!cfg.timbaleOn) return false; hit('timbale', 'F4', cfg.timbaleDecay, t, 0.82); return true;
                case 'misc': if (!cfg.miscOn) return false; hit('misc', 'E4', cfg.miscDecay, t, 0.8); return true;
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
        previewDrumPiece('hat', t0 + (delta * 2));
        previewDrumPiece('tom', t0 + (delta * 3));
        previewDrumPiece('ride', t0 + (delta * 4));
        previewDrumPiece('cajon', t0 + (delta * 5));
        previewDrumPiece('clap', t0 + (delta * 6));
        previewDrumPiece('log', t0 + (delta * 7));
        previewDrumPiece('tabla', t0 + (delta * 8));
        previewDrumPiece('timbale', t0 + (delta * 9));
        previewDrumPiece('misc', t0 + (delta * 10));
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

