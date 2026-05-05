# UI Phase 1: Visual Foundation — Design Spec

## Goal

Upgrade the app's visual baseline to pro level: a deeper, near-black dark theme ("Deeper Dark") and a refined Knob component with better contrast, glow, hover feedback, and mouse wheel support. This is the foundation all subsequent UI phases build on.

## Architecture

Two isolated changes, no cross-file dependencies introduced:

1. **`src/index.css`** — CSS custom property values updated. Zero component code changes required; every component that already uses `var(--ed-*)` tokens gets the new look automatically.
2. **`src/components/Knob.tsx`** — Four targeted enhancements to the existing SVG knob. Props API unchanged — zero callsite changes needed.

## Design Decisions

### Theme Direction: Deeper Dark (Option A)

Near-black backgrounds with stronger contrast between inactive and active states. Accent colors (Amber `#f59e0b`, Green `#10b981`, Purple `#a78bfa`, Pink `#f472b6`, Blue `#3b82f6`) are **unchanged** — they gain perceived saturation for free on the darker background.

Grey theme (`data-theme="grey"`) is **not changed** in this phase.

### Knob Style: Refined (Option A)

Same hardware-style concept (bezel ring, tick marks, value arc, 3D body, indicator dot) — tuned for the darker background. No visual redesign.

---

## File 1: `src/index.css`

### Token Changes (dark/default theme only)

| Token | Old | New | Reason |
|---|---|---|---|
| `--ed-bg-primary` | `#1c1c22` | `#0a0a0d` | Near-black base |
| `--ed-bg-secondary` | `#242428` | `#0f0f14` | Panel backgrounds |
| `--ed-bg-surface` | `#2c2c34` | `#15151e` | Cards, steps |
| `--ed-bg-elevated` | `#36363e` | `#1e1e28` | Tooltips, dropdowns |
| `--ed-border` | `#484854` | `#252535` | Primary borders |
| `--ed-border-subtle` | `#333340` | `#1a1a26` | Subtle dividers |
| `--ed-glow-orange` | `rgba(245,158,11,0.15)` | `rgba(245,158,11,0.22)` | Stronger glow |
| `--ed-glow-blue` | `rgba(59,130,246,0.15)` | `rgba(59,130,246,0.22)` | Stronger glow |
| `--ed-glow-green` | `rgba(34,197,94,0.15)` | `rgba(34,197,94,0.22)` | Stronger glow |
| `--ed-glow-red` | `rgba(239,68,68,0.12)` | `rgba(239,68,68,0.18)` | Stronger glow |

### New Token

```css
--ed-glow-depth: rgba(0, 0, 0, 0.60);
```

Used by shadows and inset overlays to add depth on the darker surface.

### No Changes To

- Text tokens (`--ed-text-primary`, `--ed-text-secondary`, `--ed-text-muted`) — unchanged, they're already readable
- Accent color tokens — unchanged
- Grey theme variant — separate phase
- Animation classes — unchanged

---

## File 2: `src/components/Knob.tsx`

### Change 1: Darker Knob Body

The body gradient uses hardcoded hex values. Update to match the new deeper dark background so the knob "pops" off the surface with more contrast.

**Old:**
```typescript
background: isDragging
  ? "linear-gradient(145deg, #2e2e3e 0%, #1e1e2c 55%, #161622 100%)"
  : "linear-gradient(145deg, #292939 0%, #1d1d2b 55%, #141420 100%)",
border: `1px solid ${isDragging ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.07)"}`,
```

**New:**
```typescript
background: isDragging
  ? "linear-gradient(145deg, #282836 0%, #181826 55%, #100e1c 100%)"
  : "linear-gradient(145deg, #222232 0%, #141422 55%, #0e0c18 100%)",
border: `1px solid ${isDragging ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.09)"}`,
```

Add inner highlight arc to the SVG (renders after body circle, before needle):
```tsx
{/* ── Inner highlight arc (top) — adds 3D depth ── */}
<path
  d={`M ${cx - bodyR * 0.65} ${cy - bodyR * 0.55} A ${bodyR} ${bodyR} 0 0 1 ${cx + bodyR * 0.65} ${cy - bodyR * 0.55}`}
  fill="none"
  stroke="rgba(255,255,255,0.06)"
  strokeWidth={1}
  strokeLinecap="round"
/>
```

### Change 2: Stronger Arc Glow

**Old:**
```tsx
{/* Wide glow */}
<path ... strokeWidth={showBezel ? 10 : 6} opacity={0.15} />
{/* Main arc */}
<path ... strokeWidth={showBezel ? 3.5 : 2.5} />
```

**New:**
```tsx
{/* Wide glow */}
<path ... strokeWidth={showBezel ? 14 : 8} opacity={0.22} />
{/* Mid glow */}
<path ... strokeWidth={showBezel ? 7 : 4} opacity={0.10} />
{/* Main arc */}
<path ... strokeWidth={showBezel ? 3.5 : 2.5} />
```

Bezel ring top-stop opacity: `0.18` → `0.25`.

Track background stroke opacity: `0.07` → `0.05` (lower, so active arc has more contrast).

### Change 3: Hover Value Tooltip

Add `isHovered` state. Show value readout on hover, not only during drag.

```typescript
const [isHovered, setIsHovered] = useState(false);
```

Update the outer div:
```tsx
onMouseEnter={() => setIsHovered(true)}
onMouseLeave={() => { if (!isDraggingRef.current) setIsHovered(false); }}
```

Update value span visibility condition:
```tsx
// Old:
showValue || isDragging ? "opacity-100" : "opacity-0"
// New:
showValue || isDragging || isHovered ? "opacity-100" : "opacity-0"
```

When hovered (but not dragging), also slightly boost bezel ring opacity via inline style on the SVG circle. Pass `isHovered` as a local variable to the JSX render.

### Change 4: Mouse Wheel Support

Add `onWheel` handler to the outer div. Each wheel tick moves the value by 1% of the range. Holding Shift uses 0.1% (fine adjustment).

```typescript
const handleWheel = useCallback((e: React.WheelEvent) => {
  e.preventDefault();
  const range = max - min;
  const step = e.shiftKey ? range * 0.001 : range * 0.01;
  const delta = e.deltaY < 0 ? step : -step;
  const newVal = Math.max(min, Math.min(max, value + delta));
  onChange(newVal);
}, [min, max, value, onChange]);
```

Add to outer div: `onWheel={handleWheel}`

**Note:** `onWheel` in React does not call `e.preventDefault()` for passive listeners by default. Use `{ passive: false }` via `useEffect` + `ref` if scrolling-parent interference is observed. For now, React's synthetic onWheel is sufficient since the knob sits inside non-scrolling panels.

---

## Verification

1. **Theme:** App launches → background is near-black, step buttons and panels clearly visible with good contrast. Accent glows visibly stronger.
2. **Knob body:** Knobs in VoiceEditor look visually elevated off the dark surface — more 3D.
3. **Arc glow:** Active arc on knobs has a visible soft glow halo.
4. **Hover:** Mouse over any knob → value appears immediately without dragging.
5. **Wheel:** Scroll wheel on knob changes value smoothly; Shift+wheel is 10× finer.
6. **No regressions:** Double-click resets to default; drag still works; labels still visible; `npm run build` passes.

---

## Out of Scope (later phases)

- Grey theme update
- Step button visual improvements (Phase 2)
- Transport bar reorganization (Phase 3)
- Overlay/modal improvements (Phase 4)
- Formatted value units on Knob (deferred — requires caller to pass unit string)
