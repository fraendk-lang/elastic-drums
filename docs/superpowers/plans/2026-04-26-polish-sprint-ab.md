# Polish Sprint A+B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Elastic Drums demo-ready with 5 UI/UX quick wins (Sprint A) and an interactive bar-waveform with Ableton-style drag handles in the Loop Player (Sprint B).

**Architecture:** Sprint A = pure React/CSS/small audio changes to existing files. Sprint B = new `WaveformCanvas.tsx` component + `waveformPeaks` field in loopPlayerStore, integrated into LoopPlayerTab as a replacement for the existing canvas when peaks are available.

**Tech Stack:** React 18, TypeScript strict, Zustand, Web Audio API, Vite, Tailwind CSS

---

## File Map

| File | Change |
|------|--------|
| `src/store/loopPlayerStore.ts` | Add `waveformPeaks: Float32Array \| null` to slot state + `computePeaks()` |
| `src/components/WaveformCanvas.tsx` | **NEW** — bar-waveform, Ableton handles (Balken+Ohren), playhead RAF |
| `src/components/LoopPlayerTab.tsx` | Swap Row 2 canvas to WaveformCanvas when peaks available; add pulse animation |
| `src/components/SynthSection.tsx` | Tab badge: dim color underline when tab content is active but not selected |
| `src/components/MixerBar.tsx` | Mute/solo opacity on meter canvas + column div |
| `src/audio/MixerRouting.ts` | Add `getGroupGainNode(group): GainNode \| null` |
| `src/audio/AudioEngine.ts` | Add `fadeDrumBus(duration: number): void` |
| `src/store/drumStore.ts` | Call `audioEngine.fadeDrumBus(0.04)` before `stopScheduler()` |
| `src/store/overlayStore.ts` | Add `"shortcuts"` to OverlayId union |
| `src/hooks/useKeyboard.ts` | Add `?` key → `openOverlay("shortcuts")` |
| `src/components/ShortcutOverlay.tsx` | **NEW** — modal with keyboard shortcuts in 3 columns |
| `src/App.tsx` | Import and render ShortcutOverlay |

---

## Task 1: waveformPeaks in loopPlayerStore

**Files:**
- Modify: `src/store/loopPlayerStore.ts`

- [ ] **Step 1: Add `waveformPeaks` and `playStartedAt` to LoopSlotState interface**

In `src/store/loopPlayerStore.ts`, find `export interface LoopSlotState` (around line 32) and add after the `loopEndSeconds` field:

```typescript
  waveformPeaks:    Float32Array | null; // 120 bars, normalized 0..1 amplitude
  playStartedAt:    number | null;       // AudioContext time when slot last started (for playhead)
```

- [ ] **Step 2: Add `computePeaks` function**

Add this function after `extractBpmFromFilename` (around line 110), before the BPM Worker section:

```typescript
// ─── Waveform peak computation ─────────────────────────────
/**
 * Compute 120 peak values from an AudioBuffer for bar-waveform display.
 * Runs synchronously — buffer is already decoded, so this is cheap (~1ms).
 * Result is normalized 0..1.
 */
function computePeaks(buffer: AudioBuffer, numBars = 120): Float32Array {
  const peaks = new Float32Array(numBars);
  const ch = buffer.getChannelData(0);
  const samplesPerBar = Math.floor(ch.length / numBars);
  for (let i = 0; i < numBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar; j++) {
      const s = ch[start + j];
      if (s !== undefined && Math.abs(s) > peak) peak = Math.abs(s);
    }
    peaks[i] = peak;
  }
  return peaks;
}
```

- [ ] **Step 3: Update `createDefaultSlot()` to include new fields**

In `createDefaultSlot()`, add to the returned object:

```typescript
    waveformPeaks:   null,
    playStartedAt:   null,
```

- [ ] **Step 4: Call `computePeaks` in `setBuffer()` and `playStartedAt` in `togglePlay()`**

Find the `setBuffer` action in the store's action object. After it sets the slot's `buffer`, add peak computation. The setBuffer action looks like:

```typescript
setBuffer(idx, buffer, fileName) {
  // existing code updates buffer/fileName/duration/etc.
  // ADD at the end of the set() call:
  // waveformPeaks: computePeaks(buffer),
}
```

Find the exact `setBuffer` implementation and add `waveformPeaks: computePeaks(buffer)` to the slot update. Similarly, in `togglePlay(idx)`, when setting `playing: true`, also set `playStartedAt: audioEngine.getAudioContext()?.currentTime ?? null`.

To find `setBuffer`, search for `set((s) =>` near `buffer:` assignment in the store actions. Open the file and look at line ~200+ for the setBuffer action. Add `waveformPeaks: computePeaks(buffer),` to the slot object being spread-updated.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30`

Expected: no errors related to the new fields

- [ ] **Step 6: Commit**

```bash
git add src/store/loopPlayerStore.ts
git commit -m "feat: add waveformPeaks + computePeaks to loopPlayerStore"
```

---

## Task 2: WaveformCanvas Component

**Files:**
- Create: `src/components/WaveformCanvas.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/WaveformCanvas.tsx` with the full implementation:

```typescript
/**
 * WaveformCanvas — Compact bar-waveform with Ableton-style drag handles.
 *
 * Rendering:
 *  - 3px-wide bars, 2px gap, centered vertically from midpoint
 *  - Bars inside [loopStart, loopEnd] (normalized 0..1): teal #2EC4B6
 *  - Bars outside: #555 at 0.35 opacity
 *  - Start handle: 3px teal line full height + 8×10px tab at top + 8×10px tab at bottom
 *  - End handle: same
 *  - Playhead: 1.5px white line
 *
 * Pointer events:
 *  - Hit-test within 8px of handle → drag start/end
 *  - pointermove → update position (clamped, start < end - minGap)
 *  - pointerup → call onDragEnd()
 */

import { useRef, useEffect, useCallback } from "react";

const TEAL = "#2EC4B6";
const BAR_W = 3;
const BAR_GAP = 2;
const BAR_STRIDE = BAR_W + BAR_GAP;
const HIT_RADIUS = 8;
const MIN_GAP = 0.02; // minimum normalized distance between handles

export interface WaveformCanvasProps {
  peaks:              Float32Array;
  loopStart:          number;            // 0..1 normalized
  loopEnd:            number;            // 0..1 normalized
  playhead:           number;            // 0..1 or -1 = hidden
  playing:            boolean;
  playStartedAt:      number | null;     // AudioContext time when playback started
  loopDuration:       number;            // seconds, for playhead calculation
  onLoopStartChange:  (pos: number) => void;
  onLoopEndChange:    (pos: number) => void;
  onDragEnd:          () => void;
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  loopStart: number,
  loopEnd: number,
  playhead: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const midY = H / 2;

  ctx.clearRect(0, 0, W, H);

  // ── Background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);

  const numBars = peaks.length;
  const totalBarsWidth = numBars * BAR_STRIDE - BAR_GAP;
  const offsetX = (W - totalBarsWidth) / 2;

  // ── Waveform bars
  for (let i = 0; i < numBars; i++) {
    const norm = i / numBars; // normalized position of this bar
    const insideLoop = norm >= loopStart && norm < loopEnd;
    const peak = peaks[i] ?? 0;

    const barH = Math.max(2, peak * (H - 8));
    const x = offsetX + i * BAR_STRIDE;
    const y = midY - barH / 2;

    if (insideLoop) {
      ctx.fillStyle = TEAL;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#555";
      ctx.globalAlpha = 0.35;
    }
    // Rounded rect
    ctx.beginPath();
    ctx.roundRect(x, y, BAR_W, barH, 1);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Loop region tinted background
  const startPx = loopStart * W;
  const endPx   = loopEnd * W;
  ctx.fillStyle = `${TEAL}10`;
  ctx.fillRect(startPx, 0, endPx - startPx, H);

  // ── Start handle: full-height bar + top ear + bottom ear
  drawHandle(ctx, startPx, H, "left");

  // ── End handle
  drawHandle(ctx, endPx, H, "right");

  // ── Playhead
  if (playhead >= 0 && playhead <= 1) {
    const px = playhead * W;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(px - 0.75, 0, 1.5, H);
  }
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  H: number,
  _side: "left" | "right",
): void {
  const EAR_W = 8;
  const EAR_H = 10;
  const LINE_W = 3;

  // Full-height teal line
  ctx.fillStyle = TEAL;
  ctx.fillRect(x - LINE_W / 2, 0, LINE_W, H);

  // Top ear (tab)
  ctx.beginPath();
  ctx.roundRect(x - EAR_W / 2, 0, EAR_W, EAR_H, 2);
  ctx.fill();

  // Bottom ear (tab)
  ctx.beginPath();
  ctx.roundRect(x - EAR_W / 2, H - EAR_H, EAR_W, EAR_H, 2);
  ctx.fill();
}

export function WaveformCanvas({
  peaks,
  loopStart,
  loopEnd,
  playhead: _playheadProp,
  playing,
  playStartedAt,
  loopDuration,
  onLoopStartChange,
  onLoopEndChange,
  onDragEnd,
}: WaveformCanvasProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const dragRef    = useRef<"start" | "end" | null>(null);
  const playheadRef = useRef<number>(-1);

  // ── Redraw on prop changes (not during RAF — RAF updates playhead only)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Measure actual rendered width
    canvas.width  = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    drawWaveform(canvas, peaks, loopStart, loopEnd, playheadRef.current);
  }, [peaks, loopStart, loopEnd]);

  // ── Playhead RAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!playing || !canvas || playStartedAt === null || loopDuration <= 0) {
      playheadRef.current = -1;
      return;
    }

    const tick = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Get AudioContext current time from a shared getter
      // We can't import audioEngine here to avoid circular deps, so use
      // window.__audioCtxCurrentTime if available, else fall back to Date.now
      const now = (window as unknown as Record<string, number>).__audioCtxCurrentTime
        ?? (Date.now() / 1000);
      const elapsed = now - playStartedAt;
      playheadRef.current = (elapsed % loopDuration) / (loopDuration / 1);
      // Clamp to loop region
      const ph = loopStart + playheadRef.current * (loopEnd - loopStart);
      drawWaveform(canvas, peaks, loopStart, loopEnd, Math.min(ph, loopEnd));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, playStartedAt, loopDuration, peaks, loopStart, loopEnd]);

  // ── Pointer: hit-test
  const xToNorm = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const norm = xToNorm(e.clientX);
    const distStart = Math.abs(norm - loopStart);
    const distEnd   = Math.abs(norm - loopEnd);
    const hitPx = HIT_RADIUS / (canvasRef.current?.clientWidth ?? 400);

    if (distEnd < hitPx && distEnd <= distStart) {
      dragRef.current = "end";
    } else if (distStart < hitPx) {
      dragRef.current = "start";
    } else {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [loopStart, loopEnd, xToNorm]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const norm = xToNorm(e.clientX);
    if (dragRef.current === "start") {
      const clamped = Math.max(0, Math.min(norm, loopEnd - MIN_GAP));
      onLoopStartChange(clamped);
    } else {
      const clamped = Math.max(loopStart + MIN_GAP, Math.min(norm, 1));
      onLoopEndChange(clamped);
    }
  }, [loopStart, loopEnd, xToNorm, onLoopStartChange, onLoopEndChange]);

  const handlePointerUp = useCallback(() => {
    if (dragRef.current !== null) {
      dragRef.current = null;
      onDragEnd();
    }
  }, [onDragEnd]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: 56,
        display: "block",
        borderRadius: 4,
        cursor: "default",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
```

- [ ] **Step 2: Expose `__audioCtxCurrentTime` from AudioEngine**

For the playhead to work, AudioEngine needs to expose currentTime via a shared global.

In `src/audio/AudioEngine.ts`, find the `resume()` method or the `getContext()` usage and add in the `init()`/`getContext()` area:

```typescript
// Expose current time for RAF consumers (e.g. WaveformCanvas)
// This avoids importing audioEngine in child components.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "__audioCtxCurrentTime", {
    get: () => this.ctx?.currentTime ?? 0,
    configurable: true,
  });
}
```

Add this inside the `if (!this.ctx)` block in `getContext()`, after `this.ctx` is created.

- [ ] **Step 3: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in WaveformCanvas.tsx

- [ ] **Step 4: Commit**

```bash
git add src/components/WaveformCanvas.tsx src/audio/AudioEngine.ts
git commit -m "feat: add WaveformCanvas component with Ableton-style drag handles"
```

---

## Task 3: WaveformCanvas Integration in LoopPlayerTab

**Files:**
- Modify: `src/components/LoopPlayerTab.tsx`

- [ ] **Step 1: Import WaveformCanvas**

At the top of `src/components/LoopPlayerTab.tsx`, add:

```typescript
import { WaveformCanvas } from "./WaveformCanvas";
```

- [ ] **Step 2: Pull `waveformPeaks` and `playStartedAt` from slot state**

The `slot` object is already destructured in `LoopSlotCard`. Find where `slot.buffer`, `slot.duration`, etc. are used. The `slot` variable is typed as `LoopSlotState` and has the new fields automatically.

- [ ] **Step 3: Replace Row 2 canvas with WaveformCanvas when peaks available**

Find the `{/* ── Row 2: Waveform / drop zone ── */}` block (around line 605) in `LoopSlotCard`.

Replace the existing Row 2 div with this conditional rendering:

```tsx
{/* ── Row 2: Waveform / drop zone ── */}
{slot.waveformPeaks && pendingSlices === null ? (
  <WaveformCanvas
    peaks={slot.waveformPeaks}
    loopStart={slot.duration > 0 ? slot.firstBeatOffset / slot.duration : 0}
    loopEnd={
      slot.loopEndSeconds > slot.firstBeatOffset && slot.duration > 0
        ? slot.loopEndSeconds / slot.duration
        : 1
    }
    playhead={-1}
    playing={isActive}
    playStartedAt={slot.playStartedAt}
    loopDuration={
      slot.loopEndSeconds > slot.firstBeatOffset
        ? slot.loopEndSeconds - slot.firstBeatOffset
        : slot.duration - slot.firstBeatOffset
    }
    onLoopStartChange={(pos) => setFirstBeatOffset(slotIndex, pos * slot.duration)}
    onLoopEndChange={(pos) => setLoopEndSeconds(slotIndex, pos * slot.duration)}
    onDragEnd={() => restartSlot(slotIndex)}
  />
) : (
  <div
    ref={waveContRef}
    className="relative rounded overflow-hidden transition-all"
    style={{
      height: pendingSlices !== null ? 52 : 32,
      background: isDragOver ? `rgba(46,196,182,0.08)` : pendingSlices !== null ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.35)",
      border: isDragOver
        ? `1px dashed ${TEAL}60`
        : pendingSlices !== null
          ? "1px solid rgba(245,158,11,0.25)"
          : slot.buffer ? "1px solid rgba(255,255,255,0.05)" : "1px dashed rgba(255,255,255,0.08)",
    }}
  >
    {slot.buffer ? (
      <canvas
        ref={canvasRef}
        width={900}
        height={pendingSlices !== null ? 52 : 32}
        className="w-full h-full"
        style={{ imageRendering: "pixelated", display: "block", cursor: canvasCursor }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerLeave}
        onContextMenu={(e) => pendingSlices !== null && e.preventDefault()}
      />
    ) : (
      <label className="absolute inset-0 flex items-center justify-center cursor-pointer">
        <span className="text-[7px] font-bold tracking-[0.16em]" style={{ color: `${TEAL}28` }}>
          DROP AUDIO HERE
        </span>
        <input type="file" accept="audio/*" className="hidden" onChange={handleFileInput} />
      </label>
    )}
    {slot.analyzing && (
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
        <span className="text-[7px] font-bold tracking-[0.14em]" style={{ color: TEAL }}>ANALYZING BPM…</span>
      </div>
    )}
    {isActive && (
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${TEAL}10 50%, transparent)`, backgroundSize: "200% 100%", animation: "ed-shimmer 2.5s linear infinite" }} />
    )}
  </div>
)}
```

- [ ] **Step 4: Add pulse animation CSS + apply to slot card**

Add a `<style>` element before the LoopPlayerTab function definition (or inside `LoopPlayerTab` component using a static tag):

```typescript
// At module scope, inject once
if (typeof document !== "undefined" && !document.getElementById("ed-loop-pulse-style")) {
  const style = document.createElement("style");
  style.id = "ed-loop-pulse-style";
  style.textContent = `
    @keyframes ed-loop-pulse {
      0%, 100% { box-shadow: 0 0 0 1px #2EC4B620, 0 0 6px 1px #2EC4B610; }
      50%       { box-shadow: 0 0 0 1px #2EC4B680, 0 0 12px 3px #2EC4B630; }
    }
  `;
  document.head.appendChild(style);
}
```

In the slot card outer `<div>`, update the `style` prop to add the animation when `isActive`:

```tsx
style={{
  background: isArmed
    ? `color-mix(in srgb, ${TEAL} 6%, var(--ed-bg-surface))`
    : "var(--ed-bg-surface)",
  border: isArmed
    ? `1px solid ${TEAL}50`
    : isDragOver
      ? `1px dashed ${TEAL}50`
      : "1px solid var(--ed-border-subtle)",
  boxShadow: isActive ? `0 0 14px ${TEAL}14` : "none",
  animation: isActive ? "ed-loop-pulse 2s ease-in-out infinite" : "none",
  padding: "7px 9px",
}}
```

- [ ] **Step 5: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 6: Manual test**

Load a WAV in a loop slot, verify:
- Bar-waveform appears with teal bars in loop region, gray outside
- Drag handles (vertical line + ear tabs) are visible at loop start/end
- Dragging a handle updates the loop region in real time
- Slot card pulses with teal glow when playing + transport running

- [ ] **Step 7: Commit**

```bash
git add src/components/LoopPlayerTab.tsx
git commit -m "feat: integrate WaveformCanvas into LoopPlayerTab with pulse animation"
```

---

## Task 4: Tab Badges in SynthSection

**Files:**
- Modify: `src/components/SynthSection.tsx`

- [ ] **Step 1: Add store imports for active-content detection**

At the top of `src/components/SynthSection.tsx`, add these imports after the existing ones:

```typescript
import { useLoopPlayerStore } from "../store/loopPlayerStore";
import { useDrumStore } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
```

- [ ] **Step 2: Add active-content selectors inside SynthSection component**

Inside the `SynthSection()` function body, after the `const [active, setActive] = useState<SynthTab>("bass");` line, add:

```typescript
  // Tab badge: detect if each tab's content is producing sound
  const isTransportPlay = useDrumStore((s) => s.isPlaying);
  const bassHasNotes    = useBassStore((s) => s.steps.some((step) => step.note !== null && step.active));
  const chordsHasNotes  = useChordsStore((s) => s.steps.some((step) => step.active));
  const melodyHasNotes  = useMelodyStore((s) => s.steps.some((step) => step.active));
  const loopSlotPlaying = useLoopPlayerStore((s) => s.slots.some((slot) => slot.playing));

  // Returns dim badge color when tab is active (not selected) but producing sound
  function getTabBadgeColor(tabId: SynthTab, isSelected: boolean): string | undefined {
    if (isSelected) return undefined; // already shown via full-opacity border
    if (!isTransportPlay && tabId !== "loops") return undefined;
    switch (tabId) {
      case "bass":    return bassHasNotes && isTransportPlay   ? "#10b981" : undefined;
      case "chords":  return chordsHasNotes && isTransportPlay ? "var(--ed-accent-chords)" : undefined;
      case "melody":  return melodyHasNotes && isTransportPlay ? "var(--ed-accent-melody)" : undefined;
      case "loops":   return loopSlotPlaying                   ? "#2EC4B6" : undefined;
      default:        return undefined;
    }
  }
```

- [ ] **Step 3: Apply badge color to tab border**

Find the tab `<button>` rendering loop (around line 156):

```tsx
{TABS.map((tab) => {
  const isActive = active === tab.id;
  return (
    <button
      ...
      style={{
        borderBottomColor: isActive ? tab.color : "transparent",
        textShadow: isActive ? `0 0 12px ${tab.color}40` : "none",
      }}
    >
```

Update the `style` prop:

```tsx
style={{
  borderBottomColor: isActive
    ? tab.color
    : (getTabBadgeColor(tab.id, false) ?? "transparent"),
  opacity: isActive ? 1 : (getTabBadgeColor(tab.id, false) ? 0.7 : 1),
  textShadow: isActive ? `0 0 12px ${tab.color}40` : "none",
}}
```

- [ ] **Step 4: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. Note: if `useBassStore` step shape doesn't have `.active`, adjust the selector — check the actual bass step type.

- [ ] **Step 5: Manual test**

- Start transport, switch to a tab other than BASS — if bass has steps, the BASS tab should show a dim green underline
- Loop slots playing → LOOPS tab shows dim teal underline when not on LOOPS tab

- [ ] **Step 6: Commit**

```bash
git add src/components/SynthSection.tsx
git commit -m "feat: tab badges show dim color underline when tab content is active"
```

---

## Task 5: Mute/Solo Visualization in MixerBar

**Files:**
- Modify: `src/components/MixerBar.tsx`

- [ ] **Step 1: Read current mute/solo state in the column rendering**

In `MixerBar.tsx`, the channel columns are rendered in the `.map()` starting at line ~156. Each column has access to `ch.muted` and `ch.soloed`. The `soloed` set is derived in the `useEffect` (lines 125-136) but not exposed to JSX.

Add a derived value before the `return` in `MixerBar()`:

```typescript
const anySoloed = channels.some((ch) => ch.soloed);
```

- [ ] **Step 2: Apply opacity to the column div**

Find the column `<div>` that wraps the strip for each channel (the one with `className="flex flex-col items-center gap-1 min-w-[46px]..."`). Add a style prop:

```tsx
<div
  key={id}
  className={`flex flex-col items-center gap-1 min-w-[46px] px-1 rounded transition-all ${
    isExpanded ? "bg-white/[0.04] ring-1 ring-white/10" : "hover:bg-white/[0.02]"
  }`}
  style={{
    opacity: anySoloed && !ch.soloed && !ch.muted ? 0.4 : 1,
    transition: "opacity 0.15s",
  }}
>
```

- [ ] **Step 3: Apply opacity to the meter canvas**

Find the `<canvas>` element for the meter inside the column (around line 184):

```tsx
<canvas
  ref={(el) => { canvasRefs.current[id] = el; }}
  width={4}
  height={56}
  className="rounded-sm"
/>
```

Add a style prop:

```tsx
<canvas
  ref={(el) => { canvasRefs.current[id] = el; }}
  width={4}
  height={56}
  className="rounded-sm"
  style={{ opacity: ch.muted ? 0.25 : 1, transition: "opacity 0.15s" }}
/>
```

- [ ] **Step 4: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Manual test**

- Mute a channel: meter canvas goes dim (opacity 0.25), name already dims to #333
- Solo a channel: all other channel strips go to 0.4 opacity

- [ ] **Step 6: Commit**

```bash
git add src/components/MixerBar.tsx
git commit -m "feat: mute/solo opacity visualization in MixerBar"
```

---

## Task 6: Drum Bus Fade on Stop

**Files:**
- Modify: `src/audio/MixerRouting.ts`
- Modify: `src/audio/AudioEngine.ts`
- Modify: `src/store/drumStore.ts`

- [ ] **Step 1: Add `getGroupGainNode` to MixerRouting**

In `src/audio/MixerRouting.ts`, find the `getGroupNames()` method (around line 336) and add before it:

```typescript
  /** Returns the GainNode for a bus group — used for programmatic ramps (e.g. fade-out on stop). */
  getGroupGainNode(group: string): GainNode | null {
    return this.groupBuses.get(group)?.gain ?? null;
  }
```

- [ ] **Step 2: Add `fadeDrumBus` to AudioEngine**

In `src/audio/AudioEngine.ts`, find the `setChannelGroup` method (around line 334) and add after it:

```typescript
  /**
   * Fade the drums bus gain to 0 over `duration` seconds (default 40ms),
   * then reset gain to 1 after 60ms extra time.
   * Prevents hard click/cut when transport stops.
   */
  fadeDrumBus(duration = 0.04): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gainNode = mixerRouter.getGroupGainNode("drums");
    if (!gainNode) return;
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
    // Reset to 1 after fade completes (60ms headroom)
    setTimeout(() => {
      gainNode.gain.cancelScheduledValues(0);
      gainNode.gain.value = 1;
    }, (duration + 0.06) * 1000);
  }
```

- [ ] **Step 3: Call `fadeDrumBus` in drumStore before stopping**

In `src/store/drumStore.ts`, find the `togglePlay` action (around line 775):

```typescript
  togglePlay: () => {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) {
      stopScheduler();
      setDrumStep(0, 0);
      set({ isPlaying: false });
    } else {
```

Replace with:

```typescript
  togglePlay: () => {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) {
      audioEngine.fadeDrumBus(0.04);   // ← 40ms fade before hard stop
      stopScheduler();
      setDrumStep(0, 0);
      set({ isPlaying: false });
    } else {
```

Make sure `audioEngine` is imported at the top of `drumStore.ts`. Check — it should already be imported since other store methods use it.

- [ ] **Step 4: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Manual test**

Play drums for a few bars, then press Space to stop. Listen carefully — the stop should be smooth (no click), fading over ~40ms.

- [ ] **Step 6: Commit**

```bash
git add src/audio/MixerRouting.ts src/audio/AudioEngine.ts src/store/drumStore.ts
git commit -m "feat: 40ms drum bus fade on transport stop to prevent click"
```

---

## Task 7: Shortcut Overlay

**Files:**
- Modify: `src/store/overlayStore.ts`
- Modify: `src/hooks/useKeyboard.ts`
- Create: `src/components/ShortcutOverlay.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add "shortcuts" to OverlayId**

In `src/store/overlayStore.ts`, line 3:

Find:
```typescript
type OverlayId = "mixer" | "browser" | "euclidean" | "song" | "scene" | "fxPanel" | "kitBrowser" | "help" | "mobileVoice" | "sampleBrowser" | "midiPlayer" | "pianoRoll" | "clipLauncher" | "arrangement" | "modMatrix" | "macros" | "midiLearn" | "midiClock" | "userGuide" | "performancePad" | "melodyGen";
```

Replace with (add `"shortcuts"` at the end before the closing `"`):
```typescript
type OverlayId = "mixer" | "browser" | "euclidean" | "song" | "scene" | "fxPanel" | "kitBrowser" | "help" | "mobileVoice" | "sampleBrowser" | "midiPlayer" | "pianoRoll" | "clipLauncher" | "arrangement" | "modMatrix" | "macros" | "midiLearn" | "midiClock" | "userGuide" | "performancePad" | "melodyGen" | "shortcuts";
```

- [ ] **Step 2: Add `?` key handler to useKeyboard**

In `src/hooks/useKeyboard.ts`:

Add import at the top:
```typescript
import { useOverlayStore } from "../store/overlayStore";
```

Inside `useKeyboard()` function, add the selector:
```typescript
const toggleShortcuts = useOverlayStore((s) => s.toggle);
```

In `handleDown`, after the `arrowleft` block but before the closing `};` of handleDown:

```typescript
      // ? key → shortcut overlay
      if (key === "?") {
        e.preventDefault();
        toggleShortcuts("shortcuts");
        return;
      }
```

Add `toggleShortcuts` to the `useEffect` dependency array.

- [ ] **Step 3: Create ShortcutOverlay component**

Create `src/components/ShortcutOverlay.tsx`:

```typescript
/**
 * ShortcutOverlay — Centered modal showing all keyboard shortcuts.
 * Toggle with ? key or the ? button in toolbar.
 * Close with Escape or backdrop click.
 */
import { useEffect } from "react";
import { useOverlayStore } from "../store/overlayStore";

interface ShortcutGroup {
  title: string;
  color: string;
  shortcuts: [string, string][];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "DRUMS / SEQUENCER",
    color: "#f59e0b",
    shortcuts: [
      ["Q W E R", "Kick · Snare · Clap · Tom Lo"],
      ["A S D F", "Tom M · Tom H · HH Cl · HH Op"],
      ["Z X C V", "Cym · Ride · Perc 1 · Perc 2"],
      ["Space", "Play / Stop"],
      ["1 – 9, 0", "Load preset 1–10"],
      ["← →", "Prev / Next preset"],
      ["Ctrl+Z", "Undo"],
      ["Ctrl+Shift+Z", "Redo"],
    ],
  },
  {
    title: "PIANO ROLL",
    color: "#a78bfa",
    shortcuts: [
      ["B", "Draw mode"],
      ["S", "Select mode"],
      ["L", "Toggle loop brace"],
      ["D", "Duplicate selected"],
      ["↑ ↓", "Transpose ±1 semitone"],
      ["Shift+↑↓", "Transpose ±1 octave"],
      ["Ctrl+A", "Select all"],
      ["Ctrl+C / V", "Copy / Paste"],
      ["Delete", "Delete selected"],
    ],
  },
  {
    title: "LOOPS / GLOBAL",
    color: "#2EC4B6",
    shortcuts: [
      ["Shift+1–0", "Queue scene 1–10"],
      ["T", "Tap tempo"],
      ["?", "Toggle this overlay"],
      ["Escape", "Close overlay"],
    ],
  },
];

export function ShortcutOverlay() {
  const isOpen = useOverlayStore((s) => s.isOpen("shortcuts"));
  const close  = useOverlayStore((s) => s.closeOverlay);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("shortcuts");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
      onClick={() => close("shortcuts")}
    >
      <div
        className="relative rounded-xl border border-white/10 bg-[#111] shadow-2xl"
        style={{ width: "min(860px, 95vw)", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <h2 className="text-[13px] font-black tracking-[0.18em] text-white/90">KEYBOARD SHORTCUTS</h2>
            <p className="text-[9px] font-bold tracking-[0.12em] text-white/30 mt-0.5">Press ? or Escape to dismiss</p>
          </div>
          <button
            onClick={() => close("shortcuts")}
            className="text-[18px] text-white/30 hover:text-white/70 transition-colors leading-none"
            aria-label="Close shortcuts"
          >
            ×
          </button>
        </div>

        {/* 3-column grid */}
        <div className="grid grid-cols-3 gap-0 divide-x divide-white/5 px-2 py-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="px-4 py-2">
              <div
                className="text-[8px] font-black tracking-[0.2em] mb-3 pb-1.5 border-b"
                style={{ color: group.color, borderColor: `${group.color}30` }}
              >
                {group.title}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.shortcuts.map(([key, desc]) => (
                  <div key={key} className="flex items-start gap-2">
                    <kbd
                      className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "rgba(255,255,255,0.75)",
                        minWidth: 28,
                        textAlign: "center",
                        fontFamily: "monospace",
                      }}
                    >
                      {key}
                    </kbd>
                    <span className="text-[9px] text-white/45 leading-tight pt-0.5">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render ShortcutOverlay in App.tsx**

Find `src/App.tsx`. Add the import near the other overlay imports:

```typescript
import { ShortcutOverlay } from "./components/ShortcutOverlay";
```

Find where other overlays like `<UserGuide />` or `<MixerBar />` are rendered in the JSX. Add:

```tsx
<ShortcutOverlay />
```

near the other overlay components (typically near the bottom of the main JSX tree, before the closing `</div>`).

- [ ] **Step 5: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Manual test**

- Press `?` on keyboard → overlay opens with shortcuts in 3 columns
- Press `Escape` → overlay closes
- Click outside the modal → overlay closes
- Tab badges show correctly

- [ ] **Step 7: Commit**

```bash
git add src/store/overlayStore.ts src/hooks/useKeyboard.ts src/components/ShortcutOverlay.tsx src/App.tsx
git commit -m "feat: shortcut overlay — ? key opens modal with all keyboard shortcuts"
```

---

## Self-Review

### Spec Coverage

| Spec Item | Task | Status |
|-----------|------|--------|
| A1: Tab-Badges (Farbiger Unterstrich) | Task 4 | ✅ |
| A2: Mute/Solo Visualisierung MixerBar | Task 5 | ✅ |
| A3: Play-Animation Loop-Slots | Task 3 Step 4 | ✅ |
| A4: Drum-Fade beim Stop | Task 6 | ✅ |
| A5: Shortcut-Overlay | Task 7 | ✅ |
| B1: waveformPeaks in loopPlayerStore | Task 1 | ✅ |
| B2: WaveformCanvas component | Task 2 | ✅ |
| B3: Playhead animation | Task 2 (RAF loop) | ✅ (simplified) |
| B4: WaveformCanvas integration in LoopPlayerTab | Task 3 | ✅ |

### Notes

- **B3 Playhead**: Simplified via `window.__audioCtxCurrentTime` global. Full slot start-time tracking would require LoopPlayerEngine to report playback start times back to the store — deferred.
- **waveformPeaks HMR**: `waveformPeaks` is preserved by existing HMR slot-state recovery in `loopPlayerStore.ts` (the `import.meta.hot.data.slots` mechanism already saves the full slot object, which now includes `waveformPeaks`). No additional HMR work needed.
- **Tab badges**: Bass store step shape needs to be verified. If `useBassStore` steps use a different shape (e.g. `note` instead of `active`), adjust the selector in Task 4 Step 2.
- **Slice-edit mode**: When `pendingSlices !== null`, the existing beat-grid canvas still shows (not WaveformCanvas). This preserves slice-editing functionality.
