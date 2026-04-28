/**
 * Loop Player Engine — 8-slot tempo-synced audio loop player
 *
 * Architecture per slot:
 *   source (loop=true) → gainNode → slotOutput[i] → MixerBar channel (16+i) → master
 *
 * Tempo sync:
 *   source.playbackRate = globalBpm / slotOriginalBpm
 *
 * Changing BPM while playing:
 *   updatePlaybackRate() applies the new rate without restarting the source
 *
 * HMR safety:
 *   init() is idempotent for the same AudioContext and auto-connects to
 *   mixer channel 16 (no explicit connect needed in App.tsx).
 *   startSlot() lazy-inits if this.ctx is null (handles Vite HMR module
 *   reload without page refresh).
 */

// Import audioEngine lazily to avoid circular-dependency issues at module load
// time — we call audioEngine.getAudioContext() only inside methods.
import { audioEngine } from "./AudioEngine";

const SLOT_COUNT        = 8;
const LOOP_CHANNEL_BASE = 16; // LP 1 = ch 16, LP 2 = ch 17, …, LP 8 = ch 23

export class LoopPlayerEngine {
  private ctx: AudioContext | null = null;
  // Per-slot output GainNodes — each routes to its own mixer channel (16+i)
  private slotOutputs: (GainNode | null)[] = new Array(SLOT_COUNT).fill(null);

  // Per-slot active audio nodes
  private sources: (AudioBufferSourceNode | null)[] = new Array(SLOT_COUNT).fill(null);
  private gains:   (GainNode | null)[]              = new Array(SLOT_COUNT).fill(null);

  /**
   * Initialise the engine with an AudioContext.
   * Idempotent: calling again with the same ctx is a no-op.
   * Calling with a new ctx (after destroy/rebuild) re-connects from scratch.
   * Each slot gets its own output GainNode → its own mixer channel (LP 1–8).
   */
  init(ctx: AudioContext): void {
    if (this.ctx === ctx) return;          // already up — same context, nothing to do
    // Disconnect any old per-slot outputs
    this.slotOutputs.forEach((o) => { if (o) { try { o.disconnect(); } catch { /* ok */ } } });

    this.ctx = ctx;
    this.slotOutputs = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const g = ctx.createGain();
      g.gain.value = 0.9;
      // Wire each slot to its own mixer channel: LP 1 = 16, LP 2 = 17, …
      g.connect(audioEngine.getChannelOutput(LOOP_CHANNEL_BASE + i));
      return g;
    });
  }

  /**
   * Lazy-init helper used inside every public playback method.
   * Handles the Vite HMR case where a module reload creates a new singleton
   * without re-running App.tsx startAudio (audioReady stays true via React
   * Fast Refresh). Returns true if the engine is ready to use.
   */
  private _ensureInit(): boolean {
    if (this.ctx && this.slotOutputs[0]) return true;
    const ctx = audioEngine.getAudioContext();
    if (ctx) this.init(ctx);
    return !!(this.ctx && this.slotOutputs[0]);
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
    if (!this._ensureInit()) return;

    // Always clean up any existing source first
    this._stopSlotInternal(slotIdx, startTime);

    // _ensureInit() guarantees both ctx and output are non-null
    const ctx = this.ctx!;

    const loopStart = Math.max(0, loopStartSeconds ?? 0);
    const loopEnd   = Math.min(buffer.duration, loopEndSeconds ?? buffer.duration);
    const effectiveLoopEnd = loopEnd > loopStart ? loopEnd : buffer.duration;

    // Apply short fades at effective loop boundaries to prevent click artifacts on wrap.
    // The fade-IN is applied to the region BEFORE loopStart (not after it), so that
    // on initial playback the source reads from loopStart at full amplitude (clean hit),
    // while on every subsequent loop-wrap the wrap point lands at the pre-fade region
    // (fade ramps 0→1 into loopStart → no click on wrap).
    const { fadedBuffer, fadeSecs } = this._applyLoopFade(buffer, loopStart, effectiveLoopEnd);

    // Wrap point: go back into the pre-fade region so the fade-in plays on every wrap
    const wrapStart = Math.max(0, loopStart - fadeSecs);

    const source = ctx.createBufferSource();
    source.buffer    = fadedBuffer;
    source.loop      = true;
    source.loopStart = wrapStart;
    source.loopEnd   = effectiveLoopEnd;

    const rate = this._calcRate(originalBpm, globalBpm, pitchFactor);
    source.playbackRate.value = rate;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gain);
    gain.connect(this.slotOutputs[slotIdx]!);

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
    if (!this._ensureInit()) return;
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

  /**
   * Schedule volume-envelope automation for a looping slot.
   * Writes `setValueAtTime` calls spanning `numCycles` loop iterations ahead,
   * aligned to `loopStartAudioTime + N * realCycleDuration`.
   *
   * Call immediately after `startSlot()`. Safe to re-call while playing —
   * cancels old schedule first.
   *
   * @param slotIdx            - 0-based slot index
   * @param envelope           - volume per segment (0–1); length = segment count
   * @param loopStartAudioTime - AudioContext time of the very first loop cycle
   * @param realCycleDuration  - real-time seconds per loop cycle (= loopRegionSecs / playbackRate)
   * @param numCycles          - how many future cycles to pre-schedule (default 64 ≈ 8+ min at 8 s/cycle)
   */
  scheduleEnvelope(
    slotIdx: number,
    envelope: number[],
    loopStartAudioTime: number,
    realCycleDuration: number,
    numCycles = 64,
  ): void {
    const gain = this.gains[slotIdx];
    if (!gain || !this.ctx) return;
    if (realCycleDuration < 0.01 || envelope.length === 0) return;

    const now = this.ctx.currentTime;
    const segCount = envelope.length;
    const segDuration = realCycleDuration / segCount;

    // Clear all previously scheduled values from now onward
    try { gain.gain.cancelScheduledValues(now); } catch { /* ok */ }

    // Find the first cycle that overlaps "now" (skip past cycles)
    const firstCycle = Math.max(0, Math.floor((now - loopStartAudioTime) / realCycleDuration));

    for (let cycle = firstCycle; cycle < firstCycle + numCycles; cycle++) {
      const cycleStart = loopStartAudioTime + cycle * realCycleDuration;
      // Don't schedule further than 10 minutes ahead
      if (cycleStart > now + 600) break;
      for (let seg = 0; seg < segCount; seg++) {
        const t = cycleStart + seg * segDuration;
        if (t < now - 0.05) continue; // skip strictly past events
        const vol = Math.max(0, Math.min(1, envelope[seg] ?? 1));
        try {
          gain.gain.setValueAtTime(vol, Math.max(now, t));
        } catch { /* ok */ }
      }
    }
  }

  /** Returns true if a slot has an active AudioBufferSourceNode. */
  isSlotActive(slotIdx: number): boolean {
    return this.sources[slotIdx] !== null;
  }

  /** Returns the output GainNode for a specific slot (used for diagnostics). */
  getSlotOutput(slotIdx: number): GainNode | null {
    return this.slotOutputs[slotIdx] ?? null;
  }

  destroy(): void {
    this.stopAll();
    this.slotOutputs.forEach((o) => { if (o) { try { o.disconnect(); } catch { /* ok */ } } });
    this.slotOutputs = new Array(SLOT_COUNT).fill(null);
    this.ctx = null;
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
   * Fade strategy (ensures beat 1 hits at full amplitude on initial start):
   *   • Fade-IN  applied to [loopStart - fadeSecs … loopStart):
   *       → region BEFORE the beat. On initial `source.start(t, loopStart)` the
   *         read begins at loopStart (full amplitude). On each subsequent loop-wrap
   *         the source rewinds to wrapStart = loopStart - fadeSecs, hears the
   *         0→1 ramp, and arrives at loopStart at full amplitude — no click.
   *   • Fade-OUT applied to the last fadeSecs of the loop region (unchanged):
   *       → end of loop ramps to silence so the wrap discontinuity is inaudible.
   *
   * @returns { fadedBuffer, fadeSecs } so callers can compute wrapStart.
   */
  private _applyLoopFade(
    buffer: AudioBuffer,
    loopStart: number,
    loopEnd: number,
    fadeSecs = 0.003,
  ): { fadedBuffer: AudioBuffer; fadeSecs: number } {
    if (!this.ctx) return { fadedBuffer: buffer, fadeSecs };
    const sr         = buffer.sampleRate;
    const fadeFrames = Math.max(1, Math.round(fadeSecs * sr));
    const startFrame = Math.round(loopStart * sr);
    const endFrame   = Math.min(buffer.length, Math.round(loopEnd * sr));

    const copy = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = copy.getChannelData(c);
      dst.set(src); // copy all samples

      // Fade-in ENDING at loopStart (0 → 1 over fadeFrames).
      // Frames [startFrame - fadeFrames … startFrame - 1]: ramp 0 → ~1.
      // Frame startFrame (= loopStart, beat 1): untouched → full amplitude.
      // On initial source.start(t, loopStart) the reader begins at startFrame —
      // the kick (or whatever is on beat 1) hits at 100% immediately.
      for (let i = 0; i < fadeFrames; i++) {
        const fi = startFrame - fadeFrames + i;
        if (fi >= 0) dst[fi]! *= i / fadeFrames;
      }

      // Fade-out at loopEnd (1 → 0 over fadeFrames).
      // fi counts DOWN from endFrame-1: the LAST sample (endFrame-1) gets
      // multiplied by 0 (silent), so on loop-wrap the source rewinds to
      // wrapStart (in the 0→1 ramp region) — fully click-free.
      for (let i = 0; i < fadeFrames; i++) {
        const fi = endFrame - 1 - i;
        if (fi >= 0) dst[fi]! *= i / fadeFrames;
      }
    }
    return { fadedBuffer: copy, fadeSecs };
  }
}

export const loopPlayerEngine = new LoopPlayerEngine();
