/**
 * audio/config.js — Audio Configuration Constants
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: Instrument definitions, note ranges, chord progressions,
 * chord maps, genre scale configs, and musical constants.
 */
(function() {
    'use strict';
    const _am = window._audioModule = window._audioModule || {};

    // ========================================================================
    // INSTRUMENT DEFINITIONS
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
        slide_guitar: {
            label: "Slide Guitar",
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
            baseUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_brass_1-mp3/"
        }
    };

    // ========================================================================
    // NOTE RANGE CONFIGURATION
    // ========================================================================

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
    // CHORD PROGRESSIONS & MAPS
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
            MAJOR: [1, 5, 1, 1, 4, 4, 4, 4, 1, 1, 5, 5, 4, 4, 1, 5],
            MINOR: [1, 5, 1, 1, 4, 4, 4, 4, 1, 1, 5, 5, 4, 4, 1, 5]
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
        },
        old: {
            // D F C G | D F C F | D F C G | D C F G  (key of C)
            MAJOR: [2, 4, 1, 5, 2, 4, 1, 4, 2, 4, 1, 5, 2, 1, 4, 5],
            MINOR: [2, 4, 1, 5, 2, 4, 1, 4, 2, 4, 1, 5, 2, 1, 4, 5]
        },
        bridge: {
            // Verse: I-V-vi-IV  |  Chorus: ii-I-V-ii
            // (E B C#m A | F#m E B F#m in key of E)
            MAJOR: [1, 1, 5, 5, 6, 6, 4, 4, 2, 2, 1, 1, 5, 5, 2, 2],
            MINOR: [1, 1, 5, 5, 6, 6, 4, 4, 2, 2, 1, 1, 5, 5, 2, 2]
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

    // ========================================================================
    // GENRE & SCALE CONFIGURATIONS
    // ========================================================================

    // Genre-based scale configurations
    // Each genre has two scales: one for uptrend, one for downtrend
    const GENRES = {
        classical: {
            label: "Major / Natural Minor",
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
            label: "Lydian / Phrygian (Raag)",
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
            label: "Dorian / Altered",
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
            label: "Pentatonic (Major / Minor)",
            scales: { 
                UPTREND: [0, 2, 4, 7, 9],           // Major Pentatonic (C D E G A)
                DOWNTREND: [0, 3, 5, 7, 10]         // Minor Pentatonic (C Eb F G Bb)
            },
            complexity: {
                blueNoteChance: 0.15,      // Add blue notes (b3, b5, b7)
                bendChance: 0.10,          // String bend simulation
                slideChance: 0.08
            }
        },
        techno_experimental: {
            label: "Phrygian / Chromatic",
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

    // ========================================================================
    // KICK DRUM CONFIG
    // ========================================================================

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
    // EXPORTS
    // ========================================================================

    _am.INSTRUMENT_MAP = INSTRUMENT_MAP;
    _am.NOTE_CONFIG = NOTE_CONFIG;
    _am.CHORD_PROGRESSIONS = CHORD_PROGRESSIONS;
    _am.CHORD_MAP_MAJOR = CHORD_MAP_MAJOR;
    _am.CHORD_MAP_MINOR = CHORD_MAP_MINOR;
    _am.GENRES = GENRES;
    _am.SCALES = SCALES;
    _am.ROOT_KEY_OFFSETS = ROOT_KEY_OFFSETS;
    _am.KICK_CONFIG = KICK_CONFIG;
})();
