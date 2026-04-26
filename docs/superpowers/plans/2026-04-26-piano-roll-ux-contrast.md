# Piano Roll UX + App Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Piano Roll usability (accidental notes, wrong pitch hits, leaking arrow keys, tiny labels) and lift the app's overall contrast for readability on a 13" MacBook.

**Architecture:** Five independent commits across two areas — Piano Roll UX (types + index.tsx) and App Contrast (index.css + 7 component files). No new files. No audio changes. Pure UI/CSS.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS, CSS custom properties.

---

## File Map

| File | Change |
|---|---|
| `src/components/PianoRoll/types.ts` | `DEFAULT_ROW_HEIGHT` 20 → 30 |
| `src/components/PianoRoll/index.tsx` | Default tool, remove single-click creation, arrow key capture, note label size |
| `src/index.css` | `:root` CSS variable values lifted |
| `src/components/Transport.tsx` | Replace hardcoded dark gradient |
| `src/components/PianoRoll/PianoRollKeys.tsx` | Replace hardcoded colors |
| `src/components/PianoRoll/PianoRollRuler.tsx` | Replace hardcoded color |
| `src/components/MixerBar.tsx` | Replace hardcoded `#111` (3 occurrences) |
| `src/components/WaveformCanvas.tsx` | Canvas background literal |
| `src/components/PerformanceMode.tsx` | Replace hardcoded colors (3 occurrences) |
| `src/components/ShortcutOverlay.tsx` | Replace `bg-[#111]` |

---

## Task 1: Row Height + Note Labels

**Files:**
- Modify: `src/components/PianoRoll/types.ts:47`
- Modify: `src/components/PianoRoll/index.tsx:1473-1479`

- [ ] **Step 1: Increase DEFAULT_ROW_HEIGHT**

In `src/components/PianoRoll/types.ts`, change line 47:

```typescript
// Before:
export const DEFAULT_ROW_HEIGHT = 20;

// After:
export const DEFAULT_ROW_HEIGHT = 30;
```

- [ ] **Step 2: Increase note label font size and lower visibility threshold**

In `src/components/PianoRoll/index.tsx`, find the note label block at line ~1473 and change:

```tsx
// Before:
{w > 24 && (
  <div className="absolute left-1 right-2 top-0.5 flex items-center justify-between gap-1 pointer-events-none select-none">
    <span className="truncate text-[6px] font-bold text-white/85 leading-none">
      {midiNoteName(note.midi)}
    </span>
    {isSel && (
      <span className="rounded bg-black/40 px-1 py-[1px] text-[6px] font-black text-white/80">
        {Math.round(note.velocity * 100)}
      </span>
    )}
  </div>
)}

// After:
{w > 14 && (
  <div className="absolute left-1 right-2 top-0.5 flex items-center justify-between gap-1 pointer-events-none select-none">
    <span className="truncate text-[8px] font-bold text-white/90 leading-none">
      {midiNoteName(note.midi)}
    </span>
    {isSel && (
      <span className="rounded bg-black/40 px-1 py-[1px] text-[8px] font-black text-white/85">
        {Math.round(note.velocity * 100)}
      </span>
    )}
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd "src/components/PianoRoll" && npx tsc --noEmit 2>&1
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/components/PianoRoll/types.ts src/components/PianoRoll/index.tsx
git commit -m "polish: piano roll row height 20→30px, note labels 6px→8px"
```

---

## Task 2: Double-Click Only — Remove Single-Click Note Creation

**Files:**
- Modify: `src/components/PianoRoll/index.tsx` (lines 85, 101, 350-365, 571-645, 666-715, 716-745, 760-770)

The current draw mode creates a note on every single `pointerDown` on the empty grid, using `drawDragNoteRef` to support drag-to-resize while drawing. This entire mechanism is removed. `handleGridDoubleClick` (already exists, untouched) becomes the sole note-creation path.

- [ ] **Step 1: Change default tool to select**

Line 85 in `src/components/PianoRoll/index.tsx`:

```typescript
// Before:
const [tool, setTool] = useState<"draw" | "select">("draw");

// After:
const [tool, setTool] = useState<"draw" | "select">("select");
```

- [ ] **Step 2: Remove drawDragNoteRef declaration**

Line 101 — delete this entire line:

```typescript
// DELETE this line:
const drawDragNoteRef = useRef<{ id: string; startX: number } | null>(null);
```

- [ ] **Step 3: Simplify Escape handler — remove drawDragNoteRef cleanup**

Find the Escape key block (~line 354) and replace:

```typescript
// Before:
if (e.key === "Escape") {
  e.preventDefault();
  if (drawDragNoteRef.current) {
    const drawnId = drawDragNoteRef.current.id;
    setNotes((prev) => prev.filter((n) => n.id !== drawnId));
    drawDragNoteRef.current = null;
  }
  setSelectedNoteIds(new Set());
  setRubberBand(null);
  setDragMode("none");
  dragStartRef.current = null;
  return;
}

// After:
if (e.key === "Escape") {
  e.preventDefault();
  setSelectedNoteIds(new Set());
  setRubberBand(null);
  setDragMode("none");
  dragStartRef.current = null;
  return;
}
```

- [ ] **Step 4: Simplify handleGridPointerDown — remove draw-mode note creation branch**

Replace the entire `handleGridPointerDown` callback (~line 571) with:

```typescript
const handleGridPointerDown = useCallback(
  (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);
    const x = e.clientX - rect.left + gridRef.current!.scrollLeft;

    if (y < 0 || y > gridH) return;

    const row = Math.floor(y / rowHeight);
    const midi = midiForRow(row);
    const rawBeat = x / cellW;
    const beat = snap ? Math.round(rawBeat / gridRes) * gridRes : rawBeat;
    if (beat < 0 || beat >= totalBeats || midi < BASE_NOTE || midi >= BASE_NOTE + TOTAL_ROWS) return;

    const hit = notes.find(
      (n) => n.track === target && n.midi === midi && beat >= n.start && beat < n.start + n.duration,
    );

    if (hit) {
      if (e.shiftKey) {
        setSelectedNoteIds((prev) => {
          const next = new Set(prev);
          if (next.has(hit.id)) next.delete(hit.id);
          else next.add(hit.id);
          return next;
        });
      } else if (!selectedNoteIds.has(hit.id)) {
        setSelectedNoteIds(new Set([hit.id]));
      }
      return;
    }

    gridClickStartRef.current = { x: e.clientX, y: e.clientY };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }

    // Both draw and select mode: empty click starts rubber-band selection.
    // Notes are created only on double-click (handleGridDoubleClick).
    setRubberBand({ x0: x, y0: y, x1: x, y1: y });
  },
  [notes, rowHeight, cellW, snap, gridRes, totalBeats, target, selectedNoteIds, gridH, midiForRow],
);
```

- [ ] **Step 5: Simplify handleGridPointerMove — remove draw-drag branch**

Replace the entire `handleGridPointerMove` callback (~line 666) with:

```typescript
const handleGridPointerMove = useCallback(
  (e: React.PointerEvent) => {
    if (!rubberBand) return;

    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
    const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);

    setRubberBand({ ...rubberBand, x1: x, y1: y });

    const x0 = Math.min(rubberBand.x0, x);
    const x1 = Math.max(rubberBand.x0, x);
    const y0 = Math.min(rubberBand.y0, y);
    const y1 = Math.max(rubberBand.y0, y);

    const selected = new Set<string>();
    for (const note of notes) {
      const noteX = note.start * cellW;
      const noteX2 = noteX + Math.max(12, note.duration * cellW);
      const row = rowForMidi(note.midi);
      const noteY = row * rowHeight;
      const noteY2 = noteY + rowHeight;
      if (noteX < x1 && noteX2 > x0 && noteY < y1 && noteY2 > y0) {
        selected.add(note.id);
      }
    }
    setSelectedNoteIds(selected);
  },
  [rubberBand, notes, cellW, rowHeight, rowForMidi],
);
```

- [ ] **Step 6: Simplify handleGridPointerUp — remove draw-drag completion branch**

Replace the entire `handleGridPointerUp` callback (~line 716) with:

```typescript
const handleGridPointerUp = useCallback(
  (e: React.PointerEvent) => {
    setRubberBand(null);
    setDragMode("none");
    dragStartRef.current = null;
    gridClickStartRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  },
  [],
);
```

- [ ] **Step 7: Clean up safety-net useEffect — remove drawDragNoteRef line**

Find the `onWindowUp` function inside the safety-net useEffect (~line 762). Remove only the `drawDragNoteRef.current = null;` line:

```typescript
// Before:
const onWindowUp = () => {
  drawDragNoteRef.current = null; // finalize any in-progress draw drag
  setRubberBand(null);
  setDragMode("none");
  dragStartRef.current = null;
  gridClickStartRef.current = null;
};

// After:
const onWindowUp = () => {
  setRubberBand(null);
  setDragMode("none");
  dragStartRef.current = null;
  gridClickStartRef.current = null;
};
```

- [ ] **Step 8: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output (clean). If there are errors about `drawDragNoteRef` being used somewhere, search with:
```bash
grep -n "drawDragNoteRef" src/components/PianoRoll/index.tsx
```
Expected: no results.

- [ ] **Step 9: Commit**

```bash
git add src/components/PianoRoll/index.tsx
git commit -m "fix: piano roll double-click-only note creation, select mode default"
```

---

## Task 3: Arrow Key Capture — Prevent Drum Sequencer Interference

**Files:**
- Modify: `src/components/PianoRoll/index.tsx` (~lines 418-471)

Currently: `if (e.key === "ArrowLeft" && hasSel)` — when nothing is selected, the event falls through to the drum sequencer which interprets `←/→` as "previous/next preset". Fix: always call `e.preventDefault()` for arrow keys when the piano roll is open, then check `hasSel` before moving notes.

- [ ] **Step 1: Fix all four arrow key handlers**

Find the four arrow-key blocks in the keyboard `handler` function (~lines 418–471) and replace all four:

```typescript
// Before (ArrowLeft):
if (e.key === "ArrowLeft" && hasSel) {
  e.preventDefault();
  const step = e.shiftKey ? 1 : gridRes;
  setNotes((prev) =>
    prev.map((n) =>
      !selectedNoteIds.has(n.id)
        ? n
        : { ...n, start: Math.max(0, Math.round((n.start - step) / gridRes) * gridRes) },
    ),
  );
  return;
}

// After (ArrowLeft):
if (e.key === "ArrowLeft") {
  e.preventDefault(); // always capture — never let drum sequencer receive this
  if (!hasSel) return;
  const step = e.shiftKey ? 1 : gridRes;
  setNotes((prev) =>
    prev.map((n) =>
      !selectedNoteIds.has(n.id)
        ? n
        : { ...n, start: Math.max(0, Math.round((n.start - step) / gridRes) * gridRes) },
    ),
  );
  return;
}

// Before (ArrowRight):
if (e.key === "ArrowRight" && hasSel) {
  e.preventDefault();
  const step = e.shiftKey ? 1 : gridRes;
  setNotes((prev) =>
    prev.map((n) =>
      !selectedNoteIds.has(n.id)
        ? n
        : {
            ...n,
            start: Math.min(totalBeats - n.duration, Math.round((n.start + step) / gridRes) * gridRes),
          },
    ),
  );
  return;
}

// After (ArrowRight):
if (e.key === "ArrowRight") {
  e.preventDefault();
  if (!hasSel) return;
  const step = e.shiftKey ? 1 : gridRes;
  setNotes((prev) =>
    prev.map((n) =>
      !selectedNoteIds.has(n.id)
        ? n
        : {
            ...n,
            start: Math.min(totalBeats - n.duration, Math.round((n.start + step) / gridRes) * gridRes),
          },
    ),
  );
  return;
}

// Before (ArrowUp):
if (e.key === "ArrowUp" && hasSel) {
  e.preventDefault();
  const semitones = e.shiftKey ? 12 : 1;
  setNotes((prev) =>
    prev.map((n) => {
      if (!selectedNoteIds.has(n.id)) return n;
      let m = Math.min(BASE_NOTE + TOTAL_ROWS - 1, n.midi + semitones);
      if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
      return { ...n, midi: m };
    }),
  );
  return;
}

// After (ArrowUp):
if (e.key === "ArrowUp") {
  e.preventDefault();
  if (!hasSel) return;
  const semitones = e.shiftKey ? 12 : 1;
  setNotes((prev) =>
    prev.map((n) => {
      if (!selectedNoteIds.has(n.id)) return n;
      let m = Math.min(BASE_NOTE + TOTAL_ROWS - 1, n.midi + semitones);
      if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
      return { ...n, midi: m };
    }),
  );
  return;
}

// Before (ArrowDown):
if (e.key === "ArrowDown" && hasSel) {
  e.preventDefault();
  const semitones = e.shiftKey ? 12 : 1;
  setNotes((prev) =>
    prev.map((n) => {
      if (!selectedNoteIds.has(n.id)) return n;
      let m = Math.max(BASE_NOTE, n.midi - semitones);
      if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
      return { ...n, midi: m };
    }),
  );
  return;
}

// After (ArrowDown):
if (e.key === "ArrowDown") {
  e.preventDefault();
  if (!hasSel) return;
  const semitones = e.shiftKey ? 12 : 1;
  setNotes((prev) =>
    prev.map((n) => {
      if (!selectedNoteIds.has(n.id)) return n;
      let m = Math.max(BASE_NOTE, n.midi - semitones);
      if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
      return { ...n, midi: m };
    }),
  );
  return;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/PianoRoll/index.tsx
git commit -m "fix: piano roll always captures arrow keys — no drum sequencer bleed"
```

---

## Task 4: CSS Contrast — Lift Dark Theme Variables

**Files:**
- Modify: `src/index.css` (`:root` block, lines ~4-10)

- [ ] **Step 1: Update CSS custom properties**

In `src/index.css`, replace the `:root` block values (leave the grey theme untouched):

```css
/* Before: */
:root {
  --ed-bg-primary: #101014;
  --ed-bg-secondary: #18181d;
  --ed-bg-surface: #212128;
  --ed-bg-elevated: #2a2a32;
  --ed-border: #333340;
  --ed-border-subtle: #262630;
  --ed-text-primary: #ededf0;
  --ed-text-secondary: #9494ac;
  --ed-text-muted: #62627a;

/* After: */
:root {
  --ed-bg-primary: #1c1c22;
  --ed-bg-secondary: #242428;
  --ed-bg-surface: #2c2c34;
  --ed-bg-elevated: #36363e;
  --ed-border: #484854;
  --ed-border-subtle: #333340;
  --ed-text-primary: #ededf0;
  --ed-text-secondary: #ababc0;
  --ed-text-muted: #828294;
```

Leave everything from `--ed-accent-orange` onwards unchanged. Leave `:root[data-theme="grey"]` entirely unchanged.

- [ ] **Step 2: Verify no TS errors (CSS change, but check nothing broke)**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "polish: lift dark theme CSS variables for MacBook readability"
```

---

## Task 5: Hardcoded Colors — Replace with CSS Variables

**Files:**
- Modify: `src/components/Transport.tsx:93`
- Modify: `src/components/PianoRoll/PianoRollKeys.tsx:34,41`
- Modify: `src/components/PianoRoll/PianoRollRuler.tsx:135`
- Modify: `src/components/MixerBar.tsx:243,377,465`
- Modify: `src/components/WaveformCanvas.tsx:88`
- Modify: `src/components/PerformanceMode.tsx:95,110,236`
- Modify: `src/components/ShortcutOverlay.tsx:78`

- [ ] **Step 1: Transport.tsx — header gradient**

Line 93 in `src/components/Transport.tsx`:

```tsx
// Before:
<header className="flex items-center h-11 px-3 border-b border-[var(--ed-border)]/70 bg-gradient-to-b from-[#111116] to-[#0d0d11] gap-1.5 relative z-20 overflow-x-auto overflow-y-hidden">

// After:
<header className="flex items-center h-11 px-3 border-b border-[var(--ed-border)]/70 bg-[var(--ed-bg-primary)] gap-1.5 relative z-20 overflow-x-auto overflow-y-hidden">
```

- [ ] **Step 2: PianoRollKeys.tsx — two colors**

Line 34:
```tsx
// Before:
className="shrink-0 overflow-y-hidden border-r border-[var(--ed-border)] bg-[#1a1816]"

// After:
className="shrink-0 overflow-y-hidden border-r border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]"
```

Line 41:
```tsx
// Before:
backgroundColor: "#0d0d10",

// After:
backgroundColor: "var(--ed-bg-primary)",
```

- [ ] **Step 3: PianoRollRuler.tsx — ruler background**

Line 135:
```tsx
// Before:
backgroundColor: "#0d0d10",

// After:
backgroundColor: "var(--ed-bg-primary)",
```

- [ ] **Step 4: MixerBar.tsx — three occurrences of #111**

Line 243:
```tsx
// Before:
<div className="absolute inset-0 rounded bg-[#111] border border-white/[0.06]" />

// After:
<div className="absolute inset-0 rounded bg-[var(--ed-bg-primary)] border border-white/[0.06]" />
```

Line 377:
```tsx
// Before:
<div className="absolute inset-0 rounded bg-[#111] border border-white/[0.06]" />

// After:
<div className="absolute inset-0 rounded bg-[var(--ed-bg-primary)] border border-white/[0.06]" />
```

Line 465:
```tsx
// Before:
<div className="flex items-end gap-4 px-3 py-2 bg-[#111] border-b border-white/[0.06]">

// After:
<div className="flex items-end gap-4 px-3 py-2 bg-[var(--ed-bg-primary)] border-b border-white/[0.06]">
```

- [ ] **Step 5: WaveformCanvas.tsx — canvas fillStyle**

Canvas cannot use CSS variables — use the literal new value. Line 88 in `src/components/WaveformCanvas.tsx`:

```typescript
// Before:
ctx.fillStyle = "#111";

// After:
ctx.fillStyle = "#1c1c22";
```

- [ ] **Step 6: PerformanceMode.tsx — three occurrences**

Line 95:
```tsx
// Before:
style={{ background: "#111116" }}>

// After:
style={{ background: "var(--ed-bg-primary)" }}>
```

Line 110:
```tsx
// Before:
style={{ background: "#0d0d12" }}>

// After:
style={{ background: "var(--ed-bg-secondary)" }}>
```

Line 236:
```tsx
// Before:
<div className="px-5 py-3 border-t border-white/10" style={{ background: "#111116" }}>

// After:
<div className="px-5 py-3 border-t border-white/10" style={{ background: "var(--ed-bg-primary)" }}>
```

- [ ] **Step 7: ShortcutOverlay.tsx — modal background**

Line 78:
```tsx
// Before:
className="relative rounded-xl border border-white/10 bg-[#111] shadow-2xl"

// After:
className="relative rounded-xl border border-white/10 bg-[var(--ed-bg-surface)] shadow-2xl"
```

- [ ] **Step 8: PianoRoll/index.tsx — grid background**

Line 1263 in `src/components/PianoRoll/index.tsx`:
```tsx
// Before:
style={{ background: "#0d0c10" }}

// After:
style={{ background: "var(--ed-bg-primary)" }}
```

- [ ] **Step 9: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/components/Transport.tsx \
        src/components/PianoRoll/PianoRollKeys.tsx \
        src/components/PianoRoll/PianoRollRuler.tsx \
        src/components/MixerBar.tsx \
        src/components/WaveformCanvas.tsx \
        src/components/PerformanceMode.tsx \
        src/components/ShortcutOverlay.tsx \
        src/components/PianoRoll/index.tsx
git commit -m "polish: replace hardcoded dark hex colors with CSS variables"
```

---

## Self-Review

**Spec coverage:**
- ✅ `DEFAULT_ROW_HEIGHT` 20 → 30 — Task 1
- ✅ Default tool `select` — Task 2 Step 1
- ✅ Double-click only (remove draw-drag) — Task 2 Steps 2-7
- ✅ Arrow keys always captured — Task 3
- ✅ Note label 6px → 8px, threshold 24 → 14 — Task 1
- ✅ CSS variables lifted — Task 4
- ✅ All 11 hardcoded color occurrences — Task 5
- ✅ WaveformCanvas literal (canvas can't use CSS vars) — Task 5 Step 5

**Placeholder scan:** No TBDs, all code is exact.

**Type consistency:** `drawDragNoteRef` removed from declaration (Task 2 Step 2), Escape handler (Task 2 Step 3), pointerDown (Task 2 Step 4), pointerMove (Task 2 Step 5), pointerUp (Task 2 Step 6), safety-net (Task 2 Step 7). All seven usages addressed. ✅
