# Elastic Drum — Finalisierung Design Spec
**Datum:** 2026-04-23  
**Status:** Approved  
**Scope:** Mixer Redesign · Bass LFO · Kits · Stability · Build

---

## Ziel

Elastic Drum marktfähig machen: professioneller Mixer, Bass-Modulation, stabile Builds, mehr Content. Kein WASM-Migration (eigenes Projekt).

---

## 1. Mixer Redesign

### 1.1 Permanent Bottom Bar

Der bestehende Fullscreen-Overlay-Mixer wird ersetzt durch eine **permanente Leiste** die immer sichtbar ist — direkt unter dem Sequencer-Grid.

- Höhe: ~110px kompakt
- 12 Drum-Kanäle + Bass + Chords + Melody = 15 Kanäle
- Horizontales Scrollen wenn Kanäle nicht in den Viewport passen
- Kein separates Overlay mehr nötig für Basis-Workflow

### 1.2 Compact Strip (Standard-Ansicht)

Pro Kanal, immer sichtbar:

| Element | Detail |
|---------|--------|
| Kanalname | Farbig (Amber für Drums, Blue für HH/Cymbal, Purple für Perc — wie bisher) |
| Peak-Meter | Schmaler vertikaler Meter, IEC-Skala, bestehende Metering-Logik |
| Volume-Fader | Vertikaler Fader, logarithmisches Gesetz (0.75 = Unity) |
| Mute-Button | M — dimmt Kanal |
| Solo-Button | S — isoliert Kanal |

### 1.3 Expanded Strip (On-Demand)

Klick auf Kanalname oder `▾`-Pfeil öffnet ein **Panel direkt über dem Kanal-Strip** (kein Fullscreen-Overlay):

| Element | Detail |
|---------|--------|
| EQ Hi | Knob, ±12 dB Shelf, 8 kHz |
| EQ Mid | Knob, ±12 dB Peak, 1 kHz |
| EQ Lo | Knob, ±12 dB Shelf, 200 Hz |
| Rev Send | Knob, 0–100% |
| Dly Send | Knob, 0–100% |
| Pan | Knob, L–C–R |
| Insert FX | Kleiner Indikator-Text (z.B. "DIST · FILT"), klickbar öffnet bestehenden FxRack |

Nur ein Kanal kann gleichzeitig expanded sein (andere klappen automatisch zu).

### 1.4 Visual Style

- Reason/SSL-DNA: klare horizontale Trennlinien zwischen Sektionen (EQ / Sends / Pan / Fader)
- Bestehendes Dark-Theme: `#111` Hintergrund, keine neuen Farben
- Fader ist einziger Fader pro Kanal — alle anderen Parameter als Knob
- Komponente: `MixerBar.tsx` (neu) ersetzt `MixerPanel.tsx` als primäre Mixer-Ansicht
- `MixerPanel.tsx` bleibt als Legacy für eventuellen Fullscreen-Bedarf, wird aber aus dem Default-Layout entfernt

### 1.5 Audio-Routing

Keine Änderung am Audio-Routing. `MixerRouting.ts` und `AudioEngine.ts` bleiben unverändert. `MixerBar` bindet dieselben Zustand-Selektoren wie `MixerPanel`.

---

## 2. Bass LFO Modulation

### 2.1 Neue Parameter in `BassParams`

```typescript
lfoEnabled: boolean      // Default: false
lfoTarget: "filter" | "pitch" | "volume"  // Default: "filter"
lfoShape: "sine" | "triangle" | "sawtooth" | "square"  // Default: "sine"
lfoRate: number          // 0.1–20 Hz, Default: 2.0
lfoDepth: number         // 0–1, Default: 0.3
lfoSync: boolean         // Sync to BPM, Default: false
lfoSyncNote: "1/16" | "1/8" | "1/4" | "1/2" | "1" | "2" | "4"  // Default: "1/4"
```

### 2.2 Audio-Engine Implementierung (`BassEngine.ts`)

- `OscillatorNode` als LFO-Quelle (loopend, kein Scheduling nötig)
- `GainNode` als Depth-Scaler
- **Filter-Target:** LFO → GainNode → `AudioParam` `filter.frequency` (via `connect()`)
- **Pitch-Target:** LFO → GainNode → `OscillatorNode.detune` (±100 cent bei Depth=1)
- **Volume-Target:** `ConstantSourceNode` (offset=1) + LFO*depth → `GainNode.gain` (DC-Offset verhindert negative Gain-Werte)
- Bei `lfoSync=true`: Rate = `(bpm / 60) / noteValueInBeats`
- Start/Stop des LFO-Nodes beim Aktivieren/Deaktivieren

### 2.3 UI (`BassSequencer.tsx`)

Neuer Abschnitt **"LFO"** unter den bestehenden Synth-Knobs:

- Enable-Toggle (ON/OFF)
- Target-Buttons: FILTER · PITCH · VOL
- Shape-Buttons: ~ (Sine) · △ (Tri) · /| (Saw) · ⊓ (Square)
- Rate-Knob mit BPM-Sync-Toggle
- Depth-Knob

### 2.4 Store (`bassStore.ts`)

`DEFAULT_BASS_PARAMS` um LFO-Felder erweitern. Serialisierung/Deserialisierung funktioniert automatisch über den bestehenden `loadBassPattern`-Mechanismus.

---

## 3. Factory Kits & Bass Presets

### 3.1 Neue Factory Kits (in `factoryKits.ts`)

6 neue Kits:

| Name | Kategorie | Charakter |
|------|-----------|-----------|
| Minimal Techno | Electronic | Sparse, punchy, mono |
| Lo-Fi Boom Bap | Hip-Hop | Vinyl-warm, swung, soft |
| Jungle Breaks | DnB | Fast breakbeats, metallic HH |
| Industrial | Electronic | Harsh, distorted, metallic |
| Future Bass | Electronic | Punchy 808, layered clap |
| Afrobeat | World | Percussion-heavy, syncopated |

### 3.2 Bass Presets

8 neue Presets als `BASS_PRESETS` Array (Name + vollständige `BassParams`):

1. Acid Classic (303-style, hohe Resonanz, kurzer Decay)
2. Deep Sub (Low-Cutoff, kein Env, schwerer Sub)
3. Wobble Bass (LFO aktiviert, Filter-Target, langsame Rate)
4. Techno Stab (Mittlere Cutoff, kurzer Decay, Distortion)
5. Reggaeton 808 (Sawtooth, Slide, langer Decay)
6. Funk Slap (Square, kurzer Envelope, Punch hoch)
7. Ambient Drone (Wavetable, sehr langsamer LFO, hoher Sustain)
8. Jungle Reese (Detuned, Distortion, langsamer Filter-LFO)

---

## 4. Sound Library — Bessere Auffindbarkeit

Der bestehende `SampleBrowser` hat 2300+ Samples aber schwache Filterung.

**Verbesserungen:**
- **Freitext-Suche** über `name`-Feld (bereits vorhanden, aber gefiltert auf aktive Kategorie)
- **"All Categories"**-Option: Suche über alle Kategorien gleichzeitig
- **Sortierung**: A–Z / Neu / Relevant (nach Treffsicherheit des Suchbegriffs)
- Keine neuen Samples nötig — reine UX-Verbesserung

---

## 5. Stabilität & Build

### 5.1 Error Boundaries

`ErrorBoundary`-Komponente (`src/components/ErrorBoundary.tsx`) wrapping:
- `AudioEngine`-Init-Sequenz in `App.tsx`
- `MixerBar` (neue Komponente)
- `BassSequencer`
- `SamplerTab` + `LoopPlayerTab`

Fallback: stiller Fehler mit Retry-Button — kein Whitescreen.

### 5.2 ARM64 Build Fix

`package.json`: `@rollup/rollup-darwin-arm64` in `optionalDependencies` sicherstellen.  
`vite.config.ts`: Falls nötig, `build.rollupOptions.plugins` mit `@rollup/wasm` als Fallback.

### 5.3 `.gitignore`

`.superpowers/` zu `.gitignore` hinzufügen (Brainstorming-Sessions nicht committen).

---

## 6. Implementierungsreihenfolge

1. `.gitignore` + ARM64 Fix (5 min)
2. Error Boundaries (30 min)
3. Bass LFO — Engine + Store + UI (2–3h)
4. Bass Presets + neue Kits (1–2h)
5. Sound Library UX (1h)
6. Mixer Redesign — `MixerBar.tsx` (3–4h)
7. Integration + Build-Test

**Gesamtaufwand:** ~1 Arbeitstag

---

## Out of Scope

- WASM DSP Migration (eigenes Projekt)
- Neue Sample-Dateien hinzufügen (2300 reichen)
- Plugin-Version (JUCE) Änderungen
