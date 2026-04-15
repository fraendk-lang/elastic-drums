/**
 * Chords Pad Synth Engine — 6-Voice Polyphonic
 *
 * Architecture:
 *   Voice 0: VCO + SubOsc ──┐
 *   Voice 1: VCO + SubOsc ──┤
 *   Voice 2: VCO + SubOsc ──┤
 *   Voice 3: VCO + SubOsc ──┼→ Mixer → FilterChain → VCA → Distortion → Output
 *   Voice 4: VCO + SubOsc ──┤
 *   Voice 5: VCO + SubOsc ──┘
 *
 * Features:
 *   - 6 oscillator voices with configurable waveform + sub-oscillators
 *   - Detune spread across voices for thick pad sound
 *   - Shared filter chain (configurable model: lpf, ladder, steiner, etc.)
 *   - Configurable attack/release VCA envelope
 *   - Filter envelope with configurable attack (not fixed 3ms like 303)
 *   - Asymmetric soft-clip distortion
 *   - Tie mode glides pitch without re-triggering VCA
 */

import { createFilterChain, type FilterModel, type FilterChain } from "./filters";

export interface ChordsParams {
  waveform: "sawtooth" | "square" | "triangle";
  filterModel: FilterModel;  // "lpf" | "ladder" | "steiner-lp" | "steiner-bp" | "steiner-hp"
  cutoff: number;      // 200-12000
  resonance: number;   // 0-20
  envMod: number;      // 0-1
  attack: number;      // 1-500 ms (pad attack)
  release: number;     // 50-2000 ms
  detune: number;      // 0-50 cents (thicken)
  distortion: number;  // 0-1
  volume: number;      // 0-1
  subOsc: number;      // 0-1
  filterType: "lowpass" | "highpass" | "bandpass" | "notch";
  chorus: number;      // Chorus depth (0-1), default 0.3
  spread: number;      // Stereo spread (0-1), default 0.5
  brightness: number;  // High-shelf boost (0-1), default 0.3
}

export const DEFAULT_CHORDS_PARAMS: ChordsParams = {
  waveform: "sawtooth",
  filterModel: "lpf",
  cutoff: 1200,
  resonance: 5,
  envMod: 0.3,
  attack: 20,
  release: 300,
  detune: 10,
  distortion: 0.1,
  volume: 0.5,
  subOsc: 0.2,
  filterType: "lowpass",
  chorus: 0.3,
  spread: 0.5,
  brightness: 0.3,
};

export const CHORD_TYPES: Record<string, number[]> = {
  "Maj": [0, 4, 7],
  "Min": [0, 3, 7],
  "7th": [0, 4, 7, 10],
  "Maj7": [0, 4, 7, 11],
  "Min7": [0, 3, 7, 10],
  "Min9": [0, 3, 7, 10, 14],
  "Dim": [0, 3, 6],
  "Aug": [0, 4, 8],
  "Sus4": [0, 5, 7],
  "Sus2": [0, 2, 7],
  "Add9": [0, 4, 7, 14],
  "9th": [0, 4, 7, 10, 14],
};

export interface ChordsStep {
  active: boolean;
  note: number;       // Scale degree
  chordType: string;  // key in CHORD_TYPES
  octave: number;     // -1, 0, +1
  accent: boolean;
  velocity?: number;  // 0-1 note velocity
  tie: boolean;
  gateLength?: number; // Step length in sequencer steps
}

// MIDI note to frequency
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Voice {
  osc: OscillatorNode;
  subOsc: OscillatorNode;
  subGain: GainNode;
  panner: StereoPannerNode;
  driftCents: number;
}

const NUM_VOICES = 6;

export class ChordsEngine {
  private ctx: AudioContext | null = null;

  // 6 voice pairs
  private voices: Voice[] = [];

  // Shared mixer
  private mixer: GainNode | null = null;

  // VCF: filter chain (replaces manual cascaded biquads)
  private filterChain: FilterChain | null = null;

  // Chorus effect
  private chorusDelay: DelayNode | null = null;
  private chorusLfo: OscillatorNode | null = null;
  private chorusLfoGain: GainNode | null = null;
  private chorusMix: GainNode | null = null;

  // Modern cleanup / air contour
  private lowCutFilter: BiquadFilterNode | null = null;
  // Brightness control (high-shelf filter)
  private brightnessFilter: BiquadFilterNode | null = null;

  // VCA + output
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private output: GainNode | null = null;

  private isRunning = false;
  private chordIsOn = false;
  private _autoReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  params: ChordsParams = { ...DEFAULT_CHORDS_PARAMS };

  init(audioCtx: AudioContext): void {
    this.ctx = audioCtx;

    // --- Shared mixer ---
    this.mixer = audioCtx.createGain();
    this.mixer.gain.value = 1.0 / NUM_VOICES; // Normalize

    // --- Create 6 voice pairs with stereo panners ---
    const detuneSpread = [-1, -0.6, -0.2, 0.2, 0.6, 1]; // Spread multipliers
    const panPositions = [-0.7, -0.4, -0.1, 0.1, 0.4, 0.7]; // Stereo positions

    for (let i = 0; i < NUM_VOICES; i++) {
      const osc = audioCtx.createOscillator();
      osc.type = this.params.waveform;
      osc.frequency.value = 261.63; // C4 default
      osc.detune.value = this.params.detune * detuneSpread[i]!;

      const subOsc = audioCtx.createOscillator();
      subOsc.type = "square"; // Sub is always square for weight
      subOsc.frequency.value = 261.63 / 2;
      subOsc.detune.value = this.params.detune * detuneSpread[i]!;

      const subGain = audioCtx.createGain();
      subGain.gain.value = this.params.subOsc;

      // Stereo panner for this voice
      const panner = audioCtx.createStereoPanner();
      panner.pan.value = panPositions[i]! * this.params.spread;

      // Route: osc + subOsc → panner → mixer
      osc.connect(panner);
      subOsc.connect(subGain);
      subGain.connect(panner);
      panner.connect(this.mixer);

      osc.start();
      subOsc.start();

      this.voices.push({
        osc,
        subOsc,
        subGain,
        panner,
        driftCents: (Math.random() - 0.5) * 3.5,
      });
    }

    // --- VCF: use filter model ---
    this.filterChain = createFilterChain(audioCtx, this.params.filterModel);

    // --- Chorus effect: simple, clean single-tap chorus ---
    this.chorusDelay = audioCtx.createDelay();
    this.chorusDelay.delayTime.value = 0.004; // 4ms base delay

    this.chorusLfo = audioCtx.createOscillator();
    this.chorusLfo.type = "triangle";
    this.chorusLfo.frequency.value = 0.9; // Slow triangle for smooth chorus

    this.chorusLfoGain = audioCtx.createGain();
    this.chorusLfoGain.gain.value = 0.0015; // Depth: ±1.5ms modulation

    this.chorusMix = audioCtx.createGain();
    this.chorusMix.gain.value = this.params.chorus;

    this.chorusLfo.connect(this.chorusLfoGain);
    this.chorusLfoGain.connect(this.chorusDelay.delayTime);
    this.chorusLfo.start();

    // --- Low-cut cleanup to keep modern chords out of the bass lane ---
    this.lowCutFilter = audioCtx.createBiquadFilter();
    this.lowCutFilter.type = "highpass";
    this.lowCutFilter.frequency.value = 120;
    this.lowCutFilter.Q.value = 0.35;

    // --- Brightness control (high-shelf filter at 3kHz) ---
    this.brightnessFilter = audioCtx.createBiquadFilter();
    this.brightnessFilter.type = "highshelf";
    this.brightnessFilter.frequency.value = 3000;
    this.updateBrightness();

    // --- VCA ---
    this.vca = audioCtx.createGain();
    this.vca.gain.value = 0; // Start silent

    // --- Distortion ---
    this.distNode = audioCtx.createWaveShaper();
    this.updateDistortion();

    // --- Output ---
    this.output = audioCtx.createGain();
    this.output.gain.value = 0; // Muted until first chord trigger

    // --- Signal chain: mixer → filterChain → low-cut → chorus (dry + wet) → brightness → VCA → distortion → output ---
    this.mixer.connect(this.filterChain.input);
    this.rewirePostFilterChain();

    this.vca.connect(this.distNode);
    this.distNode.connect(this.output);

    this.isRunning = true;
  }

  private updateDistortion(): void {
    if (!this.distNode) return;
    const drive = this.params.distortion;
    if (drive < 0.01) {
      this.distNode.curve = null;
      return;
    }
    // Asymmetric soft-clip for more analog character
    const samples = 1024;
    const curve = new Float32Array(samples);
    const gain = 1 + drive * 15;
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples / 2) - 1) * gain;
      // Asymmetric: slightly different positive vs negative clipping
      if (x >= 0) {
        curve[i] = Math.tanh(x);
      } else {
        curve[i] = Math.tanh(x * 1.2) * 0.9;
      }
    }
    this.distNode.curve = curve;
    this.distNode.oversample = "4x";
  }

  private updateBrightness(): void {
    if (!this.brightnessFilter) return;
    // Brightness: gentler low values, more obvious air above 0.5
    const gain = this.params.brightness * 8;
    this.brightnessFilter.gain.value = gain;
  }

  private updateLowCut(): void {
    if (!this.lowCutFilter) return;
    // More subOsc lowers the cleanup slightly; bright patches get more cleanup.
    const cutoff = 95 + this.params.brightness * 80 - this.params.subOsc * 25;
    this.lowCutFilter.frequency.value = Math.max(70, cutoff);
  }

  private rewirePostFilterChain(): void {
    if (!this.filterChain || !this.lowCutFilter || !this.chorusDelay || !this.chorusMix || !this.brightnessFilter || !this.vca) return;

    try { this.filterChain.output.disconnect(); } catch { /* noop */ }
    try { this.lowCutFilter.disconnect(); } catch { /* noop */ }
    try { this.chorusDelay.disconnect(); } catch { /* noop */ }
    try { this.chorusMix.disconnect(); } catch { /* noop */ }
    try { this.brightnessFilter.disconnect(); } catch { /* noop */ }

    // Signal: filter → lowCut → dry + chorus wet → brightness → VCA
    this.filterChain.output.connect(this.lowCutFilter);
    this.lowCutFilter.connect(this.brightnessFilter); // Dry path
    this.lowCutFilter.connect(this.chorusDelay);       // Chorus wet
    this.chorusDelay.connect(this.chorusMix);
    this.chorusMix.connect(this.brightnessFilter);
    this.brightnessFilter.connect(this.vca);
  }

  /**
   * Schedule the filter envelope via the filter chain.
   * Uses configurable attack time (not fixed 3ms like the 303).
   * Accent boosts envelope depth.
   */
  private scheduleFilterEnvelope(time: number, accent: boolean, glide: boolean): void {
    if (!this.filterChain) return;

    const p = this.params;
    const accentAmount = accent ? 2.0 : 1.0;
    const envDepth = p.envMod * accentAmount;

    // Filter peak: cutoff + envelope sweep range
    const filterPeak = Math.min(p.cutoff + envDepth * 8000, 18000);
    const filterBase = Math.max(p.cutoff, 20);

    // Attack time from params (converted to seconds)
    const attackSec = p.attack / 1000;
    // Decay: use release time as decay reference, accent makes it snappier
    const decaySec = (p.release / 1000) * (accent ? 0.5 : 1.0);
    const decayTau = decaySec / 3.5;

    // Resonance normalized to 0-1 range for filter chain update
    const res = Math.min(p.resonance / 20, 1.0);

    if (glide) {
      // During tie/glide: smooth transition
      void (attackSec / 3); // Calculate but don't use
      this.filterChain.update(filterPeak, res, time);
      setTimeout(() => {
        this.filterChain?.update(filterBase, res, time + attackSec);
      }, attackSec * 1000);
    } else {
      // Attack to peak
      this.filterChain.update(filterBase, res, time);
      setTimeout(() => {
        this.filterChain?.update(filterPeak, res, time + attackSec);
      }, attackSec * 1000);
      // Decay back
      setTimeout(() => {
        this.filterChain?.update(filterBase, res, time + attackSec);
      }, (attackSec + decayTau) * 1000);
    }
  }

  /** Trigger a chord (up to 6 voices) */
  triggerChord(midiNotes: number[], time: number, accent: boolean, tie: boolean, velocity = 0.85): void {
    if (!this.ctx || !this.vca || !this.filterChain || this.voices.length === 0) return;

    // Unmute output on first trigger
    if (this.output && this.output.gain.value === 0) {
      this.output.gain.value = this.params.volume;
    }

    const p = this.params;

    // --- Set each voice's frequency ---
    for (let i = 0; i < NUM_VOICES; i++) {
      const voice = this.voices[i];
      if (!voice) continue;

      if (i < midiNotes.length) {
        const freq = midiToFreq(midiNotes[i]!);
        const subFreq = freq / 2;
        const drift = voice.driftCents;

        if (tie && this.chordIsOn) {
          // Glide to new pitch
          const glideTau = p.attack / 1000 / 3;
          voice.osc.frequency.setTargetAtTime(freq, time, glideTau);
          voice.subOsc.frequency.setTargetAtTime(subFreq, time, glideTau);
          voice.osc.detune.setTargetAtTime(this.params.detune * [-1, -0.6, -0.2, 0.2, 0.6, 1][i]! + drift, time, 0.08);
          voice.subOsc.detune.setTargetAtTime(this.params.detune * [-1, -0.6, -0.2, 0.2, 0.6, 1][i]! + drift * 0.6, time, 0.08);
        } else {
          voice.osc.frequency.setValueAtTime(freq, time);
          voice.subOsc.frequency.setValueAtTime(subFreq, time);
          voice.osc.detune.setValueAtTime(this.params.detune * [-1, -0.6, -0.2, 0.2, 0.6, 1][i]! + drift, time);
          voice.subOsc.detune.setValueAtTime(this.params.detune * [-1, -0.6, -0.2, 0.2, 0.6, 1][i]! + drift * 0.6, time);
        }
      }
    }

    // --- VCA ---
    if (tie && this.chordIsOn) {
      // Tie: do NOT re-trigger VCA -- keep it open, just glide pitch + filter
      this.scheduleFilterEnvelope(time, accent, true);
    } else {
      // Normal trigger with exponential attack for smooth pad entry
      const attackSec = p.attack / 1000;
      const velocityLevel = 0.45 + Math.max(0, Math.min(1, velocity)) * 0.55;
      const level = (accent ? 1.0 : 0.75) * velocityLevel;

      this.vca.gain.cancelScheduledValues(time);
      this.vca.gain.setValueAtTime(0.001, time);
      this.vca.gain.exponentialRampToValueAtTime(level, time + attackSec);

      // Filter envelope
      this.scheduleFilterEnvelope(time, accent, false);
    }

    this.chordIsOn = true;

    // Auto-release safety net (4s max)
    if (this._autoReleaseTimer) clearTimeout(this._autoReleaseTimer);
    this._autoReleaseTimer = setTimeout(() => {
      this._autoReleaseTimer = null;
      if (this.chordIsOn) this.releaseChord(this.ctx?.currentTime ?? 0);
    }, 4000);
  }

  /** Release chord (exponential release with configurable time) */
  releaseChord(time: number): void {
    if (!this.vca) return;
    const releaseTau = this.params.release / 1000 / 4;
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setTargetAtTime(0.001, time, releaseTau);
    this.chordIsOn = false;
    if (this._autoReleaseTimer) { clearTimeout(this._autoReleaseTimer); this._autoReleaseTimer = null; }
  }

  /** Rest (no chord on this step) */
  rest(time: number): void {
    this.releaseChord(time);
  }

  /** Emergency stop for stuck notes */
  panic(time?: number): void {
    if (!this.ctx || !this.vca) return;
    const t = time ?? this.ctx.currentTime;
    this.vca.gain.cancelScheduledValues(t);
    this.vca.gain.setValueAtTime(0, t);
    this.chordIsOn = false;
  }

  /** Update parameters live */
  setParams(p: Partial<ChordsParams>): void {
    const previous = { ...this.params };
    const normalized: Partial<ChordsParams> = { ...p };

    if (normalized.filterType && normalized.filterModel === undefined) {
      if (normalized.filterType === "bandpass") normalized.filterModel = "steiner-bp";
      else if (normalized.filterType === "highpass") normalized.filterModel = "steiner-hp";
      else if (normalized.filterType === "lowpass") {
        normalized.filterModel = previous.filterModel === "steiner-lp" ? "steiner-lp" : "ladder";
      } else {
        normalized.filterModel = "lpf";
      }
    }

    Object.assign(this.params, normalized);

    if (normalized.waveform) {
      for (const voice of this.voices) {
        voice.osc.type = normalized.waveform;
      }
    }
    if (normalized.detune !== undefined) {
      const detuneSpread = [-1, -0.6, -0.2, 0.2, 0.6, 1];
      for (let i = 0; i < this.voices.length; i++) {
        const voice = this.voices[i];
        if (voice) {
          voice.osc.detune.value = normalized.detune * detuneSpread[i]! + voice.driftCents;
          voice.subOsc.detune.value = normalized.detune * detuneSpread[i]! + voice.driftCents * 0.6;
        }
      }
    }
    if (normalized.spread !== undefined) {
      const panPositions = [-0.7, -0.4, -0.1, 0.1, 0.4, 0.7];
      for (let i = 0; i < this.voices.length; i++) {
        const voice = this.voices[i];
        if (voice) {
          voice.panner.pan.value = panPositions[i]! * normalized.spread;
        }
      }
    }
    if (normalized.chorus !== undefined && this.chorusMix) {
      this.chorusMix.gain.value = normalized.chorus;
    }
    if (normalized.brightness !== undefined) {
      this.updateBrightness();
    }
    if (normalized.brightness !== undefined || normalized.subOsc !== undefined) {
      this.updateLowCut();
    }
    if (this.filterChain) {
      if (normalized.cutoff !== undefined || normalized.resonance !== undefined) {
        const cutoff = normalized.cutoff ?? this.params.cutoff;
        const res = Math.min((normalized.resonance ?? this.params.resonance) / 20, 1.0);
        this.filterChain.update(cutoff, res, this.ctx?.currentTime ?? 0);
      }
      // Hot-swap filter chain when filterModel changes
      if (normalized.filterModel && normalized.filterModel !== previous.filterModel) {
        if (this.ctx && this.mixer && this.vca) {
          // Disconnect old filter chain from signal path
          try { this.mixer.disconnect(this.filterChain.input); } catch { /* noop */ }

          // Create new filter chain
          this.filterChain = createFilterChain(this.ctx, normalized.filterModel);

          // Reconnect new filter chain to signal path
          this.mixer.connect(this.filterChain.input);
          this.rewirePostFilterChain();

          // Apply current cutoff/resonance to new filter
          const cutoff = this.params.cutoff;
          const res = Math.min(this.params.resonance / 20, 1.0);
          this.filterChain.update(cutoff, res, this.ctx.currentTime);
        }
      }
    }
    if (normalized.subOsc !== undefined) {
      for (const voice of this.voices) {
        voice.subGain.gain.value = normalized.subOsc;
      }
    }
    if (this.output && normalized.volume !== undefined) this.output.gain.value = normalized.volume;
    if (normalized.distortion !== undefined) this.updateDistortion();
  }

  /** Get output node for routing to mixer */
  getOutput(): GainNode | null {
    return this.output;
  }

  get isInitialized(): boolean {
    return this.isRunning;
  }
}

export const chordsEngine = new ChordsEngine();
