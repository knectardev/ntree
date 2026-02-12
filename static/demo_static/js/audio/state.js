/**
 * audio/state.js — Shared State Objects & Small Utilities
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: musicState, audioState (window-exposed), ui DOM cache,
 * and small utility functions used across all audio sub-modules.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    // ========================================================================
    // MUSIC THEORY STATE
    // ========================================================================

    // Music theory state
    const musicState = {
        regime: 'UPTREND',  // Now uses UPTREND/DOWNTREND to match genre scales
        currentGenre: 'classical',  // Default genre
        consecutiveDownBars: 0,
        consecutiveUpBars: 0,
        prevBarClose: null,
        regimeSwitchThreshold: 3,
        // Use a pre-advance sentinel so the first bar boundary lands on step 0.
        progressionStep: 15,
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

    // ========================================================================
    // AUDIO STATE (window-exposed for renderer compatibility)
    // ========================================================================

    window.audioState = {
        upperWick: {
            enabled: true,
            volume: -18,
            instrument: 'harpsichord',
            rhythm: '4',  // Quarter notes
            pattern: 'scale_asc',        // Voice pattern: scale_asc, scale_asc_desc, arp_asc, arp_asc_desc, scale_arp_alt, random_chord
            patternOverride: false,      // When true, pattern overrides the deep pathfinder algorithm
            restartOnChord: true         // When true, pattern resets to chord root on chord change
        },
        harmony: {
            enabled: true,
            volume: -16,
            instrument: 'electric_piano',
            rhythm: '4', // Quarter notes
            style: 'jazz_shell_voicings',
            bodySensitivity: 1.0,
            dojiThreshold: 0.14,
            maxVoices: 3
        },
        drumVolume: -12,
        drumNaturalRoom: true, // Enable room/transient realism layer on drums
        drumGlowIntensity: 1.0, // Visual multiplier for drum-strip glow brightness
        drumKit: {
            kickOn: true,
            snareOn: true,
            hatOn: true,
            tomOn: true,
            rideOn: true,
            cajonOn: true,
            clapOn: true,
            logOn: true,
            tablaOn: true,
            timbaleOn: true,
            miscOn: true,
            kickLevel: 0,
            snareLevel: 0,
            hatLevel: 0,
            tomLevel: -2,
            rideLevel: -2,
            cajonLevel: -2,
            clapLevel: -3,
            logLevel: -4,
            tablaLevel: -2,
            timbaleLevel: -2,
            miscLevel: -6,
            kickDecay: 0.28,
            snareDecay: 0.14,
            hatDecay: 0.08,
            tomDecay: 0.20,
            rideDecay: 0.32,
            cajonDecay: 0.26,
            clapDecay: 0.12,
            logDecay: 0.10,
            tablaDecay: 0.24,
            timbaleDecay: 0.24,
            miscDecay: 0.16
        },
        lowerWick: {
            enabled: true,
            volume: -18,
            instrument: 'acoustic_bass',
            rhythm: '2',  // Half notes
            pattern: 'root_only',        // Voice pattern: root_only, root_3rd_5th
            patternOverride: false,      // When true, pattern overrides the deep pathfinder algorithm
            restartOnChord: true         // When true, pattern resets to chord root on chord change
        },
        genre: 'classical',
        harmonicAwareScale: true, // When true, build chord-aware melodic pools per progression step
        rootKey: 'C',           // Root key for scales and chord progressions (C, C#, D, ... B)
        chordProgression: 'canon',
        bassLineStyle: 'walking_bass_jazz',
        drumBeat: 'standard_11piece',
        displayNotes: true,
        chordOverlay: true,     // Show chord progression overlay on chart
        sensitivity: 0.5,       // Repurposed: Complexity/Stochasticism (0=pure, 1=chaotic)
        beatStochasticity: 0,   // 0-1: humanization for drums (dropouts, ghost notes, velocity, micro-timing)
        rhythmDensity: 8,       // 1-16: Euclidean pulses per bar for rhythmic phrasing
        sustainFactor: 0.35,    // 0-1: tie/legato aggressiveness when pitch is stable
        phrasingApplyToBass: false, // When true, Euclidean/tie/dynamic-duration phrasing is also applied to bass
        melodicRange: 1.0,     // Vertical Zoom: expands/compresses price-to-MIDI mapping
        glowDuration: 3,
        displayMode: 'bars',    // 'bars' (horizontal bars) or 'circles' (radius = note duration)
        panels: {               // Sub-panel open/closed state
            channels: true,
            harmony: true,
            drumKit: true,
            genre: true,
            tuning: true,
            playback: true
        },
        playing: false,
        paused: false,          // True when playback is paused (engine stays initialized)
        
        // Internal Tone.js state
        _initialized: false,
        _sopranoSampler: null,
        _harmonySampler: null,
        _bassSampler: null,
        _kickSynth: null,
        _transportStarted: false,
        _lastBarIndex: -1,
        _priceRange: { min: 0, max: 100 },  // Updated from data
        _lastSopranoMidi: null,
        _lastHarmonyMidi: null,
        _lastBassMidi: null,
        
        // Animation state
        _animationRunning: false,
        _animationFrame: null,
        _animationIndex: 0,
        _lastAnimTime: 0,
        _msPerBar: 1000  // Default: 1 second per bar
    };

    const audioState = window.audioState;

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
        sopranoPatternOverrideChk: document.getElementById('audioSopranoPatternOverride'),
        sopranoRestartOnChordChk: document.getElementById('audioSopranoRestartOnChord'),
        sopranoPatternDD: document.getElementById('audioSopranoPatternDD'),
        sopranoPatternBtn: document.getElementById('audioSopranoPatternBtn'),
        sopranoPatternMenu: document.getElementById('audioSopranoPatternMenu'),
        sopranoPatternLabel: document.getElementById('audioSopranoPatternLabel'),
        harmonyChk: document.getElementById('audioHarmonyOn'),
        harmonyVolume: document.getElementById('audioHarmonyVolume'),
        harmonyVolumeLabel: document.getElementById('audioHarmonyVolumeLabel'),
        harmonyInstrumentDD: document.getElementById('audioHarmonyInstrumentDD'),
        harmonyInstrumentBtn: document.getElementById('audioHarmonyInstrumentBtn'),
        harmonyInstrumentMenu: document.getElementById('audioHarmonyInstrumentMenu'),
        harmonyInstrumentLabel: document.getElementById('audioHarmonyInstrumentLabel'),
        harmonyRhythmDD: document.getElementById('audioHarmonyRhythmDD'),
        harmonyRhythmBtn: document.getElementById('audioHarmonyRhythmBtn'),
        harmonyRhythmMenu: document.getElementById('audioHarmonyRhythmMenu'),
        harmonyRhythmLabel: document.getElementById('audioHarmonyRhythmLabel'),
        harmonyStyleDD: document.getElementById('audioHarmonyStyleDD'),
        harmonyStyleBtn: document.getElementById('audioHarmonyStyleBtn'),
        harmonyStyleMenu: document.getElementById('audioHarmonyStyleMenu'),
        harmonyStyleLabel: document.getElementById('audioHarmonyStyleLabel'),
        harmonyBodySensitivity: document.getElementById('audioHarmonyBodySensitivity'),
        harmonyBodySensitivityLabel: document.getElementById('audioHarmonyBodySensitivityLabel'),
        harmonyDojiThreshold: document.getElementById('audioHarmonyDojiThreshold'),
        harmonyDojiThresholdLabel: document.getElementById('audioHarmonyDojiThresholdLabel'),
        harmonyMaxVoices: document.getElementById('audioHarmonyMaxVoices'),
        harmonyMaxVoicesLabel: document.getElementById('audioHarmonyMaxVoicesLabel'),

        // Lower wick
        lowerWickChk: document.getElementById('audioLowerWick'),
        lowerVolume: document.getElementById('audioLowerVolume'),
        lowerVolumeLabel: document.getElementById('audioLowerVolumeLabel'),
        drumVolume: document.getElementById('audioDrumVolume'),
        drumVolumeLabel: document.getElementById('audioDrumVolumeLabel'),
        drumNaturalRoomChk: document.getElementById('audioDrumNaturalRoom'),
        drumGlowIntensity: document.getElementById('audioDrumGlowIntensity'),
        drumGlowIntensityLabel: document.getElementById('audioDrumGlowIntensityLabel'),
        kickOn: document.getElementById('audioKickOn'),
        snareOn: document.getElementById('audioSnareOn'),
        hatOn: document.getElementById('audioHatOn'),
        tomOn: document.getElementById('audioTomOn'),
        rideOn: document.getElementById('audioRideOn'),
        cajonOn: document.getElementById('audioCajonOn'),
        clapOn: document.getElementById('audioClapOn'),
        logOn: document.getElementById('audioLogOn'),
        tablaOn: document.getElementById('audioTablaOn'),
        timbaleOn: document.getElementById('audioTimbaleOn'),
        miscOn: document.getElementById('audioMiscOn'),
        kickLevel: document.getElementById('audioKickLevel'),
        kickLevelLabel: document.getElementById('audioKickLevelLabel'),
        snareLevel: document.getElementById('audioSnareLevel'),
        snareLevelLabel: document.getElementById('audioSnareLevelLabel'),
        hatLevel: document.getElementById('audioHatLevel'),
        hatLevelLabel: document.getElementById('audioHatLevelLabel'),
        tomLevel: document.getElementById('audioTomLevel'),
        tomLevelLabel: document.getElementById('audioTomLevelLabel'),
        rideLevel: document.getElementById('audioRideLevel'),
        rideLevelLabel: document.getElementById('audioRideLevelLabel'),
        cajonLevel: document.getElementById('audioCajonLevel'),
        cajonLevelLabel: document.getElementById('audioCajonLevelLabel'),
        clapLevel: document.getElementById('audioClapLevel'),
        clapLevelLabel: document.getElementById('audioClapLevelLabel'),
        logLevel: document.getElementById('audioLogLevel'),
        logLevelLabel: document.getElementById('audioLogLevelLabel'),
        tablaLevel: document.getElementById('audioTablaLevel'),
        tablaLevelLabel: document.getElementById('audioTablaLevelLabel'),
        timbaleLevel: document.getElementById('audioTimbaleLevel'),
        timbaleLevelLabel: document.getElementById('audioTimbaleLevelLabel'),
        miscLevel: document.getElementById('audioMiscLevel'),
        miscLevelLabel: document.getElementById('audioMiscLevelLabel'),
        kickDecay: document.getElementById('audioKickDecay'),
        kickDecayLabel: document.getElementById('audioKickDecayLabel'),
        snareDecay: document.getElementById('audioSnareDecay'),
        snareDecayLabel: document.getElementById('audioSnareDecayLabel'),
        hatDecay: document.getElementById('audioHatDecay'),
        hatDecayLabel: document.getElementById('audioHatDecayLabel'),
        tomDecay: document.getElementById('audioTomDecay'),
        tomDecayLabel: document.getElementById('audioTomDecayLabel'),
        rideDecay: document.getElementById('audioRideDecay'),
        rideDecayLabel: document.getElementById('audioRideDecayLabel'),
        cajonDecay: document.getElementById('audioCajonDecay'),
        cajonDecayLabel: document.getElementById('audioCajonDecayLabel'),
        clapDecay: document.getElementById('audioClapDecay'),
        clapDecayLabel: document.getElementById('audioClapDecayLabel'),
        logDecay: document.getElementById('audioLogDecay'),
        logDecayLabel: document.getElementById('audioLogDecayLabel'),
        tablaDecay: document.getElementById('audioTablaDecay'),
        tablaDecayLabel: document.getElementById('audioTablaDecayLabel'),
        timbaleDecay: document.getElementById('audioTimbaleDecay'),
        timbaleDecayLabel: document.getElementById('audioTimbaleDecayLabel'),
        miscDecay: document.getElementById('audioMiscDecay'),
        miscDecayLabel: document.getElementById('audioMiscDecayLabel'),
        lowerInstrumentDD: document.getElementById('audioLowerInstrumentDD'),
        lowerInstrumentBtn: document.getElementById('audioLowerInstrumentBtn'),
        lowerInstrumentMenu: document.getElementById('audioLowerInstrumentMenu'),
        lowerInstrumentLabel: document.getElementById('audioLowerInstrumentLabel'),
        lowerRhythmDD: document.getElementById('audioLowerRhythmDD'),
        lowerRhythmBtn: document.getElementById('audioLowerRhythmBtn'),
        lowerRhythmMenu: document.getElementById('audioLowerRhythmMenu'),
        lowerRhythmLabel: document.getElementById('audioLowerRhythmLabel'),
        bassPatternOverrideChk: document.getElementById('audioBassPatternOverride'),
        bassRestartOnChordChk: document.getElementById('audioBassRestartOnChord'),
        bassPatternDD: document.getElementById('audioBassPatternDD'),
        bassPatternBtn: document.getElementById('audioBassPatternBtn'),
        bassPatternMenu: document.getElementById('audioBassPatternMenu'),
        bassPatternLabel: document.getElementById('audioBassPatternLabel'),

        // Genre selection
        genreDD: document.getElementById('audioGenreDD'),
        genreBtn: document.getElementById('audioGenreBtn'),
        genreMenu: document.getElementById('audioGenreMenu'),
        genreLabel: document.getElementById('audioGenreLabel'),
        harmonicAwareScaleChk: document.getElementById('audioHarmonicAwareScale'),

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
        bassLineStyleDD: document.getElementById('audioBassLineStyleDD'),
        bassLineStyleBtn: document.getElementById('audioBassLineStyleBtn'),
        bassLineStyleMenu: document.getElementById('audioBassLineStyleMenu'),
        bassLineStyleLabel: document.getElementById('audioBassLineStyleLabel'),
        drumBeatDD: document.getElementById('audioDrumBeatDD'),
        drumBeatBtn: document.getElementById('audioDrumBeatBtn'),
        drumBeatMenu: document.getElementById('audioDrumBeatMenu'),
        drumBeatLabel: document.getElementById('audioDrumBeatLabel'),
        displayNotesChk: document.getElementById('audioDisplayNotes'),
        chordOverlayChk: document.getElementById('audioChordOverlay'),

        // Sync tuning sliders
        sensitivity: document.getElementById('audioSensitivity'),
        sensitivityLabel: document.getElementById('audioSensitivityLabel'),
        beatStochasticity: document.getElementById('audioBeatStochasticity'),
        beatStochasticityLabel: document.getElementById('audioBeatStochasticityLabel'),
        rhythmDensity: document.getElementById('audioRhythmDensity'),
        rhythmDensityLabel: document.getElementById('audioRhythmDensityLabel'),
        sustainFactor: document.getElementById('audioSustainFactor'),
        sustainFactorLabel: document.getElementById('audioSustainFactorLabel'),
        phrasingApplyBassChk: document.getElementById('audioPhrasingApplyBass'),
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
        panelHarmony: document.getElementById('audioPanelHarmony'),
        panelDrumKit: document.getElementById('audioPanelDrumKit'),
        panelGenre: document.getElementById('audioPanelGenre'),
        panelTuning: document.getElementById('audioPanelTuning'),
        panelPlayback: document.getElementById('audioPanelPlayback'),
        
        // Speed control
        speed: document.getElementById('audioSpeed'),
        speedLabel: document.getElementById('audioSpeedLabel'),

        // Playback controls
        startBtn: document.getElementById('audioStartBtn'),
        stopBtn: document.getElementById('audioStopBtn'),
        statusLabel: document.getElementById('audioStatus'),
        copyUrlBtn: document.getElementById('audioCopyUrlBtn')
    };

    // Track all audio dropdowns
    const allAudioDropdowns = [];

    // ========================================================================
    // SMALL UTILITIES (used across all audio sub-modules)
    // ========================================================================

    /**
     * Update the status label text and color
     */
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

    /**
     * Convert MIDI note number to note name
     */
    function midiToNoteName(midi) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const note = noteNames[midi % 12];
        return note + octave;
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
    // WINDOW EXPORTS (backward compat with renderer)
    // ========================================================================

    window._midiToNoteName = midiToNoteName;
    window._musicState = musicState;

    // ========================================================================
    // MODULE EXPORTS
    // ========================================================================

    _am.musicState = musicState;
    _am.audioState = audioState;
    _am.ui = ui;
    _am.allAudioDropdowns = allAudioDropdowns;
    _am.updateStatus = updateStatus;
    _am.midiToNoteName = midiToNoteName;
    _am.rhythmToDuration = rhythmToDuration;
    _am.rhythmToDurationMs = rhythmToDurationMs;
})();
