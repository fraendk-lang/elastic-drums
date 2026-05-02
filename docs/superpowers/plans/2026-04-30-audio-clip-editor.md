# Audio Clip Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-destructive trim handles, ⌘E clip-split, fade in/out, and a detail panel to the AUDIO track in the Arrangement View.

**Architecture:** Three files change. `audioClipStore.ts` gains four new fields and three new actions. `audioClipEngine.ts` uses those fields for precise playback. `ArrangementView.tsx` gains trim-handle UX on `AudioClipLane`, a `selectedAudioClipId` state, and an audio-clip branch in `ArrangementDetailPanel`.

**Tech Stack:** React, Zustand, Web Audio API (`AudioBufferSourceNode`, `GainNode`, `AudioParam` ramps), TypeScript strict mode, Tailwind CSS.

---

## File Map

| File | What changes |
|------|-------------|
| `src/store/audioClipStore.ts` | Add 4 fields to `AudioClip`; add `setTrimPoints`, `setFades`, `splitClip` actions; update `addClip` defaults |
| `src/audio/audioClipEngine.ts` | Update `startClip` for trim offset + fade ramps + stop; update `seekAudioClips` offset |
| `src/components/ArrangementView.tsx` | `AudioClipLane`: trim handles, hover cursor, ⌘E, selection; `ArrangementDetailPanel`: audio-clip branch; `ArrangementView`: `selectedAudioClipId` state + wiring |

---

## Task 1: Extend AudioClipStore

**Files:**
- Modify: `src/store/audioClipStore.ts`

- [ ] **Step 1: Add new fields to the `AudioClip` interface**

Replace the existing interface in `src/store/audioClipStore.ts` lines 13–22:

```typescript
export interface AudioClip {
  id:             string;
  startBar:       number;        // 0-indexed bar position on the timeline
  durationBars:   number;        // clip length in bars (visual timeline width)
  fileName:       string;
  buffer:         AudioBuffer;
  waveformPeaks:  Float32Array;  // 200 normalized 0..1 RMS peaks
  volume:         number;        // 0-1
  color:          string;        // user-assignable accent color
  // trim / fade (non-destructive, default = full file, no fade)
  sampleStartSec: number;        // seconds into buffer where playback begins
  sampleEndSec:   number;        // seconds into buffer where playback ends
  fadeInSec:      number;        // fade-in duration in seconds
  fadeOutSec:     number;        // fade-out duration in seconds
}
```

- [ ] **Step 2: Add new actions to the store interface**

Replace the `AudioClipStore` interface (lines 24–32) with:

```typescript
interface AudioClipStore {
  clips: AudioClip[];
  addClip:       (clip: AudioClip) => void;
  removeClip:    (id: string) => void;
  moveClip:      (id: string, startBar: number) => void;
  resizeClip:    (id: string, durationBars: number) => void;
  setVolume:     (id: string, volume: number) => void;
  setColor:      (id: string, color: string) => void;
  setTrimPoints: (id: string, startSec: number, endSec: number) => void;
  setFades:      (id: string, fadeIn: number, fadeOut: number) => void;
  splitClip:     (id: string, splitAtSec: number, secPerBar: number) => void;
}
```

- [ ] **Step 3: Implement the three new actions in the store**

Inside the `create<AudioClipStore>((set) => ({ ... }))` block, after `setColor`, add:

```typescript
  setTrimPoints: (id, startSec, endSec) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const clampedStart = Math.max(0, Math.min(endSec - 0.1, startSec));
        const clampedEnd   = Math.max(clampedStart + 0.1, Math.min(c.buffer.duration, endSec));
        return { ...c, sampleStartSec: clampedStart, sampleEndSec: clampedEnd };
      }),
    })),

  setFades: (id, fadeIn, fadeOut) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const maxHalf = (c.sampleEndSec - c.sampleStartSec) / 2;
        return {
          ...c,
          fadeInSec:  Math.max(0, Math.min(maxHalf, fadeIn)),
          fadeOutSec: Math.max(0, Math.min(maxHalf, fadeOut)),
        };
      }),
    })),

  splitClip: (id, splitAtSec, secPerBar) =>
    set((s) => {
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return s;
      // Guard: split point must be well inside the audible region
      if (
        splitAtSec <= clip.sampleStartSec + 0.05 ||
        splitAtSec >= clip.sampleEndSec   - 0.05
      ) return s;

      const part1Sec  = splitAtSec - clip.sampleStartSec;
      const part2Sec  = clip.sampleEndSec - splitAtSec;
      const part1Bars = part1Sec / secPerBar;

      const clip1: AudioClip = {
        ...clip,
        id:            `${clip.id}-a`,
        durationBars:  part1Bars,
        sampleEndSec:  splitAtSec,
        fadeOutSec:    0,
      };
      const clip2: AudioClip = {
        ...clip,
        id:             `${clip.id}-b`,
        startBar:       clip.startBar + part1Bars,
        durationBars:   part2Sec / secPerBar,
        sampleStartSec: splitAtSec,
        fadeInSec:      0,
      };

      return {
        clips: s.clips.filter((c) => c.id !== id).concat([clip1, clip2]),
      };
    }),
```

- [ ] **Step 4: Update `addClip` defaults and all call-sites that create AudioClip objects**

`addClip` itself needs no change (callers provide the full object). Update every place that constructs an `AudioClip` literal to include the four new fields. There are two: the file-picker `onChange` handler and `handleAudioFileDrop` in `ArrangementView.tsx`. Both look like:

```typescript
addAudioClip({
  id:            `ac-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  startBar,
  durationBars:  Math.max(0.5, buf.duration / spb),
  fileName:      file.name,
  buffer:        buf,
  waveformPeaks: peaks,
  volume:        1,
  color:         AUDIO_COLOR,
  // ── add these four lines ──
  sampleStartSec: 0,
  sampleEndSec:   buf.duration,
  fadeInSec:      0,
  fadeOutSec:     0,
});
```

Search for both occurrences with: `grep -n "addAudioClip" src/components/ArrangementView.tsx`

- [ ] **Step 5: Type-check**

```bash
cd "Elastic Drum"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/audioClipStore.ts src/components/ArrangementView.tsx
git commit -m "feat(store): add trim/fade fields + setTrimPoints/setFades/splitClip actions to AudioClip"
```

---

## Task 2: Update audioClipEngine Playback

**Files:**
- Modify: `src/audio/audioClipEngine.ts`

- [ ] **Step 1: Rewrite `startClip` to use trim offset, fade ramps, and explicit stop**

Replace the entire `startClip` function (lines 31–54):

```typescript
function startClip(clip: AudioClip, extraOffsetSec: number, startAtTime: number): void {
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return;

  stopClip(clip.id);

  const src  = ctx.createBufferSource();
  src.buffer = clip.buffer;

  const gain = ctx.createGain();
  src.connect(gain);
  gain.connect(ctx.destination);

  // Total audible duration after trim
  const playDuration = clip.sampleEndSec - clip.sampleStartSec - extraOffsetSec;
  if (playDuration <= 0) return;

  const when        = Math.max(ctx.currentTime, startAtTime);
  const offsetInBuf = clip.sampleStartSec + extraOffsetSec;

  // Fade in (only when playing from the start of the clip, i.e. extraOffsetSec === 0)
  if (clip.fadeInSec > 0 && extraOffsetSec === 0) {
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(clip.volume, when + clip.fadeInSec);
  } else {
    gain.gain.setValueAtTime(clip.volume, when);
  }

  // Fade out
  if (clip.fadeOutSec > 0 && clip.fadeOutSec < playDuration) {
    const fadeOutStart = when + playDuration - clip.fadeOutSec;
    gain.gain.setValueAtTime(clip.volume, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, when + playDuration);
  }

  src.start(when, offsetInBuf);
  src.stop(when + playDuration);

  src.onended = () => { _playing.delete(clip.id); };
  _playing.set(clip.id, src);
}
```

- [ ] **Step 2: Update every call to `startClip` to pass `extraOffsetSec`**

There are two call-sites:

**In the bar-boundary loop (around line 125):** change `startClip(clip, 0, barStartTime)` to:
```typescript
startClip(clip, 0, barStartTime);
```
(no change needed — already passes 0)

**In `seekAudioClips` (around line 90):** change the call to:
```typescript
const extraOffset = nowSec - clipStartSec;   // how far into audible region we are
startClip(clip, extraOffset, scheduleAt);
```

Also update `scheduleAt` in `seekAudioClips` — it should be the time the clip *would have started* from its beginning:
```typescript
const scheduleAt = transportStart + clipStartSec;
```
(already correct — no change)

Full updated `seekAudioClips`:

```typescript
export function seekAudioClips(bar: number): void {
  stopAllAudioClips();
  _stepsElapsed = bar * 16 - 1;

  const { bpm }        = useDrumStore.getState();
  const spb            = secondsPerBar(bpm);
  const transportStart = getDrumTransportStartTime();
  const ctx            = audioEngine.getAudioContext();
  if (!ctx) return;

  const clips = useAudioClipStore.getState().clips;
  for (const clip of clips) {
    const clipStartSec = clip.startBar * spb;
    const clipEndSec   = clipStartSec + (clip.sampleEndSec - clip.sampleStartSec);
    const nowSec       = bar * spb;

    if (nowSec >= clipStartSec && nowSec < clipEndSec) {
      const extraOffset = nowSec - clipStartSec;
      const scheduleAt  = transportStart + clipStartSec;
      startClip(clip, extraOffset, scheduleAt);
    }
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/audio/audioClipEngine.ts
git commit -m "feat(engine): audio clip playback uses sampleStartSec/sampleEndSec, fade ramps, explicit stop"
```

---

## Task 3: AudioClipLane — Trim Handles, Hover Cursor, Selection, ⌘E Split

**Files:**
- Modify: `src/components/ArrangementView.tsx` (AudioClipLane component, lines 1310–1434)

- [ ] **Step 1: Extend `AudioClipLaneProps` with new callbacks**

Replace the interface (lines 1312–1321):

```typescript
interface AudioClipLaneProps {
  clips:          AudioClip[];
  barPx:          number;
  height:         number;
  totalBars:      number;
  bpm:            number;
  selectedId:     string | null;
  onRemove:       (id: string) => void;
  onMove:         (id: string, startBar: number) => void;
  onResize:       (id: string, durationBars: number) => void;
  onDrop:         (e: React.DragEvent) => void;
  onSelect:       (id: string | null) => void;
  onTrimPoints:   (id: string, startSec: number, endSec: number) => void;
  onSplit:        (id: string, splitAtSec: number) => void;
}
```

- [ ] **Step 2: Update the function signature and add new refs**

Replace the function opening (lines 1323–1330):

```typescript
function AudioClipLane({
  clips, barPx, height, totalBars, bpm, selectedId,
  onRemove, onMove, onResize, onDrop,
  onSelect, onTrimPoints, onSplit,
}: AudioClipLaneProps) {
  const laneRef    = useRef<HTMLDivElement>(null);
  const dragRef    = useRef<{ id: string; offsetBar: number } | null>(null);
  const resizeRef  = useRef<{ id: string; origBars: number; startX: number } | null>(null);
  const trimRef    = useRef<{
    id: string; side: "left" | "right";
    origSec: number; startX: number;
  } | null>(null);
  const hoverRef   = useRef<{ id: string; atSec: number } | null>(null);
```

- [ ] **Step 3: Add trim pointer-down handler**

Add after `handleResizePointerDown` (before the `return`):

```typescript
  const handleTrimPointerDown = useCallback((
    e: React.PointerEvent,
    clip: AudioClip,
    side: "left" | "right",
  ) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    trimRef.current = {
      id:      clip.id,
      side,
      origSec: side === "left" ? clip.sampleStartSec : clip.sampleEndSec,
      startX:  e.clientX,
    };
  }, []);
```

- [ ] **Step 4: Extend `handleLanePointerMove` to handle trim dragging**

Replace the existing `handleLanePointerMove` callback:

```typescript
  const handleLanePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      const lane = laneRef.current;
      if (!lane) return;
      const laneRect = lane.getBoundingClientRect();
      const rawBar   = (e.clientX - laneRect.left) / barPx - dragRef.current.offsetBar;
      onMove(dragRef.current.id, Math.max(0, Math.round(rawBar)));
    }
    if (resizeRef.current) {
      const dx        = e.clientX - resizeRef.current.startX;
      const deltaBars = dx / barPx;
      onResize(resizeRef.current.id, Math.max(0.5, resizeRef.current.origBars + deltaBars));
    }
    if (trimRef.current) {
      const clip = clips.find((c) => c.id === trimRef.current!.id);
      if (!clip) return;
      const secPerBar  = (60 / bpm) * 4;
      const clipWPx    = clip.durationBars * barPx;
      const dxSec      = ((e.clientX - trimRef.current.startX) / clipWPx) * clip.buffer.duration;
      if (trimRef.current.side === "left") {
        const newStart = trimRef.current.origSec + dxSec;
        onTrimPoints(clip.id, newStart, clip.sampleEndSec);
      } else {
        const newEnd = trimRef.current.origSec + dxSec;
        onTrimPoints(clip.id, clip.sampleStartSec, newEnd);
      }
    }
  }, [barPx, bpm, clips, onMove, onResize, onTrimPoints]);
```

- [ ] **Step 5: Clear `trimRef` in `handleLanePointerUp`**

Replace `handleLanePointerUp`:

```typescript
  const handleLanePointerUp = useCallback(() => {
    dragRef.current   = null;
    resizeRef.current = null;
    trimRef.current   = null;
  }, []);
```

- [ ] **Step 6: Add ⌘E keyboard handler for split**

Add a `useEffect` inside `AudioClipLane` (before the `return`):

```typescript
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "e") return;
      if (!selectedId) return;
      const clip = clips.find((c) => c.id === selectedId);
      if (!clip) return;
      // Use hover position if available, else midpoint of audible region
      const atSec = hoverRef.current?.id === selectedId
        ? hoverRef.current.atSec
        : (clip.sampleStartSec + clip.sampleEndSec) / 2;
      onSplit(selectedId, atSec);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, clips, onSplit]);
```

- [ ] **Step 7: Rewrite the clip rendering to add trim handles, dimmed regions, hover cursor, and selection ring**

Replace the `{clips.map((clip) => { ... })}` block (lines 1388–1431):

```typescript
      {clips.map((clip) => {
        const x   = clip.startBar * barPx;
        const w   = Math.max(barPx * 0.5, clip.durationBars * barPx);
        const dur = clip.buffer.duration;
        const sel = selectedId === clip.id;

        // Trim handle positions as fractions of clip width
        const trimLFrac = dur > 0 ? clip.sampleStartSec / dur : 0;
        const trimRFrac = dur > 0 ? clip.sampleEndSec   / dur : 1;
        const trimLPx   = trimLFrac * w;
        const trimRPx   = trimRFrac * w;

        return (
          <div
            key={clip.id}
            className="absolute top-1 bottom-1 select-none"
            style={{
              left:            x,
              width:           w,
              backgroundColor: hexAlpha(clip.color, 0.15),
              border:          `1px solid ${sel ? hexAlpha(clip.color, 0.85) : hexAlpha(clip.color, 0.4)}`,
              boxShadow:       sel ? `0 0 0 1px ${hexAlpha(clip.color, 0.35)}` : undefined,
              borderRadius:    5,
              overflow:        "hidden",
              cursor:          "grab",
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).dataset.trim) return;
              if ((e.target as HTMLElement).dataset.resize) return;
              handleClipPointerDown(e, clip);
              onSelect(clip.id);
            }}
            onPointerMove={(e) => {
              // Track hover position for ⌘E split
              const rect   = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const frac   = Math.max(0, Math.min(1, (e.clientX - rect.left) / w));
              hoverRef.current = { id: clip.id, atSec: frac * dur };
            }}
            onPointerLeave={() => { hoverRef.current = null; }}
            onContextMenu={(e) => { e.preventDefault(); onRemove(clip.id); }}
          >
            {/* Waveform */}
            {w > 24 && (
              <LoopWaveformCanvas
                peaks={clip.waveformPeaks}
                color={clip.color}
                width={w - 2}
                height={height - 10}
              />
            )}

            {/* Dimmed region — excluded left (before trim start) */}
            {trimLPx > 1 && (
              <div
                className="absolute top-0 bottom-0 left-0 pointer-events-none"
                style={{ width: trimLPx, backgroundColor: "rgba(0,0,0,0.55)" }}
              />
            )}

            {/* Dimmed region — excluded right (after trim end) */}
            {trimRPx < w - 1 && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left:            trimRPx,
                  right:           12, // leave space for resize handle
                  backgroundColor: "rgba(0,0,0,0.55)",
                }}
              />
            )}

            {/* Fade-in overlay */}
            {clip.fadeInSec > 0 && (() => {
              const secPerBar = (60 / bpm) * 4;
              const fadePx    = (clip.fadeInSec / ((clip.sampleEndSec - clip.sampleStartSec) || 1)) * (w - 24);
              return (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left:       trimLPx,
                    width:      Math.max(0, fadePx),
                    background: `linear-gradient(to right, rgba(0,0,0,0.5), transparent)`,
                  }}
                />
              );
            })()}

            {/* Fade-out overlay */}
            {clip.fadeOutSec > 0 && (() => {
              const fadePx = (clip.fadeOutSec / ((clip.sampleEndSec - clip.sampleStartSec) || 1)) * (w - 24);
              return (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    right:      12 + (w - trimRPx - 12),
                    width:      Math.max(0, fadePx),
                    background: `linear-gradient(to left, rgba(0,0,0,0.5), transparent)`,
                  }}
                />
              );
            })()}

            {/* Trim-left handle */}
            <div
              data-trim="left"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
              style={{
                left:            Math.max(0, trimLPx - 3),
                width:           6,
                backgroundColor: hexAlpha(clip.color, 0.9),
                borderRadius:    "3px 0 0 3px",
              }}
              onPointerDown={(e) => handleTrimPointerDown(e, clip, "left")}
            />

            {/* Trim-right handle (sits left of resize handle) */}
            <div
              data-trim="right"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
              style={{
                left:            Math.min(w - 15, trimRPx - 3),
                width:           6,
                backgroundColor: hexAlpha(clip.color, 0.9),
                borderRadius:    "0 3px 3px 0",
              }}
              onPointerDown={(e) => handleTrimPointerDown(e, clip, "right")}
            />

            {/* Filename label */}
            <div className="absolute top-0 left-0 right-6 px-1.5 pt-0.5 pointer-events-none">
              <span
                className="text-[6px] font-bold truncate block leading-tight"
                style={{ color: hexAlpha(clip.color, 0.85) }}
              >
                {clip.fileName.replace(/\.[^.]+$/, "")}
              </span>
            </div>

            {/* Resize handle (timeline width, not trim) */}
            <div
              className="absolute top-0 bottom-0 right-0 w-3 cursor-col-resize hover:bg-white/10"
              data-resize="true"
              onPointerDown={(e) => handleResizePointerDown(e, clip)}
            />
          </div>
        );
      })}
```

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Fix any errors. The most likely issue is unused `secPerBar` inside the fade-in/out overlays — remove those local consts if TypeScript complains (they were added in the snippet above by mistake since `bpm` is already in scope).

Corrected fade-in block (remove `const secPerBar`):
```typescript
{clip.fadeInSec > 0 && (() => {
  const fadePx = (clip.fadeInSec / ((clip.sampleEndSec - clip.sampleStartSec) || 1)) * (w - 24);
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        left:       trimLPx,
        width:      Math.max(0, fadePx),
        background: `linear-gradient(to right, rgba(0,0,0,0.5), transparent)`,
      }}
    />
  );
})()}
```

- [ ] **Step 9: Commit**

```bash
git add src/components/ArrangementView.tsx
git commit -m "feat(lane): trim handles, hover cursor, ⌘E split, selection ring on AudioClipLane"
```

---

## Task 4: Detail Panel + State Wiring

**Files:**
- Modify: `src/components/ArrangementView.tsx` (ArrangementDetailPanel + ArrangementView state + AudioClipLane call-site)

- [ ] **Step 1: Add `selectedAudioClipId` state to `ArrangementView`**

After the `[isRecording, setIsRecording]` line (around line 1474), add:

```typescript
const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
```

- [ ] **Step 2: Wire new store actions into ArrangementView**

After the `resizeAudioClip` line (around line 1458), add:

```typescript
const setAudioClipTrimPoints = useAudioClipStore((s) => s.setTrimPoints);
const setAudioClipFades      = useAudioClipStore((s) => s.setFades);
const splitAudioClip         = useAudioClipStore((s) => s.splitClip);
```

- [ ] **Step 3: Update the `<AudioClipLane>` call-site to pass new props**

Find the `<AudioClipLane ... />` block (around line 2302) and update:

```tsx
<AudioClipLane
  clips={audioClips}
  barPx={barPx}
  height={AUDIO_H}
  totalBars={displayBars}
  bpm={bpm}
  selectedId={selectedAudioClipId}
  onRemove={(id) => { removeAudioClip(id); setSelectedAudioClipId(null); }}
  onMove={moveAudioClip}
  onResize={resizeAudioClip}
  onDrop={handleAudioFileDrop}
  onSelect={setSelectedAudioClipId}
  onTrimPoints={setAudioClipTrimPoints}
  onSplit={(id, atSec) => {
    const secPerBar = (60 / bpm) * 4;
    splitAudioClip(id, atSec, secPerBar);
    setSelectedAudioClipId(null);
  }}
/>
```

- [ ] **Step 4: Add `selectedAudioClip` prop to `ArrangementDetailPanel`**

Update the `ArrangementDetailPanelProps` interface (around line 656) — add one prop:

```typescript
interface ArrangementDetailPanelProps {
  songChain:          SongChainEntry[];
  scenes:             (Scene | null)[];
  primaryIdx:         number | null;
  showColorPicker:    number | null;
  setShowColorPicker: (i: number | null) => void;
  onUpdateEntry:      (i: number, patch: Partial<SongChainEntry>) => void;
  onUpdateRepeats:    (i: number, repeats: number) => void;
  onStartRename:      (i: number) => void;
  onRemove:           (i: number) => void;
  // audio clip branch
  selectedAudioClip:  AudioClip | null;
  onAudioTrimPoints:  (id: string, startSec: number, endSec: number) => void;
  onAudioFades:       (id: string, fadeIn: number, fadeOut: number) => void;
  onAudioVolume:      (id: string, volume: number) => void;
  onAudioSplit:       (id: string) => void;
  onAudioRemove:      (id: string) => void;
}
```

- [ ] **Step 5: Update the `ArrangementDetailPanel` function signature and add audio branch**

Replace the function signature (line 668):

```typescript
function ArrangementDetailPanel({
  songChain, scenes, primaryIdx,
  showColorPicker, setShowColorPicker,
  onUpdateEntry, onUpdateRepeats, onStartRename, onRemove,
  selectedAudioClip, onAudioTrimPoints, onAudioFades,
  onAudioVolume, onAudioSplit, onAudioRemove,
}: ArrangementDetailPanelProps) {
```

Then add the audio branch at the very beginning of the function body, before the `if (!entry || primary === null)` guard:

```typescript
  // ── Audio-clip branch: shown when an audio clip is selected ──────────────────
  if (selectedAudioClip) {
    const ac = selectedAudioClip;
    return (
      <div className="shrink-0 border-t border-white/8 px-4 py-2 flex items-center gap-3 flex-wrap bg-white/[0.02]">
        <span className="text-[8px] font-black tracking-wider" style={{ color: hexAlpha(AUDIO_COLOR, 0.8) }}>
          AUDIO
        </span>
        <span className="text-[8px] text-white/40 truncate max-w-[120px]">{ac.fileName}</span>

        {/* Sample Start */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          START
          <input
            type="number" step="0.01" min="0" max={ac.sampleEndSec - 0.1}
            value={ac.sampleStartSec.toFixed(2)}
            onChange={(e) => onAudioTrimPoints(ac.id, parseFloat(e.target.value) || 0, ac.sampleEndSec)}
            className="w-14 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Sample End */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          END
          <input
            type="number" step="0.01" min={ac.sampleStartSec + 0.1} max={ac.buffer.duration}
            value={ac.sampleEndSec.toFixed(2)}
            onChange={(e) => onAudioTrimPoints(ac.id, ac.sampleStartSec, parseFloat(e.target.value) || ac.buffer.duration)}
            className="w-14 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Fade In */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          FADE IN
          <input
            type="number" step="0.01" min="0"
            value={ac.fadeInSec.toFixed(2)}
            onChange={(e) => onAudioFades(ac.id, parseFloat(e.target.value) || 0, ac.fadeOutSec)}
            className="w-12 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Fade Out */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          FADE OUT
          <input
            type="number" step="0.01" min="0"
            value={ac.fadeOutSec.toFixed(2)}
            onChange={(e) => onAudioFades(ac.id, ac.fadeInSec, parseFloat(e.target.value) || 0)}
            className="w-12 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Volume */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          VOL
          <input
            type="number" step="1" min="0" max="100"
            value={Math.round(ac.volume * 100)}
            onChange={(e) => onAudioVolume(ac.id, (parseInt(e.target.value) || 0) / 100)}
            className="w-12 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          %
        </label>

        <div className="ml-auto flex items-center gap-2">
          {/* Split button */}
          <button
            onClick={() => onAudioSplit(ac.id)}
            className="text-[8px] font-bold px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white/80 hover:border-white/25 transition-colors"
            title="⌘E — Split at hover position"
          >
            ✂ SPLIT
          </button>
          {/* Delete button */}
          <button
            onClick={() => onAudioRemove(ac.id)}
            className="text-[8px] text-red-400/40 hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Update the `<ArrangementDetailPanel>` call-site**

Find the call-site (around line 2370) and add the new props:

```tsx
<ArrangementDetailPanel
  songChain={songChain}
  scenes={scenes}
  primaryIdx={primaryIdx}
  showColorPicker={showColorPicker}
  setShowColorPicker={setShowColorPicker}
  onUpdateEntry={updateSongEntry}
  onUpdateRepeats={updateSongEntryRepeats}
  onStartRename={(i) => {
    const entry = songChain[i];
    setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
    setRenamingIndex(i);
  }}
  onRemove={(i) => { removeFromSongChain(i); setSelected(new Set()); }}
  selectedAudioClip={audioClips.find((c) => c.id === selectedAudioClipId) ?? null}
  onAudioTrimPoints={setAudioClipTrimPoints}
  onAudioFades={setAudioClipFades}
  onAudioVolume={(id, vol) => useAudioClipStore.getState().setVolume(id, vol)}
  onAudioSplit={(id) => {
    const secPerBar = (60 / bpm) * 4;
    const clip = audioClips.find((c) => c.id === id);
    if (!clip) return;
    splitAudioClip(id, (clip.sampleStartSec + clip.sampleEndSec) / 2, secPerBar);
    setSelectedAudioClipId(null);
  }}
  onAudioRemove={(id) => { removeAudioClip(id); setSelectedAudioClipId(null); }}
/>
```

- [ ] **Step 7: Clear audio selection when a scene clip is selected and vice versa**

In `selectEntry` (around line 1772), add at the top of the callback:

```typescript
setSelectedAudioClipId(null);
```

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Smoke test in browser**

1. Open the Arrangement View
2. Import a WAV file via the upload button on the AUDIO label
3. Click the clip → detail panel should appear with Start/End/Fade/Vol fields
4. Drag the left trim handle → left region dims, Start field updates
5. Drag the right trim handle → right region dims, End field updates
6. Press Play → audio should start at `sampleStartSec` and stop at `sampleEndSec`
7. Set `fadeInSec = 0.5` in the panel → audio fades in over 0.5s
8. Hover over clip and press ⌘E → clip splits into two
9. Press ⌫ DELETE in panel → clip is removed

- [ ] **Step 10: Commit**

```bash
git add src/components/ArrangementView.tsx
git commit -m "feat(arrangement): audio clip detail panel, selection state, trim/fade/split wiring"
```

---

## Self-Review

**Spec coverage:**
- ✅ `sampleStartSec`, `sampleEndSec`, `fadeInSec`, `fadeOutSec` fields — Task 1
- ✅ `setTrimPoints`, `setFades`, `splitClip` store actions — Task 1
- ✅ Engine uses trim offset + fade ramps + explicit stop — Task 2
- ✅ Seek uses `sampleStartSec` offset — Task 2
- ✅ Trim handles (left/right, non-destructive) on clip — Task 3
- ✅ Free precision drag; Shift-snap not yet wired (excluded: Shift key modifier adds complexity without breaking the core feature — can be added as a follow-up)
- ✅ Dimmed regions outside trim points — Task 3
- ✅ Fade overlays (triangle gradient) — Task 3
- ✅ Split at cursor hover position via ⌘E — Task 3
- ✅ Selection ring — Task 3
- ✅ Detail panel with all fields (Start, End, Fade In, Fade Out, Vol, Split, Delete) — Task 4
- ✅ Minimum region constraint (`≥ 0.1s`) enforced in `setTrimPoints` — Task 1
- ✅ Split guard (`≥ 0.05s` from edges) — Task 1
- ✅ Backward compat: existing clips — new fields added in `addClip` call-sites with safe defaults — Task 1

**Omitted (intentional):** Shift-snap precision is excluded to keep scope tight. It can be added as a separate 30-line patch to `handleTrimPointerDown` once the core feature is stable.
