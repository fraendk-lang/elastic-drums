# Group Bus Fader — Design Spec

## Goal
Add an ausklappbares (expandable) Group Bus Panel to the MixerBar. Each of the 8 bus groups gets its own strip with a VU meter, vertical fader, and mute button — giving quick macro-level volume control without touching individual channels.

## Architecture
- No new audio graph nodes needed — `MixerRouting` already has `setGroupVolume()`, `getGroupLevel()`, `getGroupAnalyser()`, and `getGroupGainNode()`
- New state slice in `mixerBarStore.ts` for group fader + mute values
- New `setGroupVolume(group, gain)` facade method on `AudioEngine`
- All UI lives in `MixerBar.tsx` — new `GroupBusPanel` sub-component + toggle button

---

## Groups

| Group | Channels | Color |
|-------|----------|-------|
| DRUMS | 0–5 (KICK, SNARE, CLAP, TOM L, TOM M, TOM H) | `#f59e0b` |
| HATS | 6–9 (HH CL, HH OP, CYM, RIDE) | `#3b82f6` |
| PERC | 10–11 (PRC 1, PRC 2) | `#8b5cf6` |
| BASS | 12 | `#10b981` |
| CHORDS | 13 | `#a78bfa` |
| MELODY | 14 | `#f472b6` |
| SAMPL | 15 | `#f97316` |
| LOOPS | 16 | `#2EC4B6` |

---

## State: `mixerBarStore.ts`

Add a `groupBuses` field alongside the existing `channels` array:

```typescript
interface GroupBusChannel {
  fader: number;   // 0–1000, same scale as individual channels
  muted: boolean;
}

// In MixerBarState:
groupBuses: Record<string, GroupBusChannel>;

// Actions:
setGroupFader(group: string, fader: number): void;
setGroupMute(group: string, muted: boolean): void;
```

Initial state for all 8 groups: `{ fader: 750, muted: false }` (750 = unity gain, matches `faderToGain` convention).

Mute sets audio gain to 0. Unmute restores `faderToGain(fader)`. Both actions call `audioEngine.setGroupVolume()` immediately.

---

## Audio: `AudioEngine.ts`

Add one new public method:

```typescript
setGroupVolume(group: string, gain: number): void {
  mixerRouter.setGroupVolume(group, gain);
}
```

`mixerRouter.setGroupVolume()` already exists and sets `bus.gain.gain.value` directly.

---

## UI: `MixerBar.tsx`

### Toggle Button

In the existing compact strip row, add a small `GROUP ▾` / `GROUP ▴` button on the far right (after the last channel strip). Clicking it toggles a local `useState<boolean>` called `groupPanelOpen`.

```
color: rgba(255,255,255,0.3) → hover rgba(255,255,255,0.6)
font-size: 7px, font-weight: 900, letter-spacing: 0.12em
border: 1px solid rgba(255,255,255,0.09)
background: rgba(255,255,255,0.03)
```

### GroupBusPanel

Rendered **above** the compact channel strip row when `groupPanelOpen` is true. A horizontal flex row of 8 strips, separated from the channel strips by a 1px `border-b border-white/[0.06]`.

Each strip (same pattern as individual channels):

```
Column layout: label → (meter + fader side-by-side) → mute button
Width: ~46px min-width, same as individual channel strips
```

**Label:** group name in its color, font-size 7px, font-weight 900, tracking 0.14em

**Meter:** `<canvas>` 4×56px, read from `audioEngine.getChannelAnalyser()` via group analyser — integrate into the existing `useMeterData` RAF loop (extend `canvasRefs` to include group indices, or use a separate `useGroupMeterData` hook with same logic but reading `audioEngine.getGroupAnalyser(group)`)

**Fader:** `<input type="range">` vertical, 0–1000, same CSS as channel faders. Unity tick at 75% (fader value 750).

**Mute:** same M button as channels, orange highlight when active.

### Meter Integration

The existing `useMeterData` hook reads from `audioEngine.getChannelAnalyser(i)`. For group meters, add a parallel `useGroupMeterData` hook in the same file that reads from `audioEngine.getGroupAnalyser(group)` for each of the 8 groups. Same RAF, same 20fps throttle, same dB/peak-hold logic.

Add `getGroupAnalyser(group: string): AnalyserNode | null` to `AudioEngine` as a thin wrapper around `mixerRouter.getGroupAnalyser(group)` (already exists on MixerRouting).

---

## Files Changed

| File | Change |
|------|--------|
| `src/store/mixerBarStore.ts` | Add `groupBuses` state + `setGroupFader` / `setGroupMute` actions |
| `src/audio/AudioEngine.ts` | Add `setGroupVolume(group, gain)` + `getGroupAnalyser(group)` facade methods |
| `src/components/MixerBar.tsx` | Add `GroupBusPanel` component + `useGroupMeterData` hook + toggle button |

---

## Non-Goals
- No solo on group level
- No group-level EQ, send, or pan
- Panel open/close state is not persisted (resets on reload)
- No drag-to-reorder groups
