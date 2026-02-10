/**
 * audio/ui.js — UI Wiring, Settings Persistence & Initialization
 * Part of the Audio Visual Settings module (refactored from 13_audio_controls.js)
 *
 * Contains: Dropdown/slider setup, volume controls, settings save/load
 * (localStorage), settings-to-UI sync, init() entry point, and
 * keyboard shortcuts (spacebar toggle).
 */
(function() {
    'use strict';
    const _am = window._audioModule;

    // Dependencies
    const musicState = _am.musicState;
    const audioState = _am.audioState;
    const ui = _am.ui;
    const allAudioDropdowns = _am.allAudioDropdowns;
    const GENRES = _am.GENRES;
    const ROOT_KEY_OFFSETS = _am.ROOT_KEY_OFFSETS;
    const updateStatus = _am.updateStatus;
    const reloadSampler = _am.reloadSampler;
    const initAudioEngine = _am.initAudioEngine;
    const stopAudioEngine = _am.stopAudioEngine;
    const startAudioAnimation = _am.startAudioAnimation;
    const stopAudioAnimation = _am.stopAudioAnimation;
    const pauseAudioAnimation = _am.pauseAudioAnimation;
    const resumeAudioAnimation = _am.resumeAudioAnimation;
    const hookIntoReplaySystem = _am.hookIntoReplaySystem;
    const setDrumVolume = _am.setDrumVolume;

    // ========================================================================
    // GENERIC UI HELPERS
    // ========================================================================

    function setupDropdown(dd, btn, menu, labelEl, onSelect) {
        if (!dd || !btn || !menu) return;

        allAudioDropdowns.push({ dd, btn });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dd.classList.toggle('open');
            btn.setAttribute('aria-expanded', isOpen);

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

            menu.querySelectorAll('.ddItem').forEach(i => i.classList.remove('sel'));
            item.classList.add('sel');
            dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');

            if (labelEl) labelEl.textContent = text;
            if (onSelect) onSelect(val, text);
        });
    }

    function setupSlider(slider, labelEl, suffix, stateKey, transform) {
        if (!slider || !labelEl) return;

        const updateLabel = (shouldSave) => {
            if (shouldSave === undefined) shouldSave = false;
            const val = parseFloat(slider.value);
            const displayVal = transform ? transform(val) : val;
            labelEl.textContent = displayVal + suffix;
            audioState[stateKey] = val;
            if (shouldSave) saveSettings();
        };

        slider.addEventListener('input', () => updateLabel(true));
        updateLabel(false);
    }

    function setupVolumeSlider(slider, labelEl, wickType) {
        if (!slider || !labelEl) return;

        const updateLabel = (shouldSave) => {
            if (shouldSave === undefined) shouldSave = false;
            const val = parseInt(slider.value, 10);
            labelEl.textContent = Math.abs(val) + ' DB';
            audioState[wickType + 'Wick'].volume = val;

            // Update sampler volume if playing
            if (audioState.playing && audioState._initialized) {
                if (wickType === 'upper' && audioState._sopranoSampler) {
                    audioState._sopranoSampler.volume.value = val;
                } else if (wickType === 'lower' && audioState._bassSampler) {
                    audioState._bassSampler.volume.value = val;
                }
            }
            if (shouldSave) saveSettings();
        };

        slider.addEventListener('input', () => updateLabel(true));
        updateLabel(false);
    }

    // ========================================================================
    // SETTINGS PERSISTENCE (localStorage)
    // ========================================================================
    
    const STORAGE_KEY = 'ntree_audio_visual_settings';
    
    /**
     * Save current settings to localStorage
     */
    function saveSettings() {
        try {
            const settings = {
                upperWick: {
                    enabled: audioState.upperWick.enabled,
                    volume: audioState.upperWick.volume,
                    instrument: audioState.upperWick.instrument,
                    rhythm: audioState.upperWick.rhythm,
                    pattern: audioState.upperWick.pattern,
                    patternOverride: audioState.upperWick.patternOverride,
                    restartOnChord: audioState.upperWick.restartOnChord
                },
                lowerWick: {
                    enabled: audioState.lowerWick.enabled,
                    volume: audioState.lowerWick.volume,
                    instrument: audioState.lowerWick.instrument,
                    rhythm: audioState.lowerWick.rhythm,
                    pattern: audioState.lowerWick.pattern,
                    patternOverride: audioState.lowerWick.patternOverride,
                    restartOnChord: audioState.lowerWick.restartOnChord
                },
                genre: audioState.genre,
                rootKey: audioState.rootKey,
                chordProgression: audioState.chordProgression,
                drumBeat: audioState.drumBeat,
                drumVolume: audioState.drumVolume,
                displayNotes: audioState.displayNotes,
                chordOverlay: audioState.chordOverlay,
                sensitivity: audioState.sensitivity,
                melodicRange: audioState.melodicRange,
                glowDuration: audioState.glowDuration,
                displayMode: audioState.displayMode,
                panels: audioState.panels,
                speed: audioState._currentBpm || 60
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            console.log('[Audio] Settings saved');
        } catch (e) {
            console.warn('[Audio] Failed to save settings:', e);
        }
    }
    
    /**
     * Load settings from localStorage and apply to audioState
     */
    function loadSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return false;
            
            const settings = JSON.parse(stored);
            console.log('[Audio] Loading saved settings');
            
            // Apply to audioState
            if (settings.upperWick) {
                audioState.upperWick.enabled = settings.upperWick.enabled ?? true;
                audioState.upperWick.volume = settings.upperWick.volume ?? -23;
                audioState.upperWick.instrument = settings.upperWick.instrument || 'harpsichord';
                audioState.upperWick.rhythm = settings.upperWick.rhythm || '4';
                audioState.upperWick.pattern = settings.upperWick.pattern || 'scale_asc';
                audioState.upperWick.patternOverride = settings.upperWick.patternOverride ?? false;
                audioState.upperWick.restartOnChord = settings.upperWick.restartOnChord ?? true;
            }
            if (settings.lowerWick) {
                audioState.lowerWick.enabled = settings.lowerWick.enabled ?? true;
                audioState.lowerWick.volume = settings.lowerWick.volume ?? -17;
                audioState.lowerWick.instrument = settings.lowerWick.instrument || 'acoustic_bass';
                audioState.lowerWick.rhythm = settings.lowerWick.rhythm || '2';
                audioState.lowerWick.pattern = settings.lowerWick.pattern || 'root_only';
                audioState.lowerWick.patternOverride = settings.lowerWick.patternOverride ?? false;
                audioState.lowerWick.restartOnChord = settings.lowerWick.restartOnChord ?? true;
            }
            audioState.genre = settings.genre || 'classical';
            musicState.currentGenre = audioState.genre;  // Sync with musicState
            audioState.rootKey = settings.rootKey || 'C';
            musicState.rootMidi = 60 + (ROOT_KEY_OFFSETS[audioState.rootKey] || 0);  // Sync with musicState
            audioState.chordProgression = settings.chordProgression || 'canon';
            audioState.drumBeat = settings.drumBeat || 'simple';
            audioState.drumVolume = settings.drumVolume ?? -12;
            audioState.displayNotes = settings.displayNotes ?? true;
            audioState.chordOverlay = settings.chordOverlay ?? true;
            audioState.sensitivity = settings.sensitivity ?? 0.5;
            audioState.melodicRange = settings.melodicRange ?? 1.0;
            audioState.glowDuration = settings.glowDuration ?? 3;
            audioState.displayMode = settings.displayMode || 'bars';
            if (settings.panels) {
                audioState.panels.channels = settings.panels.channels ?? true;
                audioState.panels.genre = settings.panels.genre ?? true;
                audioState.panels.tuning = settings.panels.tuning ?? true;
                audioState.panels.playback = settings.panels.playback ?? true;
            }
            audioState._savedSpeed = settings.speed ?? 60;
            
            return true;
        } catch (e) {
            console.warn('[Audio] Failed to load settings:', e);
            return false;
        }
    }
    
    /**
     * Apply loaded settings to UI elements
     */
    function applySettingsToUI() {
        // Upper wick
        if (ui.upperWickChk) ui.upperWickChk.checked = audioState.upperWick.enabled;
        if (ui.upperVolume) {
            ui.upperVolume.value = audioState.upperWick.volume;
            if (ui.upperVolumeLabel) ui.upperVolumeLabel.textContent = audioState.upperWick.volume + ' DB';
        }
        applyDropdownSelection(ui.upperInstrumentMenu, ui.upperInstrumentLabel, audioState.upperWick.instrument);
        applyDropdownSelection(ui.upperRhythmMenu, ui.upperRhythmLabel, audioState.upperWick.rhythm);
        applyDropdownSelection(ui.sopranoPatternMenu, ui.sopranoPatternLabel, audioState.upperWick.pattern);
        if (ui.sopranoPatternOverrideChk) ui.sopranoPatternOverrideChk.checked = audioState.upperWick.patternOverride;
        if (ui.sopranoPatternDD) ui.sopranoPatternDD.style.opacity = audioState.upperWick.patternOverride ? '1' : '0.35';
        if (ui.sopranoPatternDD) ui.sopranoPatternDD.style.pointerEvents = audioState.upperWick.patternOverride ? 'auto' : 'none';
        if (ui.sopranoRestartOnChordChk) ui.sopranoRestartOnChordChk.checked = audioState.upperWick.restartOnChord;
        
        // Lower wick
        if (ui.lowerWickChk) ui.lowerWickChk.checked = audioState.lowerWick.enabled;
        if (ui.lowerVolume) {
            ui.lowerVolume.value = audioState.lowerWick.volume;
            if (ui.lowerVolumeLabel) ui.lowerVolumeLabel.textContent = audioState.lowerWick.volume + ' DB';
        }
        applyDropdownSelection(ui.lowerInstrumentMenu, ui.lowerInstrumentLabel, audioState.lowerWick.instrument);
        applyDropdownSelection(ui.lowerRhythmMenu, ui.lowerRhythmLabel, audioState.lowerWick.rhythm);
        applyDropdownSelection(ui.bassPatternMenu, ui.bassPatternLabel, audioState.lowerWick.pattern);
        if (ui.bassPatternOverrideChk) ui.bassPatternOverrideChk.checked = audioState.lowerWick.patternOverride;
        if (ui.bassPatternDD) ui.bassPatternDD.style.opacity = audioState.lowerWick.patternOverride ? '1' : '0.35';
        if (ui.bassPatternDD) ui.bassPatternDD.style.pointerEvents = audioState.lowerWick.patternOverride ? 'auto' : 'none';
        if (ui.bassRestartOnChordChk) ui.bassRestartOnChordChk.checked = audioState.lowerWick.restartOnChord;
        
        // Genre
        applyDropdownSelection(ui.genreMenu, ui.genreLabel, audioState.genre);
        
        // Root key
        applyDropdownSelection(ui.rootKeyMenu, ui.rootKeyLabel, audioState.rootKey);
        
        // Chord progression
        applyDropdownSelection(ui.chordProgressionMenu, ui.chordProgressionLabel, audioState.chordProgression);
        
        // Drum beat
        applyDropdownSelection(ui.drumBeatMenu, ui.drumBeatLabel, audioState.drumBeat);
        
        // Drum volume
        if (ui.drumVolume) {
            ui.drumVolume.value = audioState.drumVolume;
            if (ui.drumVolumeLabel) ui.drumVolumeLabel.textContent = Math.abs(audioState.drumVolume) + ' DB';
            if (setDrumVolume) setDrumVolume(audioState.drumVolume);
        }
        
        // Display mode
        applyDropdownSelection(ui.displayModeMenu, ui.displayModeLabel, audioState.displayMode);
        
        // Display notes checkbox
        if (ui.displayNotesChk) ui.displayNotesChk.checked = audioState.displayNotes;
        // Chord overlay checkbox
        if (ui.chordOverlayChk) ui.chordOverlayChk.checked = audioState.chordOverlay;
        
        // Sub-panel open/closed state
        if (ui.panelChannels) ui.panelChannels.open = audioState.panels.channels;
        if (ui.panelGenre) ui.panelGenre.open = audioState.panels.genre;
        if (ui.panelTuning) ui.panelTuning.open = audioState.panels.tuning;
        if (ui.panelPlayback) ui.panelPlayback.open = audioState.panels.playback;
        
        // Sliders
        if (ui.sensitivity) {
            ui.sensitivity.value = audioState.sensitivity;
            if (ui.sensitivityLabel) ui.sensitivityLabel.textContent = audioState.sensitivity.toFixed(2);
        }
        if (ui.melodicRange) {
            ui.melodicRange.value = audioState.melodicRange;
            if (ui.melodicRangeLabel) ui.melodicRangeLabel.textContent = audioState.melodicRange.toFixed(1) + 'X';
        }
        if (ui.glowDuration) {
            ui.glowDuration.value = audioState.glowDuration;
            if (ui.glowDurationLabel) ui.glowDurationLabel.textContent = Math.round(audioState.glowDuration) + ' UNITS';
        }
        if (ui.speed && audioState._savedSpeed) {
            ui.speed.value = audioState._savedSpeed;
            if (ui.speedLabel) ui.speedLabel.textContent = audioState._savedSpeed;
        }
    }
    
    /**
     * Helper to apply selection to a dropdown menu
     */
    function applyDropdownSelection(menu, label, value) {
        if (!menu) return;
        const items = menu.querySelectorAll('.ddItem');
        items.forEach(item => {
            if (item.getAttribute('data-value') === value) {
                item.classList.add('sel');
                if (label) label.textContent = item.textContent;
            } else {
                item.classList.remove('sel');
            }
        });
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    function init() {
        // Load saved settings first
        const hasSettings = loadSettings();
        if (hasSettings) {
            applySettingsToUI();
        }
        // Upper Wick controls
        if (ui.upperWickChk) {
            // Sync initial state from checkbox (only if no saved settings)
            if (!hasSettings) audioState.upperWick.enabled = ui.upperWickChk.checked;
            ui.upperWickChk.addEventListener('change', () => {
                audioState.upperWick.enabled = ui.upperWickChk.checked;
                console.log('[Audio] Upper wick enabled:', audioState.upperWick.enabled);
                saveSettings();
            });
        }
        setupVolumeSlider(ui.upperVolume, ui.upperVolumeLabel, 'upper');
        
        // Drum volume
        if (ui.drumVolume && ui.drumVolumeLabel) {
            const updateDrumLabel = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const val = parseInt(ui.drumVolume.value, 10);
                ui.drumVolumeLabel.textContent = Math.abs(val) + ' DB';
                audioState.drumVolume = val;
                if (setDrumVolume) setDrumVolume(val);
                if (shouldSave) saveSettings();
            };
            ui.drumVolume.addEventListener('input', () => updateDrumLabel(true));
            updateDrumLabel(false);
        }
        setupDropdown(ui.upperInstrumentDD, ui.upperInstrumentBtn, ui.upperInstrumentMenu, ui.upperInstrumentLabel,
            (val) => { 
                audioState.upperWick.instrument = val;
                saveSettings();
                // Reload sampler if playing
                if (audioState.playing && audioState._initialized) {
                    reloadSampler('soprano', val);
                }
            });
        setupDropdown(ui.upperRhythmDD, ui.upperRhythmBtn, ui.upperRhythmMenu, ui.upperRhythmLabel,
            (val) => { 
                audioState.upperWick.rhythm = val;
                console.log('[Audio] Upper rhythm changed to:', val);
                saveSettings();
            });
        setupDropdown(ui.sopranoPatternDD, ui.sopranoPatternBtn, ui.sopranoPatternMenu, ui.sopranoPatternLabel,
            (val) => {
                audioState.upperWick.pattern = val;
                console.log('[Audio] Soprano pattern changed to:', val);
                saveSettings();
            });
        if (ui.sopranoPatternOverrideChk) {
            if (!hasSettings) audioState.upperWick.patternOverride = ui.sopranoPatternOverrideChk.checked;
            ui.sopranoPatternOverrideChk.addEventListener('change', () => {
                audioState.upperWick.patternOverride = ui.sopranoPatternOverrideChk.checked;
                if (ui.sopranoPatternDD) {
                    ui.sopranoPatternDD.style.opacity = audioState.upperWick.patternOverride ? '1' : '0.35';
                    ui.sopranoPatternDD.style.pointerEvents = audioState.upperWick.patternOverride ? 'auto' : 'none';
                }
                console.log('[Audio] Soprano pattern override:', audioState.upperWick.patternOverride);
                saveSettings();
            });
        }
        if (ui.sopranoRestartOnChordChk) {
            if (!hasSettings) audioState.upperWick.restartOnChord = ui.sopranoRestartOnChordChk.checked;
            ui.sopranoRestartOnChordChk.addEventListener('change', () => {
                audioState.upperWick.restartOnChord = ui.sopranoRestartOnChordChk.checked;
                saveSettings();
            });
        }

        // Lower Wick controls
        if (ui.lowerWickChk) {
            // Sync initial state from checkbox (only if no saved settings)
            if (!hasSettings) audioState.lowerWick.enabled = ui.lowerWickChk.checked;
            ui.lowerWickChk.addEventListener('change', () => {
                audioState.lowerWick.enabled = ui.lowerWickChk.checked;
                console.log('[Audio] Lower wick enabled:', audioState.lowerWick.enabled);
                saveSettings();
            });
        }
        setupVolumeSlider(ui.lowerVolume, ui.lowerVolumeLabel, 'lower');
        setupDropdown(ui.lowerInstrumentDD, ui.lowerInstrumentBtn, ui.lowerInstrumentMenu, ui.lowerInstrumentLabel,
            (val) => { 
                audioState.lowerWick.instrument = val;
                saveSettings();
                // Reload sampler if playing
                if (audioState.playing && audioState._initialized) {
                    reloadSampler('bass', val);
                }
            });
        setupDropdown(ui.lowerRhythmDD, ui.lowerRhythmBtn, ui.lowerRhythmMenu, ui.lowerRhythmLabel,
            (val) => { 
                audioState.lowerWick.rhythm = val;
                console.log('[Audio] Lower rhythm changed to:', val);
                saveSettings();
            });
        setupDropdown(ui.bassPatternDD, ui.bassPatternBtn, ui.bassPatternMenu, ui.bassPatternLabel,
            (val) => {
                audioState.lowerWick.pattern = val;
                console.log('[Audio] Bass pattern changed to:', val);
                saveSettings();
            });
        if (ui.bassPatternOverrideChk) {
            if (!hasSettings) audioState.lowerWick.patternOverride = ui.bassPatternOverrideChk.checked;
            ui.bassPatternOverrideChk.addEventListener('change', () => {
                audioState.lowerWick.patternOverride = ui.bassPatternOverrideChk.checked;
                if (ui.bassPatternDD) {
                    ui.bassPatternDD.style.opacity = audioState.lowerWick.patternOverride ? '1' : '0.35';
                    ui.bassPatternDD.style.pointerEvents = audioState.lowerWick.patternOverride ? 'auto' : 'none';
                }
                console.log('[Audio] Bass pattern override:', audioState.lowerWick.patternOverride);
                saveSettings();
            });
        }
        if (ui.bassRestartOnChordChk) {
            if (!hasSettings) audioState.lowerWick.restartOnChord = ui.bassRestartOnChordChk.checked;
            ui.bassRestartOnChordChk.addEventListener('change', () => {
                audioState.lowerWick.restartOnChord = ui.bassRestartOnChordChk.checked;
                saveSettings();
            });
        }

        // Genre Selection
        setupDropdown(ui.genreDD, ui.genreBtn, ui.genreMenu, ui.genreLabel,
            (val) => { 
                audioState.genre = val;
                musicState.currentGenre = val;
                const genre = GENRES[val];
                console.log(`[Audio] Scale changed to: ${genre ? genre.label : val}`);
                saveSettings();
            });
        
        // Root Key
        setupDropdown(ui.rootKeyDD, ui.rootKeyBtn, ui.rootKeyMenu, ui.rootKeyLabel,
            (val) => {
                audioState.rootKey = val;
                musicState.rootMidi = 60 + (ROOT_KEY_OFFSETS[val] || 0);
                console.log(`[Audio] Root key changed to: ${val} (MIDI root: ${musicState.rootMidi})`);
                saveSettings();
            });

        // Chord Progression
        setupDropdown(ui.chordProgressionDD, ui.chordProgressionBtn, ui.chordProgressionMenu, ui.chordProgressionLabel,
            (val) => { 
                audioState.chordProgression = val; 
                saveSettings();
            });

        // Drum Beat
        setupDropdown(ui.drumBeatDD, ui.drumBeatBtn, ui.drumBeatMenu, ui.drumBeatLabel,
            (val) => { 
                audioState.drumBeat = val; 
                saveSettings();
            });

        if (ui.displayNotesChk) {
            // Sync initial state (only if no saved settings)
            if (!hasSettings) audioState.displayNotes = ui.displayNotesChk.checked;
            ui.displayNotesChk.addEventListener('change', () => {
                audioState.displayNotes = ui.displayNotesChk.checked;
                saveSettings();
            });
        }

        if (ui.chordOverlayChk) {
            if (!hasSettings) audioState.chordOverlay = ui.chordOverlayChk.checked;
            ui.chordOverlayChk.addEventListener('change', () => {
                audioState.chordOverlay = ui.chordOverlayChk.checked;
                saveSettings();
            });
        }

        // Sub-panel toggle persistence
        const panelMap = [
            { el: ui.panelChannels, key: 'channels' },
            { el: ui.panelGenre,    key: 'genre' },
            { el: ui.panelTuning,   key: 'tuning' },
            { el: ui.panelPlayback, key: 'playback' }
        ];
        panelMap.forEach(({ el, key }) => {
            if (el) {
                el.addEventListener('toggle', () => {
                    audioState.panels[key] = el.open;
                    saveSettings();
                });
            }
        });

        // Tuning sliders
        setupSlider(ui.sensitivity, ui.sensitivityLabel, '', 'sensitivity', v => v.toFixed(2));
        setupSlider(ui.melodicRange, ui.melodicRangeLabel, 'X', 'melodicRange', v => v.toFixed(1));
        setupSlider(ui.glowDuration, ui.glowDurationLabel, ' UNITS', 'glowDuration', v => Math.round(v));

        // Display Mode dropdown
        setupDropdown(ui.displayModeDD, ui.displayModeBtn, ui.displayModeMenu, ui.displayModeLabel,
            (val) => {
                audioState.displayMode = val;
                saveSettings();
            });

        // Speed slider - directly controls animation/audio tempo
        if (ui.speed) {
            const updateSpeedLabel = () => {
                const val = parseInt(ui.speed.value, 10);
                if (ui.speedLabel) ui.speedLabel.textContent = val;
            };
            updateSpeedLabel();
            
            ui.speed.addEventListener('input', () => {
                updateSpeedLabel();
                const bpm = parseInt(ui.speed.value, 10);
                // Update live during playback
                audioState._barsPerMs = bpm / 60000;
                audioState._currentBpm = bpm;
                console.log('[Audio] Speed updated to', bpm, 'BPM, barsPerMs:', audioState._barsPerMs.toFixed(6));
                saveSettings();
            });
        }

        // ── Helper: update start button appearance for play state ──
        function setStartBtnState(mode) {
            if (!ui.startBtn) return;
            if (mode === 'playing') {
                // Currently playing → button offers "Pause"
                ui.startBtn.textContent = 'Pause';
                ui.startBtn.style.background = '#2ecc71';  // Green
                ui.startBtn.disabled = false;
            } else if (mode === 'paused') {
                // Currently paused → button offers "Resume"
                ui.startBtn.textContent = 'Resume';
                ui.startBtn.style.background = '#ff69b4';  // Pink (same as start)
                ui.startBtn.disabled = false;
            } else {
                // Idle → button offers "Start Audio"
                ui.startBtn.textContent = 'Start Audio';
                ui.startBtn.style.background = '#ff69b4';  // Pink
                ui.startBtn.disabled = false;
            }
        }

        // Playback controls — Start / Pause / Resume tri-state button
        if (ui.startBtn) {
            ui.startBtn.addEventListener('click', async () => {
                // ── STATE 1: Currently playing → PAUSE ──
                if (audioState.playing && !audioState.paused) {
                    audioState.paused = true;
                    pauseAudioAnimation();
                    setStartBtnState('paused');
                    updateStatus('Paused');
                    return;
                }

                // ── STATE 2: Currently paused → RESUME ──
                if (audioState.playing && audioState.paused) {
                    audioState.paused = false;
                    resumeAudioAnimation();
                    setStartBtnState('playing');
                    updateStatus('Playing...');
                    return;
                }

                // ── STATE 3: Idle → START ──
                ui.startBtn.disabled = true;
                updateStatus('Initializing...');

                const success = await initAudioEngine();
                if (success) {
                    audioState.playing = true;
                    audioState.paused = false;
                    ui.stopBtn.disabled = false;
                    
                    // Start the independent animation loop
                    startAudioAnimation();
                    setStartBtnState('playing');
                } else {
                    setStartBtnState('idle');
                }
            });
        }

        // Reset button — full stop, dispose engine, return to idle
        if (ui.stopBtn) {
            ui.stopBtn.addEventListener('click', () => {
                stopAudioAnimation();
                stopAudioEngine();
                audioState.paused = false;
                setStartBtnState('idle');
                ui.stopBtn.disabled = true;
                updateStatus('Audio stopped');
                
                // Clear playhead
                window._audioPlayheadIndex = null;
                if (typeof window.requestDraw === 'function') {
                    window.requestDraw('audio_stop');
                }
            });
        }

        // Spacebar to toggle audio playback (Start / Pause / Resume)
        document.addEventListener('keydown', async (e) => {
            // Only respond to spacebar, ignore if user is typing in an input
            if (e.code !== 'Space' && e.key !== ' ') return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Prevent page scroll
            e.preventDefault();
            
            // Spacebar toggles Start ↔ Pause (not Reset)
            if (ui.startBtn && !ui.startBtn.disabled) {
                ui.startBtn.click();
            }
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            allAudioDropdowns.forEach(({ dd, btn }) => {
                dd.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            });
        });

        // Register the replay hook callback immediately
        hookIntoReplaySystem();

        // Check if Tone.js is available
        if (typeof Tone === 'undefined') {
            console.warn('[Audio] Tone.js not detected at init time - audio will not work');
            updateStatus('Tone.js not loaded');
            if (ui.startBtn) ui.startBtn.disabled = true;
        } else {
            console.log('[Audio] Tone.js detected:', Tone.version || 'version unknown');
        }

        console.log('[Audio] Audio controls initialized');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
