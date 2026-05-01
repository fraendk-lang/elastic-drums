# Beat FX Panel — Design Spec

**Date:** 2026-05-01

---

## Goal

A fixed sidebar panel (right side of the app) with 6 professional hold-to-activate Beat FX. Each effect has at least one adjustable mini-parameter. Effects apply to the master signal path.

---

## Placement

Fixed sidebar, always visible on the right side of the main layout. No toggle required — effects are immediately reachable. Width: ~100px.

---

## Interaction Model

- **Hold-to-activate**: `pointerdown` on a button starts the effect. `pointerup` or `pointercancel` anywhere stops it (even if the finger slides off the button).
- Effects have individual release behaviour (some tail out naturally, some cut immediately).
- Multiple effects cannot be active simultaneously (pressing a second button while one is held stops the first).

---

## The 6 Effects

### 1. THROW — Reverb Flood
- **On press**: Master reverb wet level ramps from current value → 100% over 80ms
- **On release**: Reverb wet ramps back to pre-press level over 500ms (natural tail)
- **Mini-param — SIZE**: Controls reverb room size. Small = short room, Large = cathedral. Range: 0–1 mapped to reverb decay 0.5s–6s

### 2. SPIRAL — Flanger Sweep
- **On press**: Flanger inserted into master path, LFO starts sweeping delay time (0.1ms–5ms)
- **On release**: Flanger fades out over 150ms, node disconnected
- **Mini-param — SPEED**: LFO rate. Range: 0.2Hz (slow, hypnotic) → 8Hz (fast, aggressive)

### 3. ECHO — Delay Flood
- **On press**: Master delay feedback ramps from current value → FEEDBACK level over 100ms. Echoes build.
- **On release**: Feedback ramps to 0 — echoes die out naturally (no hard cut)
- **Mini-param — FEEDBACK**: Max feedback level. Range: 0.5 (few echoes) → 0.92 (near self-oscillation)

### 4. FREEZE — Buffer Loop
- **Background**: ScriptProcessorNode continuously ring-buffers the last 500ms of master audio output
- **On press**: Snapshot of last LENGTH ms copied into AudioBuffer → loops via AudioBufferSourceNode. Crossfade in over 30ms.
- **On release**: Crossfade out over 80ms, normal signal restored
- **Mini-param — LENGTH**: Capture duration. Range: 10ms (grain/particle) → 200ms (full beat slice)

### 5. CHOKE — LP Filter Sweep
- **On press**: BiquadFilterNode (lowpass) sweeps from 20000Hz → FREQUENCY target over 180ms
- **On release**: Filter sweeps back to 20000Hz over 100ms, node bypassed
- **Mini-param — FREQUENCY**: Target cutoff. Range: 80Hz (fully choked) → 2000Hz (lightly dampened)

### 6. NOISE — White Noise Wash
- **On press**: Pre-generated white noise AudioBuffer plays through GainNode + BiquadFilterNode (LP). Volume ramps in over 80ms.
- **On release**: Volume ramps to 0 over 60ms (immediate-feeling but click-free)
- **Mini-params — VOL + CUT** (two params, user's explicit request):
  - VOL: Mix level. Range: 0–100% over master signal
  - CUT: LP filter cutoff. Range: 200Hz (dark rumble) → 20000Hz (full white hiss)

---

## Architecture

### New file: `src/audio/BeatFx.ts`

Singleton class managing all 6 effects. Inserts a `BeatFxChain` node between the master gain and the audio destination.

```typescript
class BeatFxManager {
  // Signal routing: masterGain → beatFxInput → [effect nodes] → beatFxOutput → destination
  connect(masterGain: GainNode, destination: AudioNode): void;

  // Effect control
  startEffect(id: BeatFxId): void;
  stopEffect(id: BeatFxId): void;

  // Parameter update (called from UI slider change)
  setParam(id: BeatFxId, param: string, value: number): void;

  // Internal ring buffer for FREEZE
  private ringBuffer: Float32Array; // 500ms at 44100Hz = ~22050 samples
  private ringPos: number;
}

type BeatFxId = 'throw' | 'spiral' | 'echo' | 'freeze' | 'choke' | 'noise';
```

Each effect is a self-contained method:
- `_startThrow() / _stopThrow()`
- `_startSpiral() / _stopSpiral()`
- `_startEcho() / _stopEcho()`
- `_startFreeze() / _stopFreeze()`
- `_startChoke() / _stopChoke()`
- `_startNoise() / _stopNoise()`

### New file: `src/components/BeatFxPanel.tsx`

Sidebar component. Local state for all params (no store needed — params are performance-time only, no persistence required).

```typescript
interface BeatFxState {
  throwSize: number;      // 0–1, default 0.6
  spiralSpeed: number;    // 0–1, default 0.4
  echoFeedback: number;   // 0–1, default 0.65
  freezeLength: number;   // 0–1, default 0.3
  chokeFreq: number;      // 0–1, default 0.2
  noiseVol: number;       // 0–1, default 0.35
  noiseCut: number;       // 0–1, default 0.8
  activeEffect: BeatFxId | null;
}
```

UI: Vertical list of effect blocks. Each block: colored button (full width) + mini-slider(s) below it. Active button glows with box-shadow pulse animation.

### Modified: `src/App.tsx` or layout component

Add `<BeatFxPanel />` as a fixed-width column in the main layout grid.

---

## Signal Routing

```
Master GainNode
    ↓
BeatFx Input Node (GainNode, passthrough)
    ↓
[Active effect nodes — connected/disconnected on demand]
    ↓
BeatFx Output Node (GainNode, passthrough)
    ↓
Compressor → Limiter → Destination
```

Effects are connected in parallel with a dry signal or switched in series depending on the effect type:
- THROW / ECHO / CHOKE: modify existing send FX levels or insert inline
- SPIRAL / FREEZE / NOISE: parallel inject into the chain

---

## Effect Colors

| Effect | Color |
|--------|-------|
| THROW | `#3b82f6` (Blue) |
| SPIRAL | `#ec4899` (Pink) |
| ECHO | `#10b981` (Green) |
| FREEZE | `#a78bfa` (Purple) |
| CHOKE | `#0ea5e9` (Sky) |
| NOISE | `#6b7280` (Gray) |

Active state: color-matched `box-shadow` pulse + 15% brighter background.

---

## Files Changed

| File | Change |
|------|--------|
| `src/audio/BeatFx.ts` | **NEW** — all 6 effects + ring buffer |
| `src/components/BeatFxPanel.tsx` | **NEW** — sidebar UI |
| `src/App.tsx` | Add `<BeatFxPanel />` to layout |
