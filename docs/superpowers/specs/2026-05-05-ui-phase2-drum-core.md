# UI Phase 2: Drum Core — Design Spec

## Goal

Upgrade the Step Sequencer and Pad Grid to pro level on top of the Phase 1 deeper-dark foundation. Four targeted changes: LED-style step buttons, beat group separators, a selected-track left stripe, and a stronger pad selection/trigger state.

## Decisions Summary

| Question | Decision |
|---|---|
| Scope | Step Sequencer + Pad Grid together (cohesive pair) |
| Step button style | B — LED Glow (radial highlight, colored glow shadow) |
| Pad layout | A — Uniform 4×3 grid (unchanged structure) |
| Velocity display | Brightness/opacity (lower velocity = dimmer glow, no mask overlay) |

---

## Architecture

Two files, no cross-file dependencies introduced:

1. **`src/components/StepSequencer.tsx`** — `StepButton` active/inactive styles + beat group spacers in grid + track label left stripe
2. **`src/components/PadGrid.tsx`** — selected pad color tinting + stronger trigger glow

Both files are self-contained. Props APIs are unchanged. No store changes.

---

## File 1: `src/components/StepSequencer.tsx`

### Change 1: Glow color constants

Add two maps at the top of the file (alongside `TRACK_COLORS`):

```typescript
// Lighter variants for radial gradient highlights
const STEP_BRIGHT: Record<string, string> = {
  "#f59e0b": "#fcd34d",
  "#3b82f6": "#93c5fd",
  "#8b5cf6": "#c4b5fd",
};

// Darker variants for radial gradient shadows
const STEP_DARK: Record<string, string> = {
  "#f59e0b": "#d97706",
  "#3b82f6": "#2563eb",
  "#8b5cf6": "#7c3aed",
};
```

### Change 2: StepButton — LED active state

**In the `StepButton` render**, replace the active `style` prop and remove the velocity-mask `div`:

**Old active style:**
```tsx
style={isActive ? {
  backgroundColor: trackColor,
  opacity: 0.35 + velNorm * 0.65,
  boxShadow: isCurrent ? `0 0 8px ${trackColor}40` : "none",
} : ...}
```

**New active style** (use `bright` and `dark` from `STEP_BRIGHT`/`STEP_DARK`):
```tsx
style={isActive ? {
  background: `radial-gradient(circle at 50% 38%, ${bright} 0%, ${trackColor} 55%, ${dark} 100%)`,
  borderColor: `${bright}55`,
  opacity: 0.35 + velNorm * 0.65,
  boxShadow: `0 0 10px ${trackColor}60, 0 0 20px ${trackColor}22, inset 0 1px 0 rgba(255,255,255,0.25)`,
} : ...}
```

Where `bright` and `dark` are derived from:
```typescript
const bright = STEP_BRIGHT[trackColor] ?? trackColor;
const dark   = STEP_DARK[trackColor]   ?? trackColor;
```

These two lines go inside `StepButton` (before `return`), derived from the `trackColor` prop.

**Remove the velocity mask div entirely:**
```tsx
{/* DELETE this block */}
{isActive && (
  <div
    className="absolute bottom-0 left-0 right-0 bg-black/20"
    style={{ height: `${100 - velNorm * 100}%` }}
  />
)}
```

### Change 3: StepButton — inactive + current overlay

**Inactive className** — replace the three-branch ternary:

Old:
```tsx
isActive
  ? "hover:brightness-125"
  : isBeat
    ? "bg-[var(--ed-bg-elevated)] hover:bg-[var(--ed-bg-surface)]"
    : "bg-[var(--ed-bg-surface)]/50 hover:bg-[var(--ed-bg-surface)]"
```

New:
```tsx
isActive
  ? "border hover:brightness-110"
  : isBeat
    ? "bg-[var(--ed-bg-surface)] border border-[var(--ed-border-subtle)] hover:bg-[var(--ed-bg-elevated)]"
    : "bg-[var(--ed-bg-secondary)] border border-[var(--ed-border-subtle)]/60 hover:bg-[var(--ed-bg-surface)]"
```

The `border` on the active branch is required so that `borderColor` in the inline style is actually rendered. Tailwind's `border` sets `border-width: 1px; border-style: solid` — without it, `borderColor` alone has no effect.

**Current step overlay** — increase opacity from 15% to 25%:

Old: `<div className="absolute inset-0 bg-white/15 rounded-[3px]" />`

New: `<div className="absolute inset-0 bg-white/25 rounded-[3px]" />`

### Change 4: Beat group separators

The CSS grid currently uses `"72px repeat(16, 1fr)"` (17 columns per row). Change to 20 columns with 3 explicit 5px spacer columns between beat groups:

**Old grid template** (line ~771):
```tsx
style={{ gridTemplateColumns: "72px repeat(16, 1fr)" }}
```

**New grid template:**
```tsx
style={{ gridTemplateColumns: "72px repeat(4, 1fr) 5px repeat(4, 1fr) 5px repeat(4, 1fr) 5px repeat(4, 1fr)" }}
```

Three rows need spacer `<div />` elements inserted to match the new column count: **header row**, **playhead row**, and **TrackRow**.

**Header row** — after the label `<div>`, the 16 step-number cells are rendered with `Array.from({ length: 16 }, (_, i) => ...)`. Insert spacer divs after index 3, 7, 11:

```tsx
{Array.from({ length: 16 }, (_, i) => (
  <React.Fragment key={i}>
    {i > 0 && i % 4 === 0 && <div />}
    <div className={`text-center ...`}>
      ...
    </div>
  </React.Fragment>
))}
```

**Playhead row** — same pattern: insert `<div key={`gap-ph-${i}`} />` before indices 4, 8, 12:

```tsx
{Array.from({ length: 16 }, (_, i) => (
  <React.Fragment key={`ph-${i}`}>
    {i > 0 && i % 4 === 0 && <div />}
    <div className={`h-[3px] ...`} style={{ ... }} />
  </React.Fragment>
))}
```

**TrackRow** — in the `Array.from({ length: 16 })` map, wrap each `<StepButton>` in a `<React.Fragment>` and insert a spacer before beat boundaries:

```tsx
{Array.from({ length: 16 }, (_, stepIdx) => {
  // ... existing variable declarations ...
  return (
    <React.Fragment key={`${track}-${stepIdx}`}>
      {stepIdx > 0 && stepIdx % 4 === 0 && <div />}
      <StepButton
        // ... existing props, key removed (now on Fragment) ...
      />
    </React.Fragment>
  );
})}
```

Note: remove the `key` prop from `<StepButton>` itself since the `<React.Fragment>` now carries it.

### Change 5: Track label — selected left stripe

In the `TrackRow` render, the label `<button>` receives a new `style` prop for the left border:

```tsx
<button
  onClick={() => onSelectTrack(track)}
  onContextMenu={handleSwingCycle}
  className={`flex min-w-0 items-center text-[9px] font-semibold pr-1 h-[28px] rounded-l transition-all whitespace-nowrap overflow-hidden ${
    isSelectedTrack
      ? "text-[var(--ed-text-primary)]"
      : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
  }`}
  style={{
    borderLeft: `2px solid ${isSelectedTrack ? color : "transparent"}`,
    paddingLeft: "4px",
  }}
  ...
>
```

The existing internal color-bar `<div>` (the small rounded rectangle) is kept unchanged — it continues to signal per-track swing state.

---

## File 2: `src/components/PadGrid.tsx`

### Change 1: Selected pad — color-tinted background + stronger glow

In the pad `<button>` `style` prop, update the `background` and `boxShadow` for `isSelected`:

**Old:**
```tsx
background: isTriggered
  ? `linear-gradient(135deg, ${color}20, ${color}10)`
  : isSelected
    ? `linear-gradient(180deg, var(--ed-bg-elevated) 0%, var(--ed-bg-surface) 100%)`
    : `linear-gradient(180deg, var(--ed-bg-surface) 0%, #151519 100%)`,
boxShadow: ...: isSelected
  ? `0 0 12px ${color}15, inset 0 1px 0 rgba(255,255,255,0.04)`
  : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)`,
```

**New:**
```tsx
background: isTriggered
  ? `linear-gradient(135deg, ${color}28, ${color}14)`
  : isSelected
    ? `linear-gradient(180deg, ${color}14 0%, ${color}08 60%, #0a0a0d 100%)`
    : `linear-gradient(180deg, var(--ed-bg-surface) 0%, #0a0a0d 100%)`,
boxShadow: ...: isSelected
  ? `0 0 20px ${color}28, inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3)`
  : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)`,
```

### Change 2: Triggered pad — stronger glow flash

**Old triggered boxShadow:**
```tsx
isTriggered
  ? `0 0 24px ${color}30, inset 0 0 20px ${color}15`
```

**New:**
```tsx
isTriggered
  ? `0 0 32px ${color}45, 0 0 16px ${color}25, inset 0 0 20px ${color}18`
```

---

## Verification

1. **LED steps**: Active steps in the sequencer have a visible radial highlight (bright center) and colored glow shadow. The glow intensity visibly decreases for lower-velocity steps.
2. **Beat groups**: The 16 steps in each row are visually separated into four groups of four. There is a clear 5px gap at positions 4, 8, 12.
3. **Track stripe**: Selecting a track shows a colored left border on its label. Switching tracks immediately moves the stripe.
4. **Pad selected**: The selected pad has a subtle color tint in its background, clearly distinct from unselected pads.
5. **Pad trigger**: Triggering a pad produces a noticeably stronger glow flash than the Phase 1 baseline.
6. **No regressions**: P-Lock dots, gate overlays, ratchet labels, condition labels, swing badge, drag-to-gate, hold-for-P-Lock all function normally. `npm run build` passes.

---

## Out of Scope

- Pad trigger scale animation (stays at current `scale(1.05)`)
- Step button height (stays at `28px`)
- Track row height (stays at `28px`)
- Waveform preview changes (Phase 3 or later)
- Sequencer header / page buttons (Phase 3)
