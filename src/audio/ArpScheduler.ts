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
 * Schedule notes this many seconds ahead of ctx.currentTime.
 *
 * Why 1 second (not the typical 100ms): on macOS, when the browser window
 * loses focus, main-thread message dispatch can be throttled. The audio
 * thread keeps running, but the JS callback that schedules notes runs at
 * reduced priority. With a small lookahead the scheduled-note buffer drains
 * before the next tick fires and audio cuts out — exactly what users see
 * when ARP+LATCH is on and they Cmd+Tab away.
 *
 * 1 second is enough headroom to survive most throttling windows while
 * still being responsive to live parameter changes (arp rate, octaves) —
 * those are read fresh each step, so the worst-case stale-parameter window
 * is also 1 second.
 */
const LOOKAHEAD_SEC = 1.0;

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

    // Clamp nextStepTime forward if we fell behind (tab resume, system sleep).
    // Reset to currentTime + LOOKAHEAD_SEC (not just currentTime) to prevent a
    // burst of catch-up notes filling the lookahead window all at once.
    if (this.nextStepTime < ctx.currentTime - 1.0) {
      this.nextStepTime = ctx.currentTime + LOOKAHEAD_SEC;
    }

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
