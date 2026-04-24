/**
 * SchedulerClock — AudioWorklet-based scheduler tick clock.
 *
 * The AudioWorklet processor runs in the browser's audio subsystem thread
 * with real-time OS priority. Unlike setInterval or Web Worker timers, it
 * cannot be blocked by main-thread GC pauses or React rendering.
 *
 * Single shared instance: all 4 schedulers (drum/bass/chords/melody)
 * subscribe to one clock instead of running 4 separate timers.
 *
 * Falls back to WorkerTimer if AudioWorklet init fails.
 */

import { WorkerTimer } from './WorkerTimer';

// AudioWorklet processor code — runs in audio thread
const TICK_PROCESSOR = `
class ElasticTickProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Fire every 20ms — count samples, post message when threshold reached
    this._samplesPerTick = Math.round(sampleRate * 0.02);
    this._countdown = this._samplesPerTick;
  }

  process() {
    this._countdown -= 128; // one quantum = 128 samples
    if (this._countdown <= 0) {
      this._countdown += this._samplesPerTick;
      this.port.postMessage(0); // tick
    }
    return true; // keep processor alive
  }
}
registerProcessor('elastic-scheduler-tick', ElasticTickProcessor);
`;

type TickFn = () => void;

class SchedulerClock {
  private node: AudioWorkletNode | null = null;
  private blobUrl: string | null = null;
  private fallback: WorkerTimer | null = null;
  private readonly listeners = new Set<TickFn>();
  private _initialized = false;

  /**
   * Initialize the clock. Must be called once after AudioContext is created.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async init(ctx: AudioContext): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    try {
      const blob = new Blob([TICK_PROCESSOR], { type: 'application/javascript' });
      this.blobUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(this.blobUrl);

      this.node = new AudioWorkletNode(ctx, 'elastic-scheduler-tick', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      this.node.port.onmessage = () => {
        // Dispatch tick to all subscribers on the main thread
        for (const fn of this.listeners) fn();
      };

      // AudioWorkletNode must be connected to run; use a silent gain
      const silent = ctx.createGain();
      silent.gain.value = 0;
      this.node.connect(silent);
      silent.connect(ctx.destination);

      console.debug('[SchedulerClock] AudioWorklet clock active — audio-thread timing');
    } catch (e) {
      // Graceful fallback: Web Worker timer (better than setInterval)
      console.warn('[SchedulerClock] AudioWorklet unavailable, using WorkerTimer fallback:', e);
      this.fallback = new WorkerTimer(20);
      this.fallback.start(() => {
        for (const fn of this.listeners) fn();
      });
    }
  }

  /**
   * Subscribe to tick events. Returns an unsubscribe function.
   * The scheduler callback runs on the main thread when invoked.
   */
  addListener(fn: TickFn): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

export const schedulerClock = new SchedulerClock();
