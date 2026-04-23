/**
 * Sampler Engine — MPC/Ableton-style 16-pad sampler
 *
 * Architecture per pad:
 *   source → [filter] → envGain → panner → masterGain
 *
 * Features:
 *   - One-shot / Gate / Loop play modes
 *   - Reverse playback
 *   - Start/end point trimming
 *   - ADSR envelope
 *   - Per-pad choke groups (1-8)
 *   - Low-pass / High-pass filter with resonance
 *   - Pitch (semitone + fine cents) via playbackRate
 *   - Velocity-sensitive gain
 */

export interface SamplerPadParams {
  volume: number;          // 0–1, default 0.8
  pan: number;             // -1–+1, default 0
  pitch: number;           // semitones, -24–+24, default 0
  fine: number;            // cents, -100–+100, default 0
  attack: number;          // seconds, 0.001–2, default 0.005
  decay: number;           // seconds, 0.001–2, default 0.1
  sustain: number;         // 0–1, default 1.0
  release: number;         // seconds, 0.001–4, default 0.1
  startPoint: number;      // 0–1, default 0
  endPoint: number;        // 0–1, default 1
  loopStart: number;       // 0–1, default 0
  loopEnd: number;         // 0–1, default 1
  playMode: "oneshot" | "gate" | "loop";
  reverse: boolean;
  chokeGroup: number;      // 0=no choke, 1–8=group
  filterType: "off" | "lowpass" | "highpass";
  filterCutoff: number;    // Hz
  filterResonance: number; // 0–1
}

export const DEFAULT_PAD_PARAMS: SamplerPadParams = {
  volume: 0.8,
  pan: 0,
  pitch: 0,
  fine: 0,
  attack: 0.005,
  decay: 0.1,
  sustain: 1.0,
  release: 0.1,
  startPoint: 0,
  endPoint: 1,
  loopStart: 0,
  loopEnd: 1,
  playMode: "oneshot",
  reverse: false,
  chokeGroup: 0,
  filterType: "off",
  filterCutoff: 2000,
  filterResonance: 0,
};

const PAD_COUNT = 16;

/** Create a reversed copy of an AudioBuffer */
function reverseBuffer(ctx: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = reversed.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[src.length - 1 - i]!;
    }
  }
  return reversed;
}

export class SamplerEngine {
  private ctx: AudioContext | null = null;
  private output: GainNode | null = null;

  // Per-pad state
  private activeSources: (AudioBufferSourceNode | null)[] = new Array(PAD_COUNT).fill(null);
  private activeGains: (GainNode | null)[] = new Array(PAD_COUNT).fill(null);

  // Choke group tracking: chokeGroup → set of padIndexes currently playing
  private chokeGroups: Map<number, Set<number>> = new Map();

  init(ctx: AudioContext): void {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.85;
    // Caller connects output to destination/channel
  }

  /**
   * Trigger a pad sample.
   * @param padIndex - 0-based pad index (0–15)
   * @param buffer - decoded AudioBuffer to play
   * @param params - pad parameters
   * @param velocity - 0–1 velocity
   * @param time - AudioContext time to schedule at
   */
  trigger(
    padIndex: number,
    buffer: AudioBuffer,
    params: SamplerPadParams,
    velocity: number,
    time: number,
  ): void {
    if (!this.ctx || !this.output) return;

    const ctx = this.ctx;

    // ── Choke: kill other pads in same choke group ──
    if (params.chokeGroup > 0) {
      const group = this.chokeGroups.get(params.chokeGroup);
      if (group) {
        for (const otherPad of Array.from(group)) {
          if (otherPad !== padIndex) {
            this._chopePad(otherPad, time);
          }
        }
      }
    }

    // ── Stop existing source on this pad ──
    this._stopPad(padIndex, time);

    // ── Optionally reverse the buffer ──
    const playBuffer = params.reverse ? reverseBuffer(ctx, buffer) : buffer;

    // ── Create source node ──
    const source = ctx.createBufferSource();
    source.buffer = playBuffer;

    // ── Pitch: combine semitones + cents ──
    const pitchRatio = Math.pow(2, (params.pitch + params.fine / 100) / 12);
    source.playbackRate.value = pitchRatio;

    // ── Build signal chain: source → [filter] → envGain → panner → output ──
    let chainInput: AudioNode = source;

    // Optional filter
    if (params.filterType !== "off") {
      const filter = ctx.createBiquadFilter();
      filter.type = params.filterType === "lowpass" ? "lowpass" : "highpass";
      filter.frequency.value = Math.max(20, Math.min(20000, params.filterCutoff));
      filter.Q.value = params.filterResonance * 20; // 0–20 Q range
      source.connect(filter);
      chainInput = filter;
    }

    // Envelope gain (ADSR)
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0, time);

    // Attack
    envGain.gain.linearRampToValueAtTime(velocity * params.volume, time + params.attack);

    // Decay to sustain
    if (params.decay > 0) {
      envGain.gain.setTargetAtTime(
        velocity * params.volume * params.sustain,
        time + params.attack,
        params.decay / 3,
      );
    }

    // Panner
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, params.pan));

    // Connect chain
    chainInput.connect(envGain);
    envGain.connect(panner);
    panner.connect(this.output);

    // ── Start/End points ──
    const duration = playBuffer.duration;
    const startOffset = params.startPoint * duration;
    const endOffset = params.endPoint * duration;
    const playDuration = Math.max(0.001, endOffset - startOffset);

    // ── Loop mode ──
    if (params.playMode === "loop") {
      source.loop = true;
      source.loopStart = params.loopStart * duration;
      source.loopEnd = params.loopEnd * duration;
      source.start(time, startOffset); // No duration limit for loop
    } else {
      source.loop = false;
      source.start(time, startOffset, playDuration);
    }

    // ── For oneshot: schedule auto-release after playDuration ──
    if (params.playMode === "oneshot") {
      const releaseStart = time + playDuration - Math.min(params.release, playDuration * 0.5);
      envGain.gain.setTargetAtTime(0, Math.max(time, releaseStart), params.release / 3);
    }

    // ── Store active nodes ──
    this.activeSources[padIndex] = source;
    this.activeGains[padIndex] = envGain;

    // ── Track in choke group ──
    if (params.chokeGroup > 0) {
      if (!this.chokeGroups.has(params.chokeGroup)) {
        this.chokeGroups.set(params.chokeGroup, new Set());
      }
      this.chokeGroups.get(params.chokeGroup)!.add(padIndex);
    }

    // ── Cleanup on ended ──
    source.onended = () => {
      if (this.activeSources[padIndex] === source) {
        this.activeSources[padIndex] = null;
        this.activeGains[padIndex] = null;
      }
      if (params.chokeGroup > 0) {
        this.chokeGroups.get(params.chokeGroup)?.delete(padIndex);
      }
    };
  }

  /**
   * Release a pad (for gate mode: ramp envelope to 0 over release time).
   */
  release(padIndex: number, time: number): void {
    const envGain = this.activeGains[padIndex];
    const source = this.activeSources[padIndex];
    if (!envGain || !source || !this.ctx) return;

    // Read params from context — we don't store params here, so use a short default release
    // The release time must be passed by the caller or we use a short default
    const releaseTime = 0.1;
    envGain.gain.cancelScheduledValues(time);
    envGain.gain.setTargetAtTime(0, time, releaseTime / 3);
    try {
      source.stop(time + releaseTime + 0.05);
    } catch {
      // Already stopped
    }
  }

  /**
   * Release a pad with an explicit release time.
   */
  releaseWithTime(padIndex: number, time: number, releaseTime: number): void {
    const envGain = this.activeGains[padIndex];
    const source = this.activeSources[padIndex];
    if (!envGain || !source || !this.ctx) return;

    envGain.gain.cancelScheduledValues(time);
    envGain.gain.setTargetAtTime(0, time, releaseTime / 3);
    try {
      source.stop(time + releaseTime + 0.05);
    } catch {
      // Already stopped
    }
  }

  /** Stop all pads, ramp master gain to 0 briefly then restore */
  stopAll(): void {
    if (!this.ctx || !this.output) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < PAD_COUNT; i++) {
      this._stopPad(i, now);
    }
    this.chokeGroups.clear();
  }

  getOutput(): GainNode | null {
    return this.output;
  }

  destroy(): void {
    this.stopAll();
    this.output = null;
    this.ctx = null;
  }

  // ── Private helpers ──────────────────────────────────────

  /** Abruptly stop a pad (for choke — very fast fade) */
  private _chopePad(padIndex: number, time: number): void {
    const envGain = this.activeGains[padIndex];
    const source = this.activeSources[padIndex];
    if (!envGain || !source) return;

    envGain.gain.cancelScheduledValues(time);
    envGain.gain.setTargetAtTime(0, time, 0.001); // 3ms choke
    try {
      source.stop(time + 0.02);
    } catch {
      // Already stopped
    }
    this.activeSources[padIndex] = null;
    this.activeGains[padIndex] = null;
  }

  /** Stop pad immediately */
  private _stopPad(padIndex: number, time: number): void {
    const source = this.activeSources[padIndex];
    const envGain = this.activeGains[padIndex];
    if (source) {
      if (envGain) {
        envGain.gain.cancelScheduledValues(time);
        envGain.gain.setValueAtTime(0, time);
      }
      try {
        source.stop(time);
      } catch {
        // Already stopped
      }
    }
    this.activeSources[padIndex] = null;
    this.activeGains[padIndex] = null;
  }
}

export const samplerEngine = new SamplerEngine();
