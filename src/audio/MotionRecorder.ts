/**
 * FX Motion Recorder — records XY pad movements as timed automation curves.
 * Each recording is synced to the sequencer's loop length.
 * On playback, the recorded movements are applied to the FX parameters.
 */

export interface MotionPoint {
  time: number;      // Time offset in seconds from recording start
  x: number;         // 0-1
  y: number;         // 0-1
}

export interface MotionRecording {
  id: string;
  mode: string;      // FX mode (FILTER, DELAY, REVERB, etc.)
  target: string;    // FX target (master, drums, etc.)
  points: MotionPoint[];
  duration: number;  // Total duration in seconds
  bpm: number;       // BPM at time of recording (for sync)
  loopBars: number;  // How many bars the recording covers
}

class MotionRecorder {
  private recording = false;
  private playing = false;
  private currentRecording: MotionPoint[] = [];
  private startTime = 0;
  private recordings: MotionRecording[] = [];
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  private playbackStartTime = 0;
  private activePlayback: MotionRecording | null = null;
  private onPlaybackPoint: ((x: number, y: number) => void) | null = null;

  /** Start recording motion */
  startRecording(): void {
    this.recording = true;
    this.currentRecording = [];
    this.startTime = performance.now();
  }

  /** Add a point during recording (called from XY pad move handler) */
  addPoint(x: number, y: number): void {
    if (!this.recording) return;
    const time = (performance.now() - this.startTime) / 1000;
    this.currentRecording.push({ time, x, y });
  }

  /** Stop recording and return the recording */
  stopRecording(mode: string, target: string, bpm: number): MotionRecording | null {
    if (!this.recording) return null;
    this.recording = false;

    if (this.currentRecording.length < 2) return null;

    const duration = (performance.now() - this.startTime) / 1000;
    const barDuration = (60 / bpm) * 4; // 4 beats per bar
    const loopBars = Math.max(1, Math.round(duration / barDuration));

    const recording: MotionRecording = {
      id: `motion-${Date.now()}`,
      mode,
      target,
      points: this.currentRecording,
      duration: loopBars * barDuration, // Quantize to bar boundary
      bpm,
      loopBars,
    };

    this.recordings.push(recording);
    this.currentRecording = [];
    return recording;
  }

  /** Start playing back a recording in a loop */
  startPlayback(recording: MotionRecording, onPoint: (x: number, y: number) => void): void {
    this.stopPlayback();
    this.playing = true;
    this.activePlayback = recording;
    this.onPlaybackPoint = onPoint;
    this.playbackStartTime = performance.now();

    // Play back at ~60fps
    this.playbackTimer = setInterval(() => {
      if (!this.activePlayback || !this.onPlaybackPoint) return;

      const elapsed = ((performance.now() - this.playbackStartTime) / 1000) % this.activePlayback.duration;

      // Find the two nearest points and interpolate
      const points = this.activePlayback.points;
      let prev = points[0]!;
      let next = points[0]!;

      for (let i = 0; i < points.length; i++) {
        if (points[i]!.time <= elapsed) prev = points[i]!;
        if (points[i]!.time >= elapsed) { next = points[i]!; break; }
      }

      // Linear interpolation
      if (prev === next || next.time === prev.time) {
        this.onPlaybackPoint(prev.x, prev.y);
      } else {
        const t = (elapsed - prev.time) / (next.time - prev.time);
        const x = prev.x + (next.x - prev.x) * t;
        const y = prev.y + (next.y - prev.y) * t;
        this.onPlaybackPoint(x, y);
      }
    }, 16); // ~60fps
  }

  stopPlayback(): void {
    this.playing = false;
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.activePlayback = null;
    this.onPlaybackPoint = null;
  }

  get isRecording(): boolean { return this.recording; }
  get isPlaying(): boolean { return this.playing; }
  get allRecordings(): MotionRecording[] { return this.recordings; }

  deleteRecording(id: string): void {
    this.recordings = this.recordings.filter(r => r.id !== id);
    if (this.activePlayback?.id === id) this.stopPlayback();
  }

  clearAll(): void {
    this.stopPlayback();
    this.recordings = [];
  }
}

export const motionRecorder = new MotionRecorder();
