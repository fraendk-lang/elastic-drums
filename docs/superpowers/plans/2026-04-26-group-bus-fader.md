# Group Bus Fader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expandable Group Bus Panel to the MixerBar with 8 strips (DRUMS/HATS/PERC/BASS/CHORDS/MELODY/SAMPL/LOOPS), each showing a live VU meter, vertical fader, and mute button.

**Architecture:** New `groupBuses` state slice in `mixerBarStore.ts` drives the UI. `AudioEngine` gets one new `getGroupAnalyser()` facade method. All rendering lives in a new `GroupBusPanel` sub-component + `useGroupMeterData` hook inside `MixerBar.tsx`. The panel opens/closes via a toggle button; `setGroupVolume()` on AudioEngine already exists.

**Tech Stack:** React 18, TypeScript strict, Zustand, Web Audio API AnalyserNode, Tailwind CSS

---

## File Map

| File | Change |
|------|--------|
| `src/store/mixerBarStore.ts` | Add `GroupBusState`, `GroupBusId`, `groupBuses` state + `setGroupFader` / `setGroupMute` actions |
| `src/audio/AudioEngine.ts` | Add `getGroupAnalyser(group): AnalyserNode \| null` facade method |
| `src/components/MixerBar.tsx` | Add `useGroupMeterData` hook, `GroupBusPanel` component, toggle button + `groupPanelOpen` state |

---

## Task 1: Group Bus State in mixerBarStore

**Files:**
- Modify: `src/store/mixerBarStore.ts`

- [ ] **Step 1: Add `GroupBusState`, `GroupBusId`, and the constant array**

In `src/store/mixerBarStore.ts`, after the existing `ChannelMixState` interface (around line 25), add:

```typescript
export const GROUP_BUS_IDS = [
  "drums", "hats", "perc", "bass", "chords", "melody", "sampler", "loops",
] as const;
export type GroupBusId = typeof GROUP_BUS_IDS[number];

export interface GroupBusState {
  fader: number;   // 0-1000, 750 = unity (same scale as channel faders)
  muted: boolean;
}
```

- [ ] **Step 2: Extend `MixerBarState` with group fields**

In the `interface MixerBarState` block (around line 58), add three new fields inside the interface:

```typescript
  groupBuses:    Record<GroupBusId, GroupBusState>;
  setGroupFader: (group: GroupBusId, fader: number) => void;
  setGroupMute:  (group: GroupBusId, muted: boolean) => void;
```

- [ ] **Step 3: Add initial state and action implementations**

In the `create<MixerBarState>` call (around line 71), add `groupBuses` initial state after `expandedChannel: null,`:

```typescript
  groupBuses: Object.fromEntries(
    GROUP_BUS_IDS.map((id) => [id, { fader: 750, muted: false }])
  ) as Record<GroupBusId, GroupBusState>,
```

Then add the two actions after `setExpanded`:

```typescript
  setGroupFader: (group, fader) =>
    set((s) => ({
      groupBuses: { ...s.groupBuses, [group]: { ...s.groupBuses[group]!, fader } },
    })),

  setGroupMute: (group, muted) =>
    set((s) => ({
      groupBuses: { ...s.groupBuses, [group]: { ...s.groupBuses[group]!, muted } },
    })),
```

- [ ] **Step 4: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/store/mixerBarStore.ts
git commit -m "feat: add groupBuses state to mixerBarStore (Sprint C)"
```

---

## Task 2: AudioEngine facade — getGroupAnalyser

**Files:**
- Modify: `src/audio/AudioEngine.ts`

- [ ] **Step 1: Add `getGroupAnalyser` method**

In `src/audio/AudioEngine.ts`, find the existing line (around line 363):
```typescript
  getGroupLevel(group: string): number { return mixerRouter.getGroupLevel(group); }
  setGroupVolume(group: string, volume: number): void { mixerRouter.setGroupVolume(group, volume); }
  getGroupNames(): string[] { return mixerRouter.getGroupNames(); }
```

Add one new line between `getGroupLevel` and `setGroupVolume`:

```typescript
  getGroupAnalyser(group: string): AnalyserNode | null { return mixerRouter.getGroupAnalyser(group); }
```

- [ ] **Step 2: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/audio/AudioEngine.ts
git commit -m "feat: expose getGroupAnalyser on AudioEngine facade"
```

---

## Task 3: GroupBusPanel + toggle in MixerBar

**Files:**
- Modify: `src/components/MixerBar.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/MixerBar.tsx`, the file already imports:
```typescript
import { useEffect, useRef } from "react";
```

Add `useState` to the React import:
```typescript
import { useEffect, useRef, useState } from "react";
```

Add the new store imports after the existing store import line:
```typescript
import { useMixerBarStore, faderToGain, NUM_MIXER_CHANNELS, GROUP_BUS_IDS, type GroupBusId } from "../store/mixerBarStore";
```

- [ ] **Step 2: Add the GROUP_BUSES metadata array**

After the existing `CHANNELS` array (around line 37), add:

```typescript
const GROUP_BUSES: { id: GroupBusId; label: string; color: string }[] = [
  { id: "drums",   label: "DRUMS", color: "#f59e0b" },
  { id: "hats",    label: "HATS",  color: "#3b82f6" },
  { id: "perc",    label: "PERC",  color: "#8b5cf6" },
  { id: "bass",    label: "BASS",  color: "#10b981" },
  { id: "chords",  label: "CHRD",  color: "#a78bfa" },
  { id: "melody",  label: "LEAD",  color: "#f472b6" },
  { id: "sampler", label: "SMPL",  color: "#f97316" },
  { id: "loops",   label: "LOOPS", color: "#2EC4B6" },
];
```

- [ ] **Step 3: Add `useGroupMeterData` hook**

After the existing `useMeterData` hook (after its closing `}` around line 111), add a new hook that follows the exact same pattern but reads from group analysers:

```typescript
// ── Group bus meter data (same pattern as useMeterData) ───────────────────────

function useGroupMeterData() {
  const peakRef    = useRef<number[]>(new Array(GROUP_BUS_IDS.length).fill(-Infinity));
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(new Array(GROUP_BUS_IDS.length).fill(null));
  const rafRef     = useRef(0);

  useEffect(() => {
    let meterBuf: Float32Array<ArrayBuffer> | null = null;
    let lastT = 0;

    const draw = (now: DOMHighResTimeStamp) => {
      if (now - lastT < 50) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastT = now;

      for (let i = 0; i < GROUP_BUS_IDS.length; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const analyser = audioEngine.getGroupAnalyser(GROUP_BUS_IDS[i]!);
        if (!analyser) continue;

        if (!meterBuf || meterBuf.length < analyser.fftSize) {
          meterBuf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
        }
        analyser.getFloatTimeDomainData(meterBuf);
        let peak = 0;
        for (let j = 0; j < analyser.fftSize; j++) peak = Math.max(peak, Math.abs(meterBuf[j]!));
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        peakRef.current[i] = Math.max(peakRef.current[i]! - 2.0, db);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const { width: w, height: h } = canvas;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, h);

        const clampDb = Math.max(-60, Math.min(0, db));
        const frac    = (clampDb + 60) / 60;
        const fillH   = frac * h;
        const gradient = ctx.createLinearGradient(0, h - fillH, 0, h);
        gradient.addColorStop(0, db > -1.5 ? "#ef4444" : db > -6 ? "#fbbf24" : "#22c55e");
        gradient.addColorStop(1, "#16a34a");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, h - fillH, w, fillH);

        const peakDb = peakRef.current[i]!;
        if (peakDb > -60) {
          const peakFrac = (Math.max(-60, Math.min(0, peakDb)) + 60) / 60;
          const py = h - peakFrac * h;
          ctx.fillStyle = peakDb > -1.5 ? "#ef4444" : "#86efac";
          ctx.fillRect(0, py, w, 1);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return canvasRefs;
}
```

- [ ] **Step 4: Add `GroupBusPanel` component**

After `useGroupMeterData`, add the panel component (before the `MixerBar` function):

```typescript
// ── Group Bus Panel ───────────────────────────────────────────────────────────

interface GroupBusPanelProps {
  groupCanvasRefs: React.MutableRefObject<(HTMLCanvasElement | null)[]>;
}

function GroupBusPanel({ groupCanvasRefs }: GroupBusPanelProps) {
  const { groupBuses, setGroupFader, setGroupMute } = useMixerBarStore();

  // Apply fader + mute to audioEngine whenever groupBuses changes
  useEffect(() => {
    GROUP_BUS_IDS.forEach((id) => {
      const bus = groupBuses[id]!;
      const gain = bus.muted ? 0 : faderToGain(bus.fader);
      audioEngine.setGroupVolume(id, gain);
    });
  }, [groupBuses]);

  return (
    <div className="border-b border-white/[0.06] bg-[#0a0a0a]">
      <div className="flex items-center gap-px py-1.5 px-1 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: "none" }}>
        {/* Section label */}
        <div className="flex items-center justify-center min-w-[32px] mr-1">
          <span className="text-[6px] font-black tracking-[0.18em] text-white/20 rotate-0">BUS</span>
        </div>

        {GROUP_BUSES.map(({ id, label, color }, i) => {
          const bus = groupBuses[id]!;
          return (
            <div
              key={id}
              className="flex flex-col items-center gap-1 min-w-[46px] px-1 rounded hover:bg-white/[0.02] transition-colors"
            >
              {/* Group name */}
              <span
                className="text-[7px] font-black tracking-[0.12em] uppercase"
                style={{ color: bus.muted ? "#333" : color }}
              >
                {label}
              </span>

              {/* Meter + fader */}
              <div className="flex gap-1 items-end h-[56px]">
                {/* Meter */}
                <canvas
                  ref={(el) => { groupCanvasRefs.current[i] = el; }}
                  width={4}
                  height={56}
                  className="rounded-sm"
                  style={{ opacity: bus.muted ? 0.25 : 1, transition: "opacity 0.15s" }}
                />

                {/* Fader */}
                <div className="relative" style={{ width: 8, height: 56 }}>
                  <div className="absolute inset-0 rounded bg-[#111] border border-white/[0.06]" />
                  {/* Unity tick */}
                  <div
                    className="absolute left-0 right-0 h-px bg-white/20"
                    style={{ top: `${(1 - 750 / 1000) * 100}%` }}
                  />
                  {/* Range input (invisible, captures interaction) */}
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={bus.fader}
                    onChange={(e) => setGroupFader(id, Number(e.target.value))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    style={{ writingMode: "vertical-lr" as const, direction: "rtl" as const }}
                    title={`${(faderToGain(bus.fader) * 100).toFixed(0)}%`}
                  />
                  {/* Visual thumb */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-4 h-2 rounded-sm bg-[#3a3a3a] border border-white/20 pointer-events-none"
                    style={{ top: `calc(${(1 - bus.fader / 1000) * 100}% - 4px)` }}
                  />
                </div>
              </div>

              {/* Mute */}
              <button
                onClick={() => setGroupMute(id, !bus.muted)}
                className={`w-5 h-3.5 text-[6px] font-black rounded-sm border transition-colors ${
                  bus.muted
                    ? "bg-orange-500/30 border-orange-500/60 text-orange-400"
                    : "bg-transparent border-white/10 text-white/20 hover:border-white/25"
                }`}
              >
                M
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add toggle state + hook call + panel rendering to `MixerBar`**

In the `MixerBar()` function, find the opening:
```typescript
export function MixerBar() {
  const {
    channels, expandedChannel,
    setFader, setMute, setSolo, setPan, setEQ, setSendRev, setSendDly, setExpanded,
  } = useMixerBarStore();

  const canvasRefs = useMeterData();
```

Replace with:
```typescript
export function MixerBar() {
  const {
    channels, expandedChannel,
    setFader, setMute, setSolo, setPan, setEQ, setSendRev, setSendDly, setExpanded,
  } = useMixerBarStore();

  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const canvasRefs      = useMeterData();
  const groupCanvasRefs = useGroupMeterData();
```

- [ ] **Step 6: Render GroupBusPanel and toggle button**

In the `MixerBar` return JSX, find the outer wrapper div:
```tsx
return (
  <div className="relative flex flex-col shrink-0 bg-[#0e0e0e] border-t border-white/[0.07]">
    {/* Expanded panel — rendered above the strip */}
    {expandedChannel !== null && (
      <ExpandedPanel ... />
    )}

    {/* Compact strips — horizontal scroll */}
    <div className="flex overflow-x-auto gap-px py-1.5 px-1 scrollbar-none" ...>
```

Update to:
```tsx
return (
  <div className="relative flex flex-col shrink-0 bg-[#0e0e0e] border-t border-white/[0.07]">
    {/* Expanded panel — rendered above the strip */}
    {expandedChannel !== null && (
      <ExpandedPanel
        channel={channels[expandedChannel]!}
        color={CHANNELS[expandedChannel]?.color ?? "#888"}
        label={CHANNELS[expandedChannel]?.label ?? ""}
        onClose={() => setExpanded(null)}
        onEQ={(band, gain) => { setEQ(expandedChannel, band, gain); audioEngine.setChannelEQ(expandedChannel, band, gain); }}
        onPan={(pan) => { setPan(expandedChannel, pan); audioEngine.setChannelPan(expandedChannel, pan); }}
        onSendRev={(v) => { setSendRev(expandedChannel, v); audioEngine.setChannelReverbSend(expandedChannel, v / 100); }}
        onSendDly={(v) => { setSendDly(expandedChannel, v); audioEngine.setChannelDelaySend(expandedChannel, v / 100); }}
      />
    )}

    {/* Group Bus Panel — rendered above channel strips when open */}
    {groupPanelOpen && (
      <GroupBusPanel groupCanvasRefs={groupCanvasRefs} />
    )}

    {/* Compact strips — horizontal scroll */}
    <div className="flex overflow-x-auto gap-px py-1.5 px-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
      {CHANNELS.map(({ id, label, color }) => {
```

Then find the end of the `.map()` closing and the closing `</div>` of the compact strips row. After the closing `</div>` of the map, and before the outer closing `</div>`, add the GROUP toggle button on the far right of the strip row.

The cleanest approach: change the compact strip row from `flex overflow-x-auto` to a relative container, and place the GROUP button absolutely to the right. Or, simpler: add the GROUP button as the last child inside the scroll div, with `ml-auto` and `sticky right-0`.

Find the scroll div and add the toggle button as the **last item** inside it:

```tsx
      {/* Group Bus toggle — sticky right */}
      <div className="sticky right-0 flex items-center pl-1 ml-auto shrink-0 bg-[#0e0e0e]">
        <button
          onClick={() => setGroupPanelOpen((v) => !v)}
          className="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded border transition-all"
          style={{
            borderColor: groupPanelOpen ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)",
            background:  groupPanelOpen ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
            color:       groupPanelOpen ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
          }}
          title="Toggle Group Bus faders"
        >
          <span className="text-[6px] font-black tracking-[0.14em]">GROUP</span>
          <span className="text-[8px] leading-none">{groupPanelOpen ? "▾" : "▴"}</span>
        </button>
      </div>
```

- [ ] **Step 7: TypeScript check**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. Common issues to watch for:
- `GROUP_BUS_IDS` import: make sure it's exported from `mixerBarStore.ts`
- `GroupBusId` type: make sure it's exported
- `groupCanvasRefs` type: `React.MutableRefObject<(HTMLCanvasElement | null)[]>`

- [ ] **Step 8: Manual smoke test**

Start `npm run dev`, open the app, open the Mixer Bar:
- "GROUP ▴" button visible far right in the channel strip
- Click it → panel opens above channels with 8 group strips (DRUMS, HATS, PERC, BASS, CHORDS, MELODY, SMPL, LOOPS)
- VU meters animate while transport plays
- Drag a fader → audio level changes for that group
- Click M → group goes silent (meter dims to 25% opacity, M button turns orange)
- Click GROUP button again → panel collapses

- [ ] **Step 9: Commit**

```bash
git add src/components/MixerBar.tsx
git commit -m "feat: group bus panel with meter + fader + mute (Sprint C)"
```

---

## Self-Review

### Spec Coverage

| Spec Item | Task | Status |
|-----------|------|--------|
| `GroupBusState` + `GroupBusId` + `groupBuses` in store | Task 1 | ✅ |
| `setGroupFader` + `setGroupMute` actions | Task 1 | ✅ |
| `getGroupAnalyser()` on AudioEngine | Task 2 | ✅ |
| `useGroupMeterData` hook (same pattern as `useMeterData`) | Task 3 Step 3 | ✅ |
| `GroupBusPanel` with 8 strips: meter + fader + mute | Task 3 Step 4 | ✅ |
| Mute dims meter to 0.25 opacity | Task 3 Step 4 | ✅ |
| Toggle button `GROUP ▴/▾` sticky right in strip row | Task 3 Step 6 | ✅ |
| `faderToGain(fader)` reused for group gain calculation | Task 3 Step 4 | ✅ |
| Unity tick at 75% on fader | Task 3 Step 4 | ✅ |
| `audioEngine.setGroupVolume()` called on state change | Task 3 Step 4 | ✅ |
| No solo, no group EQ, no persist of panel state | — | ✅ (not implemented = correct) |

### Type Consistency
- `GroupBusId` defined in Task 1, used in Task 3 — same name ✅
- `GROUP_BUS_IDS` constant exported in Task 1, used in Task 3 hook ✅
- `setGroupFader(id: GroupBusId, fader: number)` — consistent across store + component ✅
- `audioEngine.getGroupAnalyser(group: string)` added in Task 2, called in Task 3 hook ✅
