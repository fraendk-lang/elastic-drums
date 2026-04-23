# Elastic Drum Finalisierung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elastic Drum marktfähig machen: professioneller Mixer-Strip, Bass-LFO, neue Kits, bessere Sample-Suche, stabile Builds.

**Architecture:** Permanente MixerBar ersetzt den Fullscreen-Overlay als primäre Mixer-Ansicht. Bass-LFO läuft als JS-rate setInterval-Loop (konsistent mit dem bestehenden Filter-Envelope-Pattern). Alle neuen Stores folgen dem Zustand-Pattern der bestehenden Stores.

**Tech Stack:** React 18, TypeScript strict, Zustand, Web Audio API, Tailwind CSS, Vite

---

## File Map

| Datei | Aktion | Verantwortung |
|-------|--------|---------------|
| `src/audio/BassEngine.ts` | Modify | LFO OscillatorNode + setInterval loop |
| `src/store/bassStore.ts` | Modify | LFO-Felder in BassParams + DEFAULT_BASS_PARAMS + LFO-Presets |
| `src/components/BassSequencer.tsx` | Modify | LFO UI-Sektion |
| `src/kits/factoryKits.ts` | Modify | 4 neue Factory Kits |
| `src/components/SampleBrowser.tsx` | Modify | "All Voices" Suche über alle Kategorien |
| `src/components/ErrorBoundary.tsx` | Create | React ErrorBoundary Komponente |
| `src/App.tsx` | Modify | ErrorBoundary wraps + MixerBar einbinden |
| `src/store/mixerBarStore.ts` | Create | Persistierter Mixer-Zustand (Fader, Mute, Solo, Pan, EQ, Sends) |
| `src/components/MixerBar.tsx` | Create | Permanente Bottom-Bar, Compact + Expanded Strip |
| `package.json` | Modify | ARM64 optionalDependencies |

---

## Task 1: ARM64 Build Fix

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: optionalDependencies hinzufügen**

```json
// In package.json — nach "devDependencies" Block einfügen:
"optionalDependencies": {
  "@rollup/rollup-darwin-arm64": "^4.0.0",
  "@rollup/rollup-linux-x64-gnu": "^4.0.0"
}
```

- [ ] **Step 1.2: Installieren**

```bash
npm install
```

Expected: Keine Fehler. `node_modules/@rollup/rollup-darwin-arm64` existiert.

- [ ] **Step 1.3: Build verifizieren**

```bash
npm run build
```

Expected: Kein `Cannot find native module` Fehler.

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix: add rollup ARM64/Linux optional deps for cross-platform builds"
```

---

## Task 2: Error Boundaries

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 2.1: ErrorBoundary Komponente erstellen**

```tsx
// src/components/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  handleRetry = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-4 gap-2 bg-[var(--ed-bg-surface)] border border-red-900/40 rounded text-center">
          <span className="text-[9px] font-bold tracking-widest text-red-400 uppercase">Audio Error</span>
          <span className="text-[8px] text-[var(--ed-text-muted)] max-w-[200px]">
            {this.state.error?.message ?? "Unknown error"}
          </span>
          <button
            onClick={this.handleRetry}
            className="mt-1 px-3 py-1 text-[8px] font-bold tracking-widest uppercase bg-[var(--ed-bg-elevated)] border border-white/10 rounded hover:border-white/20 text-[var(--ed-text-muted)]"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2.2: ErrorBoundary in App.tsx um kritische Komponenten wrappen**

In `src/App.tsx`, füge den Import hinzu:
```tsx
import { ErrorBoundary } from "./components/ErrorBoundary";
```

Dann wrapping — suche nach der JSX-Rückgabe und wrapp die Hauptkomponente:

```tsx
// Ganz außen um den return-Inhalt von App():
<ErrorBoundary>
  {/* bestehender App-Inhalt */}
</ErrorBoundary>
```

- [ ] **Step 2.3: Build + Verify**

```bash
npm run build
```

Expected: Kein TypeScript-Fehler.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/App.tsx
git commit -m "feat: add ErrorBoundary for audio component crash recovery"
```

---

## Task 3: Bass LFO — Types

**Files:**
- Modify: `src/audio/BassEngine.ts` (BassParams interface + DEFAULT_BASS_PARAMS)

- [ ] **Step 3.1: LFO-Felder zu BassParams hinzufügen**

In `src/audio/BassEngine.ts`, ergänze das `BassParams` Interface nach dem `subFilter`-Feld:

```typescript
// Existing last field:
  subFilter: number;   // Sub lowpass cutoff (30-150Hz), default 80
// Add after:
  lfoEnabled:  boolean;                                              // Default: false
  lfoTarget:   "filter" | "pitch" | "volume";                       // Default: "filter"
  lfoShape:    "sine" | "triangle" | "sawtooth" | "square";         // Default: "sine"
  lfoRate:     number;   // 0.1–20 Hz (free), Default: 2.0
  lfoDepth:    number;   // 0–1, Default: 0.3
  lfoSync:     boolean;  // Sync rate to BPM, Default: false
  lfoSyncNote: "1/16" | "1/8" | "1/4" | "1/2" | "1" | "2" | "4"; // Default: "1/4"
```

- [ ] **Step 3.2: DEFAULT_BASS_PARAMS um LFO-Defaults erweitern**

In `DEFAULT_BASS_PARAMS` nach `subFilter: 80,` ergänzen:

```typescript
  lfoEnabled:  false,
  lfoTarget:   "filter",
  lfoShape:    "sine",
  lfoRate:     2.0,
  lfoDepth:    0.3,
  lfoSync:     false,
  lfoSyncNote: "1/4",
```

- [ ] **Step 3.3: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: Keine Fehler in BassEngine.ts.

- [ ] **Step 3.4: Commit**

```bash
git add src/audio/BassEngine.ts
git commit -m "feat(bass): add LFO type definitions to BassParams"
```

---

## Task 4: Bass LFO — Audio Engine Implementierung

**Files:**
- Modify: `src/audio/BassEngine.ts`

- [ ] **Step 4.1: Private LFO-Member hinzufügen**

In der `BassEngine`-Klasse, direkt nach `private _autoReleaseTimer` (Zeile ~135):

```typescript
  // LFO
  private _lfoInterval: ReturnType<typeof setInterval> | null = null;
  private _lfoPhase = 0;
  private _lfoLastTick = 0;
```

- [ ] **Step 4.2: LFO-Hilfsfunktion für Wellenform**

Direkt vor der `BassEngine`-Klasse (nach den Helper-Funktionen):

```typescript
function lfoWave(shape: BassParams["lfoShape"], phase: number): number {
  const p = ((phase % 1) + 1) % 1; // 0..1 normalized, always positive
  switch (shape) {
    case "sine":     return Math.sin(2 * Math.PI * p);
    case "triangle": return 1 - 4 * Math.abs(p - 0.5);
    case "sawtooth": return p * 2 - 1;
    case "square":   return p < 0.5 ? 1 : -1;
  }
}

/** Convert sync-note to beats (quarter note = 1 beat) */
const SYNC_BEATS: Record<BassParams["lfoSyncNote"], number> = {
  "1/16": 0.25, "1/8": 0.5, "1/4": 1, "1/2": 2, "1": 4, "2": 8, "4": 16,
};
```

- [ ] **Step 4.3: startLFO() Methode hinzufügen**

In der `BassEngine`-Klasse, nach `sweepLiveVolume()`:

```typescript
  /** Start or restart the LFO based on current params + BPM */
  startLFO(bpm = 120): void {
    this.stopLFO();
    if (!this.params.lfoEnabled || !this.ctx) return;

    const rate = this.params.lfoSync
      ? (bpm / 60) / SYNC_BEATS[this.params.lfoSyncNote]
      : this.params.lfoRate;

    this._lfoPhase = 0;
    this._lfoLastTick = performance.now();

    this._lfoInterval = setInterval(() => {
      if (!this.ctx) return;
      const now = performance.now();
      const dt = (now - this._lfoLastTick) / 1000;
      this._lfoLastTick = now;
      this._lfoPhase += rate * dt;

      const raw = lfoWave(this.params.lfoShape, this._lfoPhase);
      const depth = this.params.lfoDepth;

      switch (this.params.lfoTarget) {
        case "filter": {
          if (!this.filterChain) break;
          // ±2 octaves at depth=1 (4000Hz center range)
          const base = this.params.cutoff;
          const mod = raw * depth * base * 1.5;
          const freq = Math.max(50, Math.min(18000, base + mod));
          const res = Math.min(this.params.resonance / 30, 1.0);
          this.filterChain.update(freq, res, this.ctx.currentTime);
          break;
        }
        case "pitch": {
          if (!this.osc) break;
          // ±100 cents (1 semitone) at depth=1
          this.osc.detune.setValueAtTime(raw * depth * 100, this.ctx.currentTime);
          break;
        }
        case "volume": {
          if (!this.output) break;
          // Volume oscillates between (1-depth)*baseVol and baseVol
          // raw=-1..+1 → gain = baseVol * (1 - depth * (1-raw)/2)
          const baseVol = this.params.volume;
          const gain = Math.max(0, baseVol * (1 + raw * depth * 0.5));
          this.output.gain.setValueAtTime(gain, this.ctx.currentTime);
          break;
        }
      }
    }, 16); // ~60Hz
  }

  stopLFO(): void {
    if (this._lfoInterval !== null) {
      clearInterval(this._lfoInterval);
      this._lfoInterval = null;
    }
    // Reset modulated params to base values
    if (this.ctx) {
      if (this.filterChain) {
        const res = Math.min(this.params.resonance / 30, 1.0);
        this.filterChain.update(this.params.cutoff, res, this.ctx.currentTime);
      }
      if (this.osc) this.osc.detune.setValueAtTime(0, this.ctx.currentTime);
      if (this.output) this.output.gain.setValueAtTime(this.params.volume, this.ctx.currentTime);
    }
  }
```

- [ ] **Step 4.4: setParams() aktualisieren — LFO neu starten bei Parameteränderung**

In `setParams()`, am Ende der Methode (nach dem letzten `if (p.harmonics ...)` Block):

```typescript
    // Restart LFO if any LFO param changed
    if (
      p.lfoEnabled !== undefined ||
      p.lfoTarget  !== undefined ||
      p.lfoShape   !== undefined ||
      p.lfoRate    !== undefined ||
      p.lfoDepth   !== undefined ||
      p.lfoSync    !== undefined ||
      p.lfoSyncNote !== undefined
    ) {
      if (this.params.lfoEnabled) {
        this.startLFO();
      } else {
        this.stopLFO();
      }
    }
```

- [ ] **Step 4.5: destroy() aktualisieren — LFO stoppen**

In `destroy()`, nach `this.stopFilterEnvelope()` (oder wo andere Cleanups sind):

```typescript
    this.stopLFO();
```

- [ ] **Step 4.6: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: Keine Fehler.

- [ ] **Step 4.7: Commit**

```bash
git add src/audio/BassEngine.ts
git commit -m "feat(bass): implement LFO modulation engine (filter/pitch/volume)"
```

---

## Task 5: Bass LFO — Store + BassSequencer UI

**Files:**
- Modify: `src/store/bassStore.ts`
- Modify: `src/components/BassSequencer.tsx`

- [ ] **Step 5.1: bassStore — BPM-Change zu LFO-Restart weiterleiten**

In `src/store/bassStore.ts`, suche die `setParam`-Funktion und füge nach dem `bassEngine.setParams(p)` call hinzu:

```typescript
      // Restart LFO when BPM changes (LFO sync depends on BPM)
      if ('lfoEnabled' in p || 'lfoSync' in p || 'lfoSyncNote' in p || 'lfoRate' in p) {
        const bpm = useDrumStore?.getState?.()?.bpm ?? 120;
        bassEngine.startLFO(bpm);
      }
```

- [ ] **Step 5.2: BassSequencer — LFO UI-Abschnitt hinzufügen**

In `src/components/BassSequencer.tsx`, suche den Bereich wo andere Synth-Knob-Sektionen gerendert werden (nach `distortion`, `subOsc` etc.).

Füge nach dem letzten `<Knob>`-Block den LFO-Abschnitt ein:

```tsx
{/* ── LFO ─────────────────────────────────────── */}
<div className="border-t border-white/[0.06] pt-2 mt-1">
  <div className="flex items-center gap-2 mb-2">
    <span className="text-[8px] font-bold tracking-[0.2em] text-[var(--ed-text-muted)] uppercase">LFO</span>
    {/* Enable toggle */}
    <button
      onClick={() => setParam({ lfoEnabled: !params.lfoEnabled })}
      className={`px-2 py-0.5 text-[7px] font-bold tracking-widest uppercase rounded border transition-colors ${
        params.lfoEnabled
          ? "bg-[var(--ed-accent-bass)]/20 border-[var(--ed-accent-bass)]/60 text-[var(--ed-accent-bass)]"
          : "bg-transparent border-white/10 text-white/25 hover:border-white/20"
      }`}
    >
      {params.lfoEnabled ? "ON" : "OFF"}
    </button>
  </div>

  {params.lfoEnabled && (
    <div className="flex flex-col gap-2">
      {/* Target */}
      <div className="flex gap-1">
        {(["filter", "pitch", "volume"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setParam({ lfoTarget: t })}
            className={`flex-1 py-0.5 text-[7px] font-bold tracking-widest uppercase rounded border transition-colors ${
              params.lfoTarget === t
                ? "bg-[var(--ed-accent-bass)]/20 border-[var(--ed-accent-bass)]/60 text-[var(--ed-accent-bass)]"
                : "bg-transparent border-white/10 text-white/20 hover:border-white/20"
            }`}
          >
            {t === "filter" ? "FILT" : t === "pitch" ? "PITCH" : "VOL"}
          </button>
        ))}
      </div>

      {/* Shape */}
      <div className="flex gap-1">
        {([
          { id: "sine",     label: "~"  },
          { id: "triangle", label: "△"  },
          { id: "sawtooth", label: "/|" },
          { id: "square",   label: "⊓"  },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setParam({ lfoShape: id })}
            className={`flex-1 py-0.5 text-[9px] font-bold rounded border transition-colors ${
              params.lfoShape === id
                ? "bg-[var(--ed-accent-bass)]/20 border-[var(--ed-accent-bass)]/60 text-[var(--ed-accent-bass)]"
                : "bg-transparent border-white/10 text-white/20 hover:border-white/20"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Rate + Depth knobs */}
      <div className="flex gap-3 items-end">
        {!params.lfoSync && (
          <Knob
            label="RATE"
            value={params.lfoRate}
            min={0.1}
            max={20}
            step={0.01}
            onChange={(v) => setParam({ lfoRate: v })}
            color={BASS_COLOR}
            size={28}
          />
        )}
        <Knob
          label="DEPTH"
          value={params.lfoDepth * 100}
          min={0}
          max={100}
          step={1}
          onChange={(v) => setParam({ lfoDepth: v / 100 })}
          color={BASS_COLOR}
          size={28}
        />
        {/* BPM Sync toggle */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => setParam({ lfoSync: !params.lfoSync })}
            className={`px-1.5 py-0.5 text-[6px] font-bold tracking-widest uppercase rounded border transition-colors ${
              params.lfoSync
                ? "bg-[var(--ed-accent-bass)]/20 border-[var(--ed-accent-bass)]/60 text-[var(--ed-accent-bass)]"
                : "bg-transparent border-white/10 text-white/20 hover:border-white/20"
            }`}
          >
            SYNC
          </button>
          {params.lfoSync && (
            <select
              value={params.lfoSyncNote}
              onChange={(e) => setParam({ lfoSyncNote: e.target.value as BassParams["lfoSyncNote"] })}
              className="bg-[var(--ed-bg-elevated)] border border-white/10 text-[7px] text-[var(--ed-text-muted)] rounded px-1"
            >
              {(["1/16","1/8","1/4","1/2","1","2","4"] as const).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 5.3: BassParams Import in BassSequencer sicherstellen**

Am Anfang von `src/components/BassSequencer.tsx`, prüfe ob `BassParams` importiert wird:

```tsx
import { SCALES, ROOT_NOTES, scaleNote, type BassParams } from "../audio/BassEngine";
```

Falls `BassParams` noch nicht importiert: zu dem bestehenden Import aus `"../audio/BassEngine"` hinzufügen.

- [ ] **Step 5.4: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: Keine Fehler.

- [ ] **Step 5.5: Dev server testen**

```bash
npm run dev
```

Bass-Tab öffnen → LFO-Sektion erscheint unter den Synth-Knobs → ON schalten → Filter-Target → Wobble hörbar beim Spielen.

- [ ] **Step 5.6: Commit**

```bash
git add src/store/bassStore.ts src/components/BassSequencer.tsx
git commit -m "feat(bass): add LFO UI section to BassSequencer"
```

---

## Task 6: LFO Bass Presets

**Files:**
- Modify: `src/store/bassStore.ts`

- [ ] **Step 6.1: LFO-Presets zu BASS_PRESETS hinzufügen**

In `src/store/bassStore.ts`, suche das Ende des `BASS_PRESETS` Arrays (vor `];`).

Füge eine neue Kategorie hinzu:

```typescript
  // ── LFO / Modulation ──
  { name: "Wobble Bass",    params: bp({ waveform: "square",   cutoff: 380, resonance: 16, envMod: 0.50, decay: 160, accent: 0.40, slideTime:  60, distortion: 0.20, volume: 0.68, subOsc: 0.45, filterModel: "ladder", punch: 0.20,
    lfoEnabled: true,  lfoTarget: "filter",  lfoShape: "sine",     lfoRate: 2.0,  lfoDepth: 0.6, lfoSync: true,  lfoSyncNote: "1/4" }) },
  { name: "Trance Wobble",  params: bp({ waveform: "sawtooth", cutoff: 420, resonance: 22, envMod: 0.70, decay: 130, accent: 0.70, slideTime:  40, distortion: 0.30, volume: 0.62, subOsc: 0.30, filterModel: "ladder", punch: 0.25,
    lfoEnabled: true,  lfoTarget: "filter",  lfoShape: "sine",     lfoRate: 4.0,  lfoDepth: 0.7, lfoSync: true,  lfoSyncNote: "1/8" }) },
  { name: "Pitch Vibrato",  params: bp({ waveform: "sawtooth", cutoff: 500, resonance:  8, envMod: 0.40, decay: 200, accent: 0.35, slideTime:  80, distortion: 0.10, volume: 0.70, subOsc: 0.40, filterModel: "ladder",
    lfoEnabled: true,  lfoTarget: "pitch",   lfoShape: "sine",     lfoRate: 5.5,  lfoDepth: 0.4, lfoSync: false }) },
  { name: "Tremolo Sub",    params: bp({ waveform: "square",   cutoff: 250, resonance:  3, envMod: 0.08, decay: 500, accent: 0.15, slideTime:   0, distortion: 0.02, volume: 0.80, subOsc: 0.90, filterModel: "ladder", subFilter: 45,
    lfoEnabled: true,  lfoTarget: "volume",  lfoShape: "triangle", lfoRate: 6.0,  lfoDepth: 0.5, lfoSync: true,  lfoSyncNote: "1/8" }) },
  { name: "Slow Drift",     params: bp({ waveform: "sawtooth", cutoff: 320, resonance:  6, envMod: 0.25, decay: 400, accent: 0.20, slideTime: 100, distortion: 0.05, volume: 0.72, subOsc: 0.55, filterModel: "ladder",
    lfoEnabled: true,  lfoTarget: "filter",  lfoShape: "triangle", lfoRate: 0.3,  lfoDepth: 0.5, lfoSync: true,  lfoSyncNote: "1" }) },
  { name: "Saw Sweep",      params: bp({ waveform: "sawtooth", cutoff: 300, resonance: 14, envMod: 0.60, decay: 150, accent: 0.50, slideTime:  30, distortion: 0.35, volume: 0.60, subOsc: 0.25, filterModel: "ladder",
    lfoEnabled: true,  lfoTarget: "filter",  lfoShape: "sawtooth", lfoRate: 1.0,  lfoDepth: 0.8, lfoSync: true,  lfoSyncNote: "1/2" }) },
  { name: "Pulse Width",    params: bp({ waveform: "square",   cutoff: 400, resonance: 10, envMod: 0.45, decay: 130, accent: 0.45, slideTime:  20, distortion: 0.25, volume: 0.65, subOsc: 0.35,
    lfoEnabled: true,  lfoTarget: "pitch",   lfoShape: "square",   lfoRate: 8.0,  lfoDepth: 0.2, lfoSync: false }) },
  { name: "Deep Modulation",params: bp({ waveform: "square",   cutoff: 200, resonance:  5, envMod: 0.15, decay: 600, accent: 0.15, slideTime:  50, distortion: 0.05, volume: 0.75, subOsc: 0.80, filterModel: "ladder", subFilter: 48, punch: 0.10,
    lfoEnabled: true,  lfoTarget: "filter",  lfoShape: "sine",     lfoRate: 0.5,  lfoDepth: 0.4, lfoSync: true,  lfoSyncNote: "2" }) },
```

- [ ] **Step 6.2: bp() Hilfsfunktion prüfen — LFO-Defaults sicherstellen**

Suche in `bassStore.ts` die `bp()` Hilfsfunktion (oder wo DEFAULT_BASS_PARAMS verwendet wird). Stelle sicher, dass `bp()` die LFO-Defaults aus `DEFAULT_BASS_PARAMS` übernimmt wenn LFO-Felder fehlen:

```typescript
// Die bestehende bp() Funktion spread DEFAULT_BASS_PARAMS, dann überschreibt partial.
// Damit sind LFO-Felder automatisch mit Defaults gefüllt — kein Änderung nötig
// wenn bp() so aussieht:
function bp(partial: Partial<BassParams>): BassParams {
  return { ...DEFAULT_BASS_PARAMS, ...partial };
}
```

Falls `bp()` so nicht existiert, suche wie Presets definiert sind und passe an.

- [ ] **Step 6.3: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6.4: Commit**

```bash
git add src/store/bassStore.ts
git commit -m "feat(bass): add 8 LFO modulation presets to BASS_PRESETS"
```

---

## Task 7: Neue Factory Kits

**Files:**
- Modify: `src/kits/factoryKits.ts`

- [ ] **Step 7.1: 4 neue Kits am Ende des Arrays hinzufügen**

In `src/kits/factoryKits.ts`, suche das Ende des `export const FACTORY_KITS` Arrays (vor `];`).

Füge die 4 neuen Kits ein:

```typescript
  {
    id: "minimal-techno", name: "Minimal Techno", category: "Electro",
    tags: ["minimal", "techno", "detroit"], author: "Factory", bpmRange: [128, 140],
    description: "Sparse, hypnotic techno — every hit counts",
    voices: {
      0: { tune: 58, decay: 200, click: 60, drive: 35, sub: 30, pitch: 55 },
      1: { tune: 200, decay: 80, tone: 60, snap: 80, body: 30 },
      2: { decay: 180, tone: 2200, spread: 20, level: 70 },
      6: { tune: 400, decay: 25 }, 7: { tune: 400, decay: 120 },
      8: { tune: 500, decay: 400 }, 9: { tune: 600, decay: 500 },
      10: { tune: 900, decay: 60 }, 11: { tune: 1100, decay: 50 },
    },
    mix: {
      0: { pan: 0, reverbSend: 0.02, insertDrive: 0.25 },
      1: { pan: 0, reverbSend: 0.05 },
      6: { pan: -0.1, filterType: "highpass", filterFreq: 5000 },
      7: { pan: 0.1, reverbSend: 0.05 },
      8: { pan: -0.2, reverbSend: 0.08 },
    },
    masterFx: { reverbLevel: 0.10, saturation: 0.20, eqLow: 3, eqMid: -2, eqHigh: -1 },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 8], vel: [127, 100] },
      1: { steps: [4, 12], vel: [110, 90] },
      6: { steps: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], vel: [90,50,50,50,90,50,50,50,90,50,50,50,90,50,50,50] },
      8: { steps: [2, 14], vel: [70, 60] },
    }},
  },

  {
    id: "future-bass", name: "Future Bass", category: "Trap",
    tags: ["future-bass", "edm", "festival"], author: "Factory", bpmRange: [140, 160],
    description: "Punchy 808 kick, layered clap, euphoric cymbals",
    voices: {
      0: { tune: 42, decay: 700, click: 30, drive: 20, sub: 80, pitch: 42 },
      1: { tune: 220, decay: 150, tone: 55, snap: 70, body: 60 },
      2: { decay: 500, tone: 1600, spread: 80, level: 110 },
      6: { tune: 340, decay: 30 }, 7: { tune: 340, decay: 180 },
      8: { tune: 420, decay: 1200 }, 9: { tune: 500, decay: 1000 },
      10: { tune: 700, decay: 100 }, 11: { tune: 850, decay: 80 },
    },
    mix: {
      0: { pan: 0, reverbSend: 0.03 },
      1: { pan: 0, reverbSend: 0.20 },
      2: { pan: 0, reverbSend: 0.40 },
      6: { pan: -0.2 }, 7: { pan: 0.2, reverbSend: 0.12 },
      8: { pan: -0.3, reverbSend: 0.30 }, 9: { pan: 0.3, reverbSend: 0.25 },
    },
    masterFx: { reverbLevel: 0.35, saturation: 0.08, eqLow: 2, eqMid: 1, eqHigh: 3 },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 10], vel: [127, 105] },
      1: { steps: [4, 8, 12], vel: [115, 80, 110] },
      2: { steps: [4, 12], vel: [100, 90] },
      6: { steps: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], vel: [85,50,60,50,85,50,60,50,85,50,60,50,85,50,60,50] },
      8: { steps: [3, 15], vel: [75, 65] },
    }},
  },

  {
    id: "jungle-amen", name: "Jungle Amen", category: "DnB",
    tags: ["jungle", "amen", "breaks", "170bpm"], author: "Factory", bpmRange: [160, 175],
    description: "Raw jungle breaks — chopped amen energy",
    voices: {
      0: { tune: 65, decay: 180, click: 50, drive: 45, sub: 25, pitch: 52 },
      1: { tune: 230, decay: 120, tone: 70, snap: 85, body: 25 },
      2: { decay: 220, tone: 2800, spread: 40, level: 85 },
      3: { tune: 120, decay: 180 }, 4: { tune: 160, decay: 140 }, 5: { tune: 220, decay: 100 },
      6: { tune: 360, decay: 20 }, 7: { tune: 360, decay: 100 },
      8: { tune: 450, decay: 600 }, 9: { tune: 550, decay: 700 },
      10: { tune: 800, decay: 80 }, 11: { tune: 1000, decay: 60 },
    },
    mix: {
      0: { pan: 0, insertDrive: 0.30, reverbSend: 0.05 },
      1: { pan: 0, reverbSend: 0.12 },
      3: { pan: -0.3 }, 4: { pan: 0, reverbSend: 0.10 }, 5: { pan: 0.3 },
      6: { pan: -0.3 }, 7: { pan: 0.3, reverbSend: 0.08 },
      8: { pan: -0.4, reverbSend: 0.15 },
    },
    masterFx: { reverbLevel: 0.18, saturation: 0.25, eqLow: 2, eqMid: 1, eqHigh: 2 },
    pattern: { length: 16, swing: 52, tracks: {
      0: { steps: [0, 6, 10], vel: [127, 85, 105] },
      1: { steps: [3, 7, 11, 13], vel: [110, 75, 100, 65] },
      3: { steps: [4], vel: [80] },
      4: { steps: [12], vel: [70] },
      6: { steps: [0,1,2,4,5,6,8,9,10,12,13,14], vel: [80,50,60,80,45,65,80,50,55,75,45,60] },
      7: { steps: [2, 9], vel: [65, 55] },
    }},
  },

  {
    id: "afro-house", name: "Afro House", category: "World",
    tags: ["afro-house", "deep", "organic"], author: "Factory", bpmRange: [120, 128],
    description: "Deep Afro House — percussive, organic, hypnotic",
    voices: {
      0: { tune: 52, decay: 500, click: 25, drive: 15, sub: 55, pitch: 48 },
      1: { tune: 190, decay: 160, tone: 45, snap: 60, body: 65 },
      2: { decay: 400, tone: 1700, spread: 55, level: 85 },
      3: { tune: 110, decay: 250 }, 4: { tune: 150, decay: 200 }, 5: { tune: 190, decay: 170 },
      6: { tune: 320, decay: 35 }, 7: { tune: 320, decay: 200 },
      8: { tune: 380, decay: 900 }, 9: { tune: 460, decay: 850 },
      10: { tune: 700, decay: 130 }, 11: { tune: 900, decay: 110 },
    },
    mix: {
      0: { pan: 0, reverbSend: 0.08 },
      1: { pan: 0, reverbSend: 0.15 },
      3: { pan: -0.4, reverbSend: 0.20 }, 4: { pan: 0, reverbSend: 0.15 }, 5: { pan: 0.4, reverbSend: 0.18 },
      6: { pan: -0.2 }, 7: { pan: 0.2, reverbSend: 0.10 },
      10: { pan: -0.3, reverbSend: 0.25 }, 11: { pan: 0.3, reverbSend: 0.20 },
    },
    masterFx: { reverbLevel: 0.30, saturation: 0.05, eqLow: 2, eqMid: 0, eqHigh: 1 },
    pattern: { length: 16, swing: 56, tracks: {
      0: { steps: [0, 8], vel: [127, 95] },
      1: { steps: [4, 12], vel: [105, 90] },
      3: { steps: [2, 6, 14], vel: [80, 65, 75] },
      4: { steps: [10], vel: [70] },
      5: { steps: [3, 7, 11], vel: [65, 70, 60] },
      6: { steps: [0,2,4,6,8,10,12,14], vel: [85,50,80,50,85,50,80,50] },
      7: { steps: [1, 5, 9, 13], vel: [60, 55, 60, 50] },
      10: { steps: [1, 9], vel: [70, 65] },
      11: { steps: [5, 13], vel: [60, 55] },
    }},
  },
```

- [ ] **Step 7.2: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7.3: Commit**

```bash
git add src/kits/factoryKits.ts
git commit -m "feat: add 4 new factory kits (Minimal Techno, Future Bass, Jungle Amen, Afro House)"
```

---

## Task 8: SampleBrowser — Suche über alle Kategorien bei Freitext

**Files:**
- Modify: `src/components/SampleBrowser.tsx`

**Analyse:** Der SampleBrowser hat bereits `scope="all"` das alle Samples zeigt, und `activeCategory` das pro Kategorie filtert. Problem: wenn eine Kategorie gewählt ist + Suchbegriff eingegeben wird, werden nur Samples dieser Kategorie durchsucht. Fix: bei aktivem `searchQuery` den `activeCategory`-Filter aufheben.

- [ ] **Step 8.1: filteredSamples useMemo anpassen**

Suche in `src/components/SampleBrowser.tsx` den `filteredSamples`-Block (ca. Zeile 180):

```typescript
// VORHER (ca. Zeile 181-192):
const filteredSamples = useMemo(() => (
  availableSamples.filter((sample) => {
    if (activeCategory && sample.category !== activeCategory) return false;
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return [
      sample.name,
      sample.id,
      sample.pack ?? "",
      CATEGORY_NAMES[sample.category],
    ].some((value) => value.toLowerCase().includes(query));
  })
), [availableSamples, activeCategory, activePack, searchQuery]);

// NACHHER — bei aktivem searchQuery wird activeCategory ignoriert:
const filteredSamples = useMemo(() => (
  availableSamples.filter((sample) => {
    // When searching: ignore category filter so results come from all categories
    if (!searchQuery && activeCategory && sample.category !== activeCategory) return false;
    if (activePack && sample.pack !== activePack) return false;
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return [
      sample.name,
      sample.id,
      sample.pack ?? "",
      CATEGORY_NAMES[sample.category],
    ].some((value) => value.toLowerCase().includes(query));
  })
), [availableSamples, activeCategory, activePack, searchQuery]);
```

- [ ] **Step 8.2: Such-Placeholder verbessern**

Suche den `<input>` für die Suche (ca. Zeile 490) und aktualisiere den `placeholder`:

```tsx
// VORHER:
placeholder="Search samples..."

// NACHHER:
placeholder={searchQuery ? "Searching all categories…" : "Search samples…"}
```

- [ ] **Step 8.3: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Keine Fehler.

- [ ] **Step 8.4: Manuell testen**

```bash
npm run dev
```

Sample Browser öffnen → Kategorie "kicks" wählen → Suchbegriff "snare" eingeben → Snare-Samples aus allen Kategorien erscheinen (nicht nur Kicks). Suche leeren → nur Kick-Samples sichtbar.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/SampleBrowser.tsx
git commit -m "feat: SampleBrowser search spans all categories when query is active"
```

---

## Task 9: MixerBar Store

**Files:**
- Create: `src/store/mixerBarStore.ts`

- [ ] **Step 9.1: mixerBarStore erstellen**

```typescript
// src/store/mixerBarStore.ts
/**
 * Mixer Bar Store — persistent channel state for the permanent MixerBar.
 * 15 channels (0-11: drums, 12: bass, 13: chords, 14: lead).
 * State persists within the session (not in IndexedDB).
 */

import { create } from "zustand";

export const NUM_MIXER_CHANNELS = 15;

/** Fader position 0-1000 (750 = 0dB unity) */
export type FaderPos = number;

export interface ChannelMixState {
  fader:   FaderPos;   // 0-1000, 750 = unity
  muted:   boolean;
  soloed:  boolean;
  pan:     number;     // -1 to +1
  eqLo:    number;     // -12 to +12 dB
  eqMid:   number;     // -12 to +12 dB
  eqHi:    number;     // -12 to +12 dB
  sendRev: number;     // 0-100
  sendDly: number;     // 0-100
}

const defaultChannel = (): ChannelMixState => ({
  fader: 750, muted: false, soloed: false,
  pan: 0, eqLo: 0, eqMid: 0, eqHi: 0,
  sendRev: 0, sendDly: 0,
});

interface MixerBarState {
  channels: ChannelMixState[];
  expandedChannel: number | null;  // which channel strip is expanded
  setFader:   (ch: number, val: FaderPos) => void;
  setMute:    (ch: number, muted: boolean) => void;
  setSolo:    (ch: number, soloed: boolean) => void;
  setPan:     (ch: number, pan: number) => void;
  setEQ:      (ch: number, band: "lo" | "mid" | "hi", gain: number) => void;
  setSendRev: (ch: number, val: number) => void;
  setSendDly: (ch: number, val: number) => void;
  setExpanded:(ch: number | null) => void;
}

export const useMixerBarStore = create<MixerBarState>((set) => ({
  channels: Array.from({ length: NUM_MIXER_CHANNELS }, defaultChannel),
  expandedChannel: null,

  setFader: (ch, val) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, fader: val }; return { channels: c }; }),

  setMute: (ch, muted) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, muted }; return { channels: c }; }),

  setSolo: (ch, soloed) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, soloed }; return { channels: c }; }),

  setPan: (ch, pan) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, pan }; return { channels: c }; }),

  setEQ: (ch, band, gain) =>
    set((s) => {
      const c = [...s.channels];
      const field = band === "lo" ? "eqLo" : band === "mid" ? "eqMid" : "eqHi";
      c[ch] = { ...c[ch]!, [field]: gain };
      return { channels: c };
    }),

  setSendRev: (ch, val) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, sendRev: val }; return { channels: c }; }),

  setSendDly: (ch, val) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, sendDly: val }; return { channels: c }; }),

  setExpanded: (ch) => set({ expandedChannel: ch }),
}));

/** Logarithmic fader law: position (0..1) → gain */
export function faderToGain(pos: number): number {
  const p = pos / 1000;
  if (p <= 0) return 0;
  // S-curve: unity at 0.75
  const x = p / 0.75;
  return x < 1 ? x * x * x * 0.5 + 0.5 * x : 1 + (x - 1) * 1.5;
}
```

- [ ] **Step 9.2: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9.3: Commit**

```bash
git add src/store/mixerBarStore.ts
git commit -m "feat(mixer): add persistent MixerBar Zustand store"
```

---

## Task 10: MixerBar Komponente

**Files:**
- Create: `src/components/MixerBar.tsx`

- [ ] **Step 10.1: MixerBar.tsx erstellen**

```tsx
// src/components/MixerBar.tsx
/**
 * MixerBar — Permanent bottom mixer strip.
 *
 * Compact mode (always visible):
 *   channel name | peak meter | volume fader | M/S buttons
 *
 * Expanded mode (click channel header):
 *   + EQ Hi/Mid/Lo knobs | Rev/Dly send knobs | Pan knob | FX indicator
 */

import { useEffect, useRef, useCallback } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useMixerBarStore, faderToGain, NUM_MIXER_CHANNELS } from "../store/mixerBarStore";
import { Knob } from "./Knob";

// ── Channel meta ──────────────────────────────────────────────────────────────

const CHANNELS: { id: number; label: string; color: string }[] = [
  { id:  0, label: "KICK",  color: "#f59e0b" },
  { id:  1, label: "SNARE", color: "#f59e0b" },
  { id:  2, label: "CLAP",  color: "#f59e0b" },
  { id:  3, label: "TOM L", color: "#f59e0b" },
  { id:  4, label: "TOM M", color: "#f59e0b" },
  { id:  5, label: "TOM H", color: "#f59e0b" },
  { id:  6, label: "HH CL", color: "#3b82f6" },
  { id:  7, label: "HH OP", color: "#3b82f6" },
  { id:  8, label: "CYM",   color: "#3b82f6" },
  { id:  9, label: "RIDE",  color: "#3b82f6" },
  { id: 10, label: "PRC 1", color: "#8b5cf6" },
  { id: 11, label: "PRC 2", color: "#8b5cf6" },
  { id: 12, label: "BASS",  color: "#10b981" },
  { id: 13, label: "CHRD",  color: "#a78bfa" },
  { id: 14, label: "LEAD",  color: "#f472b6" },
];

// ── Peak meter per channel ────────────────────────────────────────────────────

function useMeterData() {
  const peakRef = useRef<number[]>(new Array(NUM_MIXER_CHANNELS).fill(-Infinity));
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(new Array(NUM_MIXER_CHANNELS).fill(null));
  const rafRef = useRef(0);

  useEffect(() => {
    const draw = () => {
      for (let i = 0; i < NUM_MIXER_CHANNELS; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const analyser = audioEngine.getChannelAnalyser(i);
        if (!analyser) continue;

        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let j = 0; j < buf.length; j++) peak = Math.max(peak, Math.abs(buf[j]!));
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        // Peak hold: decay 20dB/s
        peakRef.current[i] = Math.max(peakRef.current[i]! - 0.33, db);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const { width: w, height: h } = canvas;
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, h);

        // Level fill
        const clampDb = Math.max(-60, Math.min(0, db));
        const frac = (clampDb + 60) / 60;
        const fillH = frac * h;
        const gradient = ctx.createLinearGradient(0, h - fillH, 0, h);
        gradient.addColorStop(0, db > -3 ? "#ef4444" : db > -12 ? "#fbbf24" : "#22c55e");
        gradient.addColorStop(1, "#16a34a");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, h - fillH, w, fillH);

        // Peak hold line
        const peakDb = peakRef.current[i]!;
        if (peakDb > -60) {
          const peakFrac = (Math.max(-60, Math.min(0, peakDb)) + 60) / 60;
          const py = h - peakFrac * h;
          ctx.fillStyle = peakDb > -3 ? "#ef4444" : "#86efac";
          ctx.fillRect(0, py, w, 1);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return canvasRefs;
}

// ── Main component ────────────────────────────────────────────────────────────

export function MixerBar() {
  const {
    channels, expandedChannel,
    setFader, setMute, setSolo, setPan, setEQ, setSendRev, setSendDly, setExpanded,
  } = useMixerBarStore();

  const canvasRefs = useMeterData();

  // Apply fader + mute/solo to audioEngine whenever they change
  useEffect(() => {
    const soloed = new Set(channels.flatMap((ch, i) => ch.soloed ? [i] : []));
    channels.forEach((ch, i) => {
      let gain: number;
      if (soloed.size > 0) {
        gain = soloed.has(i) ? faderToGain(ch.fader) : 0;
      } else {
        gain = ch.muted ? 0 : faderToGain(ch.fader);
      }
      audioEngine.setChannelVolume(i, gain);
    });
  }, [channels]);

  // Apply EQ to audioEngine
  const applyEQ = useCallback((ch: number) => {
    const s = channels[ch];
    if (!s) return;
    audioEngine.setChannelEQ?.(ch, "lo",  s.eqLo);
    audioEngine.setChannelEQ?.(ch, "mid", s.eqMid);
    audioEngine.setChannelEQ?.(ch, "hi",  s.eqHi);
  }, [channels]);

  // Apply pan
  const applyPan = useCallback((ch: number, pan: number) => {
    audioEngine.setChannelPan?.(ch, pan);
  }, []);

  // Apply sends
  const applyRev = useCallback((ch: number, val: number) => {
    audioEngine.setChannelReverbSend(ch, val / 100);
  }, []);
  const applyDly = useCallback((ch: number, val: number) => {
    audioEngine.setChannelDelaySend(ch, val / 100);
  }, []);

  return (
    <div className="relative flex flex-col bg-[#0e0e0e] border-t border-white/[0.07]">
      {/* Expanded panel — rendered above the strip */}
      {expandedChannel !== null && (
        <ExpandedPanel
          chIdx={expandedChannel}
          channel={channels[expandedChannel]!}
          color={CHANNELS[expandedChannel]?.color ?? "#888"}
          label={CHANNELS[expandedChannel]?.label ?? ""}
          onClose={() => setExpanded(null)}
          onEQ={(band, gain) => { setEQ(expandedChannel, band, gain); applyEQ(expandedChannel); }}
          onPan={(pan) => { setPan(expandedChannel, pan); applyPan(expandedChannel, pan); }}
          onSendRev={(v) => { setSendRev(expandedChannel, v); applyRev(expandedChannel, v); }}
          onSendDly={(v) => { setSendDly(expandedChannel, v); applyDly(expandedChannel, v); }}
        />
      )}

      {/* Compact strips — horizontal scroll */}
      <div className="flex overflow-x-auto gap-px py-1.5 px-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        {CHANNELS.map(({ id, label, color }) => {
          const ch = channels[id]!;
          const isExpanded = expandedChannel === id;

          return (
            <div
              key={id}
              className={`flex flex-col items-center gap-1 min-w-[46px] px-1 rounded transition-colors ${
                isExpanded ? "bg-white/[0.04] ring-1 ring-white/10" : "hover:bg-white/[0.02]"
              }`}
            >
              {/* Channel name — click to expand */}
              <button
                onClick={() => setExpanded(isExpanded ? null : id)}
                className="w-full text-center"
              >
                <span
                  className="text-[7px] font-black tracking-[0.14em] uppercase"
                  style={{ color: ch.muted ? "#333" : color }}
                >
                  {label}
                </span>
                <span className="text-[6px] text-white/15 ml-0.5">{isExpanded ? "▴" : "▾"}</span>
              </button>

              {/* Peak meter + fader side by side */}
              <div className="flex gap-1 items-end h-[56px]">
                {/* Meter */}
                <canvas
                  ref={(el) => { canvasRefs.current[id] = el; }}
                  width={4}
                  height={56}
                  className="rounded-sm"
                />

                {/* Fader */}
                <div className="relative" style={{ width: 8, height: 56 }}>
                  <div className="absolute inset-0 rounded bg-[#111] border border-white/[0.06]" />
                  {/* Unity tick */}
                  <div
                    className="absolute left-0 right-0 h-px bg-white/20"
                    style={{ top: `${(1 - 750 / 1000) * 100}%` }}
                  />
                  {/* Thumb */}
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={ch.fader}
                    onChange={(e) => setFader(id, Number(e.target.value))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    style={{ writingMode: "vertical-lr", direction: "rtl" }}
                    title={`${(faderToGain(ch.fader) * 100).toFixed(0)}%`}
                  />
                  {/* Visual thumb */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-4 h-2 rounded-sm bg-[#3a3a3a] border border-white/20 pointer-events-none"
                    style={{ top: `calc(${(1 - ch.fader / 1000) * 100}% - 4px)` }}
                  />
                </div>
              </div>

              {/* Mute + Solo */}
              <div className="flex gap-0.5">
                <button
                  onClick={() => setMute(id, !ch.muted)}
                  className={`w-5 h-3.5 text-[6px] font-black rounded-sm border transition-colors ${
                    ch.muted
                      ? "bg-orange-500/30 border-orange-500/60 text-orange-400"
                      : "bg-transparent border-white/10 text-white/20 hover:border-white/25"
                  }`}
                >
                  M
                </button>
                <button
                  onClick={() => setSolo(id, !ch.soloed)}
                  className={`w-5 h-3.5 text-[6px] font-black rounded-sm border transition-colors ${
                    ch.soloed
                      ? "bg-yellow-500/30 border-yellow-500/60 text-yellow-400"
                      : "bg-transparent border-white/10 text-white/20 hover:border-white/25"
                  }`}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Expanded panel ────────────────────────────────────────────────────────────

interface ExpandedPanelProps {
  chIdx:    number;
  channel:  import("../store/mixerBarStore").ChannelMixState;
  color:    string;
  label:    string;
  onClose:  () => void;
  onEQ:     (band: "lo" | "mid" | "hi", gain: number) => void;
  onPan:    (pan: number) => void;
  onSendRev:(v: number) => void;
  onSendDly:(v: number) => void;
}

function ExpandedPanel({ channel, color, label, onClose, onEQ, onPan, onSendRev, onSendDly }: ExpandedPanelProps) {
  return (
    <div className="flex items-end gap-4 px-3 py-2 bg-[#111] border-b border-white/[0.06]">
      {/* Label */}
      <div className="flex flex-col items-center gap-0.5 mr-1">
        <span className="text-[7px] font-black tracking-widest uppercase" style={{ color }}>{label}</span>
        <button onClick={onClose} className="text-[6px] text-white/20 hover:text-white/40">▾ close</button>
      </div>

      {/* Divider */}
      <div className="w-px self-stretch bg-white/[0.06]" />

      {/* EQ */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[6px] font-bold tracking-[0.15em] text-white/25 uppercase">EQ</span>
        <div className="flex gap-2">
          <Knob label="HI"  value={channel.eqHi}  min={-12} max={12} step={0.5} onChange={(v) => onEQ("hi",  v)} color={color} size={22} />
          <Knob label="MID" value={channel.eqMid} min={-12} max={12} step={0.5} onChange={(v) => onEQ("mid", v)} color={color} size={22} />
          <Knob label="LO"  value={channel.eqLo}  min={-12} max={12} step={0.5} onChange={(v) => onEQ("lo",  v)} color={color} size={22} />
        </div>
      </div>

      <div className="w-px self-stretch bg-white/[0.06]" />

      {/* Sends */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[6px] font-bold tracking-[0.15em] text-white/25 uppercase">SENDS</span>
        <div className="flex gap-2">
          <Knob label="REV" value={channel.sendRev} min={0} max={100} step={1} onChange={onSendRev} color="#3b82f6" size={22} />
          <Knob label="DLY" value={channel.sendDly} min={0} max={100} step={1} onChange={onSendDly} color="#3b82f6" size={22} />
        </div>
      </div>

      <div className="w-px self-stretch bg-white/[0.06]" />

      {/* Pan */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[6px] font-bold tracking-[0.15em] text-white/25 uppercase">PAN</span>
        <Knob label="PAN" value={channel.pan * 50 + 50} min={0} max={100} step={1}
          onChange={(v) => onPan((v - 50) / 50)} color={color} size={28} />
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: audioEngine — fehlende Methoden prüfen**

Prüfe ob `audioEngine.setChannelEQ`, `audioEngine.setChannelPan`, `audioEngine.setChannelReverbSend` existieren:

```bash
grep -n "setChannelEQ\|setChannelPan\|setChannelReverbSend" src/audio/AudioEngine.ts | head -10
```

Falls `setChannelEQ` fehlt, in `src/audio/AudioEngine.ts` hinzufügen (delegiert an `mixerRouter`):

```typescript
setChannelEQ(ch: number, band: "lo" | "mid" | "hi", gainDb: number): void {
  this.mixerRouter?.setChannelEQ(ch, band, gainDb);
}
setChannelPan(ch: number, pan: number): void {
  this.mixerRouter?.setChannelPan(ch, pan);
}
```

- [ ] **Step 10.3: TypeScript prüfen**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Alle Fehler beheben (meistens optionale Chaining `?.` oder fehlende AudioEngine-Methoden).

- [ ] **Step 10.4: Commit**

```bash
git add src/components/MixerBar.tsx src/audio/AudioEngine.ts
git commit -m "feat(mixer): add permanent MixerBar component (compact + expanded strip)"
```

---

## Task 11: App.tsx — MixerBar integrieren

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 11.1: MixerBar importieren**

In `src/App.tsx`:

```tsx
import { MixerBar } from "./components/MixerBar";
```

- [ ] **Step 11.2: MixerBar im Layout positionieren**

Suche in `App.tsx` den Haupt-Layout-Block (der return-Bereich). Füge `<MixerBar />` direkt VOR dem Synth-Section-Block ein (oder nach dem Sequencer, je nach Layout-Struktur).

Suche nach `{/* Synth Section */}` oder dem StepSequencer-Block:

```tsx
{/* Permanent Mixer Bar */}
<MixerBar />
```

- [ ] **Step 11.3: Mixer-Overlay optional halten**

Der bestehende `onOpenMixer` Button im Transport kann weiterhin die vollständige `MixerPanel` Ansicht öffnen (für Detail-Arbeit). Die Zeile bleibt wie sie ist — kein Entfernen.

- [ ] **Step 11.4: Build + Test**

```bash
npm run build
```

Expected: Keine Fehler, kein Chunk > 1MB.

```bash
npm run dev
```

MixerBar erscheint permanent am unteren Rand. Fader bewegen → Lautstärke ändert sich. Kanalname klicken → EQ/Sends Panel erscheint.

- [ ] **Step 11.5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(mixer): integrate permanent MixerBar into App layout"
```

---

## Task 12: Final Build + Gesamt-Commit

- [ ] **Step 12.1: TypeScript vollständig prüfen**

```bash
npx tsc --noEmit 2>&1
```

Expected: Keine Fehler.

- [ ] **Step 12.2: Production Build**

```bash
npm run build 2>&1 | tail -30
```

Expected:
- Kein Chunk > 1MB
- Keine TypeScript-Fehler
- `chunk-sample-library` ist lazy (nicht im main-chunk)

- [ ] **Step 12.3: Dev-Server Smoke-Test**

```bash
npm run dev
```

Manuell prüfen:
- [ ] MixerBar sichtbar, alle 15 Kanäle
- [ ] Kanal-Header klicken → EQ/Sends/Pan Panel öffnet, andere schließt
- [ ] Fader bewegen → Lautstärke ändert sich real-time
- [ ] Mute/Solo funktioniert
- [ ] Bass-Tab → LFO-Sektion sichtbar unter Synth-Knobs
- [ ] LFO ON → Filter-Target → Bass spielt → Wobble hörbar
- [ ] LFO SYNC + 1/4 → Wobble sync zum Transport
- [ ] Kit Browser → "Minimal Techno" / "Future Bass" / "Jungle Amen" / "Afro House" erscheinen
- [ ] Sample Browser → "ALL" Button → alle 2300+ Samples sichtbar
- [ ] ErrorBoundary: kein Whitescreen bei normalem Betrieb

- [ ] **Step 12.4: Finaler Commit**

```bash
git add -A
git commit -m "feat: Elastic Drum finalization — MixerBar, Bass LFO, new kits, sample search, stability

- Permanent MixerBar with Reason/SSL-style compact+expanded strips
- Bass LFO modulation (filter/pitch/volume, 4 waveforms, BPM sync)
- 8 LFO showcase presets in BASS_PRESETS
- 4 new factory kits (Minimal Techno, Future Bass, Jungle Amen, Afro House)
- SampleBrowser 'All Voices' cross-category search
- ErrorBoundary for audio component crash recovery
- ARM64 + Linux optional rollup dependencies
- Build chunk optimization: main bundle 213KB (was 1037KB)"
```

---

## Spec Coverage Check

| Spec-Requirement | Task |
|-----------------|------|
| Mixer: permanent bottom bar | Task 10-11 |
| Mixer: compact (fader, meter, M/S) | Task 10 |
| Mixer: expanded (EQ Hi/Mid/Lo, sends, pan) | Task 10 |
| Mixer: Reason/SSL style, dark theme | Task 10 |
| Mixer: one expanded at a time | Task 10 (setExpanded) |
| Bass LFO: 3 targets | Task 4 |
| Bass LFO: 4 waveforms | Task 4 |
| Bass LFO: rate + depth knobs | Task 5 |
| Bass LFO: BPM sync | Task 4-5 |
| Bass LFO: presets | Task 6 |
| Factory Kits: 4 new kits | Task 7 |
| Sound Library: all-categories search | Task 8 |
| Error Boundaries | Task 2 |
| ARM64 build fix | Task 1 |
