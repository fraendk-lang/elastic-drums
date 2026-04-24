# Premium Synth Sounds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wavetable-Modus für ChordsEngine + 25 neue Premium-Presets für Chords, Melody und Bass.

**Architecture:** ChordsEngine bekommt `synthType` und `wavetable` Parameter analog zu BassEngine/MelodyEngine. `getWavetable()` aus `Wavetables.ts` wird in `init()` und `setParams()` eingehängt. Neue Presets nutzen den `cp()`/`mp()`/`bp()`-Helper-Pattern der bestehenden Stores.

**Tech Stack:** React 18, TypeScript strict, Web Audio API (`OscillatorNode.setPeriodicWave`), Zustand, Vite

---

## File Map

| Datei | Aktion | Verantwortung |
|-------|--------|---------------|
| `src/audio/ChordsEngine.ts` | Modify | `synthType` + `wavetable` in Interface + Engine |
| `src/store/chordsStore.ts` | Modify | DEFAULT update + 12 neue Presets |
| `src/components/ChordsSequencer.tsx` | Modify | Wavetable-UI (Synth-Type Toggle + 8 Buttons) |
| `src/store/melodyStore.ts` | Modify | 8 neue Presets |
| `src/store/bassStore.ts` | Modify | 5 neue Presets |

---

## Task 1: ChordsParams Types + DEFAULT

**Files:**
- Modify: `src/audio/ChordsEngine.ts`

- [ ] **Step 1.1: Import hinzufügen**

In `src/audio/ChordsEngine.ts`, erste Zeile nach bestehenden Imports:

```typescript
import { getWavetable, type WavetableName } from "./Wavetables";
```

- [ ] **Step 1.2: ChordsParams Interface erweitern**

Nach dem letzten Feld `brightness: number;` im `ChordsParams` Interface hinzufügen:

```typescript
  synthType: "subtractive" | "wavetable";  // Default: "subtractive"
  wavetable?: WavetableName;               // Default: "harmonic"
```

- [ ] **Step 1.3: DEFAULT_CHORDS_PARAMS erweitern**

Nach `brightness: 0.3,` in `DEFAULT_CHORDS_PARAMS` hinzufügen:

```typescript
  synthType: "subtractive",
  wavetable: "harmonic",
```

- [ ] **Step 1.4: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Keine Fehler (neue Felder haben Defaults).

- [ ] **Step 1.5: Commit**

```bash
git add src/audio/ChordsEngine.ts
git commit -m "feat(chords): add synthType + wavetable fields to ChordsParams"
```

---

## Task 2: ChordsEngine — Wavetable-Modus implementieren

**Files:**
- Modify: `src/audio/ChordsEngine.ts`

- [ ] **Step 2.1: init() — Oscillator-Setup für Wavetable**

In `init()`, suche den Oscillator-Setup-Block in der Voice-Schleife. Aktuell:

```typescript
const osc = audioCtx.createOscillator();
osc.type = this.params.waveform;
osc.frequency.value = 261.63; // C4 default
osc.detune.value = this.params.detune * detuneSpread[i]!;
```

Ersetzen durch:

```typescript
const osc = audioCtx.createOscillator();
if (this.params.synthType === "wavetable") {
  osc.setPeriodicWave(getWavetable(audioCtx, this.params.wavetable ?? "harmonic"));
} else {
  osc.type = this.params.waveform;
}
osc.frequency.value = 261.63; // C4 default
osc.detune.value = this.params.detune * detuneSpread[i]!;
```

- [ ] **Step 2.2: setParams() — Hot-Swap für Wavetable**

In `setParams()`, suche den Waveform-Update-Block. Aktuell:

```typescript
if (normalized.waveform) {
  for (const voice of this.voices) {
    voice.osc.type = normalized.waveform;
  }
}
```

Ersetzen durch:

```typescript
if (normalized.waveform || normalized.synthType !== undefined || normalized.wavetable) {
  for (const voice of this.voices) {
    if (this.params.synthType === "wavetable") {
      if (!this.ctx) continue;
      voice.osc.setPeriodicWave(getWavetable(this.ctx, this.params.wavetable ?? "harmonic"));
    } else {
      voice.osc.type = this.params.waveform;
    }
  }
}
```

- [ ] **Step 2.3: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Keine Fehler.

- [ ] **Step 2.4: Manuell testen**

```bash
npm run dev
```

Chords-Tab öffnen → Preset laden → prüfen dass Sound unverändert klingt. Kein JS-Fehler in Console.

- [ ] **Step 2.5: Commit**

```bash
git add src/audio/ChordsEngine.ts
git commit -m "feat(chords): implement wavetable synthesis mode in ChordsEngine"
```

---

## Task 3: chordsStore — 12 neue Presets

**Files:**
- Modify: `src/store/chordsStore.ts`

- [ ] **Step 3.1: Preset-Kategorie "Wavetable Pads" hinzufügen**

In `src/store/chordsStore.ts`, suche das Ende des `CHORDS_PRESETS`-Arrays (vor `];`).

Füge die 12 neuen Presets ein. Die `cp()` Helper-Funktion ist bereits definiert als:
`const cp = (p: Partial<ChordsParams>): ChordsParams => ({ ...DEFAULT_CHORDS_PARAMS, ...p });`

```typescript
  // ── Wavetable Pads ──────────────────────────────────────────────────────────
  { name: "Warm Strings",    params: cp({ synthType: "wavetable", wavetable: "warm-stack",  cutoff: 3200, resonance: 2,  envMod: 0.12, attack: 320, release: 1800, detune: 18, distortion: 0.02, volume: 0.52, subOsc: 0.15, chorus: 0.62, spread: 0.92, brightness: 0.45 }) },
  { name: "Choir Pad",       params: cp({ synthType: "wavetable", wavetable: "vocal",       cutoff: 2800, resonance: 2,  envMod: 0.08, attack: 380, release: 2000, detune: 22, distortion: 0.01, volume: 0.48, subOsc: 0.10, chorus: 0.44, spread: 0.88, brightness: 0.55 }) },
  { name: "Analog Poly",     params: cp({ synthType: "wavetable", wavetable: "harmonic",    cutoff: 2400, resonance: 4,  envMod: 0.18, attack:  45, release:  900, detune: 28, distortion: 0.08, volume: 0.50, subOsc: 0.20, chorus: 0.32, spread: 0.70, brightness: 0.38 }) },
  { name: "Electric Piano",  params: cp({ synthType: "wavetable", wavetable: "pulse-25",    cutoff: 3600, resonance: 3,  envMod: 0.22, attack:  10, release:  420, detune:  8, distortion: 0.04, volume: 0.54, subOsc: 0.08, chorus: 0.16, spread: 0.42, brightness: 0.60 }) },
  { name: "Ambient Glass",   params: cp({ synthType: "wavetable", wavetable: "glass",       cutoff: 5000, resonance: 5,  envMod: 0.10, attack: 500, release: 2000, detune: 12, distortion: 0.01, volume: 0.44, subOsc: 0.05, chorus: 0.28, spread: 0.78, brightness: 0.72 }) },
  { name: "Hollow Pad",      params: cp({ synthType: "wavetable", wavetable: "hollow",      cutoff: 2200, resonance: 3,  envMod: 0.14, attack: 420, release: 1600, detune: 20, distortion: 0.02, volume: 0.50, subOsc: 0.12, chorus: 0.50, spread: 0.86, brightness: 0.40 }) },
  { name: "Bright Arp Pad",  params: cp({ synthType: "wavetable", wavetable: "bright-saw",  cutoff: 4800, resonance: 6,  envMod: 0.25, attack:  18, release:  340, detune: 14, distortion: 0.06, volume: 0.50, subOsc: 0.10, chorus: 0.20, spread: 0.60, brightness: 0.65 }) },
  { name: "Digital Stack",   params: cp({ synthType: "wavetable", wavetable: "digital",     cutoff: 3000, resonance: 8,  envMod: 0.30, attack:   8, release:  260, detune: 10, distortion: 0.12, volume: 0.48, subOsc: 0.06, chorus: 0.10, spread: 0.50, brightness: 0.52 }) },

  // ── Subtractive Stabs ───────────────────────────────────────────────────────
  { name: "House Stab",      params: cp({ synthType: "subtractive", waveform: "sawtooth",  cutoff: 4200, resonance: 8,  envMod: 0.45, attack:   5, release:  150, detune: 12, distortion: 0.08, volume: 0.58, subOsc: 0.15, chorus: 0.18, spread: 0.52, brightness: 0.50 }) },
  { name: "Techno Chord",    params: cp({ synthType: "subtractive", waveform: "square",    cutoff: 2800, resonance: 10, envMod: 0.55, attack:   3, release:  100, detune:  6, distortion: 0.22, volume: 0.54, subOsc: 0.20, chorus: 0.08, spread: 0.38, brightness: 0.35 }) },
  { name: "Funk Stab",       params: cp({ synthType: "subtractive", waveform: "sawtooth",  cutoff: 3500, resonance: 12, envMod: 0.60, attack:   8, release:  200, detune:  8, distortion: 0.10, volume: 0.56, subOsc: 0.10, chorus: 0.42, spread: 0.60, brightness: 0.48 }) },
  { name: "Jazz Voicing",    params: cp({ synthType: "subtractive", waveform: "triangle",  cutoff: 1800, resonance: 3,  envMod: 0.12, attack:  22, release:  650, detune:  6, distortion: 0.02, volume: 0.50, subOsc: 0.08, chorus: 0.22, spread: 0.44, brightness: 0.32 }) },
```

- [ ] **Step 3.2: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Keine Fehler.

- [ ] **Step 3.3: Commit**

```bash
git add src/store/chordsStore.ts
git commit -m "feat(chords): add 12 premium presets (8 wavetable pads + 4 stabs)"
```

---

## Task 4: ChordsSequencer — Wavetable-UI

**Files:**
- Modify: `src/components/ChordsSequencer.tsx`

- [ ] **Step 4.1: WavetableName Import sicherstellen**

Am Anfang von `src/components/ChordsSequencer.tsx`, prüfe ob `WavetableName` und `WAVETABLE_NAMES` importiert werden. Falls nicht, zum bestehenden ChordsEngine-Import hinzufügen:

```typescript
import { type ChordsParams, type WavetableName } from "../audio/ChordsEngine";
import { WAVETABLE_NAMES } from "../audio/Wavetables";
```

- [ ] **Step 4.2: Synth-Type Toggle + Wavetable-Buttons einfügen**

Suche in `ChordsSequencer.tsx` den Waveform-Buttons-Block:

```tsx
{/* Waveform: SAW, SQR, TRI */}
<WaveBtn active={params.waveform === "sawtooth"} onClick={() => setParam("waveform", "sawtooth")} label="SAW" />
<WaveBtn active={params.waveform === "square"} onClick={() => setParam("waveform", "square")} label="SQR" />
<WaveBtn active={params.waveform === "triangle"} onClick={() => setParam("waveform", "triangle")} label="TRI" />
```

**Davor** (als neuen Block) einfügen:

```tsx
{/* Synth Type: SUBTR / WAVE */}
<div className="flex gap-1 mb-1">
  <WaveBtn
    active={params.synthType !== "wavetable"}
    onClick={() => setParam("synthType", "subtractive")}
    label="SUBTR"
  />
  <WaveBtn
    active={params.synthType === "wavetable"}
    onClick={() => setParam("synthType", "wavetable")}
    label="WAVE"
  />
</div>

{/* Wavetable selector — only visible when WAVE active */}
{params.synthType === "wavetable" && (
  <div className="flex flex-wrap gap-1 mb-1">
    {WAVETABLE_NAMES.map((wt) => (
      <WaveBtn
        key={wt}
        active={params.wavetable === wt}
        onClick={() => setParam("wavetable", wt)}
        label={wt.toUpperCase().slice(0, 6)}
      />
    ))}
  </div>
)}
```

- [ ] **Step 4.3: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Falls `setParam` den Typ nicht akzeptiert (z.B. für `wavetable`-Feld), prüfe den Typ von `setParam` in der Komponente. Der Typ-Fehler entsteht wenn `setParam` nur bekannte Schlüssel von `ChordsParams` akzeptiert — dann ist kein Fix nötig, `wavetable` ist bereits im Interface.

- [ ] **Step 4.4: Manuell testen**

```bash
npm run dev
```

Chords-Tab → neuer "SUBTR / WAVE" Toggle erscheint → WAVE klicken → 8 Wavetable-Buttons erscheinen → "WARM-STACK" klicken → Sound ändert sich auf Wavetable-Charakter.

- [ ] **Step 4.5: Commit**

```bash
git add src/components/ChordsSequencer.tsx
git commit -m "feat(chords): add synthType toggle + wavetable selector to ChordsSequencer"
```

---

## Task 5: melodyStore — 8 neue Presets

**Files:**
- Modify: `src/store/melodyStore.ts`

- [ ] **Step 5.1: Neue Presets am Ende des MELODY_PRESETS Arrays einfügen**

Suche das Ende des `MELODY_PRESETS`-Arrays (vor `];`). Die `mp()` Helper-Funktion ist definiert als:
`const mp = (p: Partial<MelodyParams>): MelodyParams => ({ ...DEFAULT_MELODY_PARAMS, ...p });`

Füge die 8 neuen Presets ein:

```typescript
  // ── Expressive ──────────────────────────────────────────────────────────────
  { name: "FM Bell",      params: mp({ synthType: "fm",          filterModel: "lpf", cutoff: 8000, resonance:  2, envMod: 0.05, decay:  70, accent: 0.30, distortion: 0.02, volume: 0.54, subOsc: 0.00, unison: 0.00, vibratoRate: 0.5, vibratoDepth: 0.00, fmHarmonicity: 8,  fmModIndex: 32 }) },
  { name: "FM Rhodes",    params: mp({ synthType: "fm",          filterModel: "lpf", cutoff: 5000, resonance:  2, envMod: 0.10, decay: 260, accent: 0.25, distortion: 0.03, volume: 0.52, subOsc: 0.10, unison: 0.00, vibratoRate: 4.0, vibratoDepth: 0.04, fmHarmonicity: 3,  fmModIndex: 12 }) },
  { name: "FM Marimba",   params: mp({ synthType: "fm",          filterModel: "lpf", cutoff: 7000, resonance:  3, envMod: 0.08, decay:  55, accent: 0.20, distortion: 0.01, volume: 0.56, subOsc: 0.00, unison: 0.00, vibratoRate: 0.5, vibratoDepth: 0.00, fmHarmonicity: 2,  fmModIndex:  6 }) },
  { name: "Pluck Lead",   params: mp({ synthType: "pluck",       filterModel: "lpf", cutoff: 4500, resonance: 10, envMod: 0.35, decay: 210, accent: 0.40, distortion: 0.05, volume: 0.54, subOsc: 0.05, unison: 0.15, vibratoRate: 0.5, vibratoDepth: 0.00, fmHarmonicity: 1,  fmModIndex:  0 }) },
  { name: "Nylon Pluck",  params: mp({ synthType: "pluck",       filterModel: "lpf", cutoff: 2200, resonance:  4, envMod: 0.20, decay: 120, accent: 0.20, distortion: 0.01, volume: 0.52, subOsc: 0.00, unison: 0.00, vibratoRate: 0.5, vibratoDepth: 0.00, fmHarmonicity: 1,  fmModIndex:  0 }) },
  { name: "PWM Stab",     params: mp({ synthType: "subtractive", waveform: "square", filterModel: "ladder", cutoff: 2600, resonance: 8, envMod: 0.40, decay: 110, accent: 0.45, distortion: 0.10, volume: 0.52, subOsc: 0.10, pulseWidth: 0.70, unison: 0.40, vibratoRate: 0.5, vibratoDepth: 0.00, fmHarmonicity: 1, fmModIndex: 0 }) },
  { name: "Glass Lead",   params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "steiner-bp", cutoff: 5500, resonance: 6, envMod: 0.15, decay: 180, accent: 0.30, distortion: 0.03, volume: 0.50, subOsc: 0.00, unison: 0.20, vibratoRate: 5.0, vibratoDepth: 0.06, fmHarmonicity: 1, fmModIndex: 0 }) },
  { name: "Acid Lead",    params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 800, resonance: 22, envMod: 0.70, decay:  80, accent: 0.60, distortion: 0.28, volume: 0.54, subOsc: 0.10, unison: 0.00, vibratoRate: 0.5, vibratoDepth: 0.00, fmHarmonicity: 1, fmModIndex: 0 }) },
```

- [ ] **Step 5.2: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Keine Fehler. Falls Felder fehlen, mit `DEFAULT_MELODY_PARAMS`-Werten auffüllen.

- [ ] **Step 5.3: Commit**

```bash
git add src/store/melodyStore.ts
git commit -m "feat(melody): add 8 expressive presets (FM bells, plucks, leads)"
```

---

## Task 6: bassStore — 5 neue Presets

**Files:**
- Modify: `src/store/bassStore.ts`

- [ ] **Step 6.1: Neue Bass-Presets einfügen**

Suche das Ende des `BASS_PRESETS`-Arrays (vor dem letzten `];`). Die `bp()` Helper-Funktion ist:
`const bp = (p: Partial<BassParams>): BassParams => ({ ...DEFAULT_BASS_PARAMS, ...p });`

Füge vor den LFO-Presets (oder am Ende) die 5 neuen Presets ein:

```typescript
  // ── Classic Bass ────────────────────────────────────────────────────────────
  { name: "Deep Sub",       params: bp({ waveform: "square",   cutoff: 180, resonance:  1, envMod: 0.03, decay: 650, accent: 0.12, slideTime:  40, distortion: 0.02, volume: 0.85, subOsc: 0.95, filterModel: "ladder", punch: 0.10, harmonics: 0.02, subFilter: 38 }) },
  { name: "Techno Stab",    params: bp({ waveform: "sawtooth", cutoff: 650, resonance:  8, envMod: 0.55, decay:  95, accent: 0.55, slideTime:  20, distortion: 0.38, volume: 0.68, subOsc: 0.20, filterModel: "ladder", punch: 0.35, harmonics: 0.10, subFilter: 80 }) },
  { name: "Reese Bass",     params: bp({ waveform: "square",   cutoff: 380, resonance:  6, envMod: 0.15, decay: 400, accent: 0.25, slideTime:  60, distortion: 0.32, volume: 0.65, subOsc: 0.35, filterModel: "ladder", punch: 0.15, harmonics: 0.08, subFilter: 70, lfoEnabled: true, lfoTarget: "filter", lfoShape: "sine", lfoRate: 0.8, lfoDepth: 0.28, lfoSync: false }) },
  { name: "Dub Bass",       params: bp({ waveform: "sawtooth", cutoff: 340, resonance:  4, envMod: 0.10, decay: 620, accent: 0.20, slideTime:  90, distortion: 0.04, volume: 0.72, subOsc: 0.62, filterModel: "ladder", punch: 0.12, harmonics: 0.04, subFilter: 60 }) },
  { name: "Pluck Bass",     params: bp({ waveform: "square",   cutoff: 820, resonance: 14, envMod: 0.65, decay:  75, accent: 0.45, slideTime:  10, distortion: 0.08, volume: 0.66, subOsc: 0.15, filterModel: "ladder", punch: 0.40, harmonics: 0.12, subFilter: 80 }) },
```

- [ ] **Step 6.2: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Keine Fehler.

- [ ] **Step 6.3: Commit**

```bash
git add src/store/bassStore.ts
git commit -m "feat(bass): add 5 classic bass presets (Sub, Techno Stab, Reese, Dub, Pluck)"
```

---

## Task 7: Final Build + Test

**Files:** keine neuen

- [ ] **Step 7.1: Production Build**

```bash
npm run build 2>&1 | tail -15
```

Expected: Kein Chunk > 1MB, keine TypeScript-Fehler, `✓ built in` Meldung.

- [ ] **Step 7.2: Smoke Test**

```bash
npm run dev
```

Manuell prüfen:
- [ ] Chords-Tab → "SUBTR / WAVE" Toggle sichtbar
- [ ] WAVE aktiv → 8 Wavetable-Buttons (HARMON, BRIGHT-S, HOLLOW, GLASS, VOCAL, PULSE-2, DIGITA, WARM-ST)
- [ ] "Warm Strings" Preset laden → WAVE-Modus aktiv, Pad-Sound mit langem Attack
- [ ] "House Stab" Preset laden → SUBTR-Modus, kurzer Stab-Sound
- [ ] Melody-Tab → "FM Bell" Preset laden → heller Glocken-Charakter
- [ ] Melody-Tab → "Pluck Lead" laden → perkussiver Pluck-Sound
- [ ] Bass-Tab → "Deep Sub" laden → sehr tiefer, weicher Sub
- [ ] Alle bestehenden Presets (1-6 Preset-Kits) unverändert

- [ ] **Step 7.3: Finaler Commit**

```bash
git add -A
git commit -m "feat: premium synth sounds — wavetable chords, 25 new presets

- Wavetable synthesis mode for ChordsEngine (8 tables: harmonic, bright-saw, hollow, glass, vocal, pulse-25, digital, warm-stack)
- 12 new chord presets: 8 wavetable pads (Warm Strings, Choir Pad, Analog Poly, Electric Piano, Ambient Glass, Hollow Pad, Bright Arp Pad, Digital Stack) + 4 subtractive stabs
- 8 new melody presets: FM Bells/Rhodes/Marimba, Pluck Lead/Nylon, PWM Stab, Glass Lead, Acid Lead
- 5 new bass presets: Deep Sub, Techno Stab, Reese Bass, Dub Bass, Pluck Bass"
```

---

## Spec Coverage Check

| Spec-Requirement | Task |
|-----------------|------|
| `synthType` + `wavetable` in ChordsParams | Task 1 |
| Wavetable-Modus in init() alle 6 Voices | Task 2 |
| Hot-Swap in setParams() | Task 2 |
| DEFAULT_CHORDS_PARAMS aktualisiert | Task 1 |
| SUBTR/WAVE Toggle in UI | Task 4 |
| 8 Wavetable-Buttons in UI | Task 4 |
| 12 neue Chord-Presets | Task 3 |
| 8 neue Melody-Presets | Task 5 |
| 5 neue Bass-Presets | Task 6 |
| Bestehende Presets unverändert | Tasks 3,5,6 (append-only) |
| Preset-Kits 1-6 unberührt | alle Tasks (kein factoryKits.ts) |
