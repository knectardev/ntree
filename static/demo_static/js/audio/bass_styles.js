/**
 * audio/bass_styles.js — Bass Line Style Registry
 * Part of the Audio Visual Settings module.
 *
 * Contains: selectable bass line styles and helper accessors.
 * These style presets are consumed by pathfinder.js walking-bass logic.
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    const DEFAULT_BASS_LINE_STYLE = 'walking_bass_jazz';

    // Pattern values are semitone offsets from the current target note.
    // walkUp is used for walk_up mode; walkDown for walk_down mode.
    const BASS_LINE_STYLES = {
        walking_bass_jazz: {
            label: 'Walking Bass (Jazz Swing / Bebop)',
            inspiration: 'Ray Brown',
            walkUp: [0, 7, 5, 1],
            walkDown: [0, -5, -7, -1]
        },
        bluegrass_old_time: {
            label: 'Bluegrass / Old-Time Bass',
            inspiration: 'Mike Bub',
            walkUp: [0, 7, 12, 7],
            walkDown: [0, -7, -12, -7]
        },
        baroque_counterpoint: {
            label: 'Baroque Counterpoint / Bach-Style Lines',
            inspiration: 'Bach',
            walkUp: [0, 4, 7, 11],
            walkDown: [0, -4, -7, -11]
        },
        motown_soul: {
            label: 'Motown / Soul Groove Bass',
            inspiration: 'James Jamerson',
            walkUp: [0, 2, 4, 7],
            walkDown: [0, -2, -4, -7]
        },
        reggae_dub: {
            label: 'Reggae / Dub One-Drop Bass',
            inspiration: 'Aston Barrett',
            walkUp: [0, 0, 7, 0],
            walkDown: [0, 0, -7, 0]
        },
        latin_afrocuban: {
            label: 'Latin / Afro-Cuban Tumbao',
            inspiration: 'Cachao Lopez',
            walkUp: [0, 7, 10, 12],
            walkDown: [0, -7, -10, -12]
        },
        afrobeat_polyrhythmic: {
            label: 'Afrobeat / Polyrhythmic Bass',
            inspiration: 'Fela Kuti',
            walkUp: [0, 7, 9, 5],
            walkDown: [0, -7, -9, -5]
        },
        pop_rock_melodic: {
            label: 'Pop / Rock Melodic Bass',
            inspiration: 'Paul McCartney',
            walkUp: [0, 4, 5, 7],
            walkDown: [0, -4, -5, -7]
        },
        electronic_synth: {
            label: 'Electronic / Synth Bass (EDM / Trap / House)',
            inspiration: 'Deadmau5',
            walkUp: [0, 12, 0, -12],
            walkDown: [0, -12, 0, 12]
        },
        minimal_pedal_drone: {
            label: 'Minimal / Pedal Tone / Drone Bass',
            inspiration: 'Brian Eno',
            walkUp: [0, 0, 0, 0],
            walkDown: [0, 0, 0, 0]
        }
    };

    function getBassLineStyle(styleKey) {
        return BASS_LINE_STYLES[styleKey] || BASS_LINE_STYLES[DEFAULT_BASS_LINE_STYLE];
    }

    _am.BASS_LINE_STYLES = BASS_LINE_STYLES;
    _am.DEFAULT_BASS_LINE_STYLE = DEFAULT_BASS_LINE_STYLE;
    _am.getBassLineStyle = getBassLineStyle;
})();
