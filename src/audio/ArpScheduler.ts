/**
 * ArpScheduler — tempo-synced arpeggiator scheduler for the XY Performance Pad.
 *
 * Subscribes to the shared SchedulerClock (AudioWorklet tick, ~20ms) and uses
 * a 100ms lookahead window to schedule Web Audio note events with no drift.
 * The caller provides getter functions (getRoot, getSettings, getScaleName) so
 * the scheduler always reads the latest XY pad state at each step boundary.
 *
 * Usage:
 *   scheduler.start({ getRoot, getSettings, getScaleName, onNote, getBpm });
 *   // later:
 *   scheduler.stop();
 */
import { schedulerClock } from './SchedulerClock';
import { audioEngine } from './AudioEngine';
import { generateArpNotes, type ArpSettings } from './Arpeggiator';

/**
 * Default lookahead window (seconds). Small for interactive responsiveness:
 * pointer-position → audible note within ~100ms. The caller can override
 * via getLookahead() — see the explanation below in ArpSchedulerOptions.
 */
const DEFAULT_LOOKAHEAD_SEC = 0.1;

export interface ArpSchedulerOptions {
  getRoot: () => number;
  getSettings: () => ArpSettings;
  getScaleName: () => string;
  onNote: (midi: number, duration: number, atTime: number, velocity: number) => void;
  getBpm: () => number;
  /**
   * Optional dynamic lookahead. Called on every tick — return the current
   * desired lookahead in seconds. Use this to stay responsive (~100ms) while
   * the user is actively touching the pad and switch to a wider window
   * (~1000ms) when LATCH keeps the arp running without active touch, so
   * background-tab throttling doesn't drain the scheduled buffer.
   */
  getLookahead?: () => number;
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
    // Initial fill — schedule first batch immediately rather than waiting
    // for the first worklet tick to come in.
    this._tick();
  }

  stop(): void {
    this._running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.options = null;
  }

  /**
   * Force a tick now. Useful after the page regains focus from background —
   * the scheduler clock may have missed dispatches and we want to resume
   * scheduling notes immediately rather than waiting for the next worklet
   * message to bubble up to the main thread.
   */
  kick(): void {
    if (this._running) this._tick();
  }

  private _tick(): void {
    if (!this._running || !this.options) return;
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;

    const { getRoot, getSettings, getScaleName, onNote, getBpm, getLookahead } = this.options;
    const lookahead = Math.max(0.05, Math.min(2.0, getLookahead?.() ?? DEFAULT_LOOKAHEAD_SEC));

    // Clamp nextStepTime forward if we fell behind (tab resume, system sleep).
    // Reset to currentTime + lookahead (not just currentTime) to prevent a
    // burst of catch-up notes filling the lookahead window all at once.
    if (this.nextStepTime < ctx.currentTime - 1.0) {
      this.nextStepTime = ctx.currentTime + lookahead;
    }

    const bpm = Math.max(20, getBpm());
    const stepDuration = 60 / bpm;

    while (this.nextStepTime < ctx.currentTime + lookahead) {
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
