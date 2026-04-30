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
