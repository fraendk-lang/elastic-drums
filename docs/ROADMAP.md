# Elastic Drums — Pro-Level Roadmap

**Ziel:** Loop-basierte Mini-DAW auf Ableton Live / Reason Niveau
**Benchmark:** Ableton Live 12, Reason 13
**Stand:** April 2026

---

## Erledigte Meilensteine

### Phase 1 — Workflow & Arrangement (April 2026) ✅
- Scene-Transitions mit Launch Quantize (NOW / 1 / 2 / 4 BAR)
- Clip-Launcher-View (4×8 Matrix, Ableton Session View Stil)
- Arrangement-Timeline (visuelle Scene-Zeitachse mit Drag & Drop)
- Globales Undo/Redo über Drum/Bass/Chords/Melody Engines

### Phase 2 — Mixing & FX auf Pro-Level (April 2026) ✅
- Sidechain-Routing (Kick → Bass/Chords/Melody Ducking, Per-Target Toggles)
- Per-Channel 3-Band EQ auf allen 15 Kanälen
- Per-Channel Compressor (Threshold/Ratio) auf allen 15 Kanälen
- Send C (Stereo Chorus) + Send D (4-Stage Phaser)
- FX-Rack: Insert-Kette mit Drag & Drop (Bitcrusher, RingMod, Tremolo, Widener, Autofilter)

### Phase 3 — Sound Design (April 2026) ✅
- Wavetable-Modus für Bass/Melody (8 Wellentabellen: Harmonic, Bright Saw, Hollow, Glass, Vocal, Pulse 25, Digital, Warm Stack)
- FM-Synthesis auf Kick/Snare/Toms (Amount + Ratio Knobs)
- Multi-Sample Velocity-Layer pro Pad (bis zu 4 Layer)
- Mod Matrix — 4 LFO-Slots auf beliebige Synth-Parameter

### Phase 4 — Piano Roll Advanced (April 2026) ✅ (Ghost-Notes + Scale-Highlighting)
- Multi-Track Ghost-Notes (alle Lanes gleichzeitig sichtbar)
- Scale-Highlighting (Root + Scale-Notes immer sichtbar, Out-of-Scale dimming)

### Phase 5 — Performance & Live (April 2026) ✅ (Macro-Knobs)
- Macro-Knobs: 8 meta-controls, je 4 Bindings mit Range-Override + Invert

### Phase 5 — Performance & Live (April 2026) ✅ (Crossfader, Tempo-Automation, MIDI Learn)
- Crossfader (A/B Channel-Gruppen, Equal-Power-Kurve)
- Tempo-Automation (per-entry BPM-Änderung + optionale Rampen)
- MIDI-Controller Mapping (CC-Learn auf Macros, Crossfader, Sends)

### Phase 6 — Export (April 2026) ✅ (Stem-Export)
- Stem-Export: 4 separate WAVs (Drums / Hats / Cym+Perc / Full)

### Phase 8 — Performance (April 2026) ✅ (weitgehend)
- Per-Field Zustand-Selektoren in Transport/StepSequencer/PadGrid (entfernen Transport aus Playback-Re-Render)
- useMemo für teure Aggregate im StepSequencer (768 iterationen/frame → cached)
- React.memo auf MixerStrip MeterColumn (nur geänderte Channels re-rendern) → später durch Canvas ersetzt
- requestIdleCallback für Auto-Save (I/O in Idle-Zeit statt während Playback)
- Canvas-basierte Mixer-Meter (15 Channel-Bridge + Master-Bar) — zero React re-renders bei 60 Hz
- Bundle-Size-Diet: 15 Overlays lazy-loaded via React.lazy + Suspense (PianoRoll, Mixer, ModMatrix, Arrangement, etc.)
- Vite manualChunks: vendor-react / vendor-state / vendor-audio für Browser-Cache-Effizienz
- AudioNode-Pool: DEFERRED (Web Audio OscillatorNode können nicht wiederverwendet werden; Voices räumen bereits sauber ab)

### Phase 4 — Piano Roll Advanced (April 2026) ✅ (weitgehend)
- Multi-Track Ghost-Notes (alle Lanes gleichzeitig sichtbar)
- Scale-Highlighting (Root + Scale-Notes immer sichtbar, Out-of-Scale dimming)
- MIDI-Record: externe Notes live in die Piano Roll aufnehmen
- Clip-Envelopes: DEFERRED (benötigt tiefe Scheduler-Integration für per-note Parameter-Automation)

### Phase 6 — Export (April 2026) ✅ (weitgehend)
- Stem-Export: 4 separate WAVs (Drums / Hats / Cym+Perc / Full)
- MIDI-Clock Sync (24 PPQ Send/Receive mit Start/Stop)
- Ableton Live Set Import (.als): NICHT geplant für MVP (komplexes proprietäres Format)

### Piano Roll Overhaul (April 2026) ✅
- Refactor: 1709-Zeilen-Monolith → 9 Module
- Sticky Zeit-Lineal mit Bar.Beat Labels
- Funktionaler Loop-Brace (Drag auf Ruler, L-Taste, Scheduler loopt unabhängig von Drums)
- Draw/Select Tool Toggle (B/S Tasten)
- Note-Length Inheritance (letzte Länge wird gemerkt)
- Shift-Constraint beim Drag (Achsen-Lock)
- 72-Row Pitch-Range (6 Oktaven C2–C8) mit Scroll-Sync
- Velocity als Brightness-Gradient
- Transforms: Transpose ±1/±Oct, Reverse, Invert, Legato, Humanize, Stretch ×2/÷2
- Note-Length Presets (1/32–1/1)
- Fold-View (nur Rows mit Noten)
- Right-Click Kontextmenü (Delete, Duplicate, Copy, Velocity, Transforms)
- Doppelklick zum Noten-Erstellen (beide Modi)
- Hover-Tooltip + Live-Drag-Koordinaten im Footer

### UI-Verbesserungen (April 2026) ✅
- Export-Dropdown (SAVE/MIDI/WAV/REC/SHARE konsolidiert)
- AutomationLane: dynamische Step-Anpassung + Drag-Resize (48–200px)
- Shift+1–0 Keyboard-Shortcuts für Scene 1–10 (Queue bei Playback, Load+Play bei Stop)

### Audio-Bugfixes (April 2026) ✅
- Scene-Load: panic() + SoundFont.stopAll() + Re-Panic nach setParams()
- Filter Self-Oscillation Bleed durch output.gain Muting in panic()
- Piano Roll Scroll-Sync Bug (Keys-Spalte konnte nicht weit genug scrollen)
- Sub-Pixel Off-by-One bei Note-Placement
- Hängende Rubber-Band-Selektion (Pointer-Capture + Window-Fallback)

---

## Phase 1 — Workflow & Arrangement

### 1.1 Clip-Launcher-View
**Referenz:** Ableton Session View
**Beschreibung:** Matrix-Ansicht mit Clips pro Track (Bass/Chords/Melody/Drums). Click = Launch, Stop-Button pro Track. Jeder Clip ist ein eigenständiges Pattern mit eigener Länge.
**Aufwand:** ~1 Session
**Dateien:** Neues `src/components/ClipLauncher.tsx`, `src/store/clipStore.ts`

### 1.2 Arrangement-Timeline
**Referenz:** Ableton Arrangement View
**Beschreibung:** Lineare Anordnung von Scenes/Clips auf einer horizontalen Zeitachse. Playback von links nach rechts mit Positionsmarker. Drag-to-arrange.
**Aufwand:** ~1 Session
**Dateien:** Neues `src/components/ArrangementView.tsx`

### 1.3 Scene-Transitions
**Referenz:** Ableton Launch Quantize
**Beschreibung:** Quantisierungs-Optionen beim Scene-Wechsel: Sofort, 1 Bar, 2 Bars, 4 Bars. Optionaler Crossfade zwischen Scenes.
**Aufwand:** ~30 min
**Dateien:** `src/store/sceneStore.ts` (queueScene erweitern)

### 1.4 Globales Undo/Redo
**Referenz:** Ableton Edit > Undo
**Beschreibung:** Undo/Redo über alle Engines (Drums + Bass + Chords + Melody + Mixer). Aktuell nur Drum-Pattern.
**Aufwand:** ~45 min
**Dateien:** `src/hooks/useUndoRedo.ts` (erweitern auf alle Stores)

---

## Phase 2 — Mixing & FX auf Pro-Level

### 2.1 Per-Channel EQ
**Referenz:** Reason SSL-Mixer Channel Strip
**Beschreibung:** 3-Band parametrischer EQ pro Mixer-Kanal (Lo/Mid/Hi mit Freq + Gain + Q). Aktuell nur Master-EQ.
**Aufwand:** ~1 Session
**Dateien:** `src/audio/AudioEngine.ts` (Channel-Kette erweitern), `src/components/MixerStrip.tsx`

### 2.2 Per-Channel Compressor
**Referenz:** Ableton Compressor
**Beschreibung:** Kompressor pro Kanal mit Threshold, Ratio, Attack, Release, Makeup-Gain. GR-Meter im Mixer-Strip.
**Aufwand:** ~45 min
**Dateien:** `src/audio/AudioEngine.ts`, `src/components/MixerStrip.tsx`

### 2.3 Sidechain-Routing
**Referenz:** Ableton Sidechain Compressor
**Beschreibung:** Kick-Signal als Sidechain-Input für Bass/Chords Compressor. Klassischer Pump-Effekt.
**Aufwand:** ~45 min
**Dateien:** `src/audio/AudioEngine.ts` (Routing-Matrix)

### 2.4 Zusätzliche Send-FX (C/D)
**Referenz:** Reason 14:2 Mixer
**Beschreibung:** 2 weitere Send-Busse (z.B. Chorus, Phaser, Flanger). Aktuell: Send A = Reverb, Send B = Delay.
**Aufwand:** ~30 min
**Dateien:** `src/audio/AudioEngine.ts`, `src/components/MixerPanel.tsx`

### 2.5 FX-Rack (Insert-Kette)
**Referenz:** Ableton Audio Effects Chain
**Beschreibung:** Pro Kanal eine konfigurierbare Insert-FX-Kette. Drag & Drop zum Umordnen. Aktuell nur Filter + Drive.
**Aufwand:** ~1 Session
**Dateien:** Neues `src/components/FxRack.tsx`, `src/audio/FxChain.ts`

---

## Phase 3 — Sound Design

### 3.1 Wavetable-Modus
**Referenz:** Ableton Wavetable
**Beschreibung:** Wavetable-Oszillator für Bass/Melody statt nur Saw/Square. Morph zwischen Wellenformen.
**Aufwand:** ~1 Session
**Dateien:** `src/audio/BassEngine.ts`, `src/audio/MelodyEngine.ts` (PeriodicWave API)

### 3.2 FM-Synthesis auf Drum Voices
**Referenz:** Reason Thor FM
**Beschreibung:** FM-Operator pro Drum Voice für metallische Kicks, glockenartige Toms, Noise-Snares.
**Aufwand:** ~45 min
**Dateien:** `src/audio/AudioEngine.ts` (Voice-Architektur erweitern)

### 3.3 Sampler mit Slicing
**Referenz:** Reason NN-XT, Ableton Simpler
**Beschreibung:** Drum-Break/Loop laden → automatisch in Slices schneiden → auf Pads verteilen. Transient-Detection.
**Aufwand:** ~1 Session
**Dateien:** Neues `src/audio/Slicer.ts`, `src/components/SlicerView.tsx`

### 3.4 Multi-Sample Velocity-Layer
**Referenz:** Ableton Simpler
**Beschreibung:** Pro Pad 2–4 Velocity-Layer (Soft/Med/Hard/Max). Automatischer Layer-Select basierend auf Anschlagstärke.
**Aufwand:** ~45 min
**Dateien:** `src/audio/SampleManager.ts`

### 3.5 Mod-Matrix
**Referenz:** Reason Combinator, Ableton Macro
**Beschreibung:** LFO/Envelope → beliebigen Synth-Parameter. Frei routbar, multiple Destinations.
**Aufwand:** ~1 Session
**Dateien:** Neues `src/audio/ModMatrix.ts`, `src/components/ModMatrixEditor.tsx`

---

## Phase 4 — Piano Roll Advanced

### 4.1 Multi-Track Ghost-Notes
**Referenz:** Ableton MIDI Clip (Fold + Ghost)
**Beschreibung:** Alle 4 Lanes gleichzeitig sichtbar. Inaktive Lanes als halbtransparente "Ghost Notes" im Hintergrund.
**Aufwand:** ~45 min
**Dateien:** `src/components/PianoRoll/index.tsx` (Ghost-Rendering-Pass)

### 4.2 Scale-Highlighting
**Referenz:** Ableton Scale Mode
**Beschreibung:** In-Scale-Rows mit deutlicherem Hintergrund, Out-of-Scale abgedunkelt. Aktuell nur bei Scale-Snap aktiv.
**Aufwand:** ~15 min
**Dateien:** `src/components/PianoRoll/index.tsx` (Row-Rendering)

### 4.3 Clip-Envelopes
**Referenz:** Ableton Clip Envelope
**Beschreibung:** Automation pro Clip: Velocity-Kurve, Pan, Filter-Cutoff. Breakpoint-Editor unter den Noten.
**Aufwand:** ~45 min
**Dateien:** `src/components/PianoRoll/index.tsx`, bestehende AutomationLane integrieren

### 4.4 MIDI-Learn in Piano Roll
**Referenz:** Ableton MIDI Mapping
**Beschreibung:** Externe MIDI-Controller zum Einspielen von Noten in der Piano Roll. Record + Overdub.
**Aufwand:** ~30 min
**Dateien:** `src/hooks/useMidi.ts`, `src/components/PianoRoll/index.tsx`

---

## Phase 5 — Performance & Live

### 5.1 MIDI-Controller-Mapping
**Referenz:** Ableton MIDI Map Mode
**Beschreibung:** Beliebige Knobs/Fader auf MIDI-CC mappen. UI-Overlay zum Zuweisen.
**Aufwand:** ~45 min
**Dateien:** `src/hooks/useMidi.ts` (CC-Routing), neues `src/components/MidiMapOverlay.tsx`

### 5.2 Macro-Knobs
**Referenz:** Reason Combinator, Ableton Macro
**Beschreibung:** 8 frei belegbare Macros. Jeder Macro steuert 1–4 Parameter gleichzeitig (mit Min/Max-Range).
**Aufwand:** ~45 min
**Dateien:** Neues `src/store/macroStore.ts`, `src/components/MacroPanel.tsx`

### 5.3 Crossfader
**Referenz:** Ableton Crossfader
**Beschreibung:** A/B-Track-Gruppen mit horizontalem Crossfader. DJ-Style Übergänge.
**Aufwand:** ~30 min
**Dateien:** `src/audio/AudioEngine.ts`, `src/components/MixerPanel.tsx`

### 5.4 Tempo-Automation
**Referenz:** Ableton Master Track
**Beschreibung:** BPM-Änderungen über die Song-Timeline. Rampen und Sprünge.
**Aufwand:** ~30 min
**Dateien:** `src/store/drumStore.ts`, `src/components/SongEditor.tsx`

---

## Phase 6 — Export & Integration

### 6.1 Stem-Export
**Referenz:** Ableton Export Individual Tracks
**Beschreibung:** Einzelne Tracks als separate WAV-Dateien exportieren (Kick, Snare, Bass, Chords etc.)
**Aufwand:** ~30 min
**Dateien:** `src/utils/audioExport.ts`

### 6.2 Ableton Live Set Import
**Referenz:** .als Dateiformat
**Beschreibung:** Ableton .als Dateien parsen, MIDI-Clips und Noten importieren in Elastic Drums Patterns.
**Aufwand:** ~1 Session
**Dateien:** Neues `src/utils/alsImport.ts`

### 6.3 MIDI-Clock Sync
**Referenz:** Reason ReWire, Ableton Link
**Beschreibung:** MIDI-Clock senden/empfangen für Sync mit externen DAWs und Hardware.
**Aufwand:** ~30 min
**Dateien:** `src/hooks/useMidiClock.ts` (erweitern)

### 6.4 VST3/AU Plugin
**Referenz:** Reason Rack Extension
**Beschreibung:** WASM-Core + JUCE WebView als VST3/AU Plugin. Grundstruktur bereits vorhanden in `plugin/`.
**Aufwand:** ongoing (C++ Kern muss vollständig sein)
**Dateien:** `plugin/src/`, `core/`

---

## Phase 8 — Performance Optimization

**Ziel:** 60 fps bei 12 Tracks + Piano Roll + Mixer + alle FX aktiv.
Ableton-Level Flüssigkeit auch auf Mittelklasse-Laptops.

### 8.1 Canvas-basiertes Piano Roll Rendering
**Referenz:** Ableton MIDI Clip Editor (Canvas statt DOM)
**Beschreibung:** Bei >200 Notes pro Clip wird das DOM-Rendering spürbar. Umstieg auf `<canvas>` mit manuellem Redraw in `requestAnimationFrame`.
**Aufwand:** ~1 Session

### 8.2 Mixer-Meter via OffscreenCanvas
**Beschreibung:** 15 FFT-Meter gleichzeitig → Main Thread. Umzug auf OffscreenCanvas in Worker.
**Aufwand:** ~45 min

### 8.3 React Re-Render Optimization
**Beschreibung:** Expensive components (ChannelStrip, Piano Roll Grid) mit React.memo + primitive props. Derived state aus Hooks raus.
**Aufwand:** ~30 min

### 8.4 Bundle-Size-Diet
**Beschreibung:** Barrel-Imports vermeiden, dynamische Imports für selten geöffnete Overlays (Mod-Matrix, FX-Rack).
**Aufwand:** ~30 min

### 8.5 AudioNode Pool
**Beschreibung:** Drum-Voices erzeugen pro Trigger 6-10 Nodes. Pool wiederverwendbarer Nodes reduziert GC-Pressure.
**Aufwand:** ~1 Session

### 8.6 `requestIdleCallback` für Non-Critical Work
**Beschreibung:** Pattern-Persistence, Undo-Snapshots, Stats-Updates in Idle-Zeit verschieben.
**Aufwand:** ~20 min

---

## Phase 7 — Polish & Production-Ready

| Feature | Aufwand |
|---------|---------|
| Onboarding/Tutorial-Overlay mit interaktiven Tooltips | ~30 min |
| Preset-Cloud — Presets teilen/laden via URL oder Account | ~1 Session |
| Responsive Touch-Optimierung für iPad/Tablet | ~1 Session |
| PWA Offline-Mode vollständig | ~30 min |
| Performance-Profiling — 60fps bei 12+ Tracks + FX | ~45 min |
| Accessibility (Keyboard-Navigation, Screen-Reader) | ~45 min |
| Dark/Light Theme Switch | ~30 min |

---

## Technische Schulden (laufend)

| Item | Prio |
|------|------|
| BassScheduler: `window.__drumStore` durch sauberen Import ersetzen | Mittel |
| WASM DSP Migration (AudioWorklet mit echtem C++ Kern) | Hoch |
| Production Build Pipeline (Rollup ARM64 Dependency) | Hoch |
| Error Boundaries für AudioContext-Fehler | Mittel |
| Unit-Tests für Audio-Engines (Web Audio API Mock) | Niedrig |
| E2E-Tests für Piano Roll Interaktionen | Niedrig |

---

## Empfohlene Reihenfolge

1. **Sidechain-Routing** — größter "Pro-Sound"-Impact
2. **Multi-Track Ghost-Notes** — macht Piano Roll Ableton-ebenbürtig
3. **Per-Channel EQ + Compressor** — Mixing auf Pro-Niveau
4. **Clip-Launcher-View** — Workflow-Revolution
5. **Stem-Export** — ermöglicht Weiterarbeit in DAWs
6. **WASM DSP Migration** — Performance + Plugin-Readiness

---

*Erstellt: April 2026 | Autor: Frank Krumsdorf + Claude*
