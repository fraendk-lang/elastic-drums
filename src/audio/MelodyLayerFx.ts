/**
 * Melody Layer Space FX — Shimmer Reverb + Freeze
 *
 * Both effects are parallel sends from the layer engine output,
 * so the dry mixer path (channel 24–26) remains unchanged.
 *
 * Shimmer: bright feedback reverb — simulates octave-up pitch shimmer
 * Freeze:  short feedback delay loop — sustains recent audio as a drone
 */

// ─── Shimmer IR ──────────────────────────────────────────────────────────────

/**
 * Synthetically generate a long, bright reverb impulse response.
 * Uses exponential noise decay with L/R decorrelation for width.
 * The IR is biased toward high frequencies to give the reverb
 * its characteristic bright, shimmering character.
 */
function createShimmerIR(ctx: AudioContext, durationSec = 4.5): AudioBuffer {
  const frames = Math.floor(durationSec * ctx.sampleRate);
  const buf = ctx.createBuffer(2, frames, ctx.sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // Slightly different decay per channel → stereo spread
    const decayRate = ch === 0 ? 0.65 : 0.72;
    for (let i = 0; i < frames; i++) {
      const t = i / ctx.sampleRate;
      const decay = Math.exp(-t * decayRate);
      // Build reverb density over first 80ms (sparse early reflections)
      const density = Math.min(1, t * 12);
      // Gaussian-like noise (3 uniform → ~bell curve, better density simulation)
      const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 0.67;
      data[i] = noise * decay * density;
    }
  }

  // Normalize to 0 dBFS with slight headroom
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    for (const s of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(s));
  }
  if (peak > 0) {
    const scale = 1 / (peak * 1.3);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < frames; i++) { data[i]! *= scale; }
    }
  }
  return buf;
}

// ─── FX Chain ────────────────────────────────────────────────────────────────

export class MelodyLayerFxChain {
  private ctx: AudioContext;

  // ── Shimmer ──────────────────────────────────────────────────────
  // Chain: source → inputGain → HP filter → convolver → wetGain → out → master
  //                                 ↑ ←←← fbDelay ←←← fbHS ←←← fbGain ←←←↑
  private shimmerInputGain: GainNode;
  private shimmerHP: BiquadFilterNode;
  private shimmerConvolver: ConvolverNode;
  private shimmerWetGain: GainNode;
  private shimmerFbGain: GainNode;
  private shimmerFbHS: BiquadFilterNode;
  private shimmerFbDelay: DelayNode;
  private shimmerOut: GainNode;

  // ── Freeze ───────────────────────────────────────────────────────
  // Chain: source → inputGain → delay → LP → fbGain → (loop) + out → master
  private freezeInputGain: GainNode;
  private freezeDelay: DelayNode;
  private freezeLP: BiquadFilterNode;
  private freezeFbGain: GainNode;
  private freezeOut: GainNode;

  private _shimmerEnabled = false;
  private _freezeActive = false;

  constructor(ctx: AudioContext, masterIn: AudioNode) {
    this.ctx = ctx;

    // ── Build shimmer chain ───────────────────────────────────────
    this.shimmerInputGain = ctx.createGain();
    this.shimmerInputGain.gain.value = 0; // off until enabled

    this.shimmerHP = ctx.createBiquadFilter();
    this.shimmerHP.type = "highpass";
    this.shimmerHP.frequency.value = 600; // shimmer lives in the highs
    this.shimmerHP.Q.value = 0.5;

    this.shimmerConvolver = ctx.createConvolver();
    this.shimmerConvolver.buffer = createShimmerIR(ctx);

    this.shimmerWetGain = ctx.createGain();
    this.shimmerWetGain.gain.value = 0.7;

    // Feedback: brightens every pass → simulates octave-up re-injection
    this.shimmerFbGain = ctx.createGain();
    this.shimmerFbGain.gain.value = 0; // off until enabled

    this.shimmerFbHS = ctx.createBiquadFilter();
    this.shimmerFbHS.type = "highshelf";
    this.shimmerFbHS.frequency.value = 1800;
    this.shimmerFbHS.gain.value = 6; // +6 dB per pass → highs accumulate = shimmer

    this.shimmerFbDelay = ctx.createDelay(1.0);
    this.shimmerFbDelay.delayTime.value = 0.08; // 80 ms pre-delay in feedback

    this.shimmerOut = ctx.createGain();
    this.shimmerOut.gain.value = 1.0;

    // Wire shimmer
    this.shimmerInputGain.connect(this.shimmerHP);
    this.shimmerHP.connect(this.shimmerConvolver);
    this.shimmerConvolver.connect(this.shimmerWetGain);
    this.shimmerWetGain.connect(this.shimmerOut);
    this.shimmerOut.connect(masterIn);

    // Feedback loop (brightness accumulates each pass)
    this.shimmerConvolver.connect(this.shimmerFbGain);
    this.shimmerFbGain.connect(this.shimmerFbHS);
    this.shimmerFbHS.connect(this.shimmerFbDelay);
    this.shimmerFbDelay.connect(this.shimmerConvolver);

    // ── Build freeze chain ────────────────────────────────────────
    this.freezeInputGain = ctx.createGain();
    this.freezeInputGain.gain.value = 0; // off until activated

    // Short loop time = washy, ambiguous freeze cloud
    this.freezeDelay = ctx.createDelay(4.0);
    this.freezeDelay.delayTime.value = 0.35;

    this.freezeLP = ctx.createBiquadFilter();
    this.freezeLP.type = "lowpass";
    this.freezeLP.frequency.value = 3200; // prevent harmonic buildup / screech

    this.freezeFbGain = ctx.createGain();
    this.freezeFbGain.gain.value = 0; // off until activated

    this.freezeOut = ctx.createGain();
    this.freezeOut.gain.value = 0.85;

    // Wire freeze
    this.freezeInputGain.connect(this.freezeDelay);
    this.freezeDelay.connect(this.freezeLP);
    this.freezeLP.connect(this.freezeFbGain);
    this.freezeFbGain.connect(this.freezeDelay); // loop
    this.freezeDelay.connect(this.freezeOut);    // also to output
    this.freezeOut.connect(masterIn);
  }

  /** Tap the layer engine output into both effect chains */
  connectSource(source: AudioNode): void {
    source.connect(this.shimmerInputGain);
    source.connect(this.freezeInputGain);
  }

  // ── Shimmer API ───────────────────────────────────────────────────

  enableShimmer(depth: number, feedback: number): void {
    this._shimmerEnabled = true;
    const now = this.ctx.currentTime;
    this.shimmerInputGain.gain.setTargetAtTime(Math.max(0, depth), now, 0.04);
    // Cap feedback at 0.62 — above that the loop can self-oscillate
    this.shimmerFbGain.gain.setTargetAtTime(Math.min(0.62, feedback), now, 0.04);
  }

  disableShimmer(): void {
    this._shimmerEnabled = false;
    const now = this.ctx.currentTime;
    this.shimmerInputGain.gain.setTargetAtTime(0, now, 0.25); // gradual close
    this.shimmerFbGain.gain.setTargetAtTime(0, now, 0.6);     // let tail ring out
  }

  setShimmerDepth(depth: number): void {
    if (!this._shimmerEnabled) return;
    this.shimmerInputGain.gain.setTargetAtTime(Math.max(0, depth), this.ctx.currentTime, 0.02);
  }

  setShimmerFeedback(fb: number): void {
    if (!this._shimmerEnabled) return;
    this.shimmerFbGain.gain.setTargetAtTime(Math.min(0.62, fb), this.ctx.currentTime, 0.02);
  }

  // ── Freeze API ────────────────────────────────────────────────────

  activateFreeze(): void {
    if (this._freezeActive) return;
    this._freezeActive = true;
    const now = this.ctx.currentTime;
    this.freezeInputGain.gain.setValueAtTime(1.0, now);
    // Ramp feedback to near-unity — slight loss per loop prevents DC buildup
    this.freezeFbGain.gain.setTargetAtTime(0.93, now, 0.04);
  }

  deactivateFreeze(): void {
    if (!this._freezeActive) return;
    this._freezeActive = false;
    const now = this.ctx.currentTime;
    // Close input — freeze what's captured in the buffer
    this.freezeInputGain.gain.setTargetAtTime(0, now, 0.02);
    // Feedback decays naturally: 0.93^N → 0 over ~3 s
    this.freezeFbGain.gain.setTargetAtTime(0, now, 1.1);
  }

  get shimmerEnabled(): boolean { return this._shimmerEnabled; }
  get freezeActive(): boolean   { return this._freezeActive; }

  destroy(): void {
    try { this.shimmerOut.disconnect(); } catch { /* ok */ }
    try { this.freezeOut.disconnect(); } catch { /* ok */ }
  }
}

// ─── Singleton array (one chain per layer slot, indices 0–2) ─────────────────

export const melodyLayerFxChains: MelodyLayerFxChain[] = [];

export function initMelodyLayerFx(ctx: AudioContext, masterIn: AudioNode): void {
  if (melodyLayerFxChains.length > 0) return; // idempotent
  for (let i = 0; i < 3; i++) {
    melodyLayerFxChains.push(new MelodyLayerFxChain(ctx, masterIn));
  }
}

// ─── Singleton for the main melody engine (PerformancePad target, Channel 14) ─

let _melodyEngineFxChain: MelodyLayerFxChain | null = null;

export function initMelodyEngineFx(ctx: AudioContext, masterIn: AudioNode): MelodyLayerFxChain {
  if (_melodyEngineFxChain) return _melodyEngineFxChain;
  _melodyEngineFxChain = new MelodyLayerFxChain(ctx, masterIn);
  return _melodyEngineFxChain;
}

export function getMelodyEngineFxChain(): MelodyLayerFxChain | null {
  return _melodyEngineFxChain;
}
