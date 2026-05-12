/**
 * RecordingOrchestrator — choreographs a 45-second product-video performance.
 *
 * Activated by the `?demo=record` URL parameter. It:
 *   1. Loads a demo song (kit + bass + chords + mixer state) via the
 *      existing `loadDemoSong()` helper — no audio refactor needed.
 *   2. Starts transport.
 *   3. Listens to `barCycle` changes (incremented by the drum scheduler at
 *      every pattern wrap) and fires scripted actions at exact bar boundaries
 *      — so cuts in the recorded MP4 land on the beat without manual editing.
 *
 * Timeline (BPM 124, 1 bar ≈ 1.94 s):
 *
 *   Bar  0: drums only — establish the groove
 *   Bar  4: bass enters (unmute ch 12 + fader sweep up)
 *   Bar  6: melody enters (unmute ch 14)
 *   Bar  8: chords enter (unmute ch 13) + filter automation begins
 *   Bar 12: performance-pad gesture playback
 *   Bar 16: queue scene #2 — quantized transition at bar 17
 *   Bar 20: stop
 *
 * Each step also dispatches a CustomEvent("recording:beat", { detail: {bar, label} })
 * so a small in-app HUD (`RecordingHud`) can show progress for the camera.
 */

import { loadDemoSong } from "../data/loadDemoSong";
import { DEMO_SONGS } from "../data/demoSongs";
import { useDrumStore } from "../store/drumStore";
import { useMixerBarStore } from "../store/mixerBarStore";
import { useSceneStore } from "../store/sceneStore";

// ── Channel constants — matches BALANCED_FADERS layout in mixerBarStore.ts ──
const CH_BASS = 12;
const CH_CHORDS = 13;
const CH_MELODY = 14;

interface TimelineStep {
  atBar: number;
  label: string;
  run: () => void;
}

interface StartOpts {
  songIdx: number;
  bars: number;
}

class RecordingOrchestrator {
  private executed = new Set<number>();
  private unsub: (() => void) | null = null;
  private running = false;

  /** Public flag for HUD components to react to recording state */
  get isRecording(): boolean { return this.running; }

  start({ songIdx, bars }: StartOpts): void {
    if (this.running) {
      console.warn("[RecOrch] already running — ignoring start()");
      return;
    }

    const song = DEMO_SONGS[songIdx];
    if (!song) {
      console.error(`[RecOrch] no demo song at index ${songIdx}`);
      return;
    }

    // ── 1. Load demo song (kit + bass + chords + mixer) without auto-play ──
    loadDemoSong(song, { autoPlay: false });

    // ── 2. Pre-mute melody + chords so the buildup is audible ──
    //     Bass is the first to enter so we keep it muted until bar 4.
    const mix = useMixerBarStore.getState();
    mix.setMute(CH_BASS, true);
    mix.setMute(CH_CHORDS, true);
    mix.setMute(CH_MELODY, true);

    // ── 3. Build the timeline ──
    const timeline: TimelineStep[] = [
      { atBar: 0,  label: "DRUMS",           run: () => this.emit(0, "DRUMS") },
      { atBar: 4,  label: "+ BASS",          run: () => { mix.setMute(CH_BASS, false);   this.emit(4,  "+ BASS"); } },
      { atBar: 6,  label: "+ MELODY",        run: () => { mix.setMute(CH_MELODY, false); this.emit(6,  "+ MELODY"); } },
      { atBar: 8,  label: "+ CHORDS",        run: () => { mix.setMute(CH_CHORDS, false); this.emit(8,  "+ CHORDS"); } },
      { atBar: 12, label: "FX",              run: () => this.animateSendSweep() },
      { atBar: 16, label: "SCENE ▶",         run: () => { useSceneStore.getState().queueScene?.(1); this.emit(16, "SCENE ▶"); } },
      { atBar: bars, label: "STOP",          run: () => this.stop() },
    ];

    // ── 4. Subscribe to bar changes — fires each pattern wrap ──
    this.executed.clear();
    this.unsub = useDrumStore.subscribe((state, prev) => {
      if (state.barCycle === prev.barCycle) return;
      for (const step of timeline) {
        if (state.barCycle === step.atBar && !this.executed.has(step.atBar)) {
          this.executed.add(step.atBar);
          console.debug(`[RecOrch] bar ${state.barCycle} → ${step.label}`);
          step.run();
        }
      }
    });

    // ── 5. Kick off transport (deferred so first step lands clean) ──
    this.running = true;
    setTimeout(() => {
      const drum = useDrumStore.getState();
      if (!drum.isPlaying) drum.togglePlay();
      this.emit(0, "DRUMS");
    }, 200);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const drum = useDrumStore.getState();
    if (drum.isPlaying) drum.togglePlay();
    this.unsub?.();
    this.unsub = null;
    this.emit(-1, "DONE");
  }

  // ── Helpers ────────────────────────────────────────────────────

  /** Animate the master reverb-send on chords from 0 → 600 over ~4 bars. */
  private animateSendSweep(): void {
    const setSendRev = useMixerBarStore.getState().setSendRev;
    const start = performance.now();
    const durMs = 4 * (60_000 / useDrumStore.getState().bpm) * 4; // 4 bars
    const tick = () => {
      if (!this.running) return;
      const t = Math.min(1, (performance.now() - start) / durMs);
      // Ease-out cubic so the sweep feels musical
      const eased = 1 - Math.pow(1 - t, 3);
      setSendRev(CH_CHORDS, Math.round(eased * 600));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.emit(12, "FX");
  }

  private emit(bar: number, label: string): void {
    window.dispatchEvent(
      new CustomEvent("recording:beat", { detail: { bar, label } }),
    );
  }
}

export const recordingOrchestrator = new RecordingOrchestrator();
