# Polish Sprint A+B — Design Spec

## Goal
Two focused polish sprints that make Elastic Drums demo-ready: Sprint A delivers high-visibility UI/UX wins with zero audio-graph risk; Sprint B adds waveform display with interactive drag handles to the Loop Player.

## Architecture
- Sprint A: pure React/CSS changes — no new files, edits to existing components
- Sprint B: new `WaveformCanvas` component + waveform peak data stored in `loopPlayerStore`

---

## Sprint A — Quick Wins

### A1: Tab-Badges (Farbiger Unterstrich)
**File:** `src/App.tsx` (tab rendering)

A 2px colored `border-bottom` appears on a tab when content in that tab is actively producing sound:
- **DRUMS**: `isPlaying` (transport running)
- **BASS**: transport playing AND bass store has ≥1 step with a note
- **LOOPS**: `slots.some(s => s.playing)`
- **SYNTH 1 / SYNTH 2**: transport playing AND piano-roll has ≥1 note
- Badge hidden when tab is currently selected (already visible, redundant)
- Colors match existing channel colors: Drums=#f59e0b, Bass=#10b981, Loops=#2EC4B6, Synths=#a78bfa/#f472b6

### A2: Mute/Solo Visualisierung im MixerBar
**File:** `src/components/MixerBar.tsx`

- **Muted channel**: meter `<canvas>` gets `opacity: 0.25`; channel name already dims to `#333`
- **Solo active** (any channel soloed): non-soloed channel strips get `opacity: 0.4` on the entire column div
- No audio-graph changes — purely CSS driven by existing Zustand state

### A3: Play-Animation Loop-Slots
**File:** `src/components/LoopPlayerTab.tsx`

When `slot.playing && isTransportPlay`, the slot card gets a pulsing teal glow:
```css
@keyframes loop-pulse {
  0%, 100% { box-shadow: 0 0 0 1px #2EC4B620, 0 0 6px 1px #2EC4B610; }
  50%       { box-shadow: 0 0 0 1px #2EC4B680, 0 0 12px 3px #2EC4B630; }
}
animation: loop-pulse 2s ease-in-out infinite;
```
Existing `isActive` variable already tracks this state — just wire up the animation.

### A4: Drum-Fade beim Stop
**File:** `src/audio/AudioEngine.ts` or `src/store/drumStore.ts`

When transport stops, instead of abruptly cutting all drum voices, ramp the master drum bus gain to 0 over 40ms, then cut. Specifically: when `isPlaying` flips false, call `audioEngine.fadeDrumBus(0, 0.04)` which does `gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.04)` then resets to 1 after 60ms. This prevents the hard click on stop.

### A5: Shortcut-Overlay
**File:** `src/components/ShortcutOverlay.tsx` (new, ~80 lines)

`?` key (and a small `?` button in the toolbar) toggles a centered modal overlay with shortcuts in 3 columns:
- Column 1: Drums/Sequencer (Q-V pads, Space, 1-6 patterns, ←→ presets, Ctrl+Z/Y)
- Column 2: Piano Roll (B/S tools, L loop, D duplicate, ↑↓ transpose, Ctrl+A/C/V)
- Column 3: Loops/Transport (pad triggers 1-4 rows, Tap BPM)

Dark semi-transparent backdrop, closes on Escape or backdrop click.

---

## Sprint B — Loop Player Waveform

### B1: Waveform Peak Data in Store
**File:** `src/store/loopPlayerStore.ts`

Add to `LoopSlotState`:
```typescript
waveformPeaks: Float32Array | null;  // normalized 0..1, one value per pixel column
```

After `setBuffer()` resolves, compute peaks synchronously from the AudioBuffer (it's already in memory):
```typescript
function computePeaks(buffer: AudioBuffer, numBars: number): Float32Array {
  const peaks = new Float32Array(numBars);
  const samplesPerBar = Math.floor(buffer.length / numBars);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < numBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar; j++) peak = Math.max(peak, Math.abs(ch[start + j] ?? 0));
    peaks[i] = peak;
  }
  return peaks;
}
```
`numBars = 120` (fixed, computed once per load). Result stored in slot state. Excluded from HMR `import.meta.hot.data` preservation (recomputed on reload — cheap).

### B2: WaveformCanvas Component
**File:** `src/components/WaveformCanvas.tsx` (new, ~180 lines)

Props:
```typescript
interface WaveformCanvasProps {
  peaks:          Float32Array;
  loopStart:      number;   // 0..1 normalized position
  loopEnd:        number;   // 0..1 normalized position
  playhead:       number;   // 0..1, -1 = hidden
  onLoopStartChange: (pos: number) => void;
  onLoopEndChange:   (pos: number) => void;
  onDragEnd:         () => void;  // calls restartSlot after drag
}
```

Canvas: `width=auto (ref measured), height=56px`. Draws:
1. All bars (3px wide, 2px gap, centered vertically from midpoint)
2. Bars inside [loopStart, loopEnd]: `#2EC4B6`; outside: `#555` at 0.35 opacity
3. Start handle: 2px teal line full height + 8×8px rectangles at top-0 and bottom-48
4. End handle: same
5. Playhead: 1.5px white line

Pointer events on canvas:
- Hit-test `pointerdown` → within 6px of start/end handle → begin drag
- `pointermove` → update position (clamped 0..1, start < end - minGap)
- `pointerup` → call `onDragEnd()`

### B3: Playhead Animation
**File:** `src/components/WaveformCanvas.tsx`

`useEffect` that runs a `requestAnimationFrame` loop only when `playing` prop is true. Reads `audioEngine.currentTime` and the slot's start time (passed as prop) to compute playhead position. Cancels RAF on unmount or when playing stops.

### B4: Integration in LoopPlayerTab
**File:** `src/components/LoopPlayerTab.tsx`

Inside each slot card, below the filename row, render:
```tsx
{slot.waveformPeaks && (
  <WaveformCanvas
    peaks={slot.waveformPeaks}
    loopStart={loopStartNorm}
    loopEnd={loopEndNorm}
    playhead={isArmed ? playheadPos : -1}
    onLoopStartChange={...}
    onLoopEndChange={...}
    onDragEnd={() => restartSlot(slotIndex)}
  />
)}
```

Remove the existing separate Start/End knob row when waveformPeaks is present — the handles replace them. Keep as fallback when peaks are null (file still loading).

---

## Files Changed

| File | Change |
|------|--------|
| `src/App.tsx` | Tab badge underline logic |
| `src/components/MixerBar.tsx` | Mute/solo opacity |
| `src/components/LoopPlayerTab.tsx` | Play animation + WaveformCanvas integration |
| `src/audio/AudioEngine.ts` | `fadeDrumBus()` method |
| `src/store/drumStore.ts` | Call `fadeDrumBus` on stop |
| `src/store/loopPlayerStore.ts` | `waveformPeaks` field + `computePeaks()` |
| `src/components/ShortcutOverlay.tsx` | **NEW** — shortcut modal |
| `src/components/WaveformCanvas.tsx` | **NEW** — waveform + handles + playhead |

---

## Non-Goals
- No project persistence (Sprint D, separate)
- No Group-Bus-Faders (Sprint C, separate)
- No undo/redo for mixer
- WaveformCanvas does NOT use wavesurfer.js (keeps bundle lean)
