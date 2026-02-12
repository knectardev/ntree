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
    const BASS_LINE_STYLES = _am.BASS_LINE_STYLES || {};
    const HARMONY_STYLES = _am.HARMONY_STYLES || {};
    const DEFAULT_BASS_LINE_STYLE = _am.DEFAULT_BASS_LINE_STYLE || 'walking_bass_jazz';
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
    const setDrumNaturalRoom = _am.setDrumNaturalRoom;
    const setDrumKitParams = _am.setDrumKitParams;
    const previewDrumPiece = _am.previewDrumPiece;
    const previewFullKit = _am.previewFullKit;
    const VOLUME_MIN_DB = -36;
    const VOLUME_MAX_DB = 6;

    function clampDb(val, fallback) {
        const n = Number(val);
        const f = Number.isFinite(fallback) ? fallback : -12;
        if (!Number.isFinite(n)) return f;
        return Math.max(VOLUME_MIN_DB, Math.min(VOLUME_MAX_DB, Math.round(n)));
    }

    function clampRange(val, min, max, fallback) {
        const n = Number(val);
        const f = Number.isFinite(fallback) ? fallback : min;
        if (!Number.isFinite(n)) return f;
        return Math.max(min, Math.min(max, n));
    }

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

    function ensureDrumKitBeatActive() {
        // If user is editing dedicated drum-kit controls while beat is still
        // on "Simple", promote playback beat so kit changes are heard in playback.
        if (audioState.drumBeat === 'simple') {
            audioState.drumBeat = 'standard_11piece';
            applyDropdownSelection(ui.drumBeatMenu, ui.drumBeatLabel, audioState.drumBeat);
            if (previewFullKit) previewFullKit();
        }
    }

    function setupVolumeSlider(slider, labelEl, wickType) {
        if (!slider || !labelEl) return;

        const updateLabel = (shouldSave) => {
            if (shouldSave === undefined) shouldSave = false;
            const val = clampDb(parseInt(slider.value, 10), audioState[wickType + 'Wick'].volume);
            slider.value = String(val);
            labelEl.textContent = val + ' dB';
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
                harmony: {
                    enabled: !!(audioState.harmony && audioState.harmony.enabled),
                    volume: audioState.harmony && audioState.harmony.volume,
                    instrument: audioState.harmony && audioState.harmony.instrument,
                    rhythm: audioState.harmony && audioState.harmony.rhythm,
                    style: audioState.harmony && audioState.harmony.style,
                    bodySensitivity: audioState.harmony && audioState.harmony.bodySensitivity,
                    dojiThreshold: audioState.harmony && audioState.harmony.dojiThreshold,
                    maxVoices: audioState.harmony && audioState.harmony.maxVoices
                },
                genre: audioState.genre,
                rootKey: audioState.rootKey,
                chordProgression: audioState.chordProgression,
                bassLineStyle: audioState.bassLineStyle,
                drumBeat: audioState.drumBeat,
                drumVolume: audioState.drumVolume,
                drumNaturalRoom: !!audioState.drumNaturalRoom,
                drumGlowIntensity: audioState.drumGlowIntensity,
                drumKit: Object.assign({}, audioState.drumKit || {}),
                displayNotes: audioState.displayNotes,
                chordOverlay: audioState.chordOverlay,
                sensitivity: audioState.sensitivity,
                beatStochasticity: audioState.beatStochasticity,
                rhythmDensity: audioState.rhythmDensity,
                sustainFactor: audioState.sustainFactor,
                phrasingApplyToBass: !!audioState.phrasingApplyToBass,
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
                audioState.upperWick.volume = clampDb(settings.upperWick.volume, -18);
                audioState.upperWick.instrument = settings.upperWick.instrument || 'harpsichord';
                audioState.upperWick.rhythm = settings.upperWick.rhythm || '4';
                audioState.upperWick.pattern = settings.upperWick.pattern || 'scale_asc';
                audioState.upperWick.patternOverride = settings.upperWick.patternOverride ?? false;
                audioState.upperWick.restartOnChord = settings.upperWick.restartOnChord ?? true;
            }
            if (settings.lowerWick) {
                audioState.lowerWick.enabled = settings.lowerWick.enabled ?? true;
                audioState.lowerWick.volume = clampDb(settings.lowerWick.volume, -18);
                audioState.lowerWick.instrument = settings.lowerWick.instrument || 'acoustic_bass';
                audioState.lowerWick.rhythm = settings.lowerWick.rhythm || '2';
                audioState.lowerWick.pattern = settings.lowerWick.pattern || 'root_only';
                audioState.lowerWick.patternOverride = settings.lowerWick.patternOverride ?? false;
                audioState.lowerWick.restartOnChord = settings.lowerWick.restartOnChord ?? true;
            }
            const hs = settings.harmony || {};
            if (!audioState.harmony) audioState.harmony = {};
            audioState.harmony.enabled = hs.enabled ?? true;
            audioState.harmony.volume = clampDb(hs.volume, -16);
            audioState.harmony.instrument = hs.instrument || 'electric_piano';
            audioState.harmony.rhythm = (hs.rhythm === '1' || hs.rhythm === '2' || hs.rhythm === '4' || hs.rhythm === '8') ? hs.rhythm : '4';
            audioState.harmony.style = (hs.style && HARMONY_STYLES[hs.style]) ? hs.style : 'jazz_shell_voicings';
            audioState.harmony.bodySensitivity = clampRange(hs.bodySensitivity, 0.2, 2.0, 1.0);
            audioState.harmony.dojiThreshold = clampRange(hs.dojiThreshold, 0.05, 0.40, 0.14);
            audioState.harmony.maxVoices = Math.max(1, Math.min(4, Math.round(Number(hs.maxVoices ?? 3))));
            audioState.genre = settings.genre || 'classical';
            musicState.currentGenre = audioState.genre;  // Sync with musicState
            audioState.rootKey = settings.rootKey || 'C';
            musicState.rootMidi = 60 + (ROOT_KEY_OFFSETS[audioState.rootKey] || 0);  // Sync with musicState
            audioState.chordProgression = settings.chordProgression || 'canon';
            audioState.bassLineStyle = settings.bassLineStyle || DEFAULT_BASS_LINE_STYLE;
            const beat = String(settings.drumBeat || 'standard_11piece');
            audioState.drumBeat = (beat === 'standard_5piece' || beat === 'standard_7piece') ? 'standard_11piece' : beat;
            audioState.drumVolume = clampDb(settings.drumVolume, -12);
            audioState.drumNaturalRoom = settings.drumNaturalRoom ?? true;
            audioState.drumGlowIntensity = clampRange(settings.drumGlowIntensity, 0.4, 2.5, 1.0);
            const dk = settings.drumKit || {};
            if (!audioState.drumKit) audioState.drumKit = {};
            audioState.drumKit.kickOn = dk.kickOn ?? true;
            audioState.drumKit.snareOn = dk.snareOn ?? true;
            audioState.drumKit.hatOn = dk.hatOn ?? dk.hihatOn ?? true;
            audioState.drumKit.tomOn = dk.tomOn ?? true;
            audioState.drumKit.rideOn = dk.rideOn ?? dk.cymbalOn ?? true;
            audioState.drumKit.cajonOn = dk.cajonOn ?? dk.congaOn ?? true;
            audioState.drumKit.clapOn = dk.clapOn ?? true;
            audioState.drumKit.logOn = dk.logOn ?? dk.claveOn ?? true;
            audioState.drumKit.tablaOn = dk.tablaOn ?? true;
            audioState.drumKit.timbaleOn = dk.timbaleOn ?? true;
            audioState.drumKit.miscOn = dk.miscOn ?? true;
            audioState.drumKit.kickLevel = clampRange(dk.kickLevel, -18, 12, 0);
            audioState.drumKit.snareLevel = clampRange(dk.snareLevel, -18, 12, 0);
            audioState.drumKit.hatLevel = clampRange(dk.hatLevel ?? dk.hihatLevel, -18, 12, 0);
            audioState.drumKit.tomLevel = clampRange(dk.tomLevel, -18, 12, -2);
            audioState.drumKit.rideLevel = clampRange(dk.rideLevel ?? dk.cymbalLevel, -18, 12, -2);
            audioState.drumKit.cajonLevel = clampRange(dk.cajonLevel ?? dk.congaLevel, -18, 12, -2);
            audioState.drumKit.clapLevel = clampRange(dk.clapLevel, -18, 12, -3);
            audioState.drumKit.logLevel = clampRange(dk.logLevel ?? dk.claveLevel, -18, 12, -4);
            audioState.drumKit.tablaLevel = clampRange(dk.tablaLevel, -18, 12, -2);
            audioState.drumKit.timbaleLevel = clampRange(dk.timbaleLevel, -18, 12, -2);
            audioState.drumKit.miscLevel = clampRange(dk.miscLevel, -18, 12, -6);
            audioState.drumKit.kickDecay = clampRange(dk.kickDecay, 0.08, 0.7, 0.28);
            audioState.drumKit.snareDecay = clampRange(dk.snareDecay, 0.06, 0.45, 0.14);
            audioState.drumKit.hatDecay = clampRange(dk.hatDecay ?? dk.hihatDecay, 0.03, 0.35, 0.08);
            audioState.drumKit.tomDecay = clampRange(dk.tomDecay, 0.08, 0.6, 0.20);
            audioState.drumKit.rideDecay = clampRange(dk.rideDecay ?? dk.cymbalDecay, 0.08, 1.2, 0.32);
            audioState.drumKit.cajonDecay = clampRange(dk.cajonDecay ?? dk.congaDecay, 0.08, 0.9, 0.26);
            audioState.drumKit.clapDecay = clampRange(dk.clapDecay, 0.03, 0.35, 0.12);
            audioState.drumKit.logDecay = clampRange(dk.logDecay ?? dk.claveDecay, 0.03, 0.35, 0.10);
            audioState.drumKit.tablaDecay = clampRange(dk.tablaDecay, 0.08, 0.9, 0.24);
            audioState.drumKit.timbaleDecay = clampRange(dk.timbaleDecay, 0.08, 0.9, 0.24);
            audioState.drumKit.miscDecay = clampRange(dk.miscDecay, 0.03, 0.9, 0.16);
            audioState.displayNotes = settings.displayNotes ?? true;
            audioState.chordOverlay = settings.chordOverlay ?? true;
            audioState.sensitivity = settings.sensitivity ?? 0.5;
            audioState.beatStochasticity = settings.beatStochasticity ?? 0;
            audioState.rhythmDensity = Math.max(1, Math.min(16, Math.round(settings.rhythmDensity ?? 8)));
            audioState.sustainFactor = settings.sustainFactor ?? 0.35;
            audioState.phrasingApplyToBass = settings.phrasingApplyToBass ?? false;
            audioState.melodicRange = settings.melodicRange ?? 1.0;
            audioState.glowDuration = settings.glowDuration ?? 3;
            audioState.displayMode = settings.displayMode || 'bars';
            if (settings.panels) {
                audioState.panels.channels = settings.panels.channels ?? true;
                audioState.panels.harmony = settings.panels.harmony ?? true;
                audioState.panels.drumKit = settings.panels.drumKit ?? true;
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
            if (ui.upperVolumeLabel) ui.upperVolumeLabel.textContent = audioState.upperWick.volume + ' dB';
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
            if (ui.lowerVolumeLabel) ui.lowerVolumeLabel.textContent = audioState.lowerWick.volume + ' dB';
        }
        applyDropdownSelection(ui.lowerInstrumentMenu, ui.lowerInstrumentLabel, audioState.lowerWick.instrument);
        applyDropdownSelection(ui.lowerRhythmMenu, ui.lowerRhythmLabel, audioState.lowerWick.rhythm);
        applyDropdownSelection(ui.bassPatternMenu, ui.bassPatternLabel, audioState.lowerWick.pattern);
        if (ui.bassPatternOverrideChk) ui.bassPatternOverrideChk.checked = audioState.lowerWick.patternOverride;
        if (ui.bassPatternDD) ui.bassPatternDD.style.opacity = audioState.lowerWick.patternOverride ? '1' : '0.35';
        if (ui.bassPatternDD) ui.bassPatternDD.style.pointerEvents = audioState.lowerWick.patternOverride ? 'auto' : 'none';
        if (ui.bassRestartOnChordChk) ui.bassRestartOnChordChk.checked = audioState.lowerWick.restartOnChord;

        // Inner harmony
        if (ui.harmonyChk) ui.harmonyChk.checked = !!(audioState.harmony && audioState.harmony.enabled);
        if (ui.harmonyVolume) {
            ui.harmonyVolume.value = String(audioState.harmony.volume);
            if (ui.harmonyVolumeLabel) ui.harmonyVolumeLabel.textContent = Math.round(audioState.harmony.volume) + ' dB';
            if (audioState._harmonySampler) {
                audioState._harmonySampler.volume.value = Number(audioState.harmony.volume);
            }
        }
        applyDropdownSelection(ui.harmonyInstrumentMenu, ui.harmonyInstrumentLabel, audioState.harmony.instrument);
        applyDropdownSelection(ui.harmonyRhythmMenu, ui.harmonyRhythmLabel, audioState.harmony.rhythm);
        applyDropdownSelection(ui.harmonyStyleMenu, ui.harmonyStyleLabel, audioState.harmony.style);
        if (ui.harmonyBodySensitivity) {
            ui.harmonyBodySensitivity.value = String(audioState.harmony.bodySensitivity);
            if (ui.harmonyBodySensitivityLabel) ui.harmonyBodySensitivityLabel.textContent = Number(audioState.harmony.bodySensitivity).toFixed(1) + 'x';
        }
        if (ui.harmonyDojiThreshold) {
            ui.harmonyDojiThreshold.value = String(audioState.harmony.dojiThreshold);
            if (ui.harmonyDojiThresholdLabel) ui.harmonyDojiThresholdLabel.textContent = Number(audioState.harmony.dojiThreshold).toFixed(2);
        }
        if (ui.harmonyMaxVoices) {
            ui.harmonyMaxVoices.value = String(audioState.harmony.maxVoices);
            if (ui.harmonyMaxVoicesLabel) ui.harmonyMaxVoicesLabel.textContent = String(Math.round(audioState.harmony.maxVoices));
        }
        
        // Genre
        applyDropdownSelection(ui.genreMenu, ui.genreLabel, audioState.genre);
        
        // Root key
        applyDropdownSelection(ui.rootKeyMenu, ui.rootKeyLabel, audioState.rootKey);
        
        // Chord progression
        applyDropdownSelection(ui.chordProgressionMenu, ui.chordProgressionLabel, audioState.chordProgression);

        // Bass line style
        applyDropdownSelection(ui.bassLineStyleMenu, ui.bassLineStyleLabel, audioState.bassLineStyle);
        
        // Drum beat
        applyDropdownSelection(ui.drumBeatMenu, ui.drumBeatLabel, audioState.drumBeat);
        
        // Drum volume
        if (ui.drumVolume) {
            ui.drumVolume.value = audioState.drumVolume;
            if (ui.drumVolumeLabel) ui.drumVolumeLabel.textContent = audioState.drumVolume + ' dB';
            if (setDrumVolume) setDrumVolume(audioState.drumVolume);
        }
        if (ui.drumNaturalRoomChk) {
            ui.drumNaturalRoomChk.checked = !!audioState.drumNaturalRoom;
            if (setDrumNaturalRoom) setDrumNaturalRoom(!!audioState.drumNaturalRoom);
        }
        if (ui.drumGlowIntensity) {
            ui.drumGlowIntensity.value = String(audioState.drumGlowIntensity);
            if (ui.drumGlowIntensityLabel) ui.drumGlowIntensityLabel.textContent = Number(audioState.drumGlowIntensity).toFixed(1) + 'x';
        }
        if (ui.kickOn) ui.kickOn.checked = !!audioState.drumKit.kickOn;
        if (ui.snareOn) ui.snareOn.checked = !!audioState.drumKit.snareOn;
        if (ui.hatOn) ui.hatOn.checked = !!audioState.drumKit.hatOn;
        if (ui.tomOn) ui.tomOn.checked = !!audioState.drumKit.tomOn;
        if (ui.rideOn) ui.rideOn.checked = !!audioState.drumKit.rideOn;
        if (ui.cajonOn) ui.cajonOn.checked = !!audioState.drumKit.cajonOn;
        if (ui.clapOn) ui.clapOn.checked = !!audioState.drumKit.clapOn;
        if (ui.logOn) ui.logOn.checked = !!audioState.drumKit.logOn;
        if (ui.tablaOn) ui.tablaOn.checked = !!audioState.drumKit.tablaOn;
        if (ui.timbaleOn) ui.timbaleOn.checked = !!audioState.drumKit.timbaleOn;
        if (ui.miscOn) ui.miscOn.checked = !!audioState.drumKit.miscOn;
        if (ui.kickLevel) {
            ui.kickLevel.value = String(audioState.drumKit.kickLevel);
            if (ui.kickLevelLabel) ui.kickLevelLabel.textContent = Math.round(audioState.drumKit.kickLevel) + ' dB';
        }
        if (ui.snareLevel) {
            ui.snareLevel.value = String(audioState.drumKit.snareLevel);
            if (ui.snareLevelLabel) ui.snareLevelLabel.textContent = Math.round(audioState.drumKit.snareLevel) + ' dB';
        }
        if (ui.hatLevel) {
            ui.hatLevel.value = String(audioState.drumKit.hatLevel);
            if (ui.hatLevelLabel) ui.hatLevelLabel.textContent = Math.round(audioState.drumKit.hatLevel) + ' dB';
        }
        if (ui.tomLevel) {
            ui.tomLevel.value = String(audioState.drumKit.tomLevel);
            if (ui.tomLevelLabel) ui.tomLevelLabel.textContent = Math.round(audioState.drumKit.tomLevel) + ' dB';
        }
        if (ui.rideLevel) {
            ui.rideLevel.value = String(audioState.drumKit.rideLevel);
            if (ui.rideLevelLabel) ui.rideLevelLabel.textContent = Math.round(audioState.drumKit.rideLevel) + ' dB';
        }
        if (ui.cajonLevel) {
            ui.cajonLevel.value = String(audioState.drumKit.cajonLevel);
            if (ui.cajonLevelLabel) ui.cajonLevelLabel.textContent = Math.round(audioState.drumKit.cajonLevel) + ' dB';
        }
        if (ui.clapLevel) {
            ui.clapLevel.value = String(audioState.drumKit.clapLevel);
            if (ui.clapLevelLabel) ui.clapLevelLabel.textContent = Math.round(audioState.drumKit.clapLevel) + ' dB';
        }
        if (ui.logLevel) {
            ui.logLevel.value = String(audioState.drumKit.logLevel);
            if (ui.logLevelLabel) ui.logLevelLabel.textContent = Math.round(audioState.drumKit.logLevel) + ' dB';
        }
        if (ui.tablaLevel) {
            ui.tablaLevel.value = String(audioState.drumKit.tablaLevel);
            if (ui.tablaLevelLabel) ui.tablaLevelLabel.textContent = Math.round(audioState.drumKit.tablaLevel) + ' dB';
        }
        if (ui.timbaleLevel) {
            ui.timbaleLevel.value = String(audioState.drumKit.timbaleLevel);
            if (ui.timbaleLevelLabel) ui.timbaleLevelLabel.textContent = Math.round(audioState.drumKit.timbaleLevel) + ' dB';
        }
        if (ui.miscLevel) {
            ui.miscLevel.value = String(audioState.drumKit.miscLevel);
            if (ui.miscLevelLabel) ui.miscLevelLabel.textContent = Math.round(audioState.drumKit.miscLevel) + ' dB';
        }
        if (ui.kickDecay) {
            ui.kickDecay.value = String(audioState.drumKit.kickDecay);
            if (ui.kickDecayLabel) ui.kickDecayLabel.textContent = Number(audioState.drumKit.kickDecay).toFixed(2) + 's';
        }
        if (ui.snareDecay) {
            ui.snareDecay.value = String(audioState.drumKit.snareDecay);
            if (ui.snareDecayLabel) ui.snareDecayLabel.textContent = Number(audioState.drumKit.snareDecay).toFixed(2) + 's';
        }
        if (ui.hatDecay) {
            ui.hatDecay.value = String(audioState.drumKit.hatDecay);
            if (ui.hatDecayLabel) ui.hatDecayLabel.textContent = Number(audioState.drumKit.hatDecay).toFixed(2) + 's';
        }
        if (ui.tomDecay) {
            ui.tomDecay.value = String(audioState.drumKit.tomDecay);
            if (ui.tomDecayLabel) ui.tomDecayLabel.textContent = Number(audioState.drumKit.tomDecay).toFixed(2) + 's';
        }
        if (ui.rideDecay) {
            ui.rideDecay.value = String(audioState.drumKit.rideDecay);
            if (ui.rideDecayLabel) ui.rideDecayLabel.textContent = Number(audioState.drumKit.rideDecay).toFixed(2) + 's';
        }
        if (ui.cajonDecay) {
            ui.cajonDecay.value = String(audioState.drumKit.cajonDecay);
            if (ui.cajonDecayLabel) ui.cajonDecayLabel.textContent = Number(audioState.drumKit.cajonDecay).toFixed(2) + 's';
        }
        if (ui.clapDecay) {
            ui.clapDecay.value = String(audioState.drumKit.clapDecay);
            if (ui.clapDecayLabel) ui.clapDecayLabel.textContent = Number(audioState.drumKit.clapDecay).toFixed(2) + 's';
        }
        if (ui.logDecay) {
            ui.logDecay.value = String(audioState.drumKit.logDecay);
            if (ui.logDecayLabel) ui.logDecayLabel.textContent = Number(audioState.drumKit.logDecay).toFixed(2) + 's';
        }
        if (ui.tablaDecay) {
            ui.tablaDecay.value = String(audioState.drumKit.tablaDecay);
            if (ui.tablaDecayLabel) ui.tablaDecayLabel.textContent = Number(audioState.drumKit.tablaDecay).toFixed(2) + 's';
        }
        if (ui.timbaleDecay) {
            ui.timbaleDecay.value = String(audioState.drumKit.timbaleDecay);
            if (ui.timbaleDecayLabel) ui.timbaleDecayLabel.textContent = Number(audioState.drumKit.timbaleDecay).toFixed(2) + 's';
        }
        if (ui.miscDecay) {
            ui.miscDecay.value = String(audioState.drumKit.miscDecay);
            if (ui.miscDecayLabel) ui.miscDecayLabel.textContent = Number(audioState.drumKit.miscDecay).toFixed(2) + 's';
        }
        if (setDrumKitParams) setDrumKitParams(audioState.drumKit);
        
        // Display mode
        applyDropdownSelection(ui.displayModeMenu, ui.displayModeLabel, audioState.displayMode);
        
        // Display notes checkbox
        if (ui.displayNotesChk) ui.displayNotesChk.checked = audioState.displayNotes;
        // Chord overlay checkbox
        if (ui.chordOverlayChk) ui.chordOverlayChk.checked = audioState.chordOverlay;
        
        // Sub-panel open/closed state
        if (ui.panelChannels) ui.panelChannels.open = audioState.panels.channels;
        if (ui.panelHarmony) ui.panelHarmony.open = (audioState.panels.harmony ?? true);
        if (ui.panelDrumKit) ui.panelDrumKit.open = (audioState.panels.drumKit ?? true);
        if (ui.panelGenre) ui.panelGenre.open = audioState.panels.genre;
        if (ui.panelTuning) ui.panelTuning.open = audioState.panels.tuning;
        if (ui.panelPlayback) ui.panelPlayback.open = audioState.panels.playback;
        
        // Sliders
        if (ui.sensitivity) {
            ui.sensitivity.value = audioState.sensitivity;
            if (ui.sensitivityLabel) ui.sensitivityLabel.textContent = audioState.sensitivity.toFixed(2);
        }
        if (ui.beatStochasticity) {
            ui.beatStochasticity.value = audioState.beatStochasticity;
            if (ui.beatStochasticityLabel) ui.beatStochasticityLabel.textContent = audioState.beatStochasticity.toFixed(2);
        }
        if (ui.rhythmDensity) {
            ui.rhythmDensity.value = audioState.rhythmDensity;
            if (ui.rhythmDensityLabel) ui.rhythmDensityLabel.textContent = String(Math.round(audioState.rhythmDensity));
        }
        if (ui.sustainFactor) {
            ui.sustainFactor.value = audioState.sustainFactor;
            if (ui.sustainFactorLabel) ui.sustainFactorLabel.textContent = Math.round(audioState.sustainFactor * 100) + '%';
        }
        if (ui.phrasingApplyBassChk) {
            ui.phrasingApplyBassChk.checked = !!audioState.phrasingApplyToBass;
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
                const val = clampDb(parseInt(ui.drumVolume.value, 10), audioState.drumVolume);
                ui.drumVolume.value = String(val);
                ui.drumVolumeLabel.textContent = val + ' dB';
                audioState.drumVolume = val;
                if (setDrumVolume) setDrumVolume(val);
                if (shouldSave) saveSettings();
            };
            ui.drumVolume.addEventListener('input', () => updateDrumLabel(true));
            updateDrumLabel(false);
        }
        if (ui.drumNaturalRoomChk) {
            ui.drumNaturalRoomChk.addEventListener('change', () => {
                audioState.drumNaturalRoom = !!ui.drumNaturalRoomChk.checked;
                if (setDrumNaturalRoom) setDrumNaturalRoom(audioState.drumNaturalRoom);
                ensureDrumKitBeatActive();
                saveSettings();
            });
        }
        if (ui.drumGlowIntensity && ui.drumGlowIntensityLabel) {
            const updateDrumGlowIntensity = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const val = clampRange(Number(ui.drumGlowIntensity.value), 0.4, 2.5, audioState.drumGlowIntensity);
                const rounded = Number(val.toFixed(1));
                ui.drumGlowIntensity.value = String(rounded);
                audioState.drumGlowIntensity = rounded;
                ui.drumGlowIntensityLabel.textContent = rounded.toFixed(1) + 'x';
                if (shouldSave) saveSettings();
            };
            ui.drumGlowIntensity.addEventListener('input', () => updateDrumGlowIntensity(true));
            updateDrumGlowIntensity(false);
        }
        const _drumPreviewAt = {
            kick: 0, snare: 0, hat: 0, tom: 0, ride: 0, cajon: 0, clap: 0, log: 0, tabla: 0, timbale: 0, misc: 0
        };
        function maybePreview(piece) {
            if (!piece || !previewDrumPiece) return;
            const nowMs = Date.now();
            if ((nowMs - (_drumPreviewAt[piece] || 0)) < 120) return;
            _drumPreviewAt[piece] = nowMs;
            previewDrumPiece(piece);
        }

        function bindDrumKitToggle(chk, key, previewPiece) {
            if (!chk || !audioState.drumKit) return;
            const update = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const enabled = !!chk.checked;
                audioState.drumKit[key] = enabled;
                if (setDrumKitParams) setDrumKitParams(audioState.drumKit);
                if (enabled && shouldSave) maybePreview(previewPiece);
                if (shouldSave) ensureDrumKitBeatActive();
                if (shouldSave) saveSettings();
            };
            chk.addEventListener('change', () => update(true));
            update(false);
        }

        function bindDrumKitSlider(slider, label, key, cfg) {
            if (!slider || !label || !audioState.drumKit) return;
            const min = cfg.min;
            const max = cfg.max;
            const precision = cfg.precision || 0;
            const suffix = cfg.suffix || '';
            const isDb = !!cfg.db;
            const previewPiece = cfg.previewPiece || null;
            const update = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                let v = clampRange(Number(slider.value), min, max, audioState.drumKit[key]);
                if (precision === 0) v = Math.round(v);
                else v = Number(v.toFixed(precision));
                slider.value = String(v);
                audioState.drumKit[key] = v;
                label.textContent = (isDb ? Math.round(v) : v.toFixed(precision)) + suffix;
                if (setDrumKitParams) setDrumKitParams(audioState.drumKit);
                if (shouldSave) maybePreview(previewPiece);
                if (shouldSave) ensureDrumKitBeatActive();
                if (shouldSave) saveSettings();
            };
            slider.addEventListener('input', () => update(true));
            update(false);
        }
        bindDrumKitToggle(ui.kickOn, 'kickOn', 'kick');
        bindDrumKitToggle(ui.snareOn, 'snareOn', 'snare');
        bindDrumKitToggle(ui.hatOn, 'hatOn', 'hat');
        bindDrumKitToggle(ui.tomOn, 'tomOn', 'tom');
        bindDrumKitToggle(ui.rideOn, 'rideOn', 'ride');
        bindDrumKitToggle(ui.cajonOn, 'cajonOn', 'cajon');
        bindDrumKitToggle(ui.clapOn, 'clapOn', 'clap');
        bindDrumKitToggle(ui.logOn, 'logOn', 'log');
        bindDrumKitToggle(ui.tablaOn, 'tablaOn', 'tabla');
        bindDrumKitToggle(ui.timbaleOn, 'timbaleOn', 'timbale');
        bindDrumKitToggle(ui.miscOn, 'miscOn', 'misc');
        bindDrumKitSlider(ui.kickLevel, ui.kickLevelLabel, 'kickLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'kick' });
        bindDrumKitSlider(ui.snareLevel, ui.snareLevelLabel, 'snareLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'snare' });
        bindDrumKitSlider(ui.hatLevel, ui.hatLevelLabel, 'hatLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'hat' });
        bindDrumKitSlider(ui.tomLevel, ui.tomLevelLabel, 'tomLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'tom' });
        bindDrumKitSlider(ui.rideLevel, ui.rideLevelLabel, 'rideLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'ride' });
        bindDrumKitSlider(ui.cajonLevel, ui.cajonLevelLabel, 'cajonLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'cajon' });
        bindDrumKitSlider(ui.clapLevel, ui.clapLevelLabel, 'clapLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'clap' });
        bindDrumKitSlider(ui.logLevel, ui.logLevelLabel, 'logLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'log' });
        bindDrumKitSlider(ui.tablaLevel, ui.tablaLevelLabel, 'tablaLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'tabla' });
        bindDrumKitSlider(ui.timbaleLevel, ui.timbaleLevelLabel, 'timbaleLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'timbale' });
        bindDrumKitSlider(ui.miscLevel, ui.miscLevelLabel, 'miscLevel', { min: -18, max: 12, precision: 0, suffix: ' dB', db: true, previewPiece: 'misc' });
        bindDrumKitSlider(ui.kickDecay, ui.kickDecayLabel, 'kickDecay', { min: 0.08, max: 0.7, precision: 2, suffix: 's', previewPiece: 'kick' });
        bindDrumKitSlider(ui.snareDecay, ui.snareDecayLabel, 'snareDecay', { min: 0.06, max: 0.45, precision: 2, suffix: 's', previewPiece: 'snare' });
        bindDrumKitSlider(ui.hatDecay, ui.hatDecayLabel, 'hatDecay', { min: 0.03, max: 0.35, precision: 2, suffix: 's', previewPiece: 'hat' });
        bindDrumKitSlider(ui.tomDecay, ui.tomDecayLabel, 'tomDecay', { min: 0.08, max: 0.6, precision: 2, suffix: 's', previewPiece: 'tom' });
        bindDrumKitSlider(ui.rideDecay, ui.rideDecayLabel, 'rideDecay', { min: 0.08, max: 1.2, precision: 2, suffix: 's', previewPiece: 'ride' });
        bindDrumKitSlider(ui.cajonDecay, ui.cajonDecayLabel, 'cajonDecay', { min: 0.08, max: 0.9, precision: 2, suffix: 's', previewPiece: 'cajon' });
        bindDrumKitSlider(ui.clapDecay, ui.clapDecayLabel, 'clapDecay', { min: 0.03, max: 0.35, precision: 2, suffix: 's', previewPiece: 'clap' });
        bindDrumKitSlider(ui.logDecay, ui.logDecayLabel, 'logDecay', { min: 0.03, max: 0.35, precision: 2, suffix: 's', previewPiece: 'log' });
        bindDrumKitSlider(ui.tablaDecay, ui.tablaDecayLabel, 'tablaDecay', { min: 0.08, max: 0.9, precision: 2, suffix: 's', previewPiece: 'tabla' });
        bindDrumKitSlider(ui.timbaleDecay, ui.timbaleDecayLabel, 'timbaleDecay', { min: 0.08, max: 0.9, precision: 2, suffix: 's', previewPiece: 'timbale' });
        bindDrumKitSlider(ui.miscDecay, ui.miscDecayLabel, 'miscDecay', { min: 0.03, max: 0.9, precision: 2, suffix: 's', previewPiece: 'misc' });
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

        // Inner Harmony controls
        if (ui.harmonyChk) {
            if (!hasSettings) audioState.harmony.enabled = ui.harmonyChk.checked;
            ui.harmonyChk.addEventListener('change', () => {
                audioState.harmony.enabled = !!ui.harmonyChk.checked;
                saveSettings();
            });
        }
        if (ui.harmonyVolume && ui.harmonyVolumeLabel) {
            const updateHarmonyVolume = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const val = clampDb(parseInt(ui.harmonyVolume.value, 10), audioState.harmony.volume);
                ui.harmonyVolume.value = String(val);
                audioState.harmony.volume = val;
                ui.harmonyVolumeLabel.textContent = val + ' dB';
                if (audioState._harmonySampler) audioState._harmonySampler.volume.value = val;
                if (shouldSave) saveSettings();
            };
            ui.harmonyVolume.addEventListener('input', () => updateHarmonyVolume(true));
            updateHarmonyVolume(false);
        }
        setupDropdown(ui.harmonyInstrumentDD, ui.harmonyInstrumentBtn, ui.harmonyInstrumentMenu, ui.harmonyInstrumentLabel,
            (val) => {
                audioState.harmony.instrument = val || 'electric_piano';
                saveSettings();
                if (audioState.playing && audioState._initialized) {
                    reloadSampler('harmony', audioState.harmony.instrument);
                }
            });
        setupDropdown(ui.harmonyRhythmDD, ui.harmonyRhythmBtn, ui.harmonyRhythmMenu, ui.harmonyRhythmLabel,
            (val) => {
                audioState.harmony.rhythm = (val === '1' || val === '2' || val === '4' || val === '8') ? val : '4';
                saveSettings();
            });
        setupDropdown(ui.harmonyStyleDD, ui.harmonyStyleBtn, ui.harmonyStyleMenu, ui.harmonyStyleLabel,
            (val) => {
                audioState.harmony.style = (val && HARMONY_STYLES[val]) ? val : 'jazz_shell_voicings';
                saveSettings();
            });
        if (ui.harmonyBodySensitivity && ui.harmonyBodySensitivityLabel) {
            const updateBodySensitivity = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const v = Number(clampRange(ui.harmonyBodySensitivity.value, 0.2, 2.0, audioState.harmony.bodySensitivity).toFixed(1));
                ui.harmonyBodySensitivity.value = String(v);
                audioState.harmony.bodySensitivity = v;
                ui.harmonyBodySensitivityLabel.textContent = v.toFixed(1) + 'x';
                if (shouldSave) saveSettings();
            };
            ui.harmonyBodySensitivity.addEventListener('input', () => updateBodySensitivity(true));
            updateBodySensitivity(false);
        }
        if (ui.harmonyDojiThreshold && ui.harmonyDojiThresholdLabel) {
            const updateDojiThreshold = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const v = Number(clampRange(ui.harmonyDojiThreshold.value, 0.05, 0.40, audioState.harmony.dojiThreshold).toFixed(2));
                ui.harmonyDojiThreshold.value = String(v);
                audioState.harmony.dojiThreshold = v;
                ui.harmonyDojiThresholdLabel.textContent = v.toFixed(2);
                if (shouldSave) saveSettings();
            };
            ui.harmonyDojiThreshold.addEventListener('input', () => updateDojiThreshold(true));
            updateDojiThreshold(false);
        }
        if (ui.harmonyMaxVoices && ui.harmonyMaxVoicesLabel) {
            const updateMaxVoices = (shouldSave) => {
                if (shouldSave === undefined) shouldSave = false;
                const v = Math.max(1, Math.min(4, Math.round(Number(ui.harmonyMaxVoices.value) || audioState.harmony.maxVoices)));
                ui.harmonyMaxVoices.value = String(v);
                audioState.harmony.maxVoices = v;
                ui.harmonyMaxVoicesLabel.textContent = String(v);
                if (shouldSave) saveSettings();
            };
            ui.harmonyMaxVoices.addEventListener('input', () => updateMaxVoices(true));
            updateMaxVoices(false);
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

        // Bass Line Style
        setupDropdown(ui.bassLineStyleDD, ui.bassLineStyleBtn, ui.bassLineStyleMenu, ui.bassLineStyleLabel,
            (val) => {
                audioState.bassLineStyle = val || DEFAULT_BASS_LINE_STYLE;
                const style = BASS_LINE_STYLES[audioState.bassLineStyle];
                console.log('[Audio] Bass line style changed to:', style ? style.label : audioState.bassLineStyle);
                saveSettings();
            });

        // Drum Beat
        setupDropdown(ui.drumBeatDD, ui.drumBeatBtn, ui.drumBeatMenu, ui.drumBeatLabel,
            (val) => { 
                audioState.drumBeat = val; 
                if (val === 'standard_11piece' && previewFullKit) {
                    previewFullKit();
                }
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
            { el: ui.panelHarmony, key: 'harmony' },
            { el: ui.panelDrumKit, key: 'drumKit' },
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
        setupSlider(ui.beatStochasticity, ui.beatStochasticityLabel, '', 'beatStochasticity', v => v.toFixed(2));
        setupSlider(ui.rhythmDensity, ui.rhythmDensityLabel, '', 'rhythmDensity', v => Math.round(v));
        setupSlider(ui.sustainFactor, ui.sustainFactorLabel, '%', 'sustainFactor', v => Math.round(v * 100));
        if (ui.phrasingApplyBassChk) {
            ui.phrasingApplyBassChk.addEventListener('change', () => {
                audioState.phrasingApplyToBass = !!ui.phrasingApplyBassChk.checked;
                saveSettings();
            });
        }
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
            // Warm-load drum samples so first drum hits are not delayed.
            if (typeof _am.primeDrumSamples === 'function') {
                _am.primeDrumSamples().catch(function(err) {
                    console.warn('[Audio] Drum sample preload failed:', err);
                });
            }
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
