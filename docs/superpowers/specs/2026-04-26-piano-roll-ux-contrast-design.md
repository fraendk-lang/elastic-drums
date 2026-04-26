# Piano Roll UX + App Contrast — Design Spec

## Goal

Fix three compounding usability problems that make the app painful on a 13" MacBook:
1. Notes created accidentally on single click
2. Arrow keys change the drum pattern while the Piano Roll is open
3. Rows too small → clicks land on the wrong pitch
4. App overall too dark to read comfortably

---

## Part 1: Piano Roll UX

### Problem Summary

| Problem | Root Cause |
|---|---|
| Notes appear on wrong pitch (aim for C, get A#) | `DEFAULT_ROW_HEIGHT = 20px` — too small to click accurately |
| Notes created accidentally | Draw mode creates a note on every single pointer-down |
| Arrow keys change drum pattern | Keyboard handler only calls `e.preventDefault()` when notes are selected (`hasSel`) — unselected state lets events leak to drum sequencer |
| Hard to read note names | 6px label font, note label hidden below `w > 24px` threshold |

### Changes

#### `src/components/PianoRoll/types.ts`

- `DEFAULT_ROW_HEIGHT`: `20` → `30` — 50% larger click target, note names fully readable

#### `src/components/PianoRoll/index.tsx`

**Default tool on open:**
```typescript
const [tool, setTool] = useState<"draw" | "select">("select");
```
Select mode is safe — no accidental notes.

**Note creation — double-click only:**

Remove the note-creation branch from `handleGridPointerDown` in draw mode. The draw-mode `pointerDown` handler becomes identical to select mode: it either selects a hit note or starts a rubber-band. No note is ever created on a single click.

`handleGridDoubleClick` already exists and creates notes in both modes — keep it unchanged. This becomes the sole note-creation path.

```typescript
// handleGridPointerDown — draw mode branch simplified to:
if (tool === "select" || tool === "draw") {
  // Shift or empty → rubber band
  setRubberBand({ x0: x, y0: y, x1: x, y1: y });
}
// (hit note → select, same as before)
```

**Arrow keys — always captured:**

Change every arrow-key guard from `if (e.key === "ArrowLeft" && hasSel)` to always call `e.preventDefault()` when the piano roll is open, then conditionally move notes if `hasSel`:

```typescript
if (e.key === "ArrowLeft") {
  e.preventDefault(); // always — never let drum sequencer get this
  if (!hasSel) return;
  // ... existing move logic
}
// Same for ArrowRight, ArrowUp, ArrowDown
```

**Note labels:**
- Font size: `text-[6px]` → `text-[8px]`
- Visibility threshold: `w > 24` → `w > 14` (smaller notes still show pitch name)

---

## Part 2: App-wide Contrast

### CSS Variables (`src/index.css` — `:root`)

All values lifted toward mid-dark. The grey theme is unchanged.

| Variable | Before | After |
|---|---|---|
| `--ed-bg-primary` | `#101014` | `#1c1c22` |
| `--ed-bg-secondary` | `#18181d` | `#242428` |
| `--ed-bg-surface` | `#212128` | `#2c2c34` |
| `--ed-bg-elevated` | `#2a2a32` | `#36363e` |
| `--ed-border` | `#333340` | `#484854` |
| `--ed-border-subtle` | `#262630` | `#333340` |
| `--ed-text-secondary` | `#9494ac` | `#ababc0` |
| `--ed-text-muted` | `#62627a` | `#828294` |

### Hardcoded Colors to Fix

These components bypass the CSS variable system with raw dark hex values:

| File | Old color | Replacement |
|---|---|---|
| `src/components/Transport.tsx` | `#111116`, `#0d0d11` (header gradient) | `var(--ed-bg-primary)` |
| `src/components/PianoRoll/index.tsx` | `#0d0c10` (grid background) | `var(--ed-bg-primary)` |
| `src/components/PianoRoll/PianoRollKeys.tsx` | `#1a1816`, `#0d0d10` | `var(--ed-bg-secondary)`, `var(--ed-bg-primary)` |
| `src/components/PianoRoll/PianoRollRuler.tsx` | `#0d0d10` | `var(--ed-bg-primary)` |
| `src/components/MixerBar.tsx` | `#111` (fader track, panel bg) | `var(--ed-bg-primary)` |
| `src/components/WaveformCanvas.tsx` | `"#111"` (canvas fillStyle) | `"#1c1c22"` (literal — canvas can't use CSS vars) |
| `src/components/PerformanceMode.tsx` | `#111116`, `#0d0d12` | `var(--ed-bg-primary)`, `var(--ed-bg-secondary)` |
| `src/components/ShortcutOverlay.tsx` | `bg-[#111]` | `bg-[var(--ed-bg-surface)]` |

---

## Files Changed

| File | Change |
|---|---|
| `src/components/PianoRoll/types.ts` | `DEFAULT_ROW_HEIGHT` 20 → 30 |
| `src/components/PianoRoll/index.tsx` | Default tool select, double-click-only creation, arrow key capture, note label size |
| `src/index.css` | `:root` CSS variable values lifted |
| `src/components/Transport.tsx` | Replace hardcoded dark grads with CSS vars |
| `src/components/PianoRoll/PianoRollKeys.tsx` | Replace hardcoded colors |
| `src/components/PianoRoll/PianoRollRuler.tsx` | Replace hardcoded color |
| `src/components/MixerBar.tsx` | Replace hardcoded `#111` |
| `src/components/WaveformCanvas.tsx` | Canvas background to `#1c1c22` |
| `src/components/PerformanceMode.tsx` | Replace hardcoded dark colors |
| `src/components/ShortcutOverlay.tsx` | Replace `bg-[#111]` |

---

## Non-Goals

- No light mode / theme toggle (existing grey theme stays as-is)
- No Piano Roll zoom presets (row height is set once in types.ts)
- No note inspector panel / exact beat input
- No changes to note colors (accents stay as-is)
