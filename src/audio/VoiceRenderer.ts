/**
 * Elastic Drums Voice Renderer
 *
 * Extracted voice synthesis methods from AudioEngine.
 * Handles all 12 drum voices: Kick, Snare, Clap, Tom, HiHat, Cymbal, Perc.
 */

// ─── Interfaces ────────────────────────────────────────────────

export interface VoiceParams {
  [key: string]: number;
}

export interface VoiceParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

// ─── Voice Parameter Definitions ────────────────────────────────

export const VOICE_PARAM_DEFS: Record<number, VoiceParamDef[]> = {
  0: [ // Kick
    { id: "tune", label: "TUNE", min: 30, max: 120, default: 52 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 100, max: 1200, default: 550 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 50 },
    { id: "drive", label: "DRIVE", min: 0, max: 100, default: 40 },
    { id: "sub", label: "SUB", min: 0, max: 100, default: 60 },
    { id: "pitch", label: "PITCH", min: 20, max: 80, default: 45, step: 1 },
    { id: "fm", label: "FM", min: 0, max: 100, default: 0 },
    { id: "fmRatio", label: "RATIO", min: 0.25, max: 8, default: 2 },
  ],
  1: [ // Snare
    { id: "tune", label: "TUNE", min: 100, max: 350, default: 180 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 50, max: 500, default: 220 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 55 },
    { id: "snap", label: "SNAP", min: 0, max: 100, default: 70 },
    { id: "body", label: "BODY", min: 0, max: 100, default: 60 },
    { id: "fm", label: "FM", min: 0, max: 100, default: 0 },
    { id: "fmRatio", label: "RATIO", min: 0.25, max: 8, default: 3 },
  ],
  2: [ // Clap
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 80, max: 800, default: 350 },
    { id: "tone", label: "TONE", min: 500, max: 5000, default: 1800 },
    { id: "spread", label: "SPREAD", min: 0, max: 100, default: 50 },
    { id: "level", label: "LEVEL", min: 0, max: 150, default: 100 },
  ],
  3: [ // Tom Lo — 808 style, ~166 Hz
    { id: "tune", label: "TUNE", min: 80, max: 300, default: 166 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 80, max: 800, default: 350 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 40 },
    { id: "fm", label: "FM", min: 0, max: 100, default: 0 },
    { id: "fmRatio", label: "RATIO", min: 0.25, max: 8, default: 1.5 },
  ],
  4: [ // Tom Mid — 808 style, ~220 Hz
    { id: "tune", label: "TUNE", min: 120, max: 400, default: 220 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 60, max: 600, default: 280 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 45 },
    { id: "fm", label: "FM", min: 0, max: 100, default: 0 },
    { id: "fmRatio", label: "RATIO", min: 0.25, max: 8, default: 1.5 },
  ],
  5: [ // Tom Hi — 808 style, ~310 Hz
    { id: "tune", label: "TUNE", min: 180, max: 600, default: 310 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 40, max: 500, default: 220 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 50 },
    { id: "fm", label: "FM", min: 0, max: 100, default: 0 },
    { id: "fmRatio", label: "RATIO", min: 0.25, max: 8, default: 1.5 },
  ],
  6: [ // HH Closed
    { id: "tune", label: "TUNE", min: 200, max: 600, default: 330 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 10, max: 120, default: 45 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 60 },
  ],
  7: [ // HH Open
    { id: "tune", label: "TUNE", min: 200, max: 600, default: 330 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 50, max: 600, default: 250 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 60 },
  ],
  8: [ // Cymbal
    { id: "tune", label: "TUNE", min: 250, max: 700, default: 380 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 200, max: 2000, default: 800 },
  ],
  9: [ // Ride
    { id: "tune", label: "TUNE", min: 300, max: 800, default: 480 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "decay", label: "DECAY", min: 200, max: 2000, default: 800 },
  ],
  10: [ // Perc 1
    { id: "type", label: "TYPE", min: 0, max: 7, default: 0, step: 1 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "tune", label: "TUNE", min: 100, max: 4000, default: 800 },
    { id: "decay", label: "DECAY", min: 20, max: 800, default: 120 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 50 },
  ],
  11: [ // Perc 2
    { id: "type", label: "TYPE", min: 0, max: 7, default: 3, step: 1 },
    { id: "sampleTune", label: "TRNS", min: -24, max: 24, default: 0, step: 1 },
    { id: "tune", label: "TUNE", min: 100, max: 4000, default: 1200 },
    { id: "decay", label: "DECAY", min: 20, max: 800, default: 120 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 50 },
  ],
};

// ─── Voice Renderer Class ──────────────────────────────────────

export class VoiceRenderer {
  private voiceParams: VoiceParams[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private lastHHClosedGain: GainNode | null = null;
  private lastHHOpenGain: GainNode | null = null;
  private sampleLookup: ((voice: number, velocity?: number) => AudioBuffer | null) | null = null;

  // ─── Anti-click: track active voice output gains for fade-out on re-trigger ───
  private activeVoiceGains: (GainNode | null)[] = [];

  constructor() {
    // Initialize all voice parameters to defaults
    for (let v = 0; v < 12; v++) {
      const params: VoiceParams = {};
      const defs = VOICE_PARAM_DEFS[v] ?? [];
      for (const d of defs) {
        params[d.id] = d.default;
      }
      this.voiceParams.push(params);
      this.activeVoiceGains.push(null);
    }
  }

  // Note: Per-trigger wrapper GainNode + scheduleCleanup approach was removed
  // because it caused audio jitter. Voices connect directly to channel output. — the per-trigger wrapper GainNode
  // + cleanup timer approach caused audio jitter. Voices now connect directly to
  // the channel output. Oscillator nodes self-clean via .stop() timing.

  // ─── Voice Parameter Management ────────────────────────────

  setVoiceParam(voice: number, paramId: string, value: number): void {
    const p = this.voiceParams[voice];
    if (p) p[paramId] = value;
  }

  getVoiceParam(voice: number, paramId: string): number {
    return this.voiceParams[voice]?.[paramId] ?? 0;
  }

  getVoiceParams(voice: number): VoiceParams {
    return this.voiceParams[voice] ?? {};
  }

  // ─── Synthesis Setup ──────────────────────────────────────

  setSampleLookup(fn: (voice: number, velocity?: number) => AudioBuffer | null): void {
    this.sampleLookup = fn;
  }

  setNoiseBuffer(buffer: AudioBuffer): void {
    this.noiseBuffer = buffer;
  }

  // ─── Helper Methods ───────────────────────────────────────

  private getNoise(ctx: AudioContext, duration: number, startTime: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    // Guard: noiseBuffer may be null if AudioContext was recreated before initNoise ran
    if (this.noiseBuffer) {
      src.buffer = this.noiseBuffer;
    }
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
    return src;
  }

  playSampleAtTime(ctx: AudioContext, buffer: AudioBuffer, _voice: number, velocity: number, time: number, out: AudioNode, tune = 0): void {
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // Pitch via playbackRate (semitones)
    if (tune !== 0) {
      src.playbackRate.value = Math.pow(2, tune / 12);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(velocity * 0.8, time);

    // Auto-fade at end to prevent clicks
    const dur = buffer.duration / src.playbackRate.value;
    gain.gain.setValueAtTime(velocity * 0.8, time + dur - 0.005);
    gain.gain.linearRampToValueAtTime(0, time + dur);

    src.connect(gain);
    gain.connect(out);
    src.start(time);
  }

  private getSustainedDecay(baseDecaySec: number, gateDurationSec?: number, ceilingSec = 4): number {
    if (!gateDurationSec) return baseDecaySec;
    return Math.min(ceilingSec, Math.max(baseDecaySec, gateDurationSec * 0.92));
  }

  scheduleVoice(ctx: AudioContext, voice: number, velocity: number, t: number, out: AudioNode, gateDurationSec?: number): void {
    const p = this.voiceParams[voice] ?? {};

    // Check if this voice has a sample loaded — play sample instead of synth
    if (this.sampleLookup) {
      const buffer = this.sampleLookup(voice, velocity);
      if (buffer) {
        this.playSampleAtTime(ctx, buffer, voice, velocity, t, out, p.sampleTune ?? 0);
        return;
      }
    }

    // Route directly to channel output — no wrapper GainNode overhead
    switch (voice) {
      case 0: this.kick(ctx, t, velocity, out, p, gateDurationSec); break;
      case 1: this.snare(ctx, t, velocity, out, p, gateDurationSec); break;
      case 2: this.clap(ctx, t, velocity, out, p, gateDurationSec); break;
      case 3:
      case 4:
      case 5: this.tom(ctx, t, velocity, p.tune ?? 140, out, p, gateDurationSec); break;
      case 6:
        // Closed hat chokes open hat
        if (this.lastHHOpenGain) {
          try {
            this.lastHHOpenGain.gain.cancelScheduledValues(t);
            this.lastHHOpenGain.gain.setValueAtTime(this.lastHHOpenGain.gain.value, t);
            this.lastHHOpenGain.gain.linearRampToValueAtTime(0, t + 0.003);
          } catch { /* already disconnected */ }
          this.lastHHOpenGain = null;
        }
        this.lastHHClosedGain = this.hihat(ctx, t, velocity, true, out, p, gateDurationSec);
        break;
      case 7:
        // Open hat chokes closed hat
        if (this.lastHHClosedGain) {
          try {
            this.lastHHClosedGain.gain.cancelScheduledValues(t);
            this.lastHHClosedGain.gain.setValueAtTime(this.lastHHClosedGain.gain.value, t);
            this.lastHHClosedGain.gain.linearRampToValueAtTime(0, t + 0.003);
          } catch { /* already disconnected */ }
          this.lastHHClosedGain = null;
        }
        this.lastHHOpenGain = this.hihat(ctx, t, velocity, false, out, p, gateDurationSec);
        break;
      case 8:
      case 9: this.cymbal(ctx, t, velocity, p.tune ?? 400, out, p, gateDurationSec); break;
      case 10:
      case 11: this.perc(ctx, t, velocity, p.tune ?? 800, out, p, gateDurationSec); break;
    }
  }

  // ─── KICK ──────────────────────────────────────────────────
  // Improved 808-style: punchy attack + sophisticated pitch envelope + 2nd harmonic + phase distortion
  private kick(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams, gateDurationSec?: number): void {
    const vol = vel * 1.0;
    const baseFreq = p.tune ?? 52;
    const decaySec = this.getSustainedDecay((p.decay ?? 550) / 1000, gateDurationSec);
    const clickAmt = (p.click ?? 50) / 100;
    const driveAmt = (p.drive ?? 40) / 100;
    const subAmt = (p.sub ?? 60) / 100;
    const pitchSweep = (p.pitch ?? 45) / 10;

    // Master output with soft-clip waveshaper
    const master = ctx.createGain();
    // Clean attack envelope — no overshoot to avoid clipping
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(vol * 0.8, t + 0.001); // Fast attack, reduced level
    master.gain.setValueAtTime(vol, t + decaySec * 0.85);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    const shaper = ctx.createWaveShaper();
    if (driveAmt > 0.05) {
      const curve = new Float32Array(1024);
      const driveGain = 1 + driveAmt * 6; // Increased range
      for (let i = 0; i < 1024; i++) {
        const x = (i / 512 - 1) * driveGain;
        curve[i] = Math.tanh(x);
      }
      shaper.curve = curve;
      shaper.oversample = "4x";
    }

    // Low-shelf EQ boost for weight + slight mid cut for clarity
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.value = 100;
    eqLow.gain.value = 3; // Gentle boost (was 6dB — caused clipping)

    const eqMidCut = ctx.createBiquadFilter();
    eqMidCut.type = "peaking";
    eqMidCut.frequency.value = 300;
    eqMidCut.Q.value = 1.5;
    eqMidCut.gain.value = -3;

    shaper.connect(eqLow);
    eqLow.connect(eqMidCut);
    eqMidCut.connect(master);
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    // After decaySec the master gain is already at 0.001 (effectively silent).
    // Disconnect is safe: it removes the dead subgraph from audio graph traversal.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    // Main body oscillator — sophisticated 3-stage pitch sweep
    const osc = ctx.createOscillator();
    osc.type = "sine";
    // Start at 5x fundamental for maximum punch
    osc.frequency.setValueAtTime(baseFreq * pitchSweep * 5, t);
    // Fast exponential drop to 1.5x in 2ms
    osc.frequency.exponentialRampToValueAtTime(baseFreq * pitchSweep * 1.5, t + 0.002);
    // Slower glide down to fundamental
    osc.frequency.exponentialRampToValueAtTime(baseFreq, t + 0.020);
    osc.frequency.setTargetAtTime(baseFreq * 0.98, t + 0.020, decaySec * 0.25);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.85, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    // FM operator: modulates main osc frequency (metallic/digital Kick textures)
    const fmAmount = (p.fm ?? 0) / 100;
    if (fmAmount > 0.01) {
      const fmRatio = p.fmRatio ?? 2;
      const modOsc = ctx.createOscillator();
      modOsc.type = "sine";
      modOsc.frequency.value = baseFreq * fmRatio;
      const modGain = ctx.createGain();
      // Mod index: fmAmount * carrier freq * 3 → higher freq = more FM for same perceived brightness
      modGain.gain.setValueAtTime(fmAmount * baseFreq * 3, t);
      modGain.gain.exponentialRampToValueAtTime(0.01, t + decaySec * 0.5);
      modOsc.connect(modGain);
      modGain.connect(osc.frequency);
      modOsc.start(t);
      modOsc.stop(t + decaySec + 0.05);
    }

    osc.connect(bodyGain);
    bodyGain.connect(shaper);
    osc.start(t);
    osc.stop(t + decaySec + 0.05);

    // 2nd harmonic (octave above) — decays much faster for punch
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(baseFreq * 2 * pitchSweep * 5, t);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 2 * pitchSweep * 1.5, t + 0.001);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 2, t + 0.012);

    const harmonic2Gain = ctx.createGain();
    harmonic2Gain.gain.setValueAtTime(0.35, t);
    harmonic2Gain.gain.exponentialRampToValueAtTime(0.01, t + 0.015); // Fast decay

    osc2.connect(harmonic2Gain);
    harmonic2Gain.connect(shaper);
    osc2.start(t);
    osc2.stop(t + 0.04);

    // Sub layer — adds low-end pressure
    if (subAmt > 0.05) {
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(baseFreq * 0.5, t);
      sub.frequency.exponentialRampToValueAtTime(baseFreq * 0.35, t + 0.05);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0, t);
      subGain.gain.linearRampToValueAtTime(subAmt * 0.9, t + 0.008);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 1.3);

      sub.connect(subGain);
      subGain.connect(shaper);
      sub.start(t);
      sub.stop(t + decaySec * 1.3 + 0.05);
    }

    // Click transient — single-cycle square burst for sharper attack
    if (clickAmt > 0.05) {
      const click = this.getNoise(ctx, 0.010, t);
      const clickHpf = ctx.createBiquadFilter();
      clickHpf.type = "highpass";
      clickHpf.frequency.value = 4000;
      const clickBpf = ctx.createBiquadFilter();
      clickBpf.type = "peaking";
      clickBpf.frequency.value = 5000;
      clickBpf.Q.value = 4;
      clickBpf.gain.value = 10; // Stronger presence
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(clickAmt * 0.75, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.010);

      click.connect(clickHpf);
      clickHpf.connect(clickBpf);
      clickBpf.connect(clickGain);
      clickGain.connect(master);
    }
  }

  // ─── SNARE ─────────────────────────────────────────────────
  // Improved: 3-oscillator body + bandpass noise shaping + two-stage decay
  private snare(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams, gateDurationSec?: number): void {
    const vol = vel * 0.80;
    const tune = p.tune ?? 180;
    const decaySec = this.getSustainedDecay((p.decay ?? 220) / 1000, gateDurationSec, 2.5);
    const toneMix = (p.tone ?? 55) / 100;
    const snap = (p.snap ?? 70) / 100;
    const bodyAmt = (p.body ?? 60) / 100;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.05);
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    // Body — three oscillators at 909 ratios (fundamental, 1.5x, 2.67x)
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(tune * 1.6, t);    // Higher start for crack
    osc1.frequency.exponentialRampToValueAtTime(tune, t + 0.012);

    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(tune * 1.5 * 1.5, t);
    osc2.frequency.exponentialRampToValueAtTime(tune * 1.5, t + 0.010);

    const osc3 = ctx.createOscillator();
    osc3.type = "sine";
    osc3.frequency.setValueAtTime(tune * 2.67 * 1.4, t);
    osc3.frequency.exponentialRampToValueAtTime(tune * 2.67, t + 0.008);

    // FM operator: adds metallic/rimshot-like character
    const fmAmount = (p.fm ?? 0) / 100;
    if (fmAmount > 0.01) {
      const fmRatio = p.fmRatio ?? 3;
      const modOsc = ctx.createOscillator();
      modOsc.type = "sine";
      modOsc.frequency.value = tune * fmRatio;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(fmAmount * tune * 4, t);
      modGain.gain.exponentialRampToValueAtTime(0.01, t + decaySec * 0.4);
      modOsc.connect(modGain);
      modGain.connect(osc1.frequency);
      modGain.connect(osc2.frequency);
      modOsc.start(t);
      modOsc.stop(t + decaySec + 0.05);
    }

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(toneMix * bodyAmt * 0.85, t);
    // Fast initial drop (the crack), then slower decay (the body ring)
    bodyGain.gain.exponentialRampToValueAtTime(toneMix * bodyAmt * 0.25, t + 0.04);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.7);

    // Resonant body filter — tighter with higher Q for ring
    const bodyBpf = ctx.createBiquadFilter();
    bodyBpf.type = "peaking";
    bodyBpf.frequency.value = 220;
    bodyBpf.Q.value = 3.5;
    bodyBpf.gain.value = 6;

    // Subtle ring modulation between oscillators for metallic edge
    const ringMod = ctx.createGain();
    ringMod.gain.setValueAtTime(0.08, t); // Subtle modulation depth

    osc1.connect(bodyGain);
    osc2.connect(bodyGain);
    osc3.connect(bodyGain);
    bodyGain.connect(bodyBpf);
    bodyBpf.connect(master);
    osc1.start(t);
    osc2.start(t);
    osc3.start(t);
    osc1.stop(t + decaySec + 0.05);
    osc2.stop(t + decaySec + 0.05);
    osc3.stop(t + decaySec + 0.05);

    // Transient layer — short burst of clipped noise for aggressive snap
    const click = this.getNoise(ctx, 0.005, t);
    const clickHpf = ctx.createBiquadFilter();
    clickHpf.type = "highpass";
    clickHpf.frequency.value = 2500;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(snap * 0.75, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.005);
    click.connect(clickHpf);
    clickHpf.connect(clickGain);
    clickGain.connect(master);

    // Snappy noise — bandpass at 3kHz with higher Q for wire snare character
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseBpf = ctx.createBiquadFilter();
    noiseBpf.type = "peaking";
    noiseBpf.frequency.value = 3000;
    noiseBpf.Q.value = 2.5;
    noiseBpf.gain.value = 6; // Wire snare boost

    const noiseHpf = ctx.createBiquadFilter();
    noiseHpf.type = "highpass";
    noiseHpf.frequency.value = 1200;

    const noiseLpf = ctx.createBiquadFilter();
    noiseLpf.type = "lowpass";
    noiseLpf.frequency.setValueAtTime(13000, t);
    noiseLpf.frequency.exponentialRampToValueAtTime(3500, t + decaySec * 0.5);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(snap * 1.1, t);
    // Two-stage decay: fast initial drop, then slower tail
    noiseGain.gain.exponentialRampToValueAtTime(snap * 0.35, t + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.65);

    noise.connect(noiseHpf);
    noiseHpf.connect(noiseBpf);
    noiseBpf.connect(noiseLpf);
    noiseLpf.connect(noiseGain);
    noiseGain.connect(master);
  }

  // ─── CLAP ──────────────────────────────────────────────────
  // Improved: randomized burst timing + variable bandpass + comb filter reverb + stereo
  private clap(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams, gateDurationSec?: number): void {
    const levelBoost = (p.level ?? 100) / 100;
    const vol = vel * 0.88 * levelBoost;
    const decaySec = this.getSustainedDecay((p.decay ?? 350) / 1000, gateDurationSec, 2.5);
    const toneFreq = p.tone ?? 1800;
    const spread = (p.spread ?? 50) / 100;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.1);
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    // Dual bandpass for wider character
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = toneFreq;
    bpf.Q.value = 1.2;

    const warmth = ctx.createBiquadFilter();
    warmth.type = "peaking";
    warmth.frequency.value = toneFreq * 0.55;
    warmth.Q.value = 1.5;
    warmth.gain.value = 5;

    bpf.connect(warmth);
    warmth.connect(master);

    // 4 noise bursts with randomized timing (±1ms jitter) for ragged character
    const baseSpacing = 0.005 + spread * 0.015;
    const burstTimes = [0, baseSpacing, baseSpacing * 2.3, baseSpacing * 3.8];
    for (let i = 0; i < burstTimes.length; i++) {
      const offset = burstTimes[i]! + (Math.random() - 0.5) * 0.001; // ±0.5ms jitter
      const burst = this.getNoise(ctx, 0.008, t + offset);
      const g = ctx.createGain();

      // Each burst has different bandpass center (±200Hz spread)
      const burstBpf = ctx.createBiquadFilter();
      burstBpf.type = "peaking";
      const freqSpread = (Math.random() - 0.5) * 400; // ±200Hz variation
      burstBpf.frequency.value = toneFreq + freqSpread;
      burstBpf.Q.value = 1.8;
      burstBpf.gain.value = 3;

      // Each burst slightly quieter
      const burstVol = 1.0 - i * 0.08;
      g.gain.setValueAtTime(burstVol, t + offset);
      g.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.008);

      burst.connect(burstBpf);
      burstBpf.connect(g);
      g.connect(bpf);
    }

    // Comb filter reverb tail (simulates room reflections)
    const tail = this.getNoise(ctx, decaySec, t + 0.035);
    const combDelay = ctx.createDelay(0.05);
    combDelay.delayTime.value = 0.025; // 25ms comb
    const combFeedback = ctx.createGain();
    combFeedback.gain.setValueAtTime(0.45, t + 0.035); // Feedback for shimmer
    // Kill feedback loop at end of decay — prevents gain accumulation across rapid triggers
    combFeedback.gain.setTargetAtTime(0, t + decaySec * 0.8, 0.01);

    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.50, t + 0.035);
    tailGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    tail.connect(tailGain);
    tailGain.connect(combDelay);
    combDelay.connect(combFeedback);
    combFeedback.connect(combDelay);
    combDelay.connect(bpf);
  }

  // ─── TOM ───────────────────────────────────────────────────
  // 808-style: warm sine body + overtone + click, deep pitch sweep
  private tom(ctx: AudioContext, t: number, vel: number, tune: number, out: AudioNode, p: VoiceParams, gateDurationSec?: number): void {
    const vol = vel * 0.8; // Louder for presence
    const decaySec = this.getSustainedDecay((p.decay ?? 300) / 1000, gateDurationSec, 3);
    const clickAmt = (p.click ?? 40) / 100;

    // Master VCA — punchy envelope with sustain
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(vol, t + 0.001); // Instant attack
    master.gain.setValueAtTime(vol, t + 0.005);
    master.gain.exponentialRampToValueAtTime(vol * 0.5, t + decaySec * 0.35);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    // Low-shelf warmth boost
    const warmth = ctx.createBiquadFilter();
    warmth.type = "lowshelf";
    warmth.frequency.value = tune * 1.5;
    warmth.gain.value = 4;

    warmth.connect(master);
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    // Main tone — deeper pitch sweep for more character
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tune * 2.0, t);      // Higher start = more punch
    osc.frequency.exponentialRampToValueAtTime(tune * 1.15, t + 0.006);
    osc.frequency.exponentialRampToValueAtTime(tune, t + 0.025);
    osc.frequency.setTargetAtTime(tune * 0.97, t + 0.03, decaySec * 0.35);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.9, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    // FM operator: adds cowbell/metallic character when pushed
    const fmAmount = (p.fm ?? 0) / 100;
    if (fmAmount > 0.01) {
      const fmRatio = p.fmRatio ?? 1.5;
      const modOsc = ctx.createOscillator();
      modOsc.type = "sine";
      modOsc.frequency.value = tune * fmRatio;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(fmAmount * tune * 2.5, t);
      modGain.gain.exponentialRampToValueAtTime(0.01, t + decaySec * 0.5);
      modOsc.connect(modGain);
      modGain.connect(osc.frequency);
      modOsc.start(t);
      modOsc.stop(t + decaySec + 0.05);
    }

    osc.connect(bodyGain);
    bodyGain.connect(warmth);
    osc.start(t);
    osc.stop(t + decaySec + 0.05);

    // Second partial — minor 7th above for tonal color (808 character)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(tune * 3.2, t);
    osc2.frequency.exponentialRampToValueAtTime(tune * 1.78, t + 0.012);

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.35, t);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.2);

    osc2.connect(overtoneGain);
    overtoneGain.connect(warmth);
    osc2.start(t);
    osc2.stop(t + decaySec + 0.05);

    // Third partial — sub octave for weight
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(tune * 0.5, t);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0, t);
    subGain.gain.linearRampToValueAtTime(0.25, t + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.8);

    sub.connect(subGain);
    subGain.connect(warmth);
    sub.start(t);
    sub.stop(t + decaySec + 0.05);

    // Click transient — sharper, tuned to the tom
    if (clickAmt > 0.05) {
      const clickBuf = this.noiseBuffer;
      if (clickBuf) {
        const clickSrc = ctx.createBufferSource();
        clickSrc.buffer = clickBuf;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(clickAmt * 0.5, t);
        clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
        const clickFilter = ctx.createBiquadFilter();
        clickFilter.type = "bandpass";
        clickFilter.frequency.value = tune * 3;
        clickFilter.Q.value = 3;
        clickSrc.connect(clickFilter);
        clickFilter.connect(clickGain);
        clickGain.connect(master);
        clickSrc.start(t);
        clickSrc.stop(t + 0.012);
      }
    }
  }

  // ─── HIHAT ─────────────────────────────────────────────────
  // Improved: ring modulation between oscillator pairs + 6th-order highpass + dynamic HPF sweep
  private hihat(ctx: AudioContext, t: number, vel: number, closed: boolean, out: AudioNode, p: VoiceParams, gateDurationSec?: number): GainNode {
    const vol = vel * (closed ? 0.65 : 0.70);
    const decaySec = this.getSustainedDecay((p.decay ?? (closed ? 45 : 250)) / 1000, gateDurationSec, 2);
    const toneAmt = (p.tone ?? 60) / 100;

    const master = ctx.createGain();
    if (closed) {
      master.gain.setValueAtTime(vol, t);
      master.gain.setValueAtTime(vol * 0.8, t + decaySec * 0.3);
      master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    } else {
      master.gain.setValueAtTime(vol, t);
      master.gain.exponentialRampToValueAtTime(vol * 0.3, t + decaySec * 0.4);
      master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    }
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    // 6th-order highpass (cascade 3 biquads) for steeper rolloff
    const hpf1 = ctx.createBiquadFilter();
    hpf1.type = "highpass";
    const hpf2 = ctx.createBiquadFilter();
    hpf2.type = "highpass";
    const hpf3 = ctx.createBiquadFilter();
    hpf3.type = "highpass";

    // HPF frequency envelope: sweeps up quickly
    const hpfFreqStart = closed ? 5500 : 3500;
    const hpfFreqEnd = closed ? 9000 + toneAmt * 3000 : 7000 + toneAmt * 2500;
    hpf1.frequency.setValueAtTime(hpfFreqStart, t);
    hpf1.frequency.exponentialRampToValueAtTime(hpfFreqEnd, t + 0.008);
    hpf2.frequency.setValueAtTime(hpfFreqStart * 1.1, t);
    hpf2.frequency.exponentialRampToValueAtTime(hpfFreqEnd * 1.1, t + 0.008);
    hpf3.frequency.setValueAtTime(hpfFreqStart * 1.2, t);
    hpf3.frequency.exponentialRampToValueAtTime(hpfFreqEnd * 1.2, t + 0.008);

    hpf1.connect(hpf2);
    hpf2.connect(hpf3);
    hpf3.connect(master);

    // Presence peak for shimmer
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 11000 + toneAmt * 3000;
    presence.Q.value = 1.5;
    presence.gain.value = 4 + toneAmt * 3;
    hpf3.connect(presence);
    presence.connect(master);

    // Ring modulation between oscillator pairs for sizzle (like real 909)
    const baseFreq = p.tune ?? 330;
    const pairs = [
      { f1: baseFreq * 1.0, f2: baseFreq * 1.4471 },
      { f1: baseFreq * 1.7409, f2: baseFreq * 1.9307 },
      { f1: baseFreq * 2.5377, f2: baseFreq * 2.7616 }
    ];

    for (const pair of pairs) {
      // Create detuned pair for chorus shimmer
      const osc1 = ctx.createOscillator();
      osc1.type = "square";
      osc1.frequency.value = pair.f1 * 0.995; // Slightly detuned
      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.value = pair.f2 * 1.005;

      // Ring modulate them
      const ringMod = ctx.createGain();
      osc2.connect(ringMod);
      ringMod.gain.setValueAtTime(1.0, t);

      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      g1.gain.setValueAtTime(0.08, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
      g2.gain.setValueAtTime(0.08, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

      osc1.connect(g1);
      ringMod.connect(g2);
      g1.connect(hpf1);
      g2.connect(hpf1);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + decaySec + 0.02);
      osc2.stop(t + decaySec + 0.02);
    }

    // Noise layer — pink noise for smoother texture
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseLpf = ctx.createBiquadFilter();
    noiseLpf.type = "lowpass";
    noiseLpf.frequency.setValueAtTime(14000 + toneAmt * 6000, t);
    noiseLpf.frequency.exponentialRampToValueAtTime(8000, t + decaySec * 0.5);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.8);

    noise.connect(noiseLpf);
    noiseLpf.connect(ng);
    ng.connect(hpf1);

    return master;
  }

  // ─── CYMBAL / RIDE ─────────────────────────────────────────
  // Improved: inharmonic partials + amplitude modulation + bell attack + multi-stage decay
  private cymbal(ctx: AudioContext, t: number, vel: number, baseFreq: number, out: AudioNode, p: VoiceParams, gateDurationSec?: number): void {
    const vol = vel * 0.65;
    const decaySec = this.getSustainedDecay((p.decay ?? 800) / 1000, gateDurationSec, 4);
    const toneAmt = (p.tone ?? 60) / 100;

    const master = ctx.createGain();
    // Multi-stage decay: fast (0→50ms), medium (50→200ms), slow tail
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(vol * 0.50, t + 0.05);
    master.gain.exponentialRampToValueAtTime(vol * 0.20, t + 0.20);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    // Highpass
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 3500 + toneAmt * 2000;
    hpf.Q.value = 0.4;

    // Bell presence peak
    const bell = ctx.createBiquadFilter();
    bell.type = "peaking";
    bell.frequency.value = 8500 + toneAmt * 3500;
    bell.Q.value = 2.2;
    bell.gain.value = 4 + toneAmt * 3;

    // Air/shimmer shelf
    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 12000;
    air.gain.value = 3 + toneAmt * 4;

    hpf.connect(bell);
    bell.connect(air);
    air.connect(master);

    // Bell component — short, bright sine burst at attack
    const bellOsc = ctx.createOscillator();
    bellOsc.type = "sine";
    bellOsc.frequency.value = baseFreq * 5.2; // High partial for bell
    const bellGain = ctx.createGain();
    bellGain.gain.setValueAtTime(0.25, t);
    bellGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    bellOsc.connect(bellGain);
    bellGain.connect(hpf);
    bellOsc.start(t);
    bellOsc.stop(t + 0.04);

    // Inharmonic partials (up to 5x fundamental) with amplitude modulation
    const ratios = [1.0, 1.4471, 1.7409, 1.9307, 2.5377, 2.7616, 3.5, 4.2, 5.0];
    for (let i = 0; i < ratios.length; i++) {
      const r = ratios[i]!;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = baseFreq * r;

      // Amplitude modulation between oscillator pairs for richness
      const modGain = ctx.createGain();
      if (i % 2 === 1) {
        // Modulate with sine LFO
        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 4.5 + r * 0.8; // Varying modulation rates
        const lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(0.15, t);
        lfo.connect(lfoGain);
        lfoGain.connect(modGain.gain);
        lfo.start(t);
        lfo.stop(t + decaySec);
      }

      const g = ctx.createGain();
      const partialDecay = decaySec * (1 - i * 0.05);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + partialDecay);

      modGain.gain.setValueAtTime(1.0, t);
      osc.connect(modGain);
      modGain.connect(g);
      g.connect(hpf);
      osc.start(t);
      osc.stop(t + partialDecay + 0.05);
    }

    // Noise shimmer — broader spectrum
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseLpf = ctx.createBiquadFilter();
    noiseLpf.type = "lowpass";
    noiseLpf.frequency.value = 15000 + toneAmt * 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.02, t + decaySec * 0.3);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.85);
    noise.connect(noiseLpf);
    noiseLpf.connect(ng);
    ng.connect(hpf);
  }

  // ─── PERCUSSION (Multi-Mode) ────────────────────────────────
  // TYPE 0=Conga, 1=Bongo, 2=Rim/Sidestick, 3=Cowbell,
  //      4=Shaker, 5=Claves, 6=Tambourine, 7=Triangle
  private perc(ctx: AudioContext, t: number, vel: number, freq: number, out: AudioNode, p: VoiceParams, gateDurationSec?: number): void {
    const type = Math.round(p.type ?? 0);
    const tune = p.tune ?? freq;
    const decaySec = this.getSustainedDecay((p.decay ?? 120) / 1000, gateDurationSec, 2.5);
    const toneAmt = (p.tone ?? 50) / 100;
    const vol = vel * 0.78;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.02);
    master.connect(out);
    // Schedule graph cleanup — prevents ghost node accumulation in audio graph.
    setTimeout(() => {
      try { master.disconnect(); } catch { /* already disconnected */ }
    }, Math.max(200, (t - ctx.currentTime + decaySec + 0.5) * 1000));

    switch (type) {
      case 0: // ── CONGA: resonant body with formant filter for wood character
      case 1: { // ── BONGO: higher, tighter, sharper attack
        const isBongo = type === 1;
        const bodyFreq = isBongo ? tune * 1.3 : tune;
        const bodyDecay = isBongo ? decaySec * 0.6 : decaySec;

        // Formant filter (peaked EQ at body resonance) for wooden shell character
        const formant = ctx.createBiquadFilter();
        formant.type = "peaking";
        formant.frequency.value = bodyFreq * 2.5;
        formant.Q.value = 2.5;
        formant.gain.value = 5; // Body resonance boost
        formant.connect(master);

        // Main body — sine with deeper pitch sweep
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(bodyFreq * 2.0, t);
        osc.frequency.exponentialRampToValueAtTime(bodyFreq * 1.05, t + (isBongo ? 0.006 : 0.012));
        osc.frequency.setTargetAtTime(bodyFreq * 0.98, t + 0.015, bodyDecay * 0.3);

        const bodyG = ctx.createGain();
        bodyG.gain.setValueAtTime(0.88, t);
        bodyG.gain.exponentialRampToValueAtTime(0.001, t + bodyDecay);
        osc.connect(bodyG);
        bodyG.connect(formant);
        osc.start(t);
        osc.stop(t + bodyDecay + 0.02);

        // Sub resonance for body weight
        const sub = ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.value = bodyFreq * 0.5;
        const subG = ctx.createGain();
        subG.gain.setValueAtTime(0, t);
        subG.gain.linearRampToValueAtTime(0.22, t + 0.005);
        subG.gain.exponentialRampToValueAtTime(0.001, t + bodyDecay * 0.7);
        sub.connect(subG);
        subG.connect(master);
        sub.start(t);
        sub.stop(t + bodyDecay + 0.02);

        // Slap noise — louder, tuned
        const slap = this.getNoise(ctx, 0.012, t);
        const slapG = ctx.createGain();
        slapG.gain.setValueAtTime(toneAmt * 0.65, t);
        slapG.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
        const slapBpf = ctx.createBiquadFilter();
        slapBpf.type = "bandpass";
        slapBpf.frequency.value = bodyFreq * 3;
        slapBpf.Q.value = 4.5;
        slap.connect(slapBpf);
        slapBpf.connect(slapG);
        slapG.connect(master);
        break;
      }

      case 2: { // ── RIM / SIDESTICK: sharp click + tuned ring
        // Click transient with higher frequency content
        const click = this.getNoise(ctx, 0.003, t);
        const clickHpf = ctx.createBiquadFilter();
        clickHpf.type = "highpass";
        clickHpf.frequency.value = 5000;
        const clickG = ctx.createGain();
        clickG.gain.setValueAtTime(1.0, t);
        clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
        click.connect(clickHpf);
        clickHpf.connect(clickG);
        clickG.connect(master);

        // Resonant ring — two partials for woody character
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tune;
        const ringG = ctx.createGain();
        ringG.gain.setValueAtTime(0.55, t);
        ringG.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
        osc.connect(ringG);
        ringG.connect(master);
        osc.start(t);
        osc.stop(t + 0.04);

        // Second partial for body
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = tune * 1.71;
        const ring2G = ctx.createGain();
        ring2G.gain.setValueAtTime(0.28, t);
        ring2G.gain.exponentialRampToValueAtTime(0.001, t + 0.027);
        osc2.connect(ring2G);
        ring2G.connect(master);
        osc2.start(t);
        osc2.stop(t + 0.03);
        break;
      }

      case 3: { // ── COWBELL: 808-style with 2 detuned square waves + bandpass
        const f1 = tune * 0.68;
        const f2 = tune * 1.02;

        // Tight bandpass for classic 808 cowbell tone
        const cowbellBpf = ctx.createBiquadFilter();
        cowbellBpf.type = "bandpass";
        cowbellBpf.frequency.value = (f1 + f2) / 2;
        cowbellBpf.Q.value = 3.5;
        cowbellBpf.connect(master);

        for (const f of [f1, f2]) {
          const osc = ctx.createOscillator();
          osc.type = "square";
          osc.frequency.value = f;
          const g = ctx.createGain();
          // Two-stage decay like real 808
          g.gain.setValueAtTime(0.45, t);
          g.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
          osc.connect(g);
          g.connect(cowbellBpf);
          osc.start(t);
          osc.stop(t + decaySec + 0.02);
        }
        break;
      }

      case 4: { // ── SHAKER: rhythmic noise with multiple jingle layers
        const noise = this.getNoise(ctx, decaySec, t);
        const hpf = ctx.createBiquadFilter();
        hpf.type = "highpass";
        hpf.frequency.value = Math.max(4500, tune);
        hpf.Q.value = 0.8;

        // Presence peak for sparkle
        const presence = ctx.createBiquadFilter();
        presence.type = "peaking";
        presence.frequency.value = 8500;
        presence.Q.value = 2.2;
        presence.gain.value = 5;

        const ng = ctx.createGain();
        // Shaped envelope with jingle-like character
        ng.gain.setValueAtTime(0.75, t);
        ng.gain.exponentialRampToValueAtTime(0.32, t + decaySec * 0.18);
        ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
        noise.connect(hpf);
        hpf.connect(presence);
        presence.connect(ng);
        ng.connect(master);

        // Add subtle metallic jingles
        for (const ratio of [1.0, 2.14]) {
          const jingle = ctx.createOscillator();
          jingle.type = "square";
          jingle.frequency.value = tune * ratio;
          const jg = ctx.createGain();
          jg.gain.setValueAtTime(0.05, t);
          jg.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.4);
          jingle.connect(jg);
          jg.connect(hpf);
          jingle.start(t);
          jingle.stop(t + decaySec * 0.5);
        }
        break;
      }

      case 5: { // ── CLAVES: shorter, sharper with hard clipping
        // Hard-clipped sine for aggressive attack
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.95, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

        // Hard limiter for clipping character
        const clipper = ctx.createWaveShaper();
        const clipCurve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) {
          const x = (i / 512 - 1) * 2.5;
          clipCurve[i] = Math.max(-1, Math.min(1, x));
        }
        clipper.curve = clipCurve;

        osc.connect(g);
        g.connect(clipper);
        clipper.connect(master);
        osc.start(t);
        osc.stop(t + 0.028);

        // Subtle second harmonic for wood character
        const h2 = ctx.createOscillator();
        h2.type = "sine";
        h2.frequency.value = tune * 3;
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.18, t);
        hg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
        h2.connect(hg);
        hg.connect(master);
        h2.start(t);
        h2.stop(t + 0.015);
        break;
      }

      case 6: { // ── TAMBOURINE: multiple jingle layers with randomized timing
        // More metallic oscillators with wider spread and timing variation
        for (const ratio of [1.0, 1.47, 2.09, 2.83, 3.5]) {
          const jingleTime = (Math.random() - 0.5) * 0.002; // ±1ms timing variation
          const osc = ctx.createOscillator();
          osc.type = "square";
          osc.frequency.value = tune * ratio;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.11, t + jingleTime);
          g.gain.exponentialRampToValueAtTime(0.001, t + jingleTime + decaySec * 0.65);
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.value = 5800;
          osc.connect(hp);
          hp.connect(g);
          g.connect(master);
          osc.start(t + jingleTime);
          osc.stop(t + jingleTime + decaySec + 0.02);
        }

        // Noise shimmer — brighter, longer
        const noise = this.getNoise(ctx, decaySec, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.40, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.60);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 7200;
        const air = ctx.createBiquadFilter();
        air.type = "highshelf";
        air.frequency.value = 10000;
        air.gain.value = 5;
        noise.connect(hp);
        hp.connect(air);
        air.connect(ng);
        ng.connect(master);
        break;
      }

      case 7: { // ── TRIANGLE: pure metallic ring with inharmonic overtones
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.60, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
        osc.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + decaySec + 0.02);

        // Three inharmonic partials for metallic shimmer
        const partials = [2.76, 5.404, 8.933];
        const partialVols = [0.20, 0.09, 0.05];
        for (let i = 0; i < partials.length; i++) {
          const h = ctx.createOscillator();
          h.type = "sine";
          h.frequency.value = tune * partials[i]!;
          const hg = ctx.createGain();
          hg.gain.setValueAtTime(partialVols[i]!, t);
          hg.gain.exponentialRampToValueAtTime(0.001, t + decaySec * (0.75 - i * 0.15));
          h.connect(hg);
          hg.connect(master);
          h.start(t);
          h.stop(t + decaySec + 0.02);
        }
        break;
      }

      default: { // Fallback: resonant noise
        const bpf = ctx.createBiquadFilter();
        bpf.type = "bandpass";
        bpf.frequency.value = tune;
        bpf.Q.value = 12;
        bpf.connect(master);
        const noise = this.getNoise(ctx, decaySec, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(1.0, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
        noise.connect(ng);
        ng.connect(bpf);
        break;
      }
    }
  }
}

// Singleton instance
export const voiceRenderer = new VoiceRenderer();
