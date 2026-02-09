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

    // ========================================================================
    // AUDIO STATE (window-exposed for renderer compatibility)
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
