/**
 * WorkerTimer — Web Worker-based interval timer.
 *
 * Unlike setInterval, a Worker timer runs on a separate JS thread and cannot
 * be blocked by main-thread GC pauses or React rendering. Critical for audio
 * schedulers that need reliable 20ms ticks without jitter.
 *
 * Falls back to setInterval if Worker creation fails (e.g. strict CSP).
 */

const WORKER_CODE = `
  let timer = null;
  self.onmessage = (e) => {
    if (e.data.type === 'start') {
      if (timer) clearInterval(timer);
      timer = setInterval(() => self.postMessage({ type: 'tick' }), e.data.interval);
    } else if (e.data.type === 'stop') {
      if (timer) { clearInterval(timer); timer = null; }
    }
  };
`;

export class WorkerTimer {
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private fallbackId: ReturnType<typeof setInterval> | null = null;
  private readonly interval: number;

  constructor(interval: number) {
    this.interval = interval;
  }

  start(callback: () => void): void {
    this.stop();
    try {
      const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
      this.blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(this.blobUrl);
      worker.onmessage = callback;
      worker.postMessage({ type: 'start', interval: this.interval });
      this.worker = worker;
    } catch {
      // Fallback: plain setInterval
      this.fallbackId = setInterval(callback, this.interval);
    }
  }

  stop(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'stop' });
        this.worker.terminate();
      } catch { /* ok */ }
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (this.fallbackId !== null) {
      clearInterval(this.fallbackId);
      this.fallbackId = null;
    }
  }
}
