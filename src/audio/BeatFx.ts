/**
 * BeatFxManager — 6 hold-to-activate master effects for the Beat FX sidebar.
 *
 * Call connect() once after AudioEngine initialises.
 * Call startEffect(id) on pointerdown, stopEffect(id) on pointerup/pointercancel.
 * Call setParam(id, key, value) when the user moves a mini-slider (value 0–1 normalised).
 */
import { audioEngine } from './AudioEngine';

export type BeatFxId = 'throw' | 'spiral' | 'echo' | 'freeze' | 'choke' | 'noise';

export interface BeatFxParams {
  throwSize: number;      // 0–1 → reverb decay 0.5s–6s, default 0.6
  spiralSpeed: number;    // 0–1 → LFO 0.2–8 Hz, default 0.4
  echoFeedback: number;   // 0–1 → delay feedback 0.5–0.92, default 0.65
  freezeLength: number;   // 0–1 → capture 10–200 ms, default 0.3
  chokeFreq: number;      // 0–1 → LPF target 80–2000 Hz, default 0.2
  noiseVol: number;       // 0–1 → noise gain, default 0.35
  noiseCut: number;       // 0–1 → noise LPF 200–20000 Hz, default 0.8
}

class BeatFxManager {
  private _ctx: AudioContext | null = null;
  private _active: BeatFxId | null = null;
  params: BeatFxParams = {
    throwSize: 0.6,
    spiralSpeed: 0.4,
    echoFeedback: 0.65,
    freezeLength: 0.3,
    chokeFreq: 0.2,
    noiseVol: 0.35,
    noiseCut: 0.8,
  };

  // THROW state
  private _throwPreLevel = 0;
  private _throwPreSize = 1.0;

  // ECHO state
  private _echoPreFeedback = 0.4;
  private _echoRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Nodes created on connect() — populated in Tasks 3–5 ─────────────────
  // SPIRAL
  _spiralDry: GainNode | null = null;
  _spiralWet: GainNode | null = null;
  _spiralDelay: DelayNode | null = null;
  _spiralFeedback: GainNode | null = null;
  _spiralLfo: OscillatorNode | null = null;
  _spiralLfoGain: GainNode | null = null;
  // FREEZE
  _freezeRingBuffer: Float32Array | null = null;
  _freezeRingPos = 0;
  _freezeCaptureSamples = 0;
  _freezeRingTimer: ReturnType<typeof setInterval> | null = null;
  _freezeSource: AudioBufferSourceNode | null = null;
  _freezeGain: GainNode | null = null;
  // NOISE
  _noiseSource: AudioBufferSourceNode | null = null;
  _noiseGain: GainNode | null = null;
  _noiseFilter: BiquadFilterNode | null = null;

  /** Call once after AudioEngine.init() succeeds */
  connect(): void {
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;
    this._ctx = ctx;
    this._buildSpiral(ctx);
    this._buildNoise(ctx);
    this._buildFreeze(ctx);
  }

  get activeEffect(): BeatFxId | null { return this._active; }

  startEffect(id: BeatFxId): void {
    if (this._active && this._active !== id) this.stopEffect(this._active);
    this._active = id;
    switch (id) {
      case 'throw':  this._startThrow(); break;
      case 'echo':   this._startEcho(); break;
      case 'choke':  this._startChoke(); break;
      case 'spiral': this._startSpiral(); break;
      case 'freeze': this._startFreeze(); break;
      case 'noise':  this._startNoise(); break;
    }
  }

  stopEffect(id: BeatFxId): void {
    if (this._active === id) this._active = null;
    switch (id) {
      case 'throw':  this._stopThrow(); break;
      case 'echo':   this._stopEcho(); break;
      case 'choke':  this._stopChoke(); break;
      case 'spiral': this._stopSpiral(); break;
      case 'freeze': this._stopFreeze(); break;
      case 'noise':  this._stopNoise(); break;
    }
  }

  setParam(id: BeatFxId, key: keyof BeatFxParams, value: number): void {
    (this.params as unknown as Record<string, number>)[key] = value;
    // Apply live if effect is active
    if (this._active !== id) return;
    if (id === 'choke') {
      const filter = audioEngine.getChokeFilter();
      if (filter && this._ctx) {
        const targetHz = 80 + value * 1920; // 0→80Hz, 1→2000Hz
        filter.frequency.setTargetAtTime(targetHz, this._ctx.currentTime, 0.02);
      }
    }
    if (id === 'noise') {
      if (this._noiseGain && this._ctx) {
        this._noiseGain.gain.setTargetAtTime(value * 0.8, this._ctx.currentTime, 0.02);
      }
      if (this._noiseFilter && this._ctx) {
        const cutHz = 200 + this.params.noiseCut * 19800;
        this._noiseFilter.frequency.setTargetAtTime(cutHz, this._ctx.currentTime, 0.02);
      }
    }
  }

  // ── THROW ─────────────────────────────────────────────────────────────

  private _startThrow(): void {
    this._throwPreLevel = audioEngine.getReverbLevel();
    this._throwPreSize = 0.5 + this.params.throwSize * 5.5; // 0.5–6s
    audioEngine.setReverbSize(this._throwPreSize);
    audioEngine.setReverbLevelSmooth(1.0, 0.08);
  }

  private _stopThrow(): void {
    audioEngine.setReverbLevelSmooth(this._throwPreLevel, 0.5);
  }

  // ── ECHO ──────────────────────────────────────────────────────────────

  private _startEcho(): void {
    if (this._echoRestoreTimer) { clearTimeout(this._echoRestoreTimer); this._echoRestoreTimer = null; }
    const fbGain = audioEngine.getDelayFeedbackGain();
    if (!fbGain || !this._ctx) return;
    this._echoPreFeedback = fbGain.gain.value;
    const target = 0.5 + this.params.echoFeedback * 0.42; // 0.5–0.92
    fbGain.gain.cancelScheduledValues(this._ctx.currentTime);
    fbGain.gain.setValueAtTime(fbGain.gain.value, this._ctx.currentTime);
    fbGain.gain.linearRampToValueAtTime(target, this._ctx.currentTime + 0.1);
  }

  private _stopEcho(): void {
    const fbGain = audioEngine.getDelayFeedbackGain();
    if (!fbGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    fbGain.gain.cancelScheduledValues(now);
    fbGain.gain.setValueAtTime(fbGain.gain.value, now);
    // Ramp to 0 so echoes die out, then restore pre-press level
    fbGain.gain.linearRampToValueAtTime(0, now + 0.3);
    const restore = this._echoPreFeedback;
    this._echoRestoreTimer = setTimeout(() => {
      const fbNow = audioEngine.getDelayFeedbackGain();
      if (fbNow) fbNow.gain.value = restore;
    }, 2500);
  }

  // Stubs for tasks 3–5 (filled in later tasks)
  private _buildSpiral(_ctx: AudioContext): void {}
  private _buildNoise(_ctx: AudioContext): void {}
  private _buildFreeze(_ctx: AudioContext): void {}
  private _startChoke(): void {}
  private _stopChoke(): void {}
  private _startSpiral(): void {}
  private _stopSpiral(): void {}
  private _startFreeze(): void {}
  private _stopFreeze(): void {}
  private _startNoise(): void {}
  private _stopNoise(): void {}
}

export const beatFxManager = new BeatFxManager();
