/**
 * 13_audio_controls.js — Audio Visual Settings panel
 * Handles dropdown setup and slider label updates for the audio playback section.
 */
(function() {
    'use strict';

    // Audio state object (exposed for future integration with Market Inventions)
    window.audioState = {
        upperWick: {
            enabled: true,
            volume: -23,
            instrument: 'harpsichord',
            rhythm: '4'
        },
        lowerWick: {
            enabled: true,
            volume: -17,
            instrument: 'acoustic_bass',
            rhythm: '2'
        },
        chordProgression: 'canon',
        displayNotes: true,
        sensitivity: 0.7,
        priceNoise: 6.9,
        syncOffset: 1190,
        glowDuration: 3,
        futureNotes: 0,
        playing: false
    };

    // Cache DOM elements
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

        // Chord progression
        chordProgressionDD: document.getElementById('audioChordProgressionDD'),
        chordProgressionBtn: document.getElementById('audioChordProgressionBtn'),
        chordProgressionMenu: document.getElementById('audioChordProgressionMenu'),
        chordProgressionLabel: document.getElementById('audioChordProgressionLabel'),
        displayNotesChk: document.getElementById('audioDisplayNotes'),

        // Sync tuning sliders
        sensitivity: document.getElementById('audioSensitivity'),
        sensitivityLabel: document.getElementById('audioSensitivityLabel'),
        priceNoise: document.getElementById('audioPriceNoise'),
        priceNoiseLabel: document.getElementById('audioPriceNoiseLabel'),
        syncOffset: document.getElementById('audioSyncOffset'),
        syncOffsetLabel: document.getElementById('audioSyncOffsetLabel'),
        glowDuration: document.getElementById('audioGlowDuration'),
        glowDurationLabel: document.getElementById('audioGlowDurationLabel'),
        futureNotes: document.getElementById('audioFutureNotes'),
        futureNotesLabel: document.getElementById('audioFutureNotesLabel'),

        // Playback controls
        startBtn: document.getElementById('audioStartBtn'),
        stopBtn: document.getElementById('audioStopBtn'),
        statusLabel: document.getElementById('audioStatus')
    };

    // Keep track of all audio dropdowns for closing others
    const allAudioDropdowns = [];

    /**
     * Generic dropdown setup (same pattern as 12_strategy_backtest.js)
     */
    function setupDropdown(dd, btn, menu, labelEl, onSelect) {
        if (!dd || !btn || !menu) return;

        allAudioDropdowns.push({ dd, btn });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dd.classList.toggle('open');
            btn.setAttribute('aria-expanded', isOpen);

            // Close other dropdowns
            if (isOpen) {
                allAudioDropdowns.forEach(({ dd: other, btn: otherBtn }) => {
                    if (other !== dd) {
                        other.classList.remove('open');
                        otherBtn.setAttribute('aria-expanded', 'false');
                    }
                });
            }
        });

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.ddItem');
            if (!item) return;

            const val = item.getAttribute('data-value');
            const text = item.textContent;

            // Update UI
            menu.querySelectorAll('.ddItem').forEach(i => i.classList.remove('sel'));
            item.classList.add('sel');
            dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');

            if (labelEl) labelEl.textContent = text;
            if (onSelect) onSelect(val, text);
        });
    }

    /**
     * Setup slider with label update
     */
    function setupSlider(slider, labelEl, suffix, stateKey, transform) {
        if (!slider || !labelEl) return;

        const updateLabel = () => {
            const val = parseFloat(slider.value);
            const displayVal = transform ? transform(val) : val;
            labelEl.textContent = displayVal + suffix;
            window.audioState[stateKey] = val;
        };

        slider.addEventListener('input', updateLabel);
        updateLabel(); // Initial
    }

    /**
     * Setup volume slider (special case: display as positive dB)
     */
    function setupVolumeSlider(slider, labelEl, wickType) {
        if (!slider || !labelEl) return;

        const updateLabel = () => {
            const val = parseInt(slider.value, 10);
            labelEl.textContent = Math.abs(val) + ' DB';
            window.audioState[wickType + 'Wick'].volume = val;
        };

        slider.addEventListener('input', updateLabel);
        updateLabel();
    }

    /**
     * Initialize all controls
     */
    function init() {
        // ===== Upper Wick =====
        if (ui.upperWickChk) {
            ui.upperWickChk.addEventListener('change', () => {
                window.audioState.upperWick.enabled = ui.upperWickChk.checked;
            });
        }

        setupVolumeSlider(ui.upperVolume, ui.upperVolumeLabel, 'upper');

        setupDropdown(
            ui.upperInstrumentDD, ui.upperInstrumentBtn, ui.upperInstrumentMenu, ui.upperInstrumentLabel,
            (val) => { window.audioState.upperWick.instrument = val; }
        );

        setupDropdown(
            ui.upperRhythmDD, ui.upperRhythmBtn, ui.upperRhythmMenu, ui.upperRhythmLabel,
            (val) => { window.audioState.upperWick.rhythm = val; }
        );

        // ===== Lower Wick =====
        if (ui.lowerWickChk) {
            ui.lowerWickChk.addEventListener('change', () => {
                window.audioState.lowerWick.enabled = ui.lowerWickChk.checked;
            });
        }

        setupVolumeSlider(ui.lowerVolume, ui.lowerVolumeLabel, 'lower');

        setupDropdown(
            ui.lowerInstrumentDD, ui.lowerInstrumentBtn, ui.lowerInstrumentMenu, ui.lowerInstrumentLabel,
            (val) => { window.audioState.lowerWick.instrument = val; }
        );

        setupDropdown(
            ui.lowerRhythmDD, ui.lowerRhythmBtn, ui.lowerRhythmMenu, ui.lowerRhythmLabel,
            (val) => { window.audioState.lowerWick.rhythm = val; }
        );

        // ===== Chord Progression =====
        setupDropdown(
            ui.chordProgressionDD, ui.chordProgressionBtn, ui.chordProgressionMenu, ui.chordProgressionLabel,
            (val) => { window.audioState.chordProgression = val; }
        );

        if (ui.displayNotesChk) {
            ui.displayNotesChk.addEventListener('change', () => {
                window.audioState.displayNotes = ui.displayNotesChk.checked;
            });
        }

        // ===== Sync Tuning Sliders =====
        setupSlider(ui.sensitivity, ui.sensitivityLabel, 'X', 'sensitivity', v => v.toFixed(1));
        setupSlider(ui.priceNoise, ui.priceNoiseLabel, 'X', 'priceNoise', v => v.toFixed(1));
        setupSlider(ui.syncOffset, ui.syncOffsetLabel, 'MS', 'syncOffset', v => Math.round(v));
        setupSlider(ui.glowDuration, ui.glowDurationLabel, ' UNITS', 'glowDuration', v => Math.round(v));
        setupSlider(ui.futureNotes, ui.futureNotesLabel, 'MS', 'futureNotes', v => Math.round(v));

        // ===== Playback Controls =====
        if (ui.startBtn) {
            ui.startBtn.addEventListener('click', () => {
                window.audioState.playing = true;
                ui.startBtn.disabled = true;
                ui.stopBtn.disabled = false;
                ui.statusLabel.textContent = 'Audio playing...';
                ui.statusLabel.style.color = '#2ecc71';

                // TODO: Connect to Market Inventions WebSocket audio engine
                console.log('[Audio] Start playback with config:', window.audioState);
            });
        }

        if (ui.stopBtn) {
            ui.stopBtn.addEventListener('click', () => {
                window.audioState.playing = false;
                ui.startBtn.disabled = false;
                ui.stopBtn.disabled = true;
                ui.statusLabel.textContent = 'Audio stopped';
                ui.statusLabel.style.color = '';

                // TODO: Disconnect from Market Inventions WebSocket
                console.log('[Audio] Stop playback');
            });
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            allAudioDropdowns.forEach(({ dd, btn }) => {
                dd.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            });
        });

        console.log('[Audio] Audio controls initialized');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
