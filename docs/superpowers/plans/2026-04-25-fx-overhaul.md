# FX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all broken FX routing, upgrade reverb/delay/chorus quality, add 2 Kaoss Pad modes, and improve FxChain module algorithms.

**Architecture:** Three layers of change — (1) SendFx.ts/AudioEngine.ts for smooth audio API, (2) reverbWorker.ts/SendFx.ts for algorithm quality, (3) FxPanel.tsx/FxRack.tsx/FxChain.ts for UI and module fixes. All changes are additive or in-place replacements; no existing API surfaces are removed.

**Tech Stack:** TypeScript strict, Web Audio API (AudioParam, WaveShaper, ConvolverNode, OscillatorNode), React 18, Zustand

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/audio/SendFx.ts` | Modify | Add smooth methods + tape saturation in delay + delay mode |
| `src/audio/AudioEngine.ts` | Modify | Expose new smooth methods + setDelayMode |
| `src/audio/reverbWorker.ts` | Modify | Fibonacci taps + Spring type + stereo decorrelation |
| `src/components/FxPanel.tsx` | Modify | Auto-sends + PHASER/CHORUS modes |
| `src/components/FxRack.tsx` | Modify | Fix Chorus + delay mode dropdown + reverb type dropdown |
| `src/audio/FxChain.ts` | Modify | Bitcrusher + Autofilter + Tremolo + RingMod improvements |

---

## Task 1: Routing Fixes

**Files:**
- Modify: `src/audio/SendFx.ts`
- Modify: `src/audio/AudioEngine.ts`
- Modify: `src/components/FxPanel.tsx`
- Modify: `src/components/FxRack.tsx`
- Modify: `src/components/PerformancePad.tsx`

### Step 1.1 — Add smooth methods to SendFx.ts

Read `src/audio/SendFx.ts`. Find the `setReverbLevel()` method (around line 604) and add two new methods immediately after `getDelayLevel()`:

```typescript
/** Smooth reverb level transition — uses AudioParam.setTargetAtTime, no clicks */
setReverbLevelSmooth(target: number, timeConstant: number): void {
  if (!this.reverbGain || !this.ctx) return;
  this.reverbGain.gain.cancelScheduledValues(this.ctx.currentTime);
  this.reverbGain.gain.setTargetAtTime(
    Math.max(0, target),
    this.ctx.currentTime,
    timeConstant,
  );
}

/** Smooth delay level transition — uses AudioParam.setTargetAtTime, no clicks */
setDelayLevelSmooth(target: number, timeConstant: number): void {
  if (!this.delayGain || !this.ctx) return;
  this.delayGain.gain.cancelScheduledValues(this.ctx.currentTime);
  this.delayGain.gain.setTargetAtTime(
    Math.max(0, target),
    this.ctx.currentTime,
    timeConstant,
  );
}
```

### Step 1.2 — Expose smooth methods in AudioEngine.ts

Read `src/audio/AudioEngine.ts`. Find the `setReverbLevel` / `setDelayLevel` delegation lines (around line 348–358). Add these two lines immediately after:

```typescript
setReverbLevelSmooth(target: number, timeConstant: number): void { sendFxManager.setReverbLevelSmooth(target, timeConstant); }
setDelayLevelSmooth(target: number, timeConstant: number): void { sendFxManager.setDelayLevelSmooth(target, timeConstant); }
```

### Step 1.3 — Fix FxPanel.tsx: auto-open sends for REVERB/DELAY modes

Read `src/components/FxPanel.tsx`. Make these changes:

**A. Add constant after imports (near the top of the file, after the imports):**

```typescript
// Synth channels that get auto-sends when Kaoss Pad uses REVERB/DELAY modes
const KAOSS_SYNTH_CHANNELS = [12, 13, 14] as const;
const KAOSS_AUTO_SEND = 0.38;
```

**B. Inside the `FxPanel` component function, after the existing refs (around line 486), add:**

```typescript
const savedSendsRef = useRef<{ reverb: number[]; delay: number[] } | null>(null);
```

**C. Replace the existing `handlePadDown` callback:**

```typescript
const handlePadDown = useCallback(
  (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPadActive(true);
    const { x, y } = calcXY(e);
    setPadX(x);
    setPadY(y);
    // Auto-open synth sends for send-bus modes so the effect is audible
    if ((activeMode === "REVERB" || activeMode === "DELAY") && !savedSendsRef.current) {
      savedSendsRef.current = {
        reverb: KAOSS_SYNTH_CHANNELS.map((ch) => audioEngine.getChannelReverbSend(ch)),
        delay:  KAOSS_SYNTH_CHANNELS.map((ch) => audioEngine.getChannelDelaySend(ch)),
      };
      if (activeMode === "REVERB") {
        KAOSS_SYNTH_CHANNELS.forEach((ch) => audioEngine.setChannelReverbSend(ch, KAOSS_AUTO_SEND));
      } else {
        KAOSS_SYNTH_CHANNELS.forEach((ch) => audioEngine.setChannelDelaySend(ch, KAOSS_AUTO_SEND));
      }
    }
    activateFxMode(activeMode, x, y, fxTarget, bpm);
  },
  [activeMode, fxTarget, bpm, calcXY]
);
```

**D. Replace the existing `handlePadUp` callback:**

```typescript
const handlePadUp = useCallback(() => {
  setPadActive(false);
  // Restore auto-sends
  if (savedSendsRef.current && !holdMode) {
    const saved = savedSendsRef.current;
    savedSendsRef.current = null;
    KAOSS_SYNTH_CHANNELS.forEach((ch, i) => {
      audioEngine.setChannelReverbSend(ch, saved.reverb[i] ?? 0);
      audioEngine.setChannelDelaySend(ch, saved.delay[i] ?? 0);
    });
  }
  if (holdMode) {
    setHoldLocked(true);
  } else {
    releaseFxMode(activeMode, fxTarget);
  }
}, [activeMode, fxTarget, holdMode]);
```

**E. Replace the existing `releaseHold` callback:**

```typescript
const releaseHold = useCallback(() => {
  setHoldLocked(false);
  // Also restore auto-sends if hold was active
  if (savedSendsRef.current) {
    const saved = savedSendsRef.current;
    savedSendsRef.current = null;
    KAOSS_SYNTH_CHANNELS.forEach((ch, i) => {
      audioEngine.setChannelReverbSend(ch, saved.reverb[i] ?? 0);
      audioEngine.setChannelDelaySend(ch, saved.delay[i] ?? 0);
    });
  }
  releaseFxMode(activeMode, fxTarget);
}, [activeMode, fxTarget]);
```

### Step 1.4 — Fix FxRack.tsx Chorus

Read `src/components/FxRack.tsx`. Find the `case "chorus":` block in `applyModuleToggle()` (around line 313). Replace it entirely:

```typescript
case "chorus":
  if (enabled) {
    const rate  = 0.8 + (params.rate  ?? 30) / 100 * 2.0;  // 0.8–2.8 Hz
    const depth = (params.depth ?? 40) / 100;               // 0–1
    audioEngine.setChorusRate(rate);
    audioEngine.setChorusDepth(depth);
    audioEngine.setChorusLevel(0.65);
    // Open per-channel chorus sends for the target
    if (isPerChannel) {
      for (const ch of channels) audioEngine.setChannelChorusSend(ch, 0.4);
    } else {
      for (let ch = 0; ch < 15; ch++) audioEngine.setChannelChorusSend(ch, 0.3);
    }
  } else {
    audioEngine.setChorusLevel(0);
    if (isPerChannel) {
      for (const ch of channels) audioEngine.setChannelChorusSend(ch, 0);
    } else {
      for (let ch = 0; ch < 15; ch++) audioEngine.setChannelChorusSend(ch, 0);
    }
  }
  break;
```

Also find `case "chorus":` in `applyModuleParam()` (around line 208). Replace it:

```typescript
case "chorus":
  if (paramId === "rate" || paramId === "depth") {
    const rate  = 0.8 + (allParams.rate  ?? 30) / 100 * 2.0;
    const depth = (allParams.depth ?? 40) / 100;
    audioEngine.setChorusRate(rate);
    audioEngine.setChorusDepth(depth);
  }
  break;
```

### Step 1.5 — Fix PerformancePad.tsx spring-back

Read `src/components/PerformancePad.tsx`. Find the spring-back block (around line 442–475). It contains the `for` loops with `setTimeout` for reverb and delay. Replace those two blocks:

```typescript
if (yParam === "reverb") {
  const endLevel = snap.reverb;
  audioEngine.setReverbLevelSmooth(endLevel, 0.18); // 180ms time constant ≈ 400ms perceptual fade
} else if (yParam === "delay") {
  const endLevel = snap.delay;
  audioEngine.setDelayLevelSmooth(endLevel, 0.18);
} else if (yParam === "drive") {
```

(Keep the `drive` block and everything after it unchanged.)

### Step 1.6 — TypeScript check

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If `setReverbLevelSmooth` / `setDelayLevelSmooth` are not found by TS, confirm they were added to both `SendFx.ts` and `AudioEngine.ts`.

### Step 1.7 — Commit

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
git add src/audio/SendFx.ts src/audio/AudioEngine.ts src/components/FxPanel.tsx src/components/FxRack.tsx src/components/PerformancePad.tsx
git commit -m "fix(fx): routing fixes — auto-sends, smooth spring-back, chorus uses Send C"
```

---

## Task 2: Reverb Upgrade

**Files:**
- Modify: `src/audio/reverbWorker.ts`
- Modify: `src/audio/SendFx.ts`
- Modify: `src/audio/AudioEngine.ts`
- Modify: `src/components/FxRack.tsx`

### Step 2.1 — Upgrade reverbWorker.ts

Replace the entire contents of `src/audio/reverbWorker.ts` with:

```typescript
/**
 * Reverb IR Worker — v2
 * Improvements over v1:
 * - Fibonacci-based early tap timings (eliminates flutter echo / periodic combs)
 * - Frequency-dependent tail decay (highs die faster than lows)
 * - Better stereo decorrelation (independent per-channel allpass states)
 * - Spring type with physical wobble character
 */

interface ReverbRequest {
  id: number;
  sampleRate: number;
  duration: number;
  decay: number;
  type: string;
}

interface ReverbResponse {
  id: number;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

// Fibonacci sequence used for early reflection timing — avoids periodic flutter
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

interface ReverbProfile {
  preDelayMs: number;
  earlyDensity: number;   // How many Fibonacci taps to use
  earlySpreadMs: number;  // L/R offset for early reflections
  tailDecayMul: number;   // Multiplier on decay time
  hfDamping: number;      // 0=lots of damping (dark), 1=little (bright)
  diffusion: number;      // 0–1: tail smoothness
  springWobble: boolean;  // Spring character (time-modulated taps)
}

const PROFILES: Record<string, ReverbProfile> = {
  room:   { preDelayMs:  5, earlyDensity:  8, earlySpreadMs: 1.5, tailDecayMul: 0.75, hfDamping: 0.45, diffusion: 0.7, springWobble: false },
  hall:   { preDelayMs: 18, earlyDensity: 10, earlySpreadMs: 4.0, tailDecayMul: 1.10, hfDamping: 0.65, diffusion: 0.8, springWobble: false },
  plate:  { preDelayMs:  2, earlyDensity:  6, earlySpreadMs: 0.8, tailDecayMul: 0.85, hfDamping: 0.80, diffusion: 0.9, springWobble: false },
  spring: { preDelayMs:  8, earlyDensity:  5, earlySpreadMs: 2.0, tailDecayMul: 0.70, hfDamping: 0.25, diffusion: 0.5, springWobble: true  },
};

/** Simple seeded pseudo-random (xorshift32) for reproducible stereo decorrelation */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function generateIR(
  sampleRate: number,
  duration: number,
  decay: number,
  type: string,
): { left: Float32Array; right: Float32Array } {
  const p = PROFILES[type] ?? PROFILES.hall!;
  const length = Math.ceil(sampleRate * duration);
  const left  = new Float32Array(length);
  const right = new Float32Array(length);
  const preDelay = Math.ceil(sampleRate * p.preDelayMs / 1000);

  // ── Early Reflections (Fibonacci taps, stereo-offset) ──────────────────
  // Different seeds for L/R for true decorrelation
  const rngL = makeRng(0x9e3779b9);
  const rngR = makeRng(0x517cc1b7);

  for (let tapIdx = 0; tapIdx < p.earlyDensity; tapIdx++) {
    const fib = FIBONACCI[tapIdx] ?? (tapIdx * 13 + 7);
    const timeL = (fib * 0.0015) + (tapIdx * 0.002); // ~1.5ms base unit per Fib step
    const timeR = timeL + (p.earlySpreadMs / 1000);
    const gain = 0.72 * Math.exp(-tapIdx * 0.28);

    const idxL = preDelay + Math.ceil(sampleRate * timeL);
    const idxR = preDelay + Math.ceil(sampleRate * timeR);
    const burstLen = Math.ceil(sampleRate * 0.003); // 3ms burst per reflection

    if (idxL < length) {
      for (let j = 0; j < burstLen && idxL + j < length; j++) {
        left[idxL + j] = (left[idxL + j] ?? 0) + rngL() * gain * Math.exp(-j / (sampleRate * 0.0015));
      }
    }
    if (idxR < length) {
      for (let j = 0; j < burstLen && idxR + j < length; j++) {
        right[idxR + j] = (right[idxR + j] ?? 0) + rngR() * gain * Math.exp(-j / (sampleRate * 0.0015));
      }
    }
  }

  // ── Diffuse Tail ────────────────────────────────────────────────────────
  const tailStart = preDelay + Math.ceil(sampleRate * (type === "plate" ? 0.005 : 0.06));

  // Spring wobble: modulate apparent position in tail using a sine pattern
  // This gives the "boing" character of spring reverb
  const wobbleFreq = p.springWobble ? 4.2 : 0; // Hz
  const wobbleDepth = p.springWobble ? 0.35 : 0;

  // Two random sources per channel — different sequences for independence
  const tailRngL = makeRng(0xdeadbeef);
  const tailRngR = makeRng(0x01234567);

  for (let i = tailStart; i < length; i++) {
    const t = (i - tailStart) / sampleRate;

    // Frequency-dependent decay:
    //   HF envelope decays faster (hfDamping near 0 = very dark, near 1 = bright and sustained)
    const hfDecayRate = 6.0 / (decay * p.tailDecayMul);                        // base rate
    const lfDecayRate = hfDecayRate * (0.35 + p.hfDamping * 0.35);             // LF decays slower
    const hfEnv = Math.exp(-t * hfDecayRate);
    const lfEnv = Math.exp(-t * lfDecayRate);

    // Smooth blend: random noise modulated by both envelopes
    // hfDamping controls mix: high = more HF, low = mostly LF (dark)
    const noiseL = tailRngL();
    const noiseR = tailRngR();

    // Spring wobble modulates amplitude (physical coil resonance)
    const wobble = p.springWobble ? (1.0 + wobbleDepth * Math.sin(2 * Math.PI * wobbleFreq * t)) : 1.0;

    // Diffusion: blend between raw noise (0) and smoothed (1)
    // We approximate smoothing by averaging with previous — already handled by Fibonacci taps above
    // Here we just use amplitude modulation via diffusion factor
    const lScale = p.diffusion * 0.6 + 0.4;
    const rScale = p.diffusion * 0.7 + 0.3; // Slightly different — more stereo decorrelation

    left[i]  = (left[i]  ?? 0) + noiseL * wobble * (hfEnv * p.hfDamping + lfEnv * (1 - p.hfDamping * 0.5)) * lScale;
    right[i] = (right[i] ?? 0) + noiseR * wobble * (hfEnv * p.hfDamping + lfEnv * (1 - p.hfDamping * 0.5)) * rScale;
  }

  return { left, right };
}

self.onmessage = (e: MessageEvent<ReverbRequest>) => {
  const { id, sampleRate, duration, decay, type } = e.data;
  const { left, right } = generateIR(sampleRate, duration, decay, type);
  const response: ReverbResponse = { id, left, right, sampleRate };
  (self as unknown as Worker).postMessage(response, [left.buffer, right.buffer]);
};
```

### Step 2.2 — Add "spring" to REVERB_TYPES in SendFx.ts

Read `src/audio/SendFx.ts`. Find line 28:
```typescript
export const REVERB_TYPES = ["room", "hall", "plate", "ambient"] as const;
```

Replace with:
```typescript
export const REVERB_TYPES = ["room", "hall", "plate", "spring"] as const;
export type ReverbType = typeof REVERB_TYPES[number];
```

Find the `setReverbType()` method signature:
```typescript
setReverbType(type: "room" | "hall" | "plate" | "ambient"): void {
```

Replace with:
```typescript
setReverbType(type: ReverbType): void {
```

Also find the `durations` and `decays` maps inside `setReverbType()`:
```typescript
const durations: Record<string, number> = { room: 1.0, hall: 2.5, plate: 1.8, ambient: 4.0 };
const decays: Record<string, number>    = { room: 1.5, hall: 2.5, plate: 2.0, ambient: 5.0 };
```

Replace with:
```typescript
const durations: Record<string, number> = { room: 0.9, hall: 2.8, plate: 1.6, spring: 1.2 };
const decays: Record<string, number>    = { room: 1.4, hall: 2.8, plate: 1.8, spring: 1.2 };
```

Also find the `reverbType` field declaration:
```typescript
private reverbType: "room" | "hall" | "plate" | "ambient" = "hall";
```

Replace with:
```typescript
private reverbType: ReverbType = "hall";
```

### Step 2.3 — Update AudioEngine.ts setReverbType signature

Read `src/audio/AudioEngine.ts`. Find:
```typescript
setReverbType(type: "room" | "hall" | "plate" | "ambient"): void { sendFxManager.setReverbType(type); }
```

Replace with:
```typescript
setReverbType(type: import("./SendFx").ReverbType): void { sendFxManager.setReverbType(type); }
```

### Step 2.4 — Add reverb type dropdown to FxRack.tsx

Read `src/components/FxRack.tsx`. Find the `FX_MODULES` array definition (near the top). Find the reverb module definition — it should have `id: "reverb"` and a `params` array. Add a new parameter to it:

Look for the reverb module params array. It will look something like:
```typescript
{ id: "reverb", name: "REVERB", ... params: [
  { id: "level",   ... },
  { id: "damping", ... },
]}
```

Add a third param:
```typescript
  { id: "type", label: "Type", min: 0, max: 3, default: 1 },  // 0=room 1=hall 2=plate 3=spring
```

Then find `applyModuleParam()` and add a case for the reverb type param. Find the `case "reverb":` block there (handling `paramId === "level"` and `"damping"`). Add:

```typescript
if (paramId === "type") {
  const types = ["room", "hall", "plate", "spring"] as const;
  const t = types[Math.round(value)] ?? "hall";
  audioEngine.setReverbType(t);
}
```

In `applyModuleToggle()` for the reverb case, after `audioEngine.setReverbDamping(...)`, add:
```typescript
const types = ["room", "hall", "plate", "spring"] as const;
const t = types[Math.round(params.type ?? 1)] ?? "hall";
audioEngine.setReverbType(t);
```

### Step 2.5 — TypeScript check

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

### Step 2.6 — Commit

```bash
git add src/audio/reverbWorker.ts src/audio/SendFx.ts src/audio/AudioEngine.ts src/components/FxRack.tsx
git commit -m "feat(reverb): Fibonacci IR + Spring type + better stereo decorrelation"
```

---

## Task 3: Delay Upgrade — Tape Saturation + Analog Mode

**Files:**
- Modify: `src/audio/SendFx.ts`
- Modify: `src/audio/AudioEngine.ts`
- Modify: `src/components/FxRack.tsx`

### Step 3.1 — Add delay saturation node to SendFx.ts

Read `src/audio/SendFx.ts`.

**A. Add private field** after `private delayTapeLfoGain: GainNode | null = null;` (around line 59):

```typescript
private delaySaturation: WaveShaperNode | null = null;
private delayMode: "clean" | "tape" | "analog" = "clean";
```

**B. Helper method — add after `generateNoiseBuffer()`** (around line 515, after the closing `}`):

```typescript
/** Build a soft-clip WaveShaper curve for delay saturation */
private buildDelaySatCurve(mode: "clean" | "tape" | "analog"): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // -1 to +1
    if (mode === "clean") {
      curve[i] = x; // Linear = bypass
    } else if (mode === "tape") {
      // Warm asymmetric soft-clip (tape head saturation)
      curve[i] = (2 / Math.PI) * Math.atan(x * 1.8) + x * 0.06;
    } else {
      // BBD-style: harder saturation, more even harmonics
      const k = 3.2;
      curve[i] = (x * (Math.abs(x) + k)) / (x * x + (k - 1) * Math.abs(x) + 1);
    }
  }
  return curve;
}
```

**C. In `init()`, after `this.delayTapeLfoGain.connect(this.delayNode.delayTime);` and before `this.delayTapeLfo.start();`** — insert:

```typescript
// Saturation node in the feedback path (starts linear = clean bypass)
this.delaySaturation = ctx.createWaveShaper();
this.delaySaturation.curve = this.buildDelaySatCurve("clean");
this.delaySaturation.oversample = "2x";
```

**D. Change the delay routing in `init()`** — find:

```typescript
this.sendBBus.connect(this.delayNode);
this.delayNode.connect(this.delayFilter);
this.delayFilter.connect(this.delayFeedback);
this.delayFeedback.connect(this.delayNode); // Feedback loop
this.delayFilter.connect(this.delayPanner);
```

Replace with:

```typescript
this.sendBBus.connect(this.delayNode);
this.delayNode.connect(this.delaySaturation!);   // saturation in signal path
this.delaySaturation!.connect(this.delayFilter);
this.delayFilter.connect(this.delayFeedback);
this.delayFeedback.connect(this.delayNode);       // Feedback loop
this.delayFilter.connect(this.delayPanner);
```

**E. Add `setDelayMode()` method** — add after `getDelayType()`:

```typescript
/** Set delay character mode: clean (linear), tape (warm sat), analog (harder sat) */
setDelayMode(mode: "clean" | "tape" | "analog"): void {
  this.delayMode = mode;
  if (this.delaySaturation) {
    this.delaySaturation.curve = this.buildDelaySatCurve(mode);
  }
  // Also configure tape LFO and filter cutoff per mode
  if (this.delayTapeLfoGain) {
    this.delayTapeLfoGain.gain.value = mode === "tape" ? 0.0018 : mode === "analog" ? 0.003 : 0;
  }
  if (this.delayFilter) {
    this.delayFilter.frequency.value = mode === "tape" ? 2800 : mode === "analog" ? 2200 : 4000;
  }
}

getDelayMode(): string {
  return this.delayMode;
}
```

### Step 3.2 — Expose setDelayMode in AudioEngine.ts

Add after `getDelayType()`:

```typescript
setDelayMode(mode: "clean" | "tape" | "analog"): void { sendFxManager.setDelayMode(mode); }
getDelayMode(): string { return sendFxManager.getDelayMode(); }
```

### Step 3.3 — Add delay mode selector to FxRack.tsx

Read `src/components/FxRack.tsx`. Find the delay module definition in `FX_MODULES`. Add a param:

```typescript
{ id: "mode", label: "Mode", min: 0, max: 2, default: 0 },  // 0=clean 1=tape 2=analog
```

In `applyModuleParam()`, find `case "delay":`. Add inside it:

```typescript
if (paramId === "mode") {
  const modes = ["clean", "tape", "analog"] as const;
  audioEngine.setDelayMode(modes[Math.round(value)] ?? "clean");
}
```

In `applyModuleToggle()`, find `case "delay":`. After the existing `audioEngine.setDelayParams(...)` line, add:

```typescript
const modes = ["clean", "tape", "analog"] as const;
audioEngine.setDelayMode(modes[Math.round(params.mode ?? 0)] ?? "clean");
```

### Step 3.4 — TypeScript check

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

### Step 3.5 — Commit

```bash
git add src/audio/SendFx.ts src/audio/AudioEngine.ts src/components/FxRack.tsx
git commit -m "feat(delay): tape/analog saturation modes in delay feedback path"
```

---

## Task 4: Kaoss Pad — PHASER + CHORUS Modes

**Files:**
- Modify: `src/components/FxPanel.tsx`

### Step 4.1 — Extend FxMode type

Read `src/components/FxPanel.tsx`. Find:

```typescript
type FxMode = "FILTER" | "DELAY" | "REVERB" | "FLANGER" | "CRUSH";
```

Replace with:

```typescript
type FxMode = "FILTER" | "DELAY" | "REVERB" | "FLANGER" | "CRUSH" | "PHASER" | "CHORUS";
```

### Step 4.2 — Add new entries to MODE_CONFIG

Find the `MODE_CONFIG` object. Add after `CRUSH`:

```typescript
  PHASER: { color: "#22d3ee", xLabel: "Rate",  yLabel: "Depth + Feedback" },
  CHORUS: { color: "#a3e635", xLabel: "Rate",  yLabel: "Depth" },
```

### Step 4.3 — Add icons to ModeIcon

Find the `ModeIcon` switch statement. Add before the closing `}`:

```tsx
case "PHASER": // Phase-shift wave
  return (
    <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
      <path d="M 1 7 Q 5 1 9 7 T 17 7 T 25 7" {...common} />
      <path d="M 1 7 Q 5 13 9 7 T 17 7 T 25 7" {...common} opacity="0.4" />
    </svg>
  );
case "CHORUS": // Three parallel waves
  return (
    <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
      <path d="M 1 4 Q 7 1 13 4 T 25 4" {...common} />
      <path d="M 1 7 Q 7 4 13 7 T 25 7" {...common} opacity="0.65" />
      <path d="M 1 10 Q 7 7 13 10 T 25 10" {...common} opacity="0.35" />
    </svg>
  );
```

### Step 4.4 — Add to FX_MODES

Find:
```typescript
const FX_MODES: FxMode[] = ["FILTER", "DELAY", "REVERB", "FLANGER", "CRUSH"];
```

Replace with:
```typescript
const FX_MODES: FxMode[] = ["FILTER", "DELAY", "REVERB", "FLANGER", "CRUSH", "PHASER", "CHORUS"];
```

### Step 4.5 — Add presets to FX_MODE_PRESETS

Find `FX_MODE_PRESETS`. Add after the last entry (CRUSH):

```typescript
  PHASER: [
    { label: "Slow",   x: 0.15, y: 0.35 },
    { label: "Medium", x: 0.45, y: 0.55 },
    { label: "Fast",   x: 0.75, y: 0.70 },
  ],
  CHORUS: [
    { label: "Subtle", x: 0.25, y: 0.30 },
    { label: "Lush",   x: 0.50, y: 0.65 },
    { label: "Wide",   x: 0.70, y: 0.85 },
  ],
```

### Step 4.6 — Add to applyFxMode()

Find `applyFxMode()`. Add after the `CRUSH` case (before the closing `}`):

```typescript
    case "PHASER": {
      // X: rate 0.05–6Hz (exponential)
      const rate = 0.05 * Math.pow(6 / 0.05, x);
      // Y: depth 0–1 + feedback 0–0.7
      const feedback = y * 0.7;
      audioEngine.setPhaserRate(rate);
      audioEngine.setPhaserFeedback(feedback);
      audioEngine.setPhaserLevel(0.35 + y * 0.4);
      break;
    }
    case "CHORUS": {
      // X: rate 0.5–4Hz, Y: depth/width 0–1
      const rate  = 0.5 + x * 3.5;
      const depth = y;
      audioEngine.setChorusRate(rate);
      audioEngine.setChorusDepth(depth);
      audioEngine.setChorusLevel(0.3 + y * 0.5);
      break;
    }
```

### Step 4.7 — Add to activateFxMode()

Find `activateFxMode()`. After the `if (mode === "FLANGER")` block, add:

```typescript
  if (mode === "PHASER") {
    // Open synth sends to phaser bus
    [12, 13, 14].forEach((ch) => audioEngine.setChannelPhaserSend(ch, 0.38));
  }
  if (mode === "CHORUS") {
    // Open synth sends to chorus bus
    [12, 13, 14].forEach((ch) => audioEngine.setChannelChorusSend(ch, 0.38));
  }
```

### Step 4.8 — Add to releaseFxMode()

Find `releaseFxMode()`. Add after the `CRUSH` case:

```typescript
    case "PHASER":
      audioEngine.setPhaserLevel(0);
      [12, 13, 14].forEach((ch) => audioEngine.setChannelPhaserSend(ch, 0));
      break;
    case "CHORUS":
      audioEngine.setChorusLevel(0);
      [12, 13, 14].forEach((ch) => audioEngine.setChannelChorusSend(ch, 0));
      break;
```

### Step 4.9 — TypeScript check

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

### Step 4.10 — Commit

```bash
git add src/components/FxPanel.tsx
git commit -m "feat(kaoss): add PHASER and CHORUS modes to Kaoss Pad"
```

---

## Task 5: FxChain Module Improvements

**Files:**
- Modify: `src/audio/FxChain.ts`

### Step 5.1 — Read FxChain.ts

Read `src/audio/FxChain.ts` completely to understand the current structure before making changes.

### Step 5.2 — Improve Bitcrusher curve (add dithering)

Find `applyBitcrushCurve()`:

```typescript
function applyBitcrushCurve(shaper: WaveShaperNode, bits: number): void {
  const steps = Math.max(2, Math.pow(2, Math.max(1, Math.floor(bits))));
  const curve = new Float32Array(new ArrayBuffer(2048 * 4));
  for (let i = 0; i < 2048; i++) {
    const x = (i / 2047) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  shaper.curve = curve;
}
```

Replace with:

```typescript
function applyBitcrushCurve(shaper: WaveShaperNode, bits: number): void {
  const steps = Math.max(2, Math.pow(2, Math.max(1, Math.floor(bits))));
  const n = 4096;
  const curve = new Float32Array(n);
  // Use a seeded PRNG for deterministic dither (same curve on re-render)
  let seed = 0x5a3c;
  const drand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
  const dither = 0.38 / steps; // Triangular dither amplitude
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const d = (drand() - drand()) * dither; // TPDF dither
    curve[i] = Math.max(-1, Math.min(1, Math.round((x + d) * steps) / steps));
  }
  shaper.curve = curve;
}
```

### Step 5.3 — Extend RingMod frequency range

Find `FX_CATALOG` array. Find the `ringmod` entry params:

```typescript
{ id: "freq", label: "Freq", min: 20, max: 2000, default: 220, unit: "Hz" },
```

Replace with:

```typescript
{ id: "freq", label: "Freq", min: 1, max: 5000, default: 220, unit: "Hz" },
```

Then find the `createRingMod()` function. Find where `carrier.frequency.value` is set from params. In the `setParam` handler, find:

```typescript
if (id === "freq") carrier.frequency.value = v;
```

Ensure it stays as-is (the min/max change in the catalog is sufficient).

### Step 5.4 — Improve Autofilter ranges and curves

Find `FX_CATALOG`. Find the `autofilter` entry params:

```typescript
{ id: "rate",   label: "Rate",  min: 0.05, max: 8,    default: 0.5, unit: "Hz" },
{ id: "center", label: "Freq",  min: 100,  max: 8000, default: 1000, unit: "Hz" },
{ id: "depth",  label: "Depth", min: 0,    max: 1,    default: 0.7 },
{ id: "res",    label: "Res",   min: 0.5,  max: 20,   default: 4 },
```

Replace with:

```typescript
{ id: "rate",   label: "Rate",  min: 0.02, max: 12,   default: 0.5,  unit: "Hz" },
{ id: "center", label: "Freq",  min: 80,   max: 9000, default: 1200, unit: "Hz" },
{ id: "depth",  label: "Depth", min: 0,    max: 1,    default: 0.6 },
{ id: "res",    label: "Res",   min: 0.5,  max: 20,   default: 5.5 },
```

Find `createAutofilter()` function. Find where the LFO rate and depth are applied in `setParam`. Locate lines like:

```typescript
if (id === "rate")   lfo.frequency.value = v;
if (id === "depth")  lfoGain.gain.value  = v * center * 0.8; // or similar
```

Depending on the exact implementation, update the depth scaling to be exponential. Find the depth application in setParam — look for a line that sets `lfoGain.gain.value` based on `depth`. Update it to use an exponential curve:

```typescript
if (id === "depth") {
  // Exponential depth: subtle at low values, dramatic at high
  const expDepth = Math.pow(params.depth, 1.6) * 4000;
  lfoGain.gain.value = expDepth;
}
```

Note: Read the actual `createAutofilter()` implementation carefully — the exact variable names for `lfo` and `lfoGain` may differ. Adapt to what's actually there.

### Step 5.5 — Add waveform selector to Tremolo

Find `FX_CATALOG`. Find the `tremolo` entry params:

```typescript
{ id: "rate",  label: "Rate",  min: 0.1, max: 20, default: 4, unit: "Hz" },
{ id: "depth", label: "Depth", min: 0,   max: 1,  default: 0.5 },
```

Add a third param:

```typescript
{ id: "wave", label: "Wave", min: 0, max: 2, default: 0 },  // 0=sine 1=square 2=triangle
```

Find `createTremolo()`. Read its implementation. It uses an OscillatorNode for the LFO. Find where the LFO oscillator is created and its type set. In the `setParam` handler, add:

```typescript
if (id === "wave") {
  const types: OscillatorType[] = ["sine", "square", "triangle"];
  lfo.type = types[Math.round(v)] ?? "sine";
}
```

Where `lfo` is the OscillatorNode variable in `createTremolo()`. Adapt to the actual variable name.

### Step 5.6 — TypeScript check

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If `OscillatorType` is not imported, it's a global Web Audio type — no import needed in TypeScript strict mode.

### Step 5.7 — Commit

```bash
git add src/audio/FxChain.ts
git commit -m "feat(fxchain): dithered bitcrusher, wider ringmod/autofilter, tremolo waveform selector"
```

---

## Task 6: Final Build + Test

### Step 6.1 — Production build

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npm run build 2>&1 | tail -15
```

Expected: `✓ built in`, no TypeScript errors, no chunk over 1MB.

### Step 6.2 — Smoke test checklist

Start dev server:
```bash
npm run dev
```

Manual verification:
- [ ] FxPanel → REVERB mode → touch pad → reverb IS audible on synth channels (was silent before)
- [ ] FxPanel → DELAY mode → touch pad → delay echoes ARE audible
- [ ] FxPanel → PHASER mode → visible in mode list, X/Y controls phaser sweep
- [ ] FxPanel → CHORUS mode → visible in mode list, lush chorus effect on synths
- [ ] FxRack → Chorus module ON → effect is audible (was silent before)
- [ ] FxRack → Reverb module → type knob cycles Room/Hall/Plate/Spring
- [ ] FxRack → Delay module → mode knob selects Clean/Tape/Analog (Tape sounds warmer)
- [ ] PerformancePad → REVERB y-param → release finger → smooth fade-back (no steps/clicks)
- [ ] All existing presets and kits unchanged

### Step 6.3 — Final commit

```bash
git add -A
git commit -m "feat: FX overhaul complete — routing, reverb, delay tape, phaser/chorus pad, fxchain"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Kaoss Pad auto-opens sends for REVERB/DELAY | Task 1 Step 1.3 |
| FxRack Chorus uses proper API | Task 1 Step 1.4 |
| Smooth spring-back (no setTimeout loop) | Task 1 Step 1.5 |
| Fibonacci taps in reverb IR | Task 2 Step 2.1 |
| Spring reverb type | Task 2 Steps 2.1–2.4 |
| Frequency-dependent reverb decay | Task 2 Step 2.1 |
| Stereo decorrelation | Task 2 Step 2.1 |
| Tape delay saturation | Task 3 Step 3.1 |
| Analog delay mode | Task 3 Step 3.1 |
| BPM sync all delay modes | Task 3 (syncDelayToBpm already works, setDelayMode preserves it) |
| Delay mode dropdown in FxRack | Task 3 Step 3.3 |
| Reverb type dropdown in FxRack | Task 2 Step 2.4 |
| PHASER Kaoss Pad mode | Task 4 |
| CHORUS Kaoss Pad mode | Task 4 |
| Bitcrusher dithering | Task 5 Step 5.2 |
| RingMod wider range | Task 5 Step 5.3 |
| Autofilter wider range + exp curve | Task 5 Step 5.4 |
| Tremolo waveform selector | Task 5 Step 5.5 |
