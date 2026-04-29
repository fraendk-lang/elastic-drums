# Arpeggiator Panel — Design Spec

**Date:** 2026-04-29  
**Status:** Approved  
**Scope:** Bass, Chords, Melody sequencers (Phase 1)

---

## Goal

Expose the existing `ArpSettings` engine (already wired into all three synth schedulers) through a collapsible panel in each sequencer's toolbar. No backend changes — pure UI.

---

## What Changes, What Stays

| System | Change |
|--------|--------|
| `src/components/ArpPanel.tsx` | **Create** — shared panel component |
| `src/components/BassSequencer.tsx` | Add ARP button + `showArp` toggle + `<ArpPanel>` |
| `src/components/ChordsSequencer.tsx` | Add ARP button + `showArp` toggle + `<ArpPanel>` |
| `src/components/MelodySequencer.tsx` | Add ARP button + `showArp` toggle + `<ArpPanel>` |
| `src/audio/Arpeggiator.ts` | **Unchanged** |
| `src/store/bassStore.ts` | **Unchanged** — `arp` field + `setArp` already exist |
| `src/store/chordsStore.ts` | **Unchanged** |
| `src/store/melodyStore.ts` | **Unchanged** |

---

## ArpPanel Component

### Props

```typescript
interface ArpPanelProps {
  arp:         ArpSettings;
  setArp:      <K extends keyof ArpSettings>(key: K, value: ArpSettings[K]) => void;
  accentColor: string;  // track color: teal (#14b8a6), purple (#a855f7), yellow (#eab308)
}
```

### Layout — Two rows

**Row 1 — Button groups (discrete values)**

Four groups separated by 1px dividers:

| Group | Values | Type |
|-------|--------|------|
| MODE | off · up · down · updown · downup · converge · diverge · random · chord | `ArpMode` |
| RATE | 1/4 · 1/8 · 1/8t · 1/16 · 1/16t · 1/32 | `ArpRate` |
| OCT | 1 · 2 · 3 · 4 | `number` |
| GATE | S · M · L | `ArpGate` (short/medium/long) |

Active button: `background: accentColor, color: #000, fontWeight: 700`  
Inactive button: `background: rgba(0,0,0,0.3), color: rgba(255,255,255,0.25)`

Mode labels: `off=OFF, up=UP, down=DN, updown=↕, downup=↕2, converge=CV, diverge=DV, random=RND, chord=♩♩`  
Gate labels: `short=S, medium=M, long=L`

**Row 2 — Sliders (continuous values)**

Four sliders in equal-width columns, separated by a `border-top border-white/5` from Row 1:

| Param | Store key | Range | Display |
|-------|-----------|-------|---------|
| SWING | `swing` | 0–0.5 | `Math.round(val * 200)` + `%` (0–100%) |
| SKIP | `skipProb` | 0–1 | `Math.round(val * 100)` + `%` |
| VEL DECAY | `velDecay` | 0–1 | `Math.round(val * 100)` + `%` |
| JITTER | `velocityJitter` | 0–1 | `Math.round(val * 100)` + `%` |

Each slider: label (6px, white/40) + value (6px, accentColor at 60% opacity) on one line, then `<input type="range">` below. Slider accent color via CSS `accent-color`.

### Container styles

```
background: rgba(0,0,0,0.25)
border-top: 1px solid rgba(255,255,255,0.06)
padding: 8px 12px
display: flex flex-col gap-2
```

No border-radius — the panel sits flush below the toolbar.

---

## ARP Button (in each sequencer toolbar)

```tsx
<button
  onClick={() => setShowArp(v => !v)}
  className={`px-2 py-1 rounded text-[9px] font-black tracking-[0.15em] transition-colors flex items-center gap-1 ${
    showArp
      ? "text-white/80 bg-white/10"
      : "text-white/35 hover:text-white/60"
  }`}
>
  ARP
  {arp.mode !== "off" && (
    <span
      className="w-1.5 h-1.5 rounded-full animate-pulse"
      style={{ backgroundColor: accentColor }}
    />
  )}
</button>
```

- `showArp` is local component state (default `false`)
- Panel mounts/unmounts with `showArp` — no animation needed
- Button stays highlighted (`bg-white/10`) while panel is open

---

## Accent Colors per Track

| Track | Color |
|-------|-------|
| Bass | `#14b8a6` (teal) |
| Chords | `#a855f7` (purple) |
| Melody | `#eab308` (yellow) |

---

## Integration Points

Each sequencer already has:
- `const { arp, setArp } = useBassStore()` (or chords/melody equivalent)
- The `setArp(key, value)` action updates the store; the scheduler reads it on the next step

No additional store wiring needed. The panel is purely presentational.

---

## What is NOT in scope

- Arp presets / save/load
- Pattern Offset control (Ableton feature, not in our engine yet)
- Distance + Steps transposition (Ableton feature, not in our engine)
- Per-step arp override
- Arp in the Drum sequencer (drums don't use the synth scheduler)

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/components/ArpPanel.tsx` | **Create** — ~80 lines |
| `src/components/BassSequencer.tsx` | Add `showArp` state, ARP button, `<ArpPanel>` |
| `src/components/ChordsSequencer.tsx` | Add `showArp` state, ARP button, `<ArpPanel>` |
| `src/components/MelodySequencer.tsx` | Add `showArp` state, ARP button, `<ArpPanel>` |
