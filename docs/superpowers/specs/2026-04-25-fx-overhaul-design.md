# FX Overhaul — Design Spec
**Datum:** 2026-04-25  
**Status:** Approved  
**Scope:** Routing-Fixes · Reverb-Upgrade · Delay-Upgrade · Echter Chorus · Kaoss Pad Improvements · FX Rack Tuning

---

## Ziel

Alle FX klingen professionell und hörbar. Der Kaoss Pad fühlt sich wie ein echtes Performance-Instrument an. Delay hat Tape-Charakter, Reverb hat echte Räumlichkeit, Chorus klingt wie Roland Juno. Keine bestehenden Presets, Kits oder Sequencer-Logik wird verändert.

---

## 1. Routing-Fixes

### 1.1 Kaoss Pad Auto-Sends (`src/components/FxPanel.tsx`)

**Problem:** REVERB/DELAY/CHORUS Modi im Kaoss Pad modifizieren nur den Output-Pegel des Buses, aber alle per-Channel-Sends sind auf 0 — kein Signal erreicht den Bus.

**Fix:** Beim Aktivieren eines Kaoss Pad Modes der Send-basierte FX nutzt (REVERB, DELAY, FLANGER), werden die Synth-Channels (12=Bass, 13=Chords, 14=Melody) auf einen musikalischen Default geöffnet. Beim Verlassen: sanfter Fade-back auf die vorherigen Werte.

```typescript
// Beim activateFxMode("reverb"):
const SYNTH_CHANNELS = [12, 13, 14];
const AUTO_SEND_LEVEL = 0.35;

// Save originals + open sends
savedSends.reverb = SYNTH_CHANNELS.map(ch => audioEngine.getChannelReverbSend(ch));
SYNTH_CHANNELS.forEach(ch => audioEngine.setChannelReverbSend(ch, AUTO_SEND_LEVEL));

// Beim deactivateFxMode():
SYNTH_CHANNELS.forEach((ch, i) => {
  audioEngine.setChannelReverbSend(ch, savedSends.reverb[i] ?? 0);
});
```

Drum-Channels (0–11) werden NICHT automatisch geöffnet.

### 1.2 FxRack Chorus Fix (`src/components/FxRack.tsx`)

```typescript
// Vorher (buggy):
audioEngine.setFlangerParams(rate, depth, 0.3);

// Nachher:
audioEngine.startFlanger();
audioEngine.setFlangerParams(rate, depth, 0.3);
```

### 1.3 Kaoss Pad Spring-Back (`src/components/PerformancePad.tsx`)

Ersetzt den aktuellen `setTimeout`-Loop durch AudioParam-Scheduling:

```typescript
// Statt 20x setTimeout:
const ctx = audioEngine.getAudioContext();
const t = ctx.currentTime;
// Nutze audioEngine-Methoden mit eingebauten Ramps (setTargetAtTime intern)
audioEngine.setReverbLevelSmooth(savedReverbLevel, 0.4); // 400ms Zeitkonstante
audioEngine.setDelayLevelSmooth(savedDelayLevel, 0.4);
```

`setReverbLevelSmooth(target, timeConstant)` und `setDelayLevelSmooth()` werden in `SendFx.ts` als neue Methoden ergänzt die intern `gainNode.gain.setTargetAtTime()` nutzen.

---

## 2. Reverb Upgrade (`src/audio/SendFx.ts`)

### 2.1 IR-Algorithmus

Neuer `generateIR(type, sampleRate, duration)` im Web Worker mit:

**Fibonacci-basierte Tap-Abstände** (statt linear):
```
tapTimes = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233] * baseMs
```
Verhindert Flutter-Echo und periodische Kämme.

**Frequency-Dependent Decay:**
```typescript
// Jedes Sample: Höhen sterben 2.5× schneller ab als Bässe
const hfDecay = Math.pow(dampingFactor, 2.5);
const lfDecay = Math.pow(dampingFactor, 1.0);
// Einfacher 1-Pol Tiefpass pro Reflection-Tap
```

**Stereo Decorrelation:**
L/R Kanäle nutzen leicht unterschiedliche Allpass-Filter-Koeffizienten (±5% Variation) → echte Stereobreite statt gephastem Mono.

**Pre-Delay Modulation:**
Minimale LFO-Modulation (±0.3ms @ 0.1Hz) auf dem Pre-Delay-Node gegen Metallic-Coloration.

### 2.2 4 Reverb-Typen

| Typ | Pre-Delay | Tail | Damping | Diffusion | Einsatz |
|-----|-----------|------|---------|-----------|---------|
| **Room** | 5ms | 0.9s | 6kHz | 8 Taps | Drums, natürlich |
| **Hall** | 18ms | 2.8s | 8kHz | 12 Taps | Pads, Chords |
| **Plate** | 2ms | 1.6s | 12kHz | 16 Taps | Melody, hell |
| **Spring** | 8ms | 1.2s | 3kHz | 6 Taps (mit Wiggle) | Bass, Retro |

Spring-Typ bekommt zusätzlich: sinusförmige Modulation der Tap-Zeiten (±15% @ 4Hz) für den fedrigen Charakter.

### 2.3 API-Erweiterung

```typescript
// Neu in SendFx.ts:
setReverbType(type: "room" | "hall" | "plate" | "spring"): void
setReverbLevelSmooth(target: number, timeConstant: number): void

// Neu in AudioEngine.ts:
setReverbType(type: ReverbType): void
setReverbLevelSmooth(target: number, timeConstant: number): void
```

### 2.4 FX Rack UI

`FxRack.tsx` — Reverb-Modul bekommt Typ-Dropdown:
```tsx
<select value={params.type} onChange={...}>
  <option value="room">ROOM</option>
  <option value="hall">HALL</option>
  <option value="plate">PLATE</option>
  <option value="spring">SPRING</option>
</select>
```
Default: `"hall"` (rückwärtskompatibel).

---

## 3. Delay Upgrade (`src/audio/SendFx.ts`)

### 3.1 3 Delay-Modi

**Clean** (bestehend, leicht verbesserte LP-Filter-Kurve):
```
Input → Delay → LP(4kHz) → Feedback → Output
```

**Tape** (neu):
```
Input → Delay → TapeSat → LP(3.2kHz, -2dB/repeat) → WowLFO → Feedback → Output
```
- `TapeSat`: Soft-Clip WaveShaper (asymmetrisch, warm)
- LP-Cutoff sinkt mit jeder Wiederholung: `cutoff = baseCutoff * Math.pow(0.92, repeatCount)`
- `WowLFO`: Sine @ 0.9Hz, ±0.6ms Delay-Zeit-Modulation

**Analog** (neu):
```
Input → Delay → BBDSat → LP(2.4kHz) → Detune(±2ct) → Feedback → Output
```
- `BBDSat`: Härtere WaveShaper-Kurve, mehr Oberton-Sättigung (BBD = Bucket-Brigade-Device)
- ±2 Cents Detune über zweiten Delay-Node

### 3.2 BPM Sync — alle Modi

```typescript
setDelayDivision(division: DelayDivision, bpm: number): void
// Divisionen: "1/32" | "1/16" | "1/16d" | "1/8" | "1/8d" | "1/4" | "1/4d" | "1/2"
// Punktierte Noten (d) = Factor × 1.5
// Funktioniert für Clean, Tape, Analog gleich
```

BPM wird vom globalen Store gelesen (`useDrumStore.getState().bpm`) — kein manueller Eintrag nötig.

### 3.3 API-Erweiterung

```typescript
// Neu in SendFx.ts:
setDelayMode(mode: "clean" | "tape" | "analog"): void
setDelayLevelSmooth(target: number, timeConstant: number): void

// Neu in AudioEngine.ts:
setDelayMode(mode: DelayMode): void
setDelayLevelSmooth(target: number, timeConstant: number): void
```

### 3.4 FX Rack UI

Delay-Modul bekommt Modus-Dropdown neben Division-Selector:
```tsx
<select value={params.mode} onChange={...}>
  <option value="clean">CLEAN</option>
  <option value="tape">TAPE</option>
  <option value="analog">ANALOG</option>
</select>
```

---

## 4. Echter Chorus (`src/audio/SendFx.ts` + `src/audio/AudioEngine.ts`)

### 4.1 Juno-Style 3-Voice Chorus

Komplett unabhängig vom Flanger. Eigene Node-Struktur in `SendFx.ts`:

```typescript
interface ChorusVoice {
  delay: DelayNode;        // Basis-Delay
  lfo: OscillatorNode;     // LFO
  lfoGain: GainNode;       // Depth-Skalierung
}

// 3 Voices:
const voices = [
  { baseDelay: 0.015, lfoRate: 0.80, lfoDepth: 0.006 },  // 15ms, 0.8Hz, ±6ms
  { baseDelay: 0.022, lfoRate: 1.10, lfoDepth: 0.008 },  // 22ms, 1.1Hz, ±8ms
  { baseDelay: 0.031, lfoRate: 0.65, lfoDepth: 0.005 },  // 31ms, 0.65Hz, ±5ms
];

// Audio Graph:
// Input → Splitter → [Voice1, Voice2, Voice3] → Merger → WetGain → Output
//       ↘ DryGain ────────────────────────────────────────────────→ Output
```

Stereo: Voice 1+3 → Left, Voice 2 → Right (leichte Stereobreite).

### 4.2 API

```typescript
// Neu (ersetzt setFlangerParams für Chorus-Zweck):
startChorus(): void
stopChorus(): void
setChorusRate(rate: number): void    // 0.5–4Hz
setChorusDepth(depth: number): void  // 0–1
setChorusLevel(level: number): void  // 0–1 wet

// Bestehende Flanger-API bleibt unverändert (für Kaoss Pad FLANGER Mode)
```

### 4.3 FxRack Chorus Fix

```typescript
// Vorher:
audioEngine.setFlangerParams(rate, depth, feedback);

// Nachher:
audioEngine.startChorus();
audioEngine.setChorusRate(rate);
audioEngine.setChorusDepth(depth);
```

---

## 5. Kaoss Pad Improvements (`src/components/FxPanel.tsx`)

### 5.1 2 Neue Modi

**PHASER Mode:**
- X: Rate (0.05–6Hz, exponentiell)
- Y: Depth (0–1) + Feedback (0–0.7, skaliert mit Y)
- Implementation: `audioEngine.startPhaser()` + `setPhaserRate()` + `setPhaserFeedback()`
- Spring-back: Rate zurück auf 0.4Hz, Feedback auf 0.3

**CHORUS Mode:**
- X: Rate (0.5–4Hz)
- Y: Depth/Breite (0–1)
- Implementation: `audioEngine.startChorus()` + `setChorusRate()` + `setChorusDepth()`
- Spring-back: Rate 0.8Hz, Depth 0.3

Beide Modi erscheinen als neue Buttons in der Modus-Leiste des Kaoss Pads.

### 5.2 Spring-Back Verbesserung

```typescript
// PerformancePad.tsx — statt setTimeout-Loop:
function springBack(paramType: string, savedValue: number) {
  switch (paramType) {
    case "reverb":
      audioEngine.setReverbLevelSmooth(savedValue, 0.4);
      break;
    case "delay":
      audioEngine.setDelayLevelSmooth(savedValue, 0.4);
      break;
    // etc.
  }
}
```

---

## 6. FX Rack Modul-Verbesserungen (`src/audio/FxChain.ts`)

### 6.1 Bitcrusher

Neue WaveShaper-Kurve mit smootherem Aliasing:
```typescript
function buildBitcrushCurve(bits: number): Float32Array {
  const steps = Math.pow(2, bits);
  // Smooth-Quantisierung: leichtes Dithering ±0.5/steps verhindert harten Cliff
  const dither = 0.5 / steps;
  // curve[i] = round(x * steps + random(-dither, dither)) / steps
}
```

### 6.2 Autofilter

```typescript
// Breitere Rate-Range:
const rate = 0.02 + (params.rate / 100) ** 2 * 12;  // 0.02–12Hz exponentiell

// Depth-Kurve:
const depth = (params.depth / 100) ** 1.5 * 3500;  // exponentiell, max ±3500Hz

// Bessere Resonanz-Defaults: 
defaultQ = 3.5  // war 2.0 — mehr Charakter
```

### 6.3 Tremolo — Waveform-Auswahl

```typescript
type TremoloWaveform = "sine" | "square" | "triangle";

// Square-Waveform: Gate-Effekt (Sidechain-Feeling)
// PeriodicWave für Square statt OscillatorNode type (kein Bandbegrenzungs-Problem)
```

UI: 3 kleine Buttons (SIN / SQR / TRI) im Tremolo-Modul.

### 6.4 Ring Modulator

```typescript
// Erweiterter Frequenzbereich:
const freq = 1 + (params.freq / 100) ** 2 * 4999;  // 1–5000Hz exponentiell
// Sub-Bereich 1–20Hz = langsame Tremolo-Modulation
```

---

## 7. Was unverändert bleibt

- Alle bestehenden Presets (Bass, Chords, Melody, Drums)
- Preset-Kits 1-6
- Sequencer, Piano Roll, MixerBar
- Flanger-API (für Kaoss Pad FLANGER Mode)
- Phaser-Basis-Implementierung (wird nur für neuen Kaoss Pad Mode exponiert)
- Alle anderen AudioEngine-Methoden

---

## 8. Implementierungsreihenfolge

1. Routing-Fixes (SendFx smooth methods + FxPanel Auto-Sends + FxRack Chorus fix)
2. Echter Chorus (neue Node-Struktur, unabhängig von Flanger)
3. Reverb Upgrade (neuer IR-Algo + 4 Typen + UI)
4. Delay Upgrade (Tape/Analog Modi + BPM Sync alle Modi + UI)
5. Kaoss Pad 2 neue Modi (Phaser + Chorus) + Spring-Back Fix
6. FX Rack Modul-Verbesserungen (Bitcrusher, Autofilter, Tremolo, RingMod)
7. Build + Test

**Geschätzter Aufwand:** ~5 Stunden
