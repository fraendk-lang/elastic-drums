# Melody Pad — Volume Control + Classic Arp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated vertical volume slider and a classic Ableton-style tempo-synced arpeggiator to the Melody XY Pad.

**Architecture:** A new `ArpScheduler.ts` uses `SchedulerClock` (already a shared AudioWorklet-backed 20ms tick) to schedule arp notes via Web Audio API lookahead — no drift. `PerformancePad.tsx` gains local state for volume/arp settings, a vertical slider replacing the right strip, and an arp-controls bar below the pad. On touch-down the arp starts; on touch-up it stops (or latches). The X position is read at each arp step boundary so pitch changes are grid-quantized.

**Tech Stack:** React, TypeScript strict mode, Web Audio API (`AudioBufferSourceNode` timing), Zustand (read-only for BPM), Tailwind CSS. Existing `Arpeggiator.ts` and `SchedulerClock.ts` are used unchanged.

---

## File Structure

| File | Action |
|------|--------|
| `src/audio/ArpScheduler.ts` | **CREATE** — lookahead scheduler, ~80 lines |
| `src/components/PerformancePad.tsx` | **MODIFY** — add state, volume slider, arp bar, touch wiring |
| `src/audio/Arpeggiator.ts` | **NO CHANGE** — already complete |
| `src/audio/SchedulerClock.ts` | **NO CHANGE** — already has `addListener()` API |

---

## Task 1: Create ArpScheduler

**Files:**
- Create: `src/audio/ArpScheduler.ts`

### Background

`SchedulerClock` fires a tick callback every ~20ms from an AudioWorklet. `generateArpNotes(rootMidi, stepDuration, settings, scaleName, rootMidi)` from `Arpeggiator.ts` returns `ArpNote[]` — each note has `{ offset, note, duration, velocity }` relative to the start of the step. The scheduler advances `nextStepTime` by `60/bpm` seconds (1 beat = 1 quarter note) and schedules Web Audio events with absolute times.

- [ ] **Step 1: Create the file**

Write `src/audio/ArpScheduler.ts` with this exact content:

```typescript
import { schedulerClock } from './SchedulerClock';
import { audioEngine } from './AudioEngine';
import { generateArpNotes, type ArpSettings } from './Arpeggiator';

const LOOKAHEAD_SEC = 0.1;

export interface ArpSchedulerOptions {
  getRoot: () => number;
  getSettings: () => ArpSettings;
  getScaleName: () => string;
  onNote: (midi: number, duration: number, atTime: number, velocity: number) => void;
  getBpm: () => number;
}

export class ArpScheduler {
  private options: ArpSchedulerOptions | null = null;
  private nextStepTime = 0;
  private unsubscribe: (() => void) | null = null;
  private _running = false;

  get isRunning(): boolean {
    return this._running;
  }

  start(options: ArpSchedulerOptions): void {
    this.stop();
    this.options = options;
    this._running = true;

    const ctx = audioEngine.getAudioContext();
    if (!ctx) { this._running = false; return; }
    this.nextStepTime = ctx.currentTime + 0.02;

    this.unsubscribe = schedulerClock.addListener(() => this._tick());
  }

  stop(): void {
    this._running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.options = null;
  }

  private _tick(): void {
    if (!this._running || !this.options) return;
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;

    const { getRoot, getSettings, getScaleName, onNote, getBpm } = this.options;
    const bpm = Math.max(20, getBpm());
    const stepDuration = 60 / bpm;

    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_SEC) {
      const rootMidi = getRoot();
      const settings = getSettings();
      const scaleName = getScaleName();
      const notes = generateArpNotes(rootMidi, stepDuration, settings, scaleName, rootMidi);

      const stepStart = this.nextStepTime;
      for (const n of notes) {
        const atTime = stepStart + n.offset;
        if (atTime >= ctx.currentTime) {
          onNote(n.note, n.duration, atTime, n.velocity);
        }
      }

      this.nextStepTime += stepDuration;
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd "Elastic Drum" && npx tsc --noEmit 2>&1 | head -30`

Expected: no errors about `ArpScheduler.ts`. If `SchedulerClock` import fails, check the relative path — `ArpScheduler.ts` lives in `src/audio/` next to `SchedulerClock.ts`.

- [ ] **Step 3: Commit**

```bash
git add "Elastic Drum/src/audio/ArpScheduler.ts"
git commit -m "feat: add ArpScheduler — lookahead scheduler for XY pad arp"
```

---

## Task 2: Add Volume Slider to PerformancePad

**Files:**
- Modify: `src/components/PerformancePad.tsx`

### Background

The current right strip at line ~1171 is a tiny label div:
```tsx
{/* Right strip: stats */}
<div className="flex flex-col justify-end w-8 text-[8px] text-[var(--ed-text-muted)] font-mono">
  <span className="text-[var(--ed-accent-melody)]/70 rotate-90 origin-left translate-y-[-50%]">Pitch →</span>
</div>
```
Replace it with a vertical `<input type="range">` volume slider. A vertical range input is achieved via CSS `writing-mode: vertical-lr` + `direction: rtl` (standard, works in all modern browsers). The volume applies to the engine immediately via `sweepLiveVolume`.

- [ ] **Step 1: Add volume state after the shimmer state block (line ~116)**

Find this line in `PerformancePad.tsx`:
```tsx
  const [shimmerFeedback, setShimmerFeedback] = useState(0.28);
```

Add immediately after it:
```tsx
  const [padVolume, setPadVolume] = useState(80);
```

- [ ] **Step 2: Add volume sync effect after the existing reset-on-close effect (after line ~133)**

Find:
```tsx
  // Reset transpose when overlay closes (prevents stale offset if closed mid-press)
  useEffect(() => {
    if (!isOpen) {
      setBassLiveTranspose(0);
      setMelodyLiveTranspose(0);
    }
  }, [isOpen, setBassLiveTranspose, setMelodyLiveTranspose]);
```

Add immediately after it:
```tsx
  useEffect(() => {
    if (!isOpen) return;
    if (target === "melody") melodyEngine.sweepLiveVolume(padVolume / 100);
    else bassEngine.sweepLiveVolume(padVolume / 100);
  }, [isOpen, target]);
  // eslint-disable-next-line react-hooks/exhaustive-deps — intentionally only on open/target change
```

- [ ] **Step 3: Replace the right strip JSX**

Find:
```tsx
        {/* Right strip: stats */}
        <div className="flex flex-col justify-end w-8 text-[8px] text-[var(--ed-text-muted)] font-mono">
          <span className="text-[var(--ed-accent-melody)]/70 rotate-90 origin-left translate-y-[-50%]">Pitch →</span>
        </div>
```

Replace with:
```tsx
        {/* Volume slider */}
        <div className="flex flex-col items-center gap-1 w-10">
          <span className="text-[7px] text-white/30 font-mono tracking-wider">VOL</span>
          <div className="flex-1 flex items-center justify-center w-full">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={padVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPadVolume(v);
                if (target === "melody") melodyEngine.sweepLiveVolume(v / 100);
                else bassEngine.sweepLiveVolume(v / 100);
              }}
              className="cursor-pointer accent-orange-400"
              style={{ writingMode: "vertical-lr", direction: "rtl", width: "100%", height: "100%" }}
              title={`Volume: ${padVolume}%`}
            />
          </div>
          <span className="text-[7px] text-orange-400/80 font-mono">{padVolume}%</span>
        </div>
```

- [ ] **Step 4: Verify in browser**

Start dev server (`npm run dev`), open XY Performance pad, confirm vertical slider appears on the right. Drag it — `padVolume%` label should update. Play a note — volume should change with slider position.

- [ ] **Step 5: Commit**

```bash
git add "Elastic Drum/src/components/PerformancePad.tsx"
git commit -m "feat: add dedicated volume slider to XY Performance Pad"
```

---

## Task 3: Add Arp State + Arp Bar UI

**Files:**
- Modify: `src/components/PerformancePad.tsx`

### Background

The arp bar is a single row of controls rendered below the XY pad area (inside the outer `flex-col` container). It is only shown when `target === "melody"`. Controls: ARP ON/OFF toggle, Mode (UP / ↕UD / RND), Rate (1/4 / 1/8 / 1/16), Octave (1 / 2), LATCH.

`ArpSettings.mode` uses values from `ArpMode` type in `Arpeggiator.ts` (`"up" | "updown" | "random"`). `ArpSettings.rate` uses `ArpRate` (`"1/4" | "1/8" | "1/16"`).

- [ ] **Step 1: Add arp-related imports at the top of the file**

Find:
```tsx
import { sendFxManager } from "../audio/SendFx";
```

Add after it:
```tsx
import { ArpScheduler } from "../audio/ArpScheduler";
import { DEFAULT_ARP_SETTINGS, type ArpSettings } from "../audio/Arpeggiator";
import { useDrumStore } from "../store/drumStore";
```

Note: `useDrumStore` is already imported at line ~16. Only add the two new imports.

- [ ] **Step 2: Add arp state after the padVolume state**

Find:
```tsx
  const [padVolume, setPadVolume] = useState(80);
```

Add immediately after it:
```tsx
  const [arpOn, setArpOn] = useState(false);
  const [arpMode, setArpMode] = useState<"up" | "updown" | "random">("up");
  const [arpRate, setArpRate] = useState<"1/4" | "1/8" | "1/16">("1/8");
  const [arpOctaves, setArpOctaves] = useState<1 | 2>(1);
  const [arpLatch, setArpLatch] = useState(false);
  const arpSchedulerRef = useRef(new ArpScheduler());
  const arpRootRef = useRef<number>(60);
```

- [ ] **Step 3: Add arp cleanup effect — add after the volume sync effect**

Find the volume sync effect you added in Task 2:
```tsx
  useEffect(() => {
    if (!isOpen) return;
    if (target === "melody") melodyEngine.sweepLiveVolume(padVolume / 100);
    else bassEngine.sweepLiveVolume(padVolume / 100);
  }, [isOpen, target]);
  // eslint-disable-next-line react-hooks/exhaustive-deps — intentionally only on open/target change
```

Add immediately after it:
```tsx
  useEffect(() => {
    const sched = arpSchedulerRef.current;
    return () => { sched.stop(); };
  }, []);
```

- [ ] **Step 4: Add handleArpToggle callback — add after the applyChordFollow callback (~line 151)**

Find:
```tsx
  }, [chordFollow, bassRoot, setBassLiveTranspose, setMelodyLiveTranspose]);
```

Add immediately after it:
```tsx
  const handleArpToggle = useCallback(() => {
    setArpOn((prev) => {
      if (prev) arpSchedulerRef.current.stop();
      return !prev;
    });
  }, []);
```

- [ ] **Step 5: Add arp bar JSX below the XY pad area**

Find the closing tag of the outer pad flex container — it follows the Volume slider div you added:
```tsx
        {/* Volume slider */}
        <div className="flex flex-col items-center gap-1 w-10">
          ...
        </div>
      </div>
    </div>
```

The structure is:
```
<div className="fixed inset-0 z-50 flex flex-col" ...>
  {/* Header */}
  <div ...>...</div>
  {/* XY Pad */}
  <div className="flex-1 flex items-stretch justify-stretch p-6 gap-4 min-h-0" ...>
    {/* Y-axis label strip */}
    {/* XY pad */}
    {/* Volume slider */}        ← you added this
  </div>                         ← close "flex-1" div
  {/* ADD ARP BAR HERE */}
</div>                           ← close "fixed inset-0" div
```

Find:
```tsx
      </div>
    </div>
  );
}
```

Replace the last closing tags with:
```tsx
      </div>

      {/* Arp bar — melody target only */}
      {target === "melody" && (
        <div
          className="flex items-center gap-2 px-5 py-2 border-t border-white/[0.06] flex-shrink-0"
          style={{ background: "#0a080c" }}
        >
          {/* ARP ON/OFF */}
          <button
            onClick={handleArpToggle}
            className={`px-3 h-6 text-[9px] font-bold rounded transition-all ${
              arpOn
                ? "bg-orange-500/30 text-orange-300"
                : "bg-white/5 text-white/30 hover:text-white/60"
            }`}
            style={{ boxShadow: arpOn ? "0 0 8px rgba(249,115,22,0.25)" : "none" }}
          >
            ARP {arpOn ? "●" : "○"}
          </button>

          <div className="w-px h-4 bg-white/10" />

          {/* Mode */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-white/20 mr-1 tracking-wider">MODE</span>
            {(
              [
                ["up",     "↑ UP"],
                ["updown", "↕ UD"],
                ["random", "? RND"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setArpMode(m)}
                className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                  arpMode === m
                    ? "bg-orange-500/25 text-orange-300"
                    : "text-white/25 hover:text-white/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Rate */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-white/20 mr-1 tracking-wider">RATE</span>
            {(["1/4", "1/8", "1/16"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setArpRate(r)}
                className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                  arpRate === r
                    ? "bg-orange-500/25 text-orange-300"
                    : "text-white/25 hover:text-white/60"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Octave */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-white/20 mr-1 tracking-wider">OCT</span>
            {([1, 2] as const).map((o) => (
              <button
                key={o}
                onClick={() => setArpOctaves(o)}
                className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                  arpOctaves === o
                    ? "bg-orange-500/25 text-orange-300"
                    : "text-white/25 hover:text-white/60"
                }`}
              >
                {o}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Latch */}
          <button
            onClick={() => setArpLatch((v) => !v)}
            className={`px-3 h-6 text-[9px] font-bold rounded transition-all ${
              arpLatch
                ? "bg-orange-500/20 text-orange-400"
                : "bg-white/5 text-white/30 hover:text-white/60"
            }`}
            title="LATCH: arp keeps running after finger lift"
          >
            LATCH
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify UI renders**

Open dev server, open XY Pad. Confirm:
- Arp bar appears below the pad (melody target only)
- ARP ○/● button toggles orange glow
- Mode/Rate/Octave/LATCH buttons highlight orange when selected
- Switching to "bass" target hides the arp bar

- [ ] **Step 7: Commit**

```bash
git add "Elastic Drum/src/components/PerformancePad.tsx"
git commit -m "feat: add arp controls bar to XY Performance Pad"
```

---

## Task 4: Wire Arp to Touch Handlers

**Files:**
- Modify: `src/components/PerformancePad.tsx`

### Background

Three touch handlers need changes:
1. `handlePointerDown` — if arpOn + melody: skip `fireVoice`, start `ArpScheduler` instead, create dummy voice (empty releases) to track pointer
2. `handlePointerMove` — update `arpRootRef.current` at each X change (scheduler reads it at next step)
3. `handlePointerUp` — stop arp when last finger lifts (unless latch)

The `ArpSettings` passed to the scheduler uses the local arp state. BPM is read from the Zustand drum store via `useDrumStore.getState().bpm` (avoid subscribing — just read at start of each step inside `getSettings`/`getBpm`).

- [ ] **Step 1: Modify handlePointerDown**

Find the `else` branch at the end of handlePointerDown (after the `if (mode === "chords")` block):
```tsx
    } else {
      const midi = xToMidi(x);
      const release = fireVoice(midi, velocity, y);
      voice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity, releases: [release] };
    }
```

Replace it with:
```tsx
    } else if (arpOn && target === "melody") {
      const midi = xToMidi(x);
      arpRootRef.current = midi;
      const arpSettings: ArpSettings = {
        ...DEFAULT_ARP_SETTINGS,
        mode: arpMode,
        rate: arpRate,
        octaves: arpOctaves,
        gate: "medium",
      };
      arpSchedulerRef.current.start({
        getRoot: () => arpRootRef.current,
        getSettings: () => ({ ...arpSettings, mode: arpMode, rate: arpRate, octaves: arpOctaves }),
        getScaleName: () => scaleName,
        onNote: (noteMidi, duration, atTime, vel) => {
          melodyEngine.triggerPolyNote(noteMidi, atTime, duration, vel, false);
        },
        getBpm: () => useDrumStore.getState().bpm,
      });
      voice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity, releases: [] };
    } else {
      const midi = xToMidi(x);
      const release = fireVoice(midi, velocity, y);
      voice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity, releases: [release] };
    }
```

- [ ] **Step 2: Modify handlePointerMove**

Find inside handlePointerMove (after the `if (mode === "chords")` block):
```tsx
    } else {
      modulateVoice(y);
      if (gridSnap) {
        const newMidi = xToMidi(x);
        if (newMidi !== voice.midi) repitchVoice(voice, newMidi, y);
      }
    }
```

Replace with:
```tsx
    } else if (arpOn && target === "melody") {
      modulateVoice(y);
      arpRootRef.current = xToMidi(x);
    } else {
      modulateVoice(y);
      if (gridSnap) {
        const newMidi = xToMidi(x);
        if (newMidi !== voice.midi) repitchVoice(voice, newMidi, y);
      }
    }
```

- [ ] **Step 3: Modify handlePointerUp**

Find the spring-back block at the end of handlePointerUp:
```tsx
    // Spring-back: restore FX levels when ALL fingers are lifted
    if (activeVoicesRef.current.size === 0 && fxSnapshotRef.current) {
```

Add this block immediately before it:
```tsx
    // Stop arp when last finger lifts (unless latch is on)
    if (arpOn && target === "melody" && activeVoicesRef.current.size === 0 && !arpLatch) {
      arpSchedulerRef.current.stop();
    }

```

- [ ] **Step 4: Verify arp plays**

Open dev server, open XY Pad (NOTES mode, target = MELODY):
1. Toggle ARP ON
2. Touch and hold the pad → arp should play tempo-synced notes
3. Move finger left/right → notes should shift at the next arp step
4. Lift finger → arp stops after current notes finish
5. Toggle LATCH ON, touch → lift finger → arp keeps running
6. Toggle ARP OFF → arp stops immediately

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: no errors. Common issue: `ArpSettings` import — ensure it's imported at top of file.

- [ ] **Step 6: Commit**

```bash
git add "Elastic Drum/src/components/PerformancePad.tsx"
git commit -m "feat: wire arp scheduler to XY pad touch handlers"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Volume slider (vertical, right of pad, default 80%, melody+bass)
- ✅ Arp bar (ARP ON/OFF, Mode UP/↕UD/RND, Rate 1/4/1/8/1/16, Octave 1/2, LATCH)
- ✅ Touch → arp starts, root = X pitch
- ✅ Move → root updates at next step (quantized via `getRoot()` called per step)
- ✅ Release → stop when last finger lifts (latch mode: keep running)
- ✅ LATCH off → stop on finger lift; LATCH on → keep running
- ✅ ARP OFF toggle → immediate stop
- ✅ AudioContext lookahead scheduler (no setInterval drift)
- ✅ `Arpeggiator.ts` used unchanged

**Type consistency:**
- `ArpSettings` from `Arpeggiator.ts` used in Task 1 (ArpScheduler) and Task 4 (handlePointerDown) — same type
- `ArpSchedulerOptions.getSettings()` returns `ArpSettings` — matches `generateArpNotes` parameter
- `arpMode` state type `"up" | "updown" | "random"` matches `ArpMode` values (subset of full `ArpMode` union)
- `arpRate` state type `"1/4" | "1/8" | "1/16"` matches `ArpRate` values (subset)
