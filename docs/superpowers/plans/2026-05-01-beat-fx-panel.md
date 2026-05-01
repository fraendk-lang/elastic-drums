# Beat FX Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed right-sidebar Beat FX panel with 6 hold-to-activate master effects (THROW, SPIRAL, ECHO, FREEZE, CHOKE, NOISE) each with adjustable mini-parameters.

**Architecture:** Two new files — `BeatFx.ts` (audio engine singleton) and `BeatFxPanel.tsx` (sidebar UI). AudioEngine/SendFx get 4 small additions to expose internal nodes. Beat FX connect in parallel to `pumpGain` or control existing FX nodes. No store needed — params are local component state.

**Tech Stack:** Web Audio API (BiquadFilterNode, GainNode, OscillatorNode, AnalyserNode, AudioBufferSourceNode), React hooks, Tailwind CSS.

---

## File Map

| File | Change |
|------|--------|
| `src/audio/SendFx.ts` | Add `getDelayFeedbackGain()` |
| `src/audio/AudioEngine.ts` | Add chokeFilter to chain + expose 4 getters |
| `src/audio/BeatFx.ts` | **NEW** — all 6 effects + FREEZE ring buffer |
| `src/components/BeatFxPanel.tsx` | **NEW** — sidebar UI |
| `src/App.tsx` | Add `<BeatFxPanel />` to layout |

---

## Task 1: Expose internal Audio nodes

**Files:**
- Modify: `src/audio/SendFx.ts` (end of class, ~line 740)
- Modify: `src/audio/AudioEngine.ts` (init chain ~line 132, getters ~line 220)

The BeatFx engine needs raw access to 4 internal nodes: the delay feedback GainNode (ECHO), the choke filter (CHOKE, pre-allocated in the master chain), the pumpGain (injection point for SPIRAL/NOISE/FREEZE sources), and the masterAnalyser (ring buffer reads for FREEZE).

- [ ] **Step 1: Add `getDelayFeedbackGain()` to SendFx**

In `src/audio/SendFx.ts`, find the line `getDelayLevel(): number {` and add the new getter just before it:

```typescript
  getDelayFeedbackGain(): GainNode | null { return this.delayFeedback; }
```

- [ ] **Step 2: Run type check**

```bash
cd "Elastic Drum" && npx tsc --noEmit
```
Expected: no output (zero errors).

- [ ] **Step 3: Add chokeFilter field to AudioEngine class**

In `src/audio/AudioEngine.ts`, find `private masterGain: GainNode | null = null;` and add below it:

```typescript
  private chokeFilter: BiquadFilterNode | null = null;
```

- [ ] **Step 4: Insert chokeFilter into master chain**

Find this block in the `init()` method:
```typescript
      // pumpGain → compressor → limiter → analyser → speakers
      this.pumpGain.connect(this.masterCompressor);
```

Replace it with:
```typescript
      // pumpGain → chokeFilter → compressor → limiter → analyser → speakers
      // chokeFilter defaults to 20 000 Hz (fully open) — BeatFx controls it for CHOKE effect
      this.chokeFilter = this.ctx.createBiquadFilter();
      this.chokeFilter.type = "lowpass";
      this.chokeFilter.frequency.value = 20000;
      this.chokeFilter.Q.value = 0.5;
      this.pumpGain.connect(this.chokeFilter);
      this.chokeFilter.connect(this.masterCompressor);
```

- [ ] **Step 5: Add 4 getters to AudioEngine (after `getMasterGainNode()`)**

Find `getMasterGainNode(): GainNode | null { return this.masterGain; }` and add after it:

```typescript
  getChokeFilter(): BiquadFilterNode | null { return this.chokeFilter; }
  getPumpGain(): GainNode | null { return this.pumpGain; }
  getMasterAnalyser(): AnalyserNode | null { return this.masterAnalyser; }
  getDelayFeedbackGain(): GainNode | null { return sendFxManager.getDelayFeedbackGain(); }
```

- [ ] **Step 6: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/audio/SendFx.ts src/audio/AudioEngine.ts
git commit -m "feat: expose chokeFilter, pumpGain, masterAnalyser, delayFeedback for Beat FX"
```

---

## Task 2: BeatFx.ts — skeleton + THROW + ECHO

**Files:**
- Create: `src/audio/BeatFx.ts`

Create the BeatFxManager singleton with its params struct, the `connect()` method, and the two simplest effects that use existing AudioEngine API: THROW (reverb flood) and ECHO (delay feedback build).

- [ ] **Step 1: Create `src/audio/BeatFx.ts`**

```typescript
/**
 * BeatFxManager — 6 hold-to-activate master effects for the Beat FX sidebar.
 *
 * Call connect() once after AudioEngine initialises.
 * Call startEffect(id) on pointerdown, stopEffect(id) on pointerup/pointercancel.
 * Call setParam(id, key, value) when the user moves a mini-slider (value 0–1 normalised).
 */
import { audioEngine } from './AudioEngine';

export type BeatFxId = 'throw' | 'spiral' | 'echo' | 'freeze' | 'choke' | 'noise';

export interface BeatFxParams {
  throwSize: number;      // 0–1 → reverb decay 0.5s–6s, default 0.6
  spiralSpeed: number;    // 0–1 → LFO 0.2–8 Hz, default 0.4
  echoFeedback: number;   // 0–1 → delay feedback 0.5–0.92, default 0.65
  freezeLength: number;   // 0–1 → capture 10–200 ms, default 0.3
  chokeFreq: number;      // 0–1 → LPF target 80–2000 Hz, default 0.2
  noiseVol: number;       // 0–1 → noise gain, default 0.35
  noiseCut: number;       // 0–1 → noise LPF 200–20000 Hz, default 0.8
}

class BeatFxManager {
  private _ctx: AudioContext | null = null;
  private _active: BeatFxId | null = null;
  params: BeatFxParams = {
    throwSize: 0.6,
    spiralSpeed: 0.4,
    echoFeedback: 0.65,
    freezeLength: 0.3,
    chokeFreq: 0.2,
    noiseVol: 0.35,
    noiseCut: 0.8,
  };

  // THROW state
  private _throwPreLevel = 0;
  private _throwPreSize = 1.0;

  // ECHO state
  private _echoPreFeedback = 0.4;
  private _echoRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Nodes created on connect() ──────────────────────────────────────────
  // SPIRAL
  private _spiralDry: GainNode | null = null;
  private _spiralWet: GainNode | null = null;
  private _spiralDelay: DelayNode | null = null;
  private _spiralFeedback: GainNode | null = null;
  private _spiralLfo: OscillatorNode | null = null;
  private _spiralLfoGain: GainNode | null = null;
  // FREEZE
  private _freezeRingBuffer: Float32Array | null = null;
  private _freezeRingPos = 0;
  private _freezeCaptureSamples = 0;
  private _freezeRingTimer: ReturnType<typeof setInterval> | null = null;
  private _freezeSource: AudioBufferSourceNode | null = null;
  private _freezeGain: GainNode | null = null;
  // NOISE
  private _noiseSource: AudioBufferSourceNode | null = null;
  private _noiseGain: GainNode | null = null;
  private _noiseFilter: BiquadFilterNode | null = null;

  /** Call once after AudioEngine.init() succeeds */
  connect(): void {
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;
    this._ctx = ctx;
    this._buildSpiral(ctx);
    this._buildNoise(ctx);
    this._buildFreeze(ctx);
  }

  get activeEffect(): BeatFxId | null { return this._active; }

  startEffect(id: BeatFxId): void {
    if (this._active && this._active !== id) this.stopEffect(this._active);
    this._active = id;
    switch (id) {
      case 'throw':  this._startThrow(); break;
      case 'echo':   this._startEcho(); break;
      case 'choke':  this._startChoke(); break;
      case 'spiral': this._startSpiral(); break;
      case 'freeze': this._startFreeze(); break;
      case 'noise':  this._startNoise(); break;
    }
  }

  stopEffect(id: BeatFxId): void {
    if (this._active === id) this._active = null;
    switch (id) {
      case 'throw':  this._stopThrow(); break;
      case 'echo':   this._stopEcho(); break;
      case 'choke':  this._stopChoke(); break;
      case 'spiral': this._stopSpiral(); break;
      case 'freeze': this._stopFreeze(); break;
      case 'noise':  this._stopNoise(); break;
    }
  }

  setParam(id: BeatFxId, key: keyof BeatFxParams, value: number): void {
    (this.params as Record<string, number>)[key] = value;
    // Apply live if effect is active
    if (this._active !== id) return;
    if (id === 'choke') {
      const filter = audioEngine.getChokeFilter();
      if (filter && this._ctx) {
        const targetHz = 80 + value * 1920; // 0→80Hz, 1→2000Hz
        filter.frequency.setTargetAtTime(targetHz, this._ctx.currentTime, 0.02);
      }
    }
    if (id === 'noise') {
      if (this._noiseGain && this._ctx) {
        this._noiseGain.gain.setTargetAtTime(value * 0.8, this._ctx.currentTime, 0.02);
      }
      if (this._noiseFilter && this._ctx) {
        const cutHz = 200 + this.params.noiseCut * 19800;
        this._noiseFilter.frequency.setTargetAtTime(cutHz, this._ctx.currentTime, 0.02);
      }
    }
  }

  // ── THROW ─────────────────────────────────────────────────────────────

  private _startThrow(): void {
    this._throwPreLevel = audioEngine.getReverbLevel();
    this._throwPreSize = 0.5 + this.params.throwSize * 5.5; // 0.5–6s
    audioEngine.setReverbSize(this._throwPreSize);
    audioEngine.setReverbLevelSmooth(1.0, 0.08);
  }

  private _stopThrow(): void {
    audioEngine.setReverbLevelSmooth(this._throwPreLevel, 0.5);
  }

  // ── ECHO ──────────────────────────────────────────────────────────────

  private _startEcho(): void {
    if (this._echoRestoreTimer) { clearTimeout(this._echoRestoreTimer); this._echoRestoreTimer = null; }
    const fbGain = audioEngine.getDelayFeedbackGain();
    if (!fbGain || !this._ctx) return;
    this._echoPreFeedback = fbGain.gain.value;
    const target = 0.5 + this.params.echoFeedback * 0.42; // 0.5–0.92
    fbGain.gain.cancelScheduledValues(this._ctx.currentTime);
    fbGain.gain.setValueAtTime(fbGain.gain.value, this._ctx.currentTime);
    fbGain.gain.linearRampToValueAtTime(target, this._ctx.currentTime + 0.1);
  }

  private _stopEcho(): void {
    const fbGain = audioEngine.getDelayFeedbackGain();
    if (!fbGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    fbGain.gain.cancelScheduledValues(now);
    fbGain.gain.setValueAtTime(fbGain.gain.value, now);
    // Ramp to 0 so echoes die out, then restore pre-press level
    fbGain.gain.linearRampToValueAtTime(0, now + 0.3);
    const restore = this._echoPreFeedback;
    this._echoRestoreTimer = setTimeout(() => {
      const fbNow = audioEngine.getDelayFeedbackGain();
      if (fbNow) fbNow.gain.value = restore;
    }, 2500);
  }

  // Stubs for tasks 3–5 (filled in later tasks)
  private _buildSpiral(_ctx: AudioContext): void {}
  private _buildNoise(_ctx: AudioContext): void {}
  private _buildFreeze(_ctx: AudioContext): void {}
  private _startChoke(): void {}
  private _stopChoke(): void {}
  private _startSpiral(): void {}
  private _stopSpiral(): void {}
  private _startFreeze(): void {}
  private _stopFreeze(): void {}
  private _startNoise(): void {}
  private _stopNoise(): void {}
}

export const beatFxManager = new BeatFxManager();
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/audio/BeatFx.ts
git commit -m "feat: BeatFx skeleton + THROW + ECHO effects"
```

---

## Task 3: BeatFx.ts — CHOKE + NOISE

**Files:**
- Modify: `src/audio/BeatFx.ts`

Fill in the 4 stub methods for CHOKE and NOISE. CHOKE uses the chokeFilter inserted in Task 1. NOISE generates a white noise AudioBuffer in `_buildNoise()`, runs it through a GainNode + BiquadFilter, and injects into pumpGain.

- [ ] **Step 1: Replace `_buildNoise`, `_startNoise`, `_stopNoise` stubs**

In `src/audio/BeatFx.ts`, replace:
```typescript
  private _buildNoise(_ctx: AudioContext): void {}
```
with:
```typescript
  private _buildNoise(ctx: AudioContext): void {
    const pumpGain = audioEngine.getPumpGain();
    if (!pumpGain) return;

    // White noise buffer (2 seconds, looped)
    const bufLen = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    this._noiseSource = ctx.createBufferSource();
    this._noiseSource.buffer = noiseBuf;
    this._noiseSource.loop = true;
    this._noiseSource.start();

    this._noiseFilter = ctx.createBiquadFilter();
    this._noiseFilter.type = 'lowpass';
    this._noiseFilter.frequency.value = 200 + this.params.noiseCut * 19800;

    this._noiseGain = ctx.createGain();
    this._noiseGain.gain.value = 0; // silent until press

    this._noiseSource.connect(this._noiseFilter);
    this._noiseFilter.connect(this._noiseGain);
    this._noiseGain.connect(pumpGain);
  }
```

- [ ] **Step 2: Replace `_startNoise` and `_stopNoise` stubs**

Replace:
```typescript
  private _startNoise(): void {}
  private _stopNoise(): void {}
```
with:
```typescript
  private _startNoise(): void {
    if (!this._noiseGain || !this._noiseFilter || !this._ctx) return;
    const now = this._ctx.currentTime;
    // Apply current params
    this._noiseFilter.frequency.setValueAtTime(200 + this.params.noiseCut * 19800, now);
    const targetVol = this.params.noiseVol * 0.8;
    this._noiseGain.gain.cancelScheduledValues(now);
    this._noiseGain.gain.setValueAtTime(0, now);
    this._noiseGain.gain.linearRampToValueAtTime(targetVol, now + 0.08);
  }

  private _stopNoise(): void {
    if (!this._noiseGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._noiseGain.gain.cancelScheduledValues(now);
    this._noiseGain.gain.setValueAtTime(this._noiseGain.gain.value, now);
    this._noiseGain.gain.linearRampToValueAtTime(0, now + 0.06);
  }
```

- [ ] **Step 3: Replace `_startChoke` and `_stopChoke` stubs**

Replace:
```typescript
  private _startChoke(): void {}
  private _stopChoke(): void {}
```
with:
```typescript
  private _startChoke(): void {
    const filter = audioEngine.getChokeFilter();
    if (!filter || !this._ctx) return;
    const targetHz = 80 + this.params.chokeFreq * 1920; // 80–2000 Hz
    const now = this._ctx.currentTime;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(20000, now);
    filter.frequency.linearRampToValueAtTime(targetHz, now + 0.18);
  }

  private _stopChoke(): void {
    const filter = audioEngine.getChokeFilter();
    if (!filter || !this._ctx) return;
    const now = this._ctx.currentTime;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.linearRampToValueAtTime(20000, now + 0.1);
  }
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/audio/BeatFx.ts
git commit -m "feat: BeatFx CHOKE and NOISE effects"
```

---

## Task 4: BeatFx.ts — SPIRAL (Flanger)

**Files:**
- Modify: `src/audio/BeatFx.ts`

SPIRAL is an AllPass-based flanger: two DelayNodes with a shared OscillatorNode LFO modulating their delay times. The wet signal is mixed into pumpGain in parallel. On press the LFO starts running; on release the wet gain fades out and the LFO stops.

- [ ] **Step 1: Replace `_buildSpiral` stub**

Replace:
```typescript
  private _buildSpiral(_ctx: AudioContext): void {}
```
with:
```typescript
  private _buildSpiral(ctx: AudioContext): void {
    const pumpGain = audioEngine.getPumpGain();
    if (!pumpGain) return;

    // Flanger: delay modulated by LFO (0.1–5 ms range)
    this._spiralDelay = ctx.createDelay(0.02);
    this._spiralDelay.delayTime.value = 0.003; // 3ms center

    this._spiralFeedback = ctx.createGain();
    this._spiralFeedback.gain.value = 0.5;

    this._spiralLfo = ctx.createOscillator();
    this._spiralLfo.type = 'sine';
    this._spiralLfo.frequency.value = 0.2 + this.params.spiralSpeed * 7.8;

    this._spiralLfoGain = ctx.createGain();
    this._spiralLfoGain.gain.value = 0.002; // ±2ms sweep

    this._spiralWet = ctx.createGain();
    this._spiralWet.gain.value = 0; // silent until press

    this._spiralDry = ctx.createGain();
    this._spiralDry.gain.value = 1;

    // LFO → delay time modulation
    this._spiralLfo.connect(this._spiralLfoGain);
    this._spiralLfoGain.connect(this._spiralDelay.delayTime);

    // Signal path: pumpGain input → spiral delay → feedback → wet out
    // We tap pumpGain output for the flanger input by creating a source connection
    // The flanger signal is injected back INTO pumpGain (parallel)
    pumpGain.connect(this._spiralDelay);
    this._spiralDelay.connect(this._spiralFeedback);
    this._spiralFeedback.connect(this._spiralDelay); // feedback loop
    this._spiralDelay.connect(this._spiralWet);
    this._spiralWet.connect(pumpGain);

    // LFO starts stopped (no sound until press)
    this._spiralLfo.start();
  }
```

- [ ] **Step 2: Replace `_startSpiral` and `_stopSpiral` stubs**

Replace:
```typescript
  private _startSpiral(): void {}
  private _stopSpiral(): void {}
```
with:
```typescript
  private _startSpiral(): void {
    if (!this._spiralWet || !this._spiralLfo || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._spiralLfo.frequency.setValueAtTime(
      0.2 + this.params.spiralSpeed * 7.8,
      now
    );
    this._spiralWet.gain.cancelScheduledValues(now);
    this._spiralWet.gain.setValueAtTime(0, now);
    this._spiralWet.gain.linearRampToValueAtTime(0.7, now + 0.1);
  }

  private _stopSpiral(): void {
    if (!this._spiralWet || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._spiralWet.gain.cancelScheduledValues(now);
    this._spiralWet.gain.setValueAtTime(this._spiralWet.gain.value, now);
    this._spiralWet.gain.linearRampToValueAtTime(0, now + 0.15);
  }
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/audio/BeatFx.ts
git commit -m "feat: BeatFx SPIRAL flanger effect"
```

---

## Task 5: BeatFx.ts — FREEZE (Buffer Loop)

**Files:**
- Modify: `src/audio/BeatFx.ts`

FREEZE uses `masterAnalyser.getFloatTimeDomainData()` in a 20ms setInterval to continuously fill a ring buffer of the last 500ms of master audio. On press, the last `freezeLength` ms are copied into an AudioBuffer and looped. On release the loop fades out.

- [ ] **Step 1: Replace `_buildFreeze` stub**

Replace:
```typescript
  private _buildFreeze(_ctx: AudioContext): void {}
```
with:
```typescript
  private _buildFreeze(ctx: AudioContext): void {
    const pumpGain = audioEngine.getPumpGain();
    if (!pumpGain) return;

    // Ring buffer holds 500ms of audio (mono capture from analyser)
    const ringLen = Math.ceil(ctx.sampleRate * 0.5);
    this._freezeRingBuffer = new Float32Array(ringLen);
    this._freezeRingPos = 0;

    const tempBuf = new Float32Array(2048); // matches analyser fftSize

    // Continuously fill ring buffer from masterAnalyser time-domain data
    this._freezeRingTimer = setInterval(() => {
      const analyser = audioEngine.getMasterAnalyser();
      if (!analyser || !this._freezeRingBuffer) return;
      analyser.getFloatTimeDomainData(tempBuf);
      for (let i = 0; i < tempBuf.length; i++) {
        this._freezeRingBuffer[this._freezeRingPos] = tempBuf[i]!;
        this._freezeRingPos = (this._freezeRingPos + 1) % this._freezeRingBuffer.length;
      }
    }, 20);

    // Freeze output gain (connects into pumpGain)
    this._freezeGain = ctx.createGain();
    this._freezeGain.gain.value = 0;
    this._freezeGain.connect(pumpGain);
  }
```

- [ ] **Step 2: Replace `_startFreeze` and `_stopFreeze` stubs**

Replace:
```typescript
  private _startFreeze(): void {}
  private _stopFreeze(): void {}
```
with:
```typescript
  private _startFreeze(): void {
    if (!this._freezeRingBuffer || !this._freezeGain || !this._ctx) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Determine how many samples to capture based on freezeLength param
    const capMs = 10 + this.params.freezeLength * 190; // 10–200 ms
    this._freezeCaptureSamples = Math.ceil((capMs / 1000) * ctx.sampleRate);
    const capLen = Math.min(this._freezeCaptureSamples, this._freezeRingBuffer.length);

    // Copy last `capLen` samples from ring buffer into AudioBuffer
    const buf = ctx.createBuffer(1, capLen, ctx.sampleRate);
    const out = buf.getChannelData(0);
    const ringLen = this._freezeRingBuffer.length;
    const startPos = (this._freezeRingPos - capLen + ringLen) % ringLen;
    for (let i = 0; i < capLen; i++) {
      out[i] = this._freezeRingBuffer[(startPos + i) % ringLen]!;
    }

    // Stop previous source if any
    if (this._freezeSource) {
      try { this._freezeSource.stop(); } catch { /* already stopped */ }
      this._freezeSource.disconnect();
    }

    this._freezeSource = ctx.createBufferSource();
    this._freezeSource.buffer = buf;
    this._freezeSource.loop = true;
    this._freezeSource.connect(this._freezeGain);
    this._freezeSource.start(now);

    // Crossfade in (30ms)
    this._freezeGain.gain.cancelScheduledValues(now);
    this._freezeGain.gain.setValueAtTime(0, now);
    this._freezeGain.gain.linearRampToValueAtTime(1.0, now + 0.03);
  }

  private _stopFreeze(): void {
    if (!this._freezeGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._freezeGain.gain.cancelScheduledValues(now);
    this._freezeGain.gain.setValueAtTime(this._freezeGain.gain.value, now);
    this._freezeGain.gain.linearRampToValueAtTime(0, now + 0.08);
    // Stop source after fade completes
    const src = this._freezeSource;
    if (src) {
      setTimeout(() => {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
      }, 120);
      this._freezeSource = null;
    }
  }
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/audio/BeatFx.ts
git commit -m "feat: BeatFx FREEZE buffer loop effect (AnalyserNode ring buffer)"
```

---

## Task 6: BeatFxPanel.tsx — Sidebar UI

**Files:**
- Create: `src/components/BeatFxPanel.tsx`

The sidebar UI. Each effect block has a colored hold button + mini-slider(s) below it. Pressing the button calls `beatFxManager.startEffect()` and releases call `stopEffect()`. The component also calls `beatFxManager.connect()` once on mount (after audio is ready).

- [ ] **Step 1: Create `src/components/BeatFxPanel.tsx`**

```typescript
import { useEffect, useRef, useState } from "react";
import { beatFxManager, type BeatFxId, type BeatFxParams } from "../audio/BeatFx";
import { audioEngine } from "../audio/AudioEngine";

interface EffectDef {
  id: BeatFxId;
  label: string;
  color: string;
  params: { key: keyof BeatFxParams; label: string }[];
}

const EFFECTS: EffectDef[] = [
  { id: "throw",  label: "THROW",  color: "#3b82f6", params: [{ key: "throwSize",    label: "SIZE" }] },
  { id: "spiral", label: "SPIRAL", color: "#ec4899", params: [{ key: "spiralSpeed",  label: "SPD"  }] },
  { id: "echo",   label: "ECHO",   color: "#10b981", params: [{ key: "echoFeedback", label: "FBK"  }] },
  { id: "freeze", label: "FREEZE", color: "#a78bfa", params: [{ key: "freezeLength", label: "LEN"  }] },
  { id: "choke",  label: "CHOKE",  color: "#0ea5e9", params: [{ key: "chokeFreq",    label: "FRQ"  }] },
  { id: "noise",  label: "NOISE",  color: "#6b7280", params: [
    { key: "noiseVol", label: "VOL" },
    { key: "noiseCut", label: "CUT" },
  ]},
];

export function BeatFxPanel() {
  const [active, setActive] = useState<BeatFxId | null>(null);
  const [params, setParams] = useState<BeatFxParams>({ ...beatFxManager.params });
  const connected = useRef(false);

  // Connect BeatFxManager once audio engine is ready
  useEffect(() => {
    if (connected.current) return;
    if (!audioEngine.isInitialized) return;
    beatFxManager.connect();
    connected.current = true;
  });

  const handlePointerDown = (id: BeatFxId) => {
    if (!connected.current) {
      beatFxManager.connect();
      connected.current = true;
    }
    setActive(id);
    beatFxManager.startEffect(id);
  };

  const handlePointerUp = (id: BeatFxId) => {
    setActive((prev) => (prev === id ? null : prev));
    beatFxManager.stopEffect(id);
  };

  const handleParam = (id: BeatFxId, key: keyof BeatFxParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    beatFxManager.setParam(id, key, value);
  };

  return (
    <div
      className="flex flex-col gap-1.5 p-1.5 border-l border-white/[0.07] select-none shrink-0"
      style={{ width: 84, background: "#09090f" }}
    >
      <div className="text-[7px] font-black tracking-[0.18em] text-white/25 text-center py-0.5">
        BEAT FX
      </div>

      {EFFECTS.map((fx) => {
        const isActive = active === fx.id;
        return (
          <div key={fx.id} className="flex flex-col gap-1">
            {/* Hold Button */}
            <button
              className="w-full rounded-md font-black text-[9px] tracking-widest transition-all active:scale-[0.97] touch-none"
              style={{
                height: 32,
                background: isActive ? fx.color : `${fx.color}22`,
                color: isActive ? (fx.id === "throw" || fx.id === "spiral" || fx.id === "echo" || fx.id === "freeze" || fx.id === "choke" ? "#fff" : "#e5e7eb") : fx.color,
                border: `1px solid ${fx.color}${isActive ? "ff" : "55"}`,
                boxShadow: isActive ? `0 0 12px ${fx.color}66, inset 0 0 8px ${fx.color}33` : "none",
              }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePointerDown(fx.id); }}
              onPointerUp={() => handlePointerUp(fx.id)}
              onPointerCancel={() => handlePointerUp(fx.id)}
            >
              {fx.label}
            </button>

            {/* Mini Slider(s) */}
            {fx.params.map((p) => (
              <div key={p.key} className="flex items-center gap-1 px-0.5">
                <span className="text-[6px] font-bold text-white/30 w-5 shrink-0">{p.label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(params[p.key] * 100)}
                  onChange={(e) => handleParam(fx.id, p.key, Number(e.target.value) / 100)}
                  className="flex-1 h-0.5 accent-white/40 cursor-pointer"
                  style={{ accentColor: fx.color }}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/BeatFxPanel.tsx
git commit -m "feat: BeatFxPanel sidebar UI — 6 hold buttons + mini sliders"
```

---

## Task 7: Wire BeatFxPanel into App.tsx layout

**Files:**
- Modify: `src/App.tsx`

Add `<BeatFxPanel />` as a fixed-width column on the right side of the main content area, next to the existing `MixerStrip`. It's always visible (no toggle).

- [ ] **Step 1: Import BeatFxPanel in App.tsx**

Find the existing lazy imports block at the top of `src/App.tsx`. After the last import, add:

```typescript
import { BeatFxPanel } from "./components/BeatFxPanel";
```

(Not lazy — it's always rendered and small enough to include in the main bundle.)

- [ ] **Step 2: Add BeatFxPanel to the layout**

Find this block in the JSX (around line 481):
```tsx
          {/* Right: Mini Mixer (hidden on small screens) */}
          <div className="hidden lg:block w-44 border-l border-[var(--ed-border)] shrink-0">
            <MixerStrip onOpenMixer={() => overlay.openOverlay("mixer")} />
          </div>
```

Replace with:
```tsx
          {/* Right: Mini Mixer + Beat FX Sidebar */}
          <div className="hidden lg:flex shrink-0">
            <div className="w-44 border-l border-[var(--ed-border)]">
              <MixerStrip onOpenMixer={() => overlay.openOverlay("mixer")} />
            </div>
            <BeatFxPanel />
          </div>
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Start dev server and verify**

```bash
npm run dev
```

Open the app. Verify:
- Beat FX sidebar is visible on the right (84px wide, dark background)
- "BEAT FX" label at the top
- All 6 effect buttons present with correct colors
- Mini sliders visible below each button
- NOISE has 2 sliders (VOL + CUT), all others have 1

- [ ] **Step 5: Test each effect**

Start playback (Space). Then test each button:
- **THROW**: Hold → reverb floods. Release → tail fades naturally.
- **SPIRAL**: Hold → flanging/swirling modulation. Release → fades out.
- **ECHO**: Hold → echoes build up. Release → echoes die out on their own.
- **FREEZE**: Hold → audio freezes/loops. Release → returns to live.
- **CHOKE**: Hold → filter chokes the sound dark. Release → opens back up.
- **NOISE**: Hold → noise washes in. Release → cuts cleanly.

Also verify NOISE VOL/CUT sliders make audible difference (adjust while holding NOISE).

- [ ] **Step 6: Commit and push**

```bash
git add src/App.tsx
git commit -m "feat: wire BeatFxPanel into main layout — Beat FX sidebar complete"
git push
```
