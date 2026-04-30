# Melody Pad — Volume Control + Classic Arp Design

**Date:** 2026-04-30

---

## Goal

Add a dedicated volume slider and a classic Ableton-style tempo-synced arpeggiator to the Melody XY Pad (`PerformancePad.tsx`).

---

## Layout

```
┌─────────────────────────────────────────┬──┐
│                                         │  │ ▲
│              XY PAD                     │  │ │
│         (X = pitch, Y = cutoff)         │  │ VOL
│                                         │  │ │
└─────────────────────────────────────────┴──┘ ▼
┌──────────────────────────────────────────────┐
│ ARP ● │ UP  ↕UD  RND │ 1/4  1/8  1/16 │ 1 2Oct │ LATCH │
└──────────────────────────────────────────────┘
```

- **Volume slider**: vertical `<input type="range">` right of the XY pad, full pad height, 0–100 (default 80)
- **Arp bar**: single row of toggle/select buttons directly below the pad, always visible

---

## Volume Control

- Replaces Y-axis volume assignment as the primary volume control
- Y axis is freed for other assignments (cutoff, reverb, etc.)
- Slider value (0–100) maps to a gain multiplier (0–1) applied to each triggered voice
- `sweepLiveVolume(vol / 100)` called on slider change, same path as existing Y=volume

---

## Arp Controls (Arp Bar)

| Control | Values | Default |
|---------|--------|---------|
| ARP ON/OFF | toggle | OFF |
| Mode | UP · ↕UD · RND | UP |
| Rate | 1/4 · 1/8 · 1/16 | 1/8 |
| Octave | 1 · 2 | 1 |
| LATCH | toggle | OFF |

All active selections highlighted in orange (`#f97316`).

---

## Arp Behavior

### Touch → Arp Start
- When ARP is ON and the user touches the pad, the arp scheduler starts
- Root note = scale-locked pitch at current X position (same logic as existing X→pitch mapping)
- Arp plays through scale notes upward from root, repeating at the chosen rate

### Root Note Tracking
- While finger is held, X position is read at **each arp step boundary** (not continuously)
- This quantizes pitch changes to the grid — musically tight, not chaotic
- Implementation: scheduler reads `currentRootNoteRef.current` at start of each scheduled step

### Release Behavior
- **LATCH OFF**: arp completes the current note, then stops at the next step boundary
- **LATCH ON**: arp continues running after finger lift, using the last X pitch as root
- Latch disengages when ARP ON/OFF is toggled or pad is touched again

### Multi-touch
- Multiple simultaneous touches: use the most recently touched finger as root (existing `activeVoicesRef` logic)

---

## Architecture

### New file: `src/audio/ArpScheduler.ts`

Web Audio API lookahead scheduler, ~80 lines, mirrors `BassScheduler.ts` pattern.

```typescript
interface ArpSchedulerOptions {
  getRoot: () => number;               // called each step to get current root MIDI
  getSettings: () => ArpSettings;      // mode, rate, octaves, gate
  scaleName: string;
  onNote: (midi: number, duration: number, atTime: number, velocity: number) => void;
}
```

- `generateArpNotes(root, stepDuration, settings, scaleName, root)` returns all sub-notes with `offset` times for the step
- Scheduler iterates the returned `ArpNote[]` and calls `ctx.currentTime + stepStart + note.offset` for each
- Uses `setInterval` (~25ms) as the scheduling heartbeat; notes themselves are scheduled via Web Audio `ctx.currentTime` — no drift
- `start(options)` / `stop()` public API; `updateRoot` not needed (scheduler calls `getRoot()` per step)

### Modified file: `src/components/PerformancePad.tsx`

New local state:
```typescript
const [arpOn, setArpOn]       = useState(false);
const [arpMode, setArpMode]   = useState<'up' | 'updown' | 'random'>('up');
const [arpRate, setArpRate]   = useState<'1/4' | '1/8' | '1/16'>('1/8');
const [arpOctaves, setArpOctaves] = useState<1 | 2>(1);
const [arpLatch, setArpLatch] = useState(false);
const [volume, setVolume]     = useState(80);
const currentRootRef          = useRef<number>(60); // MIDI note, updated on X move
```

Touch handler changes:
- On `pointerdown`: if arp ON, start `ArpScheduler` with current root
- On `pointermove`: update `currentRootRef.current` (scheduler reads it at next step)
- On `pointerup`: if latch OFF, stop at next step boundary; if latch ON, keep running

### Existing file: `src/audio/Arpeggiator.ts`

Already implements `generateArpNotes(baseNote, stepDuration, settings, scaleName, rootMidi)`. Used by `ArpScheduler` to get the next note in sequence. No changes needed.

---

## Note Playback

The `ArpScheduler` calls `onNote(midi, durationSec, atTime)` for each scheduled step. In `PerformancePad`, this callback:
1. Looks up the synth voice for the pad
2. Calls the existing note-trigger path with `atTime` (Web Audio scheduled time)
3. Note duration = `rateSec * 0.9` (slight gap between notes, legato feel)

---

## Edge Cases

- **ARP OFF while running**: scheduler stops immediately (no latch behavior)
- **BPM change while running**: scheduler recalculates `rateSec` on next loop iteration
- **Rate change while running**: takes effect at next step boundary
- **Mode change while running**: takes effect at next step boundary
- **Pad not touched + LATCH ON**: arp keeps running from last root until ARP toggled OFF
- **Very fast rate (1/16) + slow BPM**: minimum note duration clamped to 30ms

---

## Files Changed

| File | Change |
|------|--------|
| `src/audio/ArpScheduler.ts` | **NEW** — lookahead scheduler for arp |
| `src/components/PerformancePad.tsx` | Add volume slider + arp bar UI + wiring |
| `src/audio/Arpeggiator.ts` | No changes (already complete) |
