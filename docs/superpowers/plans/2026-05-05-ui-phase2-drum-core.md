# UI Phase 2: Drum Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Step Sequencer and Pad Grid with LED-style step buttons (velocity via glow intensity), beat group separators, a selected-track left stripe, and stronger pad selection/trigger states.

**Architecture:** Two completely isolated file changes. `src/components/StepSequencer.tsx` gets 5 targeted edits (constants, StepButton active style, inactive style, beat group spacers, label stripe). `src/components/PadGrid.tsx` gets 2 targeted edits (pad background tinting, trigger glow). No props API changes, no store changes.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS v4, inline styles for dynamic color values, CSS grid for sequencer layout, Vite build.

---

## Files

| File | Change type |
|---|---|
| `src/components/StepSequencer.tsx` | Modify — 5 targeted edits |
| `src/components/PadGrid.tsx` | Modify — 2 targeted edits |

---

## Task 1: Add glow constants + LED active style to StepButton

**Files:**
- Modify: `src/components/StepSequencer.tsx:11-127`

No automated tests exist for visual styles. Verification is visual: run `npm run dev`, open the app, toggle some steps on and verify they have a radial gradient highlight with colored glow.

- [ ] **Step 1: Add `STEP_BRIGHT` and `STEP_DARK` maps after `TRACK_COLORS` (line 17)**

Insert immediately after line 17 (the closing `]` of `TRACK_COLORS`):

```typescript
// Lighter highlight variants for the radial gradient top-center
const STEP_BRIGHT: Record<string, string> = {
  "#f59e0b": "#fcd34d",
  "#3b82f6": "#93c5fd",
  "#8b5cf6": "#c4b5fd",
};

// Darker shadow variants for the radial gradient bottom
const STEP_DARK: Record<string, string> = {
  "#f59e0b": "#d97706",
  "#3b82f6": "#2563eb",
  "#8b5cf6": "#7c3aed",
};
```

- [ ] **Step 2: Add `bright` and `dark` derivations inside `StepButton` (after line 93)**

After the existing `const velNorm = velocity / 127;` line (line 93), add:

```typescript
const bright = STEP_BRIGHT[trackColor] ?? trackColor;
const dark   = STEP_DARK[trackColor]   ?? trackColor;
```

- [ ] **Step 3: Replace the active `style` prop (lines 120–127)**

Replace:
```tsx
style={isActive ? {
  backgroundColor: trackColor,
  opacity: 0.35 + velNorm * 0.65,
  boxShadow: isCurrent ? `0 0 8px ${trackColor}40` : "none",
} : (isTiedStep || isInGateDragRange) ? {
  backgroundColor: trackColor,
  opacity: 0.2,
} : undefined}
```

With:
```tsx
style={isActive ? {
  background: `radial-gradient(circle at 50% 38%, ${bright} 0%, ${trackColor} 55%, ${dark} 100%)`,
  borderColor: `${bright}55`,
  opacity: 0.35 + velNorm * 0.65,
  boxShadow: `0 0 10px ${trackColor}60, 0 0 20px ${trackColor}22, inset 0 1px 0 rgba(255,255,255,0.25)`,
} : (isTiedStep || isInGateDragRange) ? {
  backgroundColor: trackColor,
  opacity: 0.2,
} : undefined}
```

- [ ] **Step 4: Delete the velocity mask div (lines 142–147)**

Remove this entire block:
```tsx
{isActive && (
  <div
    className="absolute bottom-0 left-0 right-0 bg-black/20"
    style={{ height: `${100 - velNorm * 100}%` }}
  />
)}
```

Velocity is now encoded in the button's `opacity` — this overlay is no longer needed.

- [ ] **Step 5: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:5173`. In the step sequencer, toggle several steps on at different velocities (right-click to cycle velocity). Verify:
- Active steps show a radial gradient (bright center, darker edges)
- Lower-velocity steps are visibly dimmer/less opaque
- Full-velocity steps glow brightly

- [ ] **Step 6: Commit**

```bash
git add src/components/StepSequencer.tsx
git commit -m "feat(sequencer): LED glow step buttons — radial gradient, velocity as brightness"
```

---

## Task 2: StepButton inactive styles + current step overlay

**Files:**
- Modify: `src/components/StepSequencer.tsx:111-141`

- [ ] **Step 1: Update the inactive className ternary (lines 114–119)**

Replace:
```tsx
      } ${
        isActive
          ? "hover:brightness-125"
          : isBeat
            ? "bg-[var(--ed-bg-elevated)] hover:bg-[var(--ed-bg-surface)]"
            : "bg-[var(--ed-bg-surface)]/50 hover:bg-[var(--ed-bg-surface)]"
      }`}
```

With:
```tsx
      } ${
        isActive
          ? "border hover:brightness-110"
          : isBeat
            ? "bg-[var(--ed-bg-surface)] border border-[var(--ed-border-subtle)] hover:bg-[var(--ed-bg-elevated)]"
            : "bg-[var(--ed-bg-secondary)] border border-[var(--ed-border-subtle)]/60 hover:bg-[var(--ed-bg-surface)]"
      }`}
```

The `border` on the active branch is required so that `borderColor` set in the inline `style` prop from Task 1 is actually visible. Beat steps (every 4th) use a slightly lighter background for rhythm orientation.

- [ ] **Step 2: Strengthen the current-step overlay (line 140)**

Replace:
```tsx
      {isCurrent && (
        <div className="absolute inset-0 bg-white/15 rounded-[3px]" />
      )}
```

With:
```tsx
      {isCurrent && (
        <div className="absolute inset-0 bg-white/25 rounded-[3px]" />
      )}
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:5173`. Press Play. Verify:
- Inactive non-beat steps are darker than before (near-black background)
- Beat steps (positions 1, 5, 9, 13 in each page) are slightly lighter than non-beat steps
- The current (playing) step has a clearly visible bright white flash

- [ ] **Step 4: Commit**

```bash
git add src/components/StepSequencer.tsx
git commit -m "feat(sequencer): deeper inactive steps, stronger current-step flash"
```

---

## Task 3: Beat group separators — grid + all three rows

**Files:**
- Modify: `src/components/StepSequencer.tsx:771-849`

**Important:** All changes in this task must be applied atomically. Changing the grid template without inserting spacer elements (or vice versa) will break the layout — steps will appear in wrong columns. Apply all four edits before verifying.

- [ ] **Step 1: Update the grid template (line 771)**

Replace:
```tsx
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "72px repeat(16, 1fr)" }}>
```

With:
```tsx
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "72px repeat(4, 1fr) 5px repeat(4, 1fr) 5px repeat(4, 1fr) 5px repeat(4, 1fr)" }}>
```

This adds three 5px spacer columns between groups of 4 steps. Each row must now provide 20 grid cells (1 label + 4 steps + spacer + 4 steps + spacer + 4 steps + spacer + 4 steps) instead of 17.

- [ ] **Step 2: Add spacers to the header row (lines 777–797)**

Replace the header row `Array.from` block:
```tsx
          {Array.from({ length: 16 }, (_, i) => {
            const absIdx = pageOffset + i;
            const isCurrent = isPlaying && currentStep === absIdx;
            return (
              <div
                key={i}
                className={`text-center text-[9px] font-mono pb-0.5 transition-colors border-b ${
                  isCurrent
                    ? "text-[var(--ed-accent-orange)] font-bold"
                    : i % 4 === 0
                      ? "text-[var(--ed-text-secondary)]"
                      : "text-[var(--ed-text-muted)]/60"
                } ${i % 4 === 0 ? "border-white/10" : "border-white/5"}`}
              >
                <div className="text-[6px] font-black tracking-[0.18em] text-white/20">
                  {Math.floor(i / 4) + 1}.{(i % 4) + 1}
                </div>
                {absIdx + 1}
              </div>
            );
          })}
```

With:
```tsx
          {Array.from({ length: 16 }, (_, i) => {
            const absIdx = pageOffset + i;
            const isCurrent = isPlaying && currentStep === absIdx;
            return (
              <React.Fragment key={i}>
                {i > 0 && i % 4 === 0 && <div />}
                <div
                  className={`text-center text-[9px] font-mono pb-0.5 transition-colors border-b ${
                    isCurrent
                      ? "text-[var(--ed-accent-orange)] font-bold"
                      : i % 4 === 0
                        ? "text-[var(--ed-text-secondary)]"
                        : "text-[var(--ed-text-muted)]/60"
                  } ${i % 4 === 0 ? "border-white/10" : "border-white/5"}`}
                >
                  <div className="text-[6px] font-black tracking-[0.18em] text-white/20">
                    {Math.floor(i / 4) + 1}.{(i % 4) + 1}
                  </div>
                  {absIdx + 1}
                </div>
              </React.Fragment>
            );
          })}
```

- [ ] **Step 3: Add spacers to the playhead row (lines 801–808)**

Replace the playhead row `Array.from` block:
```tsx
          {Array.from({ length: 16 }, (_, i) => {
            const isCurrent = isPlaying && currentStep === pageOffset + i;
            return (
              <div key={`ph-${i}`} className={`h-[3px] rounded-full mx-0.5 transition-all duration-[40ms] ${isCurrent ? "ed-playhead-glow" : ""}`} style={{
                backgroundColor: isCurrent ? "var(--ed-accent-orange)" : "transparent",
              }} />
            );
          })}
```

With:
```tsx
          {Array.from({ length: 16 }, (_, i) => {
            const isCurrent = isPlaying && currentStep === pageOffset + i;
            return (
              <React.Fragment key={`ph-${i}`}>
                {i > 0 && i % 4 === 0 && <div />}
                <div className={`h-[3px] rounded-full mx-0.5 transition-all duration-[40ms] ${isCurrent ? "ed-playhead-glow" : ""}`} style={{
                  backgroundColor: isCurrent ? "var(--ed-accent-orange)" : "transparent",
                }} />
              </React.Fragment>
            );
          })}
```

- [ ] **Step 4: Add spacers to the TrackRow step loop (lines 282–349)**

In `TrackRow`, the `Array.from({ length: 16 }, (_, stepIdx) => { ... return (<StepButton key={...} />) })` loop renders 16 `<StepButton>` elements. Wrap each in a `<React.Fragment>` and insert spacers before beat boundaries.

Replace the `return (` inside the `Array.from` map:
```tsx
        return (
          <StepButton
            key={`${track}-${stepIdx}`}
            track={track}
            absoluteStep={absoluteStep}
```

With:
```tsx
        return (
          <React.Fragment key={`${track}-${stepIdx}`}>
            {stepIdx > 0 && stepIdx % 4 === 0 && <div />}
            <StepButton
              track={track}
              absoluteStep={absoluteStep}
```

And close the Fragment after the `<StepButton ... />` closing tag:
```tsx
            />
          </React.Fragment>
```

The full replacement for the return block looks like:
```tsx
        return (
          <React.Fragment key={`${track}-${stepIdx}`}>
            {stepIdx > 0 && stepIdx % 4 === 0 && <div />}
            <StepButton
              track={track}
              absoluteStep={absoluteStep}
              isActive={isActive}
              isCurrent={isCurrent}
              trackColor={color}
              velocity={velocity}
              ratchetCount={ratchetCount}
              condition={condition}
              gateLength={gateLength}
              hasLocks={hasLocks}
              isHeld={isHeld}
              isTiedStep={isTiedStep}
              isInGateDragRange={isInGateDragRange}
              isBeat={isBeat}
              onClick={(e) => {
                if (gateDrag) return;
                if (e.shiftKey && step?.active) {
                  const levels = [127, 100, 70, 40];
                  const current = step.velocity;
                  const idx = levels.findIndex((v) => v <= current);
                  const next = levels[(idx + 1) % levels.length]!;
                  onSetStepVelocity(track, absoluteStep, next);
                } else {
                  onToggleStep(track, absoluteStep);
                }
              }}
              onContextMenu={(e) => onContextMenu(e, track, absoluteStep)}
              onMouseDown={(e) => onStepMouseDown(e, track, absoluteStep)}
              onPointerDown={(e) => onGateDragStart(e, track, absoluteStep)}
              onLongPress={() => onStepLongPress(track, absoluteStep)}
              stepRef={(el) => {
                if (el) stepRefs.current.set(`${track}-${stepIdx}`, el);
                else stepRefs.current.delete(`${track}-${stepIdx}`);
              }}
            />
          </React.Fragment>
        );
```

- [ ] **Step 5: Verify in browser**

Open `http://localhost:5173`. Verify:
- Each track row shows four clear groups of 4 steps separated by a small gap
- Step numbers in the header align correctly above each step
- The playhead indicator aligns with steps during playback
- All 16 steps are still clickable and toggle correctly

- [ ] **Step 6: Commit**

```bash
git add src/components/StepSequencer.tsx
git commit -m "feat(sequencer): beat group separators — 4 groups of 4 with 5px gap"
```

---

## Task 4: Track label selected left stripe

**Files:**
- Modify: `src/components/StepSequencer.tsx:245-280`

- [ ] **Step 1: Add `style` prop to the label `<button>` in TrackRow (line ~245)**

Find the label button in `TrackRow`. It currently starts with:
```tsx
      <button
        onClick={() => onSelectTrack(track)}
        onContextMenu={handleSwingCycle}
        aria-label={`Select track: ${label}${hasSwing ? ` (swing ${trackSwing})` : ""}`}
        title={hasSwing ? `Swing: ${trackSwing} · Right-click to cycle` : "Right-click to set per-track swing"}
        className={`flex min-w-0 items-center text-[9px] font-semibold pr-1 h-[28px] rounded-l transition-all whitespace-nowrap overflow-hidden ${
          isSelectedTrack
            ? "text-[var(--ed-text-primary)]"
            : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
        }`}
      >
```

Add a `style` prop after the `className` prop:
```tsx
      <button
        onClick={() => onSelectTrack(track)}
        onContextMenu={handleSwingCycle}
        aria-label={`Select track: ${label}${hasSwing ? ` (swing ${trackSwing})` : ""}`}
        title={hasSwing ? `Swing: ${trackSwing} · Right-click to cycle` : "Right-click to set per-track swing"}
        className={`flex min-w-0 items-center text-[9px] font-semibold pr-1 h-[28px] rounded-l transition-all whitespace-nowrap overflow-hidden ${
          isSelectedTrack
            ? "text-[var(--ed-text-primary)]"
            : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
        }`}
        style={{
          borderLeft: `2px solid ${isSelectedTrack ? color : "transparent"}`,
          paddingLeft: "4px",
        }}
      >
```

The existing internal color-bar `<div>` (small rounded rectangle inside the label) is left unchanged — it continues to display per-track swing state.

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173`. Click different tracks in the pad grid. Verify:
- The selected track's label shows a 2px colored left border (amber for kick/snare/toms, blue for hi-hats, purple for percs)
- Clicking a different track immediately moves the stripe
- The existing swing indicator dot/bar inside the label is still present and functional

- [ ] **Step 3: Commit**

```bash
git add src/components/StepSequencer.tsx
git commit -m "feat(sequencer): colored left stripe on selected track label"
```

---

## Task 5: PadGrid — selected tinting + stronger trigger glow

**Files:**
- Modify: `src/components/PadGrid.tsx:217-228`

- [ ] **Step 1: Update `background` and `boxShadow` in the pad `<button>` style (lines 217–228)**

Replace:
```tsx
              style={{
                background: isTriggered
                  ? `linear-gradient(135deg, ${color}20, ${color}10)`
                  : isSelected
                    ? `linear-gradient(180deg, var(--ed-bg-elevated) 0%, var(--ed-bg-surface) 100%)`
                    : `linear-gradient(180deg, var(--ed-bg-surface) 0%, #151519 100%)`,
                boxShadow: isDragTarget
                  ? `0 0 20px rgba(34,197,94,0.3), inset 0 1px 0 rgba(255,255,255,0.03)`
                  : isTriggered
                    ? `0 0 24px ${color}30, inset 0 0 20px ${color}15`
                    : isSelected
                      ? `0 0 12px ${color}15, inset 0 1px 0 rgba(255,255,255,0.04)`
                      : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)`,
```

With:
```tsx
              style={{
                background: isTriggered
                  ? `linear-gradient(135deg, ${color}28, ${color}14)`
                  : isSelected
                    ? `linear-gradient(180deg, ${color}14 0%, ${color}08 60%, #0a0a0d 100%)`
                    : `linear-gradient(180deg, var(--ed-bg-surface) 0%, #0a0a0d 100%)`,
                boxShadow: isDragTarget
                  ? `0 0 20px rgba(34,197,94,0.3), inset 0 1px 0 rgba(255,255,255,0.03)`
                  : isTriggered
                    ? `0 0 32px ${color}45, 0 0 16px ${color}25, inset 0 0 20px ${color}18`
                    : isSelected
                      ? `0 0 20px ${color}28, inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3)`
                      : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)`,
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173`. Click between pads. Trigger pads with keyboard (Q W E R / A S D F / Z X C V). Verify:
- Selected pad has a subtle color-tinted background (faint amber/blue/purple glow in the gradient) — clearly distinct from unselected pads
- Triggering a pad produces a noticeably stronger and wider glow flash than before
- Drag-and-drop still shows green ring on hover
- Waveform preview, sample indicator dot, label text all still visible

- [ ] **Step 3: Run build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no TypeScript errors. The circular chunk warning is pre-existing and can be ignored.

- [ ] **Step 4: Commit**

```bash
git add src/components/PadGrid.tsx
git commit -m "feat(pads): color-tinted selection state, stronger trigger glow"
```

---

## Task 6: Push

- [ ] **Step 1: Push all commits**

```bash
git push
```

Expected: `main` branch pushed to `origin` with all 5 commits from this plan.

- [ ] **Step 2: Smoke test all verification criteria**

Open the dev or deployed app and confirm all 6 criteria from the spec:

1. Active steps show radial gradient (bright center) + colored glow shadow ✓
2. Lower-velocity steps are visibly dimmer than full-velocity steps ✓
3. 16 steps per row separated into four clear groups of 4 ✓
4. Selecting a track shows a colored left border on its label; switching updates immediately ✓
5. Selected pad has subtle color tinting; unselected pads are neutral dark ✓
6. Triggering a pad produces a strong glow flash; P-Locks, gate overlays, ratchet, conditions still work ✓
