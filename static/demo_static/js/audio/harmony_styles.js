/**
 * audio/harmony_styles.js — Inner Voice / Harmony Style Registry
 * Part of the Audio Visual Settings module.
 */
(function() {
    'use strict';
    const _am = window._audioModule = window._audioModule || {};

    // Offsets are semitones from the current chord root pitch class.
    // Range is constrained to avoid clashing with soprano/bass voices.
    const HARMONY_STYLES = {
        jazz_shell_voicings: {
            label: 'Jazz Shell (3rds & 7ths)',
            minMidi: 48, // C3
            maxMidi: 72, // C5
            bullish: [4, 11],
            bearish: [3, 10],
            doji: [7] // stable color on low-body candles
        },
        power_chords_thick: {
            label: 'Power Stacks (Root + 5th)',
            minMidi: 43, // G2
            maxMidi: 67, // G4
            bullish: [0, 7, 12],
            bearish: [0, 7, 12],
            doji: [7]
        },
        ambient_sustained_pad: {
            label: 'Ambient Tension',
            minMidi: 60, // C4
            maxMidi: 79, // G5
            bullish: [4, 7, 9],
            bearish: [3, 7, 8],
            doji: [7]
        },
        orchestral_strings: {
            label: 'Orchestral Fill',
            minMidi: 48, // C3
            maxMidi: 69, // A4
            bullish: [0, 4, 7, 11],
            bearish: [0, 3, 7, 10],
            doji: [0, 7]
        }
    };

    _am.HARMONY_STYLES = HARMONY_STYLES;
})();

