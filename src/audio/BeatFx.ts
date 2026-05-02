/**
 * BeatFxManager — 6 hold-to-activate master effects for the Beat FX sidebar.
 *
 * Call connect() once after AudioEngine initialises.
 * Call startEffect(id) on pointerdown, stopEffect(id) on pointerup/pointercancel.
 * Call setParam(id, key, value) when slider changes (0–1 normalised).
 *
 * Effects:
 *   THROW   — Reverb flood: wet ramps to 100%, tails out naturally on release
 *   ECHO    — Delay flood: feedback ramps high, echoes die on release
 *   CHOKE   — LP filter sweep: closes dark on press, opens on release
 *   NOISE   — White noise wash: ramps in/out cleanly
 *   STUTTER — Rhythmic gain gating: stutter/gate effect
 *   ROLL    — Short delay loop: last N ms loop while held
 */
import { audioEngine } from './AudioEngine';

export type BeatFxId = 'throw' | 'echo' | 'choke' | 'noise' | 'stutter' | 'roll';

export interface BeatFxParams {
  throwSize: number;    // 0–1 (reverb size 2–6s), default 0.6
  echoFeedback: number; // 0–1 → 0.5–0.92 feedback, default 0.65
  chokeFreq: number;    // 0–1 → 80–2000 Hz target, default 0.2
  noiseVol: number;     // 0–1 → noise level, default 0.35
  noiseCut: number;     // 0–1 → LP 200–20000 Hz, default 0.8
  stutterRate: number;  // 0–1 → fast↔slow (40–200ms interval), default 0.5
  rollLength: number;   // 0–1 → 25–200ms delay time, default 0.3
}

class BeatFxManager {
  private _ctx: AudioContext | null = null;
  private _active: BeatFxId | null = null;

  params: BeatFxParams = {
    throwSize: 0.6,
    echoFeedback: 0.65,
    chokeFreq: 0.2,
    noiseVol: 0.35,
    noiseCut: 0.8,
    stutterRate: 0.5,
    rollLength: 0.3,
  };

  // THROW state
  private _throwPreLevel = 0;
  private _throwDidStart = false;

  // ECHO state
  private _echoPreFeedback: number | null = null;
  private _echoRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  // NOISE nodes (built once on connect)
  private _noiseSource: AudioBufferSourceNode | null = null;
  private _noiseGain: GainNode | null = null;
  private _noiseFilter: BiquadFilterNode | null = null;

  // ROLL nodes (built once on connect)
  private _rollDelay: DelayNode | null = null;
  private _rollFeedback: GainNode | null = null;
  private _rollWet: GainNode | null = null;

  /** Call once after AudioEngine.init() succeeds. Safe to call multiple times. */
  connect(): void {
    const ctx = audioEngine.getAudioContext();
    if (!ctx || this._ctx) return;
    this._ctx = ctx;
    this._buildNoise(ctx);
    this._buildRoll(ctx);
  }

  get activeEffect(): BeatFxId | null { return this._active; }

  startEffect(id: BeatFxId): void {
    if (this._active && this._active !== id) this.stopEffect(this._active);
    this._active = id;
    switch (id) {
      case 'throw':   this._startThrow(); break;
      case 'echo':    this._startEcho(); break;
      case 'choke':   this._startChoke(); break;
      case 'noise':   this._startNoise(); break;
      case 'stutter': this._startStutter(); break;
      case 'roll':    this._startRoll(); break;
    }
  }

  stopEffect(id: BeatFxId): void {
    if (this._active === id) this._active = null;
    switch (id) {
      case 'throw':   this._stopThrow(); break;
      case 'echo':    this._stopEcho(); break;
      case 'choke':   this._stopChoke(); break;
      case 'noise':   this._stopNoise(); break;
      case 'stutter': this._stopStutter(); break;
      case 'roll':    this._stopRoll(); break;
    }
  }

  /** Apply live param changes while an effect is held. */
  setParam(id: BeatFxId, key: keyof BeatFxParams, value: number): void {
    (this.params as unknown as Record<string, number>)[key] = value;
    if (this._active !== id || !this._ctx) return;
    const now = this._ctx.currentTime;
    if (id === 'choke' && key === 'chokeFreq') {
      audioEngine.getChokeFilter()?.frequency.setTargetAtTime(80 + value * 1920, now, 0.02);
    }
    if (id === 'noise') {
      if (key === 'noiseVol') this._noiseGain?.gain.setTargetAtTime(value * 0.8, now, 0.02);
      if (key === 'noiseCut') this._noiseFilter?.frequency.setTargetAtTime(200 + value * 19800, now, 0.02);
    }
  }

  // ── THROW — Reverb flood ───────────────────────────────────────────────

  private _startThrow(): void {
    this._throwPreLevel = audioEngine.getReverbLevel();
    this._throwDidStart = true;
    audioEngine.setReverbSize(2 + this.params.throwSize * 4); // 2–6s
    audioEngine.setReverbLevelSmooth(1.0, 0.08);
  }

  private _stopThrow(): void {
    if (!this._throwDidStart) return;
    this._throwDidStart = false;
    audioEngine.setReverbLevelSmooth(this._throwPreLevel, 0.5);
    audioEngine.setReverbSize(2.5); // restore neutral size
  }

  // ── ECHO — Delay feedback flood ────────────────────────────────────────

  private _startEcho(): void {
    if (this._echoRestoreTimer) {
      clearTimeout(this._echoRestoreTimer);
      this._echoRestoreTimer = null;
    }
    const fbGain = audioEngine.getDelayFeedbackGain();
    if (!fbGain || !this._ctx) return;
    if (this._echoPreFeedback === null) {
      this._echoPreFeedback = fbGain.gain.value;
    }
    const target = 0.5 + this.params.echoFeedback * 0.42; // 0.5–0.92
    const now = this._ctx.currentTime;
    fbGain.gain.cancelScheduledValues(now);
    fbGain.gain.setValueAtTime(fbGain.gain.value, now);
    fbGain.gain.linearRampToValueAtTime(target, now + 0.1);
  }

  private _stopEcho(): void {
    const fbGain = audioEngine.getDelayFeedbackGain();
    if (!fbGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    fbGain.gain.cancelScheduledValues(now);
    fbGain.gain.setValueAtTime(fbGain.gain.value, now);
    fbGain.gain.linearRampToValueAtTime(0, now + 0.4);
    const restore = this._echoPreFeedback ?? 0.35;
    this._echoRestoreTimer = setTimeout(() => {
      const fb = audioEngine.getDelayFeedbackGain();
      if (fb) fb.gain.value = restore;
      this._echoPreFeedback = null;
      this._echoRestoreTimer = null;
    }, 2500);
  }

  // ── CHOKE — LP filter sweep ────────────────────────────────────────────

  private _startChoke(): void {
    const filter = audioEngine.getChokeFilter();
    if (!filter || !this._ctx) return;
    const targetHz = 80 + this.params.chokeFreq * 1920;
    const now = this._ctx.currentTime;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(20000, now);
    filter.frequency.linearRampToValueAtTime(targetHz, now + 0.18);
  }

  private _stopChoke(): void {
    const filter = audioEngine.getChokeFilter();
    if (!filter || !this._ctx) return;
    const now = this._ctx.currentTime;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.linearRampToValueAtTime(20000, now + 0.1);
  }

  // ── NOISE — White noise wash ───────────────────────────────────────────

  private _buildNoise(ctx: AudioContext): void {
    const pump = audioEngine.getPumpGain();
    if (!pump) return;

    const bufLen = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    this._noiseSource = ctx.createBufferSource();
    this._noiseSource.buffer = noiseBuf;
    this._noiseSource.loop = true;
    this._noiseSource.start();

    this._noiseFilter = ctx.createBiquadFilter();
    this._noiseFilter.type = 'lowpass';
    this._noiseFilter.frequency.value = 200 + this.params.noiseCut * 19800;

    this._noiseGain = ctx.createGain();
    this._noiseGain.gain.value = 0;

    this._noiseSource.connect(this._noiseFilter);
    this._noiseFilter.connect(this._noiseGain);
    this._noiseGain.connect(pump);
  }

  private _startNoise(): void {
    if (!this._noiseGain || !this._noiseFilter || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._noiseFilter.frequency.setValueAtTime(200 + this.params.noiseCut * 19800, now);
    this._noiseGain.gain.cancelScheduledValues(now);
    this._noiseGain.gain.setValueAtTime(0, now);
    this._noiseGain.gain.linearRampToValueAtTime(this.params.noiseVol * 0.8, now + 0.08);
  }

  private _stopNoise(): void {
    if (!this._noiseGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._noiseGain.gain.cancelScheduledValues(now);
    this._noiseGain.gain.setValueAtTime(this._noiseGain.gain.value, now);
    this._noiseGain.gain.linearRampToValueAtTime(0, now + 0.06);
  }

  // ── STUTTER — Rhythmic gain gating ────────────────────────────────────
  // Schedules rapid on/off on pumpGain. Cancelled cleanly on release.

  private _startStutter(): void {
    const pump = audioEngine.getPumpGain();
    if (!pump || !this._ctx) return;
    const now = this._ctx.currentTime;
    // stutterRate 0→1: slow (200ms) → fast (40ms)
    const interval = 0.04 + (1 - this.params.stutterRate) * 0.16;
    const fade = Math.min(0.004, interval * 0.05); // 4ms anti-click fade, max 5% of interval
    const silenceEnd = interval * 0.28; // 28% silence duty
    const steps = Math.ceil(4 / interval);
    // Start from current value so first cycle doesn't click
    pump.gain.cancelScheduledValues(now);
    pump.gain.setValueAtTime(pump.gain.value, now);
    for (let i = 0; i < steps; i++) {
      const t = now + i * interval;
      // Fade up at cycle start (from 0 for i>0, from current for i=0)
      pump.gain.linearRampToValueAtTime(1, t + fade);
      // Hold at 1 until silence point
      pump.gain.setValueAtTime(1, t + silenceEnd);
      // Fade down into silence
      pump.gain.linearRampToValueAtTime(0, t + silenceEnd + fade);
      // Silence holds until next cycle's fade-up
      pump.gain.setValueAtTime(0, t + interval - fade);
    }
  }

  private _stopStutter(): void {
    const pump = audioEngine.getPumpGain();
    if (!pump || !this._ctx) return;
    pump.gain.cancelScheduledValues(this._ctx.currentTime);
    pump.gain.setValueAtTime(1, this._ctx.currentTime);
  }

  // ── ROLL — Short delay loop ────────────────────────────────────────────
  // Loops last N ms of audio while held. Stops cleanly on release.
  // Graph: pump → rollDelay ⟲ rollFeedback → rollWet → chokeFilter (downstream)
  // rollWet MUST NOT connect back to pump — that creates a runaway feedback loop.

  private _buildRoll(ctx: AudioContext): void {
    const pump = audioEngine.getPumpGain();
    const chokeFilter = audioEngine.getChokeFilter();
    if (!pump || !chokeFilter) return;

    this._rollDelay = ctx.createDelay(0.5);
    this._rollDelay.delayTime.value = 0.1;

    this._rollFeedback = ctx.createGain();
    this._rollFeedback.gain.value = 0;

    this._rollWet = ctx.createGain();
    this._rollWet.gain.value = 0;

    // Tap from pump into the delay loop
    pump.connect(this._rollDelay);
    // Internal feedback loop (self-contained, gain starts at 0)
    this._rollDelay.connect(this._rollFeedback);
    this._rollFeedback.connect(this._rollDelay);
    // Wet output goes DOWNSTREAM of pump — avoids the runaway loop
    this._rollDelay.connect(this._rollWet);
    this._rollWet.connect(chokeFilter);
  }

  private _startRoll(): void {
    if (!this._rollDelay || !this._rollFeedback || !this._rollWet || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._rollDelay.delayTime.setValueAtTime(0.025 + this.params.rollLength * 0.175, now);
    this._rollFeedback.gain.setValueAtTime(0.78, now); // < 1.0 ensures natural decay
    this._rollWet.gain.cancelScheduledValues(now);
    this._rollWet.gain.setValueAtTime(0, now);
    this._rollWet.gain.linearRampToValueAtTime(0.75, now + 0.03);
  }

  private _stopRoll(): void {
    if (!this._rollFeedback || !this._rollWet || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._rollFeedback.gain.setValueAtTime(0, now);
    this._rollWet.gain.cancelScheduledValues(now);
    this._rollWet.gain.setValueAtTime(this._rollWet.gain.value, now);
    this._rollWet.gain.linearRampToValueAtTime(0, now + 0.15);
  }
}

export const beatFxManager = new BeatFxManager();
