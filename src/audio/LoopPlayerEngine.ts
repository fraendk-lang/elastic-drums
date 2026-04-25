/**
 * Loop Player Engine — 4-slot tempo-synced audio loop player
 *
 * Architecture per slot:
 *   source (loop=true) → gainNode → output
 *
 * Tempo sync:
 *   source.playbackRate = globalBpm / slotOriginalBpm
 *
 * Changing BPM while playing:
 *   updatePlaybackRate() applies the new rate without restarting the source
 */

const SLOT_COUNT = 4;

export class LoopPlayerEngine {
  private ctx: AudioContext | null = null;
  private output: GainNode | null = null;

  // Per-slot active audio nodes
  private sources: (AudioBufferSourceNode | null)[] = new Array(SLOT_COUNT).fill(null);
  private gains:   (GainNode | null)[]              = new Array(SLOT_COUNT).fill(null);

  init(ctx: AudioContext): void {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.9;
    // Caller is responsible for connecting output to destination
  }

  /**
   * Start a loop slot. Stops any existing source on the slot first.
   *
   * @param slotIdx           - 0-based slot index (0–3)
   * @param buffer            - decoded AudioBuffer (the full loop file)
   * @param originalBpm       - native BPM of the audio file (e.g. 128)
   * @param globalBpm         - current project BPM (e.g. 140)
   * @param volume            - 0–1 slot volume
   * @param startTime         - AudioContext time to begin playback
   * @param loopStartSeconds  - beat-aligned loop start within buffer (default: 0)
   * @param loopEndSeconds    - beat-aligned loop end within buffer (default: buffer.duration)
   */
  startSlot(
    slotIdx: number,
    buffer: AudioBuffer,
    originalBpm: number,
    globalBpm: number,
    volume: number,
    startTime: number,
    loopStartSeconds?: number,
    loopEndSeconds?: number,
    pitchFactor = 1,
  ): void {
    if (!this.ctx || !this.output) return;

    // Always clean up any existing source first
    this._stopSlotInternal(slotIdx, startTime);

    const ctx = this.ctx;

    const loopStart = Math.max(0, loopStartSeconds ?? 0);
    const loopEnd   = Math.min(buffer.duration, loopEndSeconds ?? buffer.duration);

    // Apply short fades at loop boundaries to prevent click artifacts on loop wrap
    const fadedBuffer = this._applyLoopFade(buffer, loopStart, loopEnd);

    const source = ctx.createBufferSource();
    source.buffer    = fadedBuffer;
    source.loop      = true;
    source.loopStart = loopStart;
    source.loopEnd   = loopEnd > loopStart ? loopEnd : fadedBuffer.duration;

    const rate = this._calcRate(originalBpm, globalBpm, pitchFactor);
    source.playbackRate.value = rate;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gain);
    gain.connect(this.output);

    // Start reading from loopStart so playback begins on beat 1
    source.start(Math.max(ctx.currentTime, startTime), loopStart);

    this.sources[slotIdx] = source;
    this.gains[slotIdx]   = gain;

    source.onended = () => {
      if (this.sources[slotIdx] === source) {
        this.sources[slotIdx] = null;
        this.gains[slotIdx]   = null;
      }
    };
  }

  /**
   * Stop a slot with a short fade-out (avoids click artifacts).
   */
  stopSlot(slotIdx: number, time: number): void {
    this._stopSlotInternal(slotIdx, time);
  }

  /**
   * Live-update playback rate of a running slot (e.g. when global BPM changes).
   * No audio interruption — just adjusts speed.
   */
  updatePlaybackRate(slotIdx: number, originalBpm: number, globalBpm: number, pitchFactor = 1): void {
    const source = this.sources[slotIdx];
    if (!source || !this.ctx) return;
    const rate = this._calcRate(originalBpm, globalBpm, pitchFactor);
    source.playbackRate.setValueAtTime(rate, this.ctx.currentTime);
  }

  /**
   * Smoothly ramp slot volume (no click).
   */
  setVolume(slotIdx: number, volume: number): void {
    const gain = this.gains[slotIdx];
    if (!gain || !this.ctx) return;
    gain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)),
      this.ctx.currentTime,
      0.02,
    );
  }

  /**
   * Stop all slots immediately.
   */
  stopAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < SLOT_COUNT; i++) {
      this._stopSlotInternal(i, now);
    }
  }

  /** Returns true if a slot has an active AudioBufferSourceNode. */
  isSlotActive(slotIdx: number): boolean {
    return this.sources[slotIdx] !== null;
  }

  getOutput(): GainNode | null {
    return this.output;
  }

  destroy(): void {
    this.stopAll();
    this.output = null;
    this.ctx    = null;
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * Compute AudioBufferSourceNode playbackRate.
   *
   * @param originalBpm  Native BPM of the audio file
   * @param globalBpm    Current project BPM
   * @param pitchFactor  1.0 for BEATS/COMPLEX (pitch handled offline),
   *                     2^(semitones/12) for RE-PITCH (vinyl — changes both pitch & tempo)
   */
  private _calcRate(originalBpm: number, globalBpm: number, pitchFactor = 1): number {
    const bpmRatio = originalBpm > 0 ? globalBpm / originalBpm : 1;
    return Math.max(0.1, Math.min(8, bpmRatio * pitchFactor));
  }

  private _stopSlotInternal(slotIdx: number, time: number): void {
    const source = this.sources[slotIdx];
    const gain   = this.gains[slotIdx];
    if (!source) return;

    if (gain) {
      try { gain.gain.setTargetAtTime(0, time, 0.015); } catch { /* ok */ }
    }
    try { source.stop(time + 0.06); } catch { /* already stopped */ }

    this.sources[slotIdx] = null;
    this.gains[slotIdx]   = null;
  }

  /**
   * Create a copy of `buffer` with short linear fades applied at the loop
   * boundary points to eliminate click artifacts on `AudioBufferSourceNode.loop`.
   *
   * @param buffer       Source AudioBuffer
   * @param loopStart    Loop start in seconds
   * @param loopEnd      Loop end in seconds
   * @param fadeSecs     Fade duration (default 3 ms)
   */
  private _applyLoopFade(
    buffer: AudioBuffer,
    loopStart: number,
    loopEnd: number,
    fadeSecs = 0.003,
  ): AudioBuffer {
    if (!this.ctx) return buffer;
    const sr         = buffer.sampleRate;
    const fadeFrames = Math.max(1, Math.round(fadeSecs * sr));
    const startFrame = Math.round(loopStart * sr);
    const endFrame   = Math.min(buffer.length, Math.round(loopEnd * sr));

    const copy = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = copy.getChannelData(c);
      dst.set(src); // copy all samples

      // Fade-in at loopStart (0 → 1 over fadeFrames)
      for (let i = 0; i < fadeFrames; i++) {
        const fi = startFrame + i;
        if (fi < dst.length) dst[fi]! *= i / fadeFrames;
      }
      // Fade-out at loopEnd (1 → 0 over fadeFrames)
      for (let i = 0; i < fadeFrames; i++) {
        const fi = endFrame - 1 - i;
        if (fi >= 0) dst[fi]! *= i / fadeFrames;
      }
    }
    return copy;
  }
}

export const loopPlayerEngine = new LoopPlayerEngine();
