# UI Phase 1: Visual Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Elastic Groove's visual baseline to pro level via a deeper near-black dark theme and a refined Knob component with stronger glow, hover feedback, and mouse wheel support.

**Architecture:** Two completely isolated file changes. `src/index.css` updates 10 CSS custom property values — every component using `var(--ed-*)` tokens picks up the new look automatically with zero code changes. `src/components/Knob.tsx` receives four targeted enhancements; its props API is unchanged so no callsites need updating.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS v4, SVG-based Knob component, Vite build.

---

## Files

| File | Change type |
|---|---|
| `src/index.css` | Modify — update 10 CSS custom property values, add 1 new token |
| `src/components/Knob.tsx` | Modify — 4 targeted enhancements, props API unchanged |

---

## Task 1: Update CSS design tokens

**Files:**
- Modify: `src/index.css:3-32`

No automated tests exist for CSS variables. Verification is visual: run `npm run dev`, open the app, confirm the background is near-black and borders are still visible.

- [ ] **Step 1: Update background and border tokens in `src/index.css`**

Replace the `:root` block (lines 3–32). Keep everything from `--ed-text-primary` downward unchanged. Only the first 6 background/border tokens and the 4 glow tokens change, plus add `--ed-glow-depth`:

```css
:root {
  /* Elastic Groove Color Palette – Deeper Dark Theme */
  --ed-bg-primary: #0a0a0d;
  --ed-bg-secondary: #0f0f14;
  --ed-bg-surface: #15151e;
  --ed-bg-elevated: #1e1e28;
  --ed-border: #252535;
  --ed-border-subtle: #1a1a26;
  --ed-text-primary: #ededf0;
  --ed-text-secondary: #ababc0;
  --ed-text-muted: #828294;
  --ed-accent-orange: #f59e0b;
  --ed-accent-amber: #d97706;
  --ed-accent-blue: #3b82f6;
  --ed-accent-red: #ef4444;
  --ed-accent-green: #22c55e;
  --ed-pad-va: #f59e0b;
  --ed-pad-sample: #3b82f6;
  --ed-pad-hybrid: #8b5cf6;
  --ed-accent-bass: #10b981;
  --ed-accent-chords: #a78bfa;
  --ed-accent-melody: #f472b6;

  /* Glow intensities */
  --ed-glow-orange: rgba(245, 158, 11, 0.22);
  --ed-glow-blue: rgba(59, 130, 246, 0.22);
  --ed-glow-green: rgba(34, 197, 94, 0.22);
  --ed-glow-red: rgba(239, 68, 68, 0.18);
  --ed-glow-depth: rgba(0, 0, 0, 0.60);
}
```

- [ ] **Step 2: Verify visually**

```bash
npm run dev
```

Open `http://localhost:5173`. Check:
- App background is near-black (not medium-grey)
- Transport bar, step sequencer rows, mixer strip are all still clearly legible
- Step buttons, pad grid, borders are visible (not invisible on black)
- Accent glows on active elements look stronger/more saturated

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(theme): deeper dark — near-black backgrounds, stronger accent glows"
```

---

## Task 2: Knob body — darker gradient + inner highlight arc

**Files:**
- Modify: `src/components/Knob.tsx:211-258`

- [ ] **Step 1: Update the knob body `background` and `border` style values**

In the `{/* ── Knob body ── */}` div (around line 212), replace the `style` prop:

```tsx
{/* ── Knob body ─────────────────────────────────────────── */}
<div
  className="absolute rounded-full"
  style={{
    width:  bodyR * 2,
    height: bodyR * 2,
    top:    (size - bodyR * 2) / 2,
    left:   (size - bodyR * 2) / 2,
    background: isDragging
      ? "linear-gradient(145deg, #282836 0%, #181826 55%, #100e1c 100%)"
      : "linear-gradient(145deg, #222232 0%, #141422 55%, #0e0c18 100%)",
    border: `1px solid ${isDragging ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.09)"}`,
    boxShadow: isDragging
      ? `inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.7)`
      : `inset 0 2px 3px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.6)`,
  }}
>
```

- [ ] **Step 2: Add the inner highlight arc to the SVG**

In the SVG, add this path **after** the body circle (`<circle cx={cx} cy={cy} r={bodyR} .../>` — note: the body is a `<div>`, not an SVG circle) — place it **after** the tick marks and **before** the value arc block (`{normalized > 0.005 && ...}`):

```tsx
{/* ── Inner highlight arc (top) — 3D depth ─────────────── */}
<path
  d={`M ${cx - bodyR * 0.65} ${cy - bodyR * 0.55} A ${bodyR} ${bodyR} 0 0 1 ${cx + bodyR * 0.65} ${cy - bodyR * 0.55}`}
  fill="none"
  stroke="rgba(255,255,255,0.06)"
  strokeWidth={1}
  strokeLinecap="round"
/>
```

- [ ] **Step 3: Verify in browser**

Open the Voice Editor (left panel, Kick selected). The knobs should look more three-dimensional — slightly more elevated off the black background — with a faint highlight curve at the top.

- [ ] **Step 4: Commit**

```bash
git add src/components/Knob.tsx
git commit -m "feat(knob): darker body gradient + inner highlight arc for Deeper Dark theme"
```

---

## Task 3: Knob arc — stronger glow + bezel + track tweaks

**Files:**
- Modify: `src/components/Knob.tsx:158-208`

- [ ] **Step 1: Update the bezel ring top-stop opacity**

In `<defs>`, the `bezel-gradient` linear gradient has its first stop at `stopColor="rgba(255,255,255,0.18)"`. Change it to `0.25`:

```tsx
<defs>
  <linearGradient id="bezel-gradient" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stopColor="rgba(255,255,255,0.25)" />
    <stop offset="50%"  stopColor="rgba(255,255,255,0.06)" />
    <stop offset="100%" stopColor="rgba(255,255,255,0.03)" />
  </linearGradient>
</defs>
```

- [ ] **Step 2: Lower background arc track opacity**

The background arc track circle has `stroke="rgba(255,255,255,0.07)"`. Lower it to `0.05` so the active arc has more contrast:

```tsx
{/* ── Background arc track ───────────────────────────── */}
<circle
  cx={cx} cy={cy} r={trackR}
  fill="none"
  stroke="rgba(255,255,255,0.05)"
  strokeWidth={showBezel ? 3 : 2.5}
  strokeDasharray={`${trackR * 2 * Math.PI * 0.75} ${trackR * 2 * Math.PI * 0.25}`}
  strokeDashoffset={trackR * 2 * Math.PI * 0.375}
  strokeLinecap="round"
/>
```

- [ ] **Step 3: Add mid-glow layer and strengthen wide glow**

Replace the entire `{normalized > 0.005 && (...)}` value arc block:

```tsx
{/* ── Value arc ──────────────────────────────────────── */}
{normalized > 0.005 && (<>
  {/* Wide outer glow */}
  <path
    d={`M ${arcStartX} ${arcStartY} A ${trackR} ${trackR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
    fill="none" stroke={color}
    strokeWidth={showBezel ? 14 : 8}
    strokeLinecap="round"
    opacity={0.22}
  />
  {/* Mid glow */}
  <path
    d={`M ${arcStartX} ${arcStartY} A ${trackR} ${trackR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
    fill="none" stroke={color}
    strokeWidth={showBezel ? 7 : 4}
    strokeLinecap="round"
    opacity={0.10}
  />
  {/* Main arc */}
  <path
    d={`M ${arcStartX} ${arcStartY} A ${trackR} ${trackR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
    fill="none" stroke={color}
    strokeWidth={showBezel ? 3.5 : 2.5}
    strokeLinecap="round"
  />
</>)}
```

- [ ] **Step 4: Verify in browser**

Turn a knob up to ~70%. The value arc should have a visible soft glow halo radiating outward — clearly stronger than before, without being garish.

- [ ] **Step 5: Commit**

```bash
git add src/components/Knob.tsx
git commit -m "feat(knob): stronger arc glow (wide + mid layers), tighter bezel + track contrast"
```

---

## Task 4: Knob hover — show value on mouse-over

**Files:**
- Modify: `src/components/Knob.tsx:14,39-45,134-155,262-267`

- [ ] **Step 1: Add `isHovered` state**

At line 14, `useState` is already imported. In the component body, after the existing state declarations (after `const lastTapRef = useRef(0);`), add:

```typescript
const [isHovered, setIsHovered] = useState(false);
```

- [ ] **Step 2: Add mouse enter/leave handlers**

After the existing `handleClick` callback, add:

```typescript
const handleMouseEnter = useCallback(() => {
  setIsHovered(true);
}, []);

const handleMouseLeave = useCallback(() => {
  if (!isDraggingRef.current) setIsHovered(false);
}, []);
```

- [ ] **Step 3: Wire handlers to the knob div and update value readout visibility**

In the `{/* Knob */}` div (around line 146), add `onMouseEnter` and `onMouseLeave`:

```tsx
<div
  ref={knobRef}
  className={`relative cursor-grab ${isDragging ? "cursor-grabbing" : ""}`}
  style={{ width: size, height: size }}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onPointerCancel={handlePointerUp}
  onClick={handleClick}
  onDoubleClick={() => onChange(defaultValue)}
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
>
```

Update the value readout `<span>` visibility condition (around line 138):

```tsx
<span
  className={`font-mono tabular-nums h-3 transition-opacity duration-100 ${
    showValue || isDragging || isHovered ? "opacity-100" : "opacity-0"
  }`}
  style={{ color, fontSize: size >= 56 ? 10 : 8 }}
>
  {Math.round(value)}
</span>
```

- [ ] **Step 4: Boost bezel opacity on hover**

In the bezel ring circle, add an inline opacity boost when hovered. The bezel circle is around line 160:

```tsx
{showBezel && (
  <circle
    cx={cx} cy={cy} r={outerR}
    fill="none"
    stroke="url(#bezel-gradient)"
    strokeWidth={1.5}
    opacity={isHovered || isDragging ? 1 : 0.75}
  />
)}
```

- [ ] **Step 5: Verify in browser**

Hover over any knob in the Voice Editor without clicking. The numeric value should appear immediately above the knob. Moving away should hide it again. During drag it should remain visible.

- [ ] **Step 6: Commit**

```bash
git add src/components/Knob.tsx
git commit -m "feat(knob): show value on hover, boost bezel opacity on hover/drag"
```

---

## Task 5: Knob mouse wheel support

**Files:**
- Modify: `src/components/Knob.tsx` — add handler + wire to div

- [ ] **Step 1: Add `handleWheel` callback**

After the `handleMouseLeave` callback from Task 4, add:

```typescript
const handleWheel = useCallback((e: React.WheelEvent) => {
  e.preventDefault();
  const range = max - min;
  // Normal scroll: 1% of range per tick; Shift: 0.1% (fine)
  const step = e.shiftKey ? range * 0.001 : range * 0.01;
  const delta = e.deltaY < 0 ? step : -step;
  const newVal = Math.max(min, Math.min(max, value + delta));
  onChange(newVal);
}, [min, max, value, onChange]);
```

- [ ] **Step 2: Wire `onWheel` to the knob div**

Add `onWheel={handleWheel}` to the `{/* Knob */}` div (same div as Task 4):

```tsx
<div
  ref={knobRef}
  className={`relative cursor-grab ${isDragging ? "cursor-grabbing" : ""}`}
  style={{ width: size, height: size }}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onPointerCancel={handlePointerUp}
  onClick={handleClick}
  onDoubleClick={() => onChange(defaultValue)}
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
  onWheel={handleWheel}
>
```

- [ ] **Step 3: Verify in browser**

Hover over a knob and scroll the mouse wheel. The value should increase/decrease smoothly. Hold Shift while scrolling — the steps should be 10× smaller (fine adjustment). Scrolling does not scroll the page behind the knob.

- [ ] **Step 4: Run build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no errors. The circular chunk warning is pre-existing and can be ignored.

- [ ] **Step 5: Final commit**

```bash
git add src/components/Knob.tsx
git commit -m "feat(knob): mouse wheel support — 1% per tick, Shift for 0.1% fine adjustment"
```

---

## Task 6: Push

- [ ] **Step 1: Push all commits**

```bash
git push
```

Expected: branch `main` pushed to `origin`, all 5 commits in this plan.

- [ ] **Step 2: Smoke test in browser**

Open the deployed/dev app and check all 6 verification criteria from the spec:

1. Background is near-black — panels and borders clearly visible ✓
2. Knobs in VoiceEditor look more 3D / elevated off surface ✓
3. Active arc has visible soft glow halo ✓
4. Hover over knob → value appears without dragging ✓
5. Scroll wheel on knob changes value; Shift+scroll is finer ✓
6. Double-click still resets to default; drag still works ✓
