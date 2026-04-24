# Premium Synth Sounds — Design Spec
**Datum:** 2026-04-25  
**Status:** Approved  
**Scope:** Wavetable für ChordsEngine · Neue Presets (Chords / Melody / Bass)

---

## Ziel

Chords und Melody klingen premium: echte Pad-Texturen, ausdrucksstarke Leads, warme Bässe. Kein Breaking Change an bestehenden Presets oder Preset-Kits 1-6.

---

## 1. Wavetable-Modus für ChordsEngine

### 1.1 Neue Parameter in `ChordsParams`

```typescript
synthType: "subtractive" | "wavetable"  // Default: "subtractive"
wavetable?: WavetableName               // Default: "harmonic"
```

`WavetableName` kommt aus dem bestehenden `src/audio/Wavetables.ts` — 8 Optionen:
`"harmonic"` · `"warm"` · `"bright"` · `"hollow"` · `"nasal"` · `"soft"` · `"reedy"` · `"buzzy"`

### 1.2 Engine-Implementierung (`ChordsEngine.ts`)

Die ChordsEngine hat 6 Voices, jede mit einem `OscillatorNode`. Bei `synthType === "wavetable"`:

```typescript
osc.setPeriodicWave(getWavetable(ctx, params.wavetable ?? "harmonic"));
```

Bei `synthType === "subtractive"`:

```typescript
osc.type = params.waveform; // bestehende Logik
```

`setParams()` handled Hot-Swap: bei Änderung von `synthType` oder `wavetable` alle 6 Voices aktualisieren. Kein Neustart der Engine nötig.

### 1.3 UI (`ChordsSequencer.tsx`)

Unter dem Waveform-Selector ein neuer Abschnitt **"SYNTH"**:

- `SUBTR` / `WAVE` Toggle-Buttons für `synthType`
- Bei `WAVE` aktiv: 8 Wavetable-Buttons (dieselben Labels wie in BassSequencer/MelodySequencer)
- Styling und Pattern identisch mit dem bestehenden Wavetable-UI in `BassSequencer.tsx`

### 1.4 Store (`chordsStore.ts`)

`DEFAULT_CHORD_PARAMS` um `synthType: "subtractive"` und `wavetable: "harmonic"` erweitern. Serialisierung funktioniert automatisch über den bestehenden Mechanismus.

---

## 2. Neue Presets

### 2.1 Chords — 12 neue Presets (`chordsStore.ts`)

Kategorie **"Pads & Textures"** (Wavetable-basiert):

| Name | synthType | wavetable | Charakter |
|------|-----------|-----------|-----------|
| Warm Strings | wavetable | warm | Langsamer Attack, breites Spread, leichter Chorus |
| Choir Pad | wavetable | hollow | Mittlerer Attack, hohe Brightness, sanfter Chorus |
| Analog Poly | wavetable | harmonic | Mittlerer Attack, Detune, analoger Charakter |
| Electric Piano | wavetable | nasal | Kurzer Attack, mittlerer Release, leichte Distortion |
| Ambient Glass | wavetable | bright | Langsamer Attack, langer Release, hohe Brightness |
| Reese Chords | wavetable | buzzy | Mittlerer Attack, Detune, leichte Distortion |
| Soft Pad | wavetable | soft | Langer Attack, langer Release, kein Chorus |
| Bright Synth | wavetable | bright | Kurzer Attack, mittlere Cutoff, Spread |

Kategorie **"Stabs"** (Subtractive, ergänzend):

| Name | Charakter |
|------|-----------|
| House Stab | Kurzer Attack/Release, hohe Cutoff, mittlere Resonanz |
| Techno Chord | Sehr kurzer Attack, mittlere Cutoff, Distortion |
| Funk Stab | Kurzer Attack, hohes EnvMod, Chorus |
| Jazz Voicing | Mittlerer Attack, warme Cutoff, kein Chorus |

### 2.2 Melody — 8 neue Presets (`melodyStore.ts`)

Kategorie **"Expressive"**:

| Name | synthType | Charakter |
|------|-----------|-----------|
| FM Bell | fm | Hoher fmModIndex, kurzer Decay, Bell-Charakter |
| FM Rhodes | fm | Mittlerer fmModIndex, mittlerer Decay, Piano-ähnlich |
| FM Marimba | fm | Niedriger fmHarmonicity, kurzer Decay, perkussiv |
| Pluck Lead | pluck | Kurze Attack, mittlerer Decay, Resonanz |
| Nylon Pluck | pluck | Sehr kurzer Decay, warme Cutoff, kein Unison |
| Synth Stab | subtractive | PWM, kurzer Decay, Unison |
| Glass Lead | subtractive | Hohe Brightness, mittlerer Decay, leichtes Vibrato |
| Acid Lead | subtractive | Hohe Resonanz, kurzer Decay, leichte Distortion |

### 2.3 Bass — 5 neue Presets (`bassStore.ts`)

Kategorie **"Classic"**:

| Name | Charakter |
|------|-----------|
| Deep Sub | Sehr niedrige Cutoff, kein EnvMod, reines Sub |
| Techno Kick-Bass | Sawtooth, kurzer Decay, Distortion |
| Reese Bass | Detuned Square, Distortion, langsamer Filter-LFO |
| Dub Bass | Sawtooth, langer Decay, Slide, tiefer Sub |
| Pluck Bass | Square, sehr kurzer Decay, mittlere Resonanz |

---

## 3. Was unverändert bleibt

- Alle bestehenden Presets in allen drei Stores — keine Änderungen
- Preset-Kits 1-6 (Zahlen-Presets) — völlig unberührt
- Bass LFO Presets (gestern hinzugefügt) — bleiben
- ChordsEngine Audio-Routing — keine Änderungen
- Alle anderen Engine-Parameter — unverändert

---

## 4. Implementierungsreihenfolge

1. `ChordsParams` um `synthType` + `wavetable` erweitern (Types)
2. `ChordsEngine.ts` — Wavetable-Modus in allen 6 Voices
3. `chordsStore.ts` — Default-Update + 12 neue Presets
4. `ChordsSequencer.tsx` — Wavetable-UI
5. `melodyStore.ts` — 8 neue Presets
6. `bassStore.ts` — 5 neue Presets
7. Build + Test

**Gesamtaufwand:** ~4-5 Stunden

---

## Out of Scope

- Sample-Playback für Chords (separates Projekt)
- Neue Wavetables hinzufügen (8 bestehende reichen)
- FM-Modus für Chords (Melody hat es bereits, Chords braucht es nicht)
- Änderungen am Audio-Routing
