/**
 * Bass Synth Engine — TB-303 Style (Authentic)
 *
 * Architecture:
 *   VCO (Saw/Square) + Sub-Osc → VCF (filter model) → VCA → Distortion → Output
 *
 * Authentic 303 behaviour:
 *   - Fast filter envelope attack (~3ms), sharp exponential decay
 *   - Accent dramatically boosts filter envelope depth AND shortens decay
 *   - Self-oscillating resonance near max Q
 *   - Slide glides BOTH pitch AND filter cutoff
 *   - Note tie holds VCA open (no re-trigger) while gliding pitch/filter
 *   - Sub-oscillator one octave below main VCO
 *   - Filter model: ladder (Moog-style) for classic 303 warmth
 */

import { createFilterChain, type FilterModel, type FilterChain } from "./filters";

export type FilterMode = "lowpass" | "highpass" | "bandpass" | "notch";

export interface BassParams {
  waveform: "sawtooth" | "square";
  filterType: FilterMode;
  filterModel: FilterModel;  // "lpf" | "ladder" | "steiner-lp" | "steiner-bp" | "steiner-hp"
  cutoff: number;      // Filter cutoff Hz (200-8000)
  resonance: number;   // Filter Q (0-30)
  envMod: number;      // Filter envelope depth (0-1)
  decay: number;       // Filter envelope decay ms (50-1000)
  accent: number;      // Accent intensity (0-1)
  slideTime: number;   // Portamento time ms (0-200)
  distortion: number;  // Drive amount (0-1)
  volume: number;      // Output level (0-1)
  subOsc: number;      // Sub-oscillator level (0-1), 0 = off
  punch: number;       // Transient punch amount (0-1), default 0.3
  harmonics: number;   // Harmonic enhancer mix (0-1), default 0.15
  subFilter: number;   // Sub lowpass cutoff (30-150Hz), default 80
}

export const DEFAULT_BASS_PARAMS: BassParams = {
  waveform: "sawtooth",
  filterType: "lowpass",
  filterModel: "ladder",  // Moog-style for classic 303 warmth
  cutoff: 600,
  resonance: 12,
  envMod: 0.6,
  decay: 200,
  accent: 0.5,
  slideTime: 60,
  distortion: 0.3,
  volume: 0.7,
  subOsc: 0,
  punch: 0.3,
  harmonics: 0.15,
  subFilter: 80,
};

// Musical scales
export const SCALES: Record<string, number[]> = {
  "Chromatic":   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "Major":       [0, 2, 4, 5, 7, 9, 11],
  "Minor":       [0, 2, 3, 5, 7, 8, 10],
  "Dorian":      [0, 2, 3, 5, 7, 9, 10],
  "Phrygian":    [0, 1, 3, 5, 7, 8, 10],
  "Mixolydian":  [0, 2, 4, 5, 7, 9, 10],
  "Minor Pent":  [0, 3, 5, 7, 10],
  "Major Pent":  [0, 2, 4, 7, 9],
  "Blues":        [0, 3, 5, 6, 7, 10],
  "Harmonic Min": [0, 2, 3, 5, 7, 8, 11],
  "Melodic Min":  [0, 2, 3, 5, 7, 9, 11],
  "Whole Tone":  [0, 2, 4, 6, 8, 10],
  "Diminished":  [0, 2, 3, 5, 6, 8, 9, 11],
};

export const ROOT_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Get MIDI note number for scale degree
export function scaleNote(rootMidi: number, scaleName: string, degree: number, octaveOffset = 0): number {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const octave = Math.floor(degree / scale.length);
  const idx = ((degree % scale.length) + scale.length) % scale.length;
  return rootMidi + (scale[idx] ?? 0) + (octave + octaveOffset) * 12;
}

// MIDI note to frequency
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface BassStep {
  active: boolean;
  note: number;      // Scale degree (0-based)
  octave: number;    // -1, 0, +1
  accent: boolean;
  slide: boolean;
  tie: boolean;       // Hold note across to next step (no re-trigger)
}

export class BassEngine {
  private ctx: AudioContext | null = null;

  // VCO
  private osc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private subLPF: BiquadFilterNode | null = null;  // Sub layer lowpass filter
  private oscMix: GainNode | null = null;

  // VCF: filter chain (replaces manual cascaded biquads)
  private filterChain: FilterChain | null = null;

  // VCA + output
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private dcBlocker: BiquadFilterNode | null = null;  // Remove DC offset from distortion
  private output: GainNode | null = null;

  // Harmonic enhancer: parallel saturation path
  private harmonicEnhancer: WaveShaperNode | null = null;
  private harmonicFilter: BiquadFilterNode | null = null;  // Bandpass 200-2000Hz
  private harmonicMix: GainNode | null = null;

  private isRunning = false;
  private noteIsOn = false;
  private _filterEnvTimer: ReturnType<typeof setInterval> | null = null;

  params: BassParams = { ...DEFAULT_BASS_PARAMS };

  init(audioCtx: AudioContext): void {
    this.ctx = audioCtx;

    // --- VCO (main) ---
    this.osc = audioCtx.createOscillator();
    this.osc.type = this.params.waveform;
    this.osc.frequency.value = 130.81; // C3

    // --- Sub-oscillator (one octave below) ---
    this.subOsc = audioCtx.createOscillator();
    this.subOsc.type = "square"; // Sub is always square for weight
    this.subOsc.frequency.value = 130.81 / 2;

    this.subGain = audioCtx.createGain();
    this.subGain.gain.value = this.params.subOsc;

    // Sub layer lowpass filter at 80Hz for clean sine-like sub regardless of source
    this.subLPF = audioCtx.createBiquadFilter();
    this.subLPF.type = "lowpass";
    this.subLPF.frequency.value = this.params.subFilter;
    this.subLPF.Q.value = 0.7;

    // Mixer node to combine main osc (post-filter) + sub (bypassed)
    this.oscMix = audioCtx.createGain();
    this.oscMix.gain.value = 1.0;

    // --- VCF: use filter model ---
    this.filterChain = createFilterChain(audioCtx, this.params.filterModel);

    // --- Harmonic enhancer: parallel saturation path ---
    this.harmonicEnhancer = audioCtx.createWaveShaper();
    this.updateHarmonicEnhancer();

    this.harmonicFilter = audioCtx.createBiquadFilter();
    this.harmonicFilter.type = "bandpass";
    this.harmonicFilter.frequency.value = 500; // Mid-range focus
    this.harmonicFilter.Q.value = 1.0;

    this.harmonicMix = audioCtx.createGain();
    this.harmonicMix.gain.value = this.params.harmonics;

    // --- VCA ---
    this.vca = audioCtx.createGain();
    this.vca.gain.value = 0; // Start silent

    // --- Distortion ---
    this.distNode = audioCtx.createWaveShaper();
    this.updateDistortion();

    // --- DC offset blocker ---
    this.dcBlocker = audioCtx.createBiquadFilter();
    this.dcBlocker.type = "highpass";
    this.dcBlocker.frequency.value = 20;
    this.dcBlocker.Q.value = 0.7;

    // --- Output ---
    this.output = audioCtx.createGain();
    this.output.gain.value = this.params.volume;

    // --- Signal chain (improved architecture) ---
    // Main osc → filter chain → VCA → distortion → DC blocker
    this.osc.connect(this.filterChain.input);
    this.filterChain.output.connect(this.vca);
    this.vca.connect(this.distNode);
    this.distNode.connect(this.dcBlocker);

    // Harmonic enhancer: parallel from distortion output
    this.distNode.connect(this.harmonicFilter);
    this.harmonicFilter.connect(this.harmonicEnhancer);
    this.harmonicEnhancer.connect(this.harmonicMix);

    // Sub osc → sub LPF → ALSO through VCA (so it respects note on/off!)
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.subLPF);
    this.subLPF.connect(this.vca); // Sub goes through VCA for proper gating

    // Mix post-VCA outputs to oscMix → output
    this.dcBlocker.connect(this.oscMix);
    this.harmonicMix.connect(this.oscMix);
    this.oscMix.connect(this.output);

    // Don't connect yet — caller will route to mixer
    // this.output.connect(audioCtx.destination);

    this.osc.start();
    this.subOsc.start();
    this.isRunning = true;
  }

  private updateDistortion(): void {
    if (!this.distNode) return;
    const drive = this.params.distortion;
    if (drive < 0.01) {
      this.distNode.curve = null;
      return;
    }
    // Professional analog-style saturation with tube bias
    const samples = 4096; // Higher resolution for smoother harmonics
    const curve = new Float32Array(samples);
    const gain = 1 + drive * 15; // Extended gain range
    const bias = 0.15; // Tube-like DC bias for even harmonics
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples / 2) - 1) * gain;
      // Three-stage saturation:
      // 1. Tube bias (asymmetric even harmonics)
      const biased = x + bias;
      // 2. Soft-knee compression
      const knee = biased / (1 + Math.abs(biased) * 0.3);
      // 3. Final tanh saturation with asymmetry
      if (knee >= 0) {
        curve[i] = Math.tanh(knee * 1.2) * 0.95;
      } else {
        curve[i] = Math.tanh(knee * 0.9) * 0.88; // Softer negative half = even harmonics
      }
    }
    this.distNode.curve = curve;
    this.distNode.oversample = "4x";
  }

  private updateHarmonicEnhancer(): void {
    if (!this.harmonicEnhancer) return;
    // Light saturation curve for harmonic enhancer
    const samples = 2048;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples / 2) - 1) * 2; // Moderate gain for subtle saturation
      curve[i] = Math.tanh(x * 0.8) * 0.9;
    }
    this.harmonicEnhancer.curve = curve;
    this.harmonicEnhancer.oversample = "2x";
  }

  /**
   * Schedule the 303 filter envelope via the filter chain.
   * The 303 has a very fast attack (~2-3ms) and a sharp exponential decay.
   * Accent dramatically increases the envelope depth and peak.
   * Uses smooth 5ms timer update for professional envelope shaping.
   */
  private scheduleFilterEnvelope(_time: number, accent: boolean, slide: boolean): void {
    if (!this.filterChain) return;

    // Clear any previous envelope
    if (this._filterEnvTimer) clearInterval(this._filterEnvTimer);

    const p = this.params;
    const accentMul = accent ? (1.0 + p.accent * 2.5) : 1.0;
    const envDepth = p.envMod * accentMul;
    const filterPeak = Math.min(p.cutoff + envDepth * 8000, 18000);
    const filterBase = Math.max(p.cutoff, 20);
    const decaySec = (p.decay / 1000) * (accent ? 0.4 : 1.0);
    const res = Math.min(p.resonance / 30, 1.0);

    const attackMs = slide ? p.slideTime : 3;
    const startTime = performance.now();
    let currentFreq = filterBase;

    this._filterEnvTimer = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      const now = this.ctx?.currentTime ?? 0;

      if (elapsed < attackMs / 1000) {
        // Attack phase: ramp to peak
        const t = elapsed / (attackMs / 1000);
        currentFreq = filterBase + (filterPeak - filterBase) * t;
      } else {
        // Decay phase: exponential decay from peak to base
        const decayElapsed = elapsed - attackMs / 1000;
        const t = Math.exp(-decayElapsed / (decaySec / 3));
        currentFreq = filterBase + (filterPeak - filterBase) * t;
      }

      this.filterChain?.update(currentFreq, res, now);

      // Stop after envelope is essentially done
      if (elapsed > attackMs / 1000 + decaySec * 2) {
        clearInterval(this._filterEnvTimer!);
        this._filterEnvTimer = null;
        this.filterChain?.update(filterBase, res, now);
      }
    }, 5); // 5ms = 200Hz update rate, smooth enough for filter sweep
  }

  /** Trigger a bass note */
  triggerNote(midiNote: number, time: number, accent: boolean, slide: boolean, tie: boolean): void {
    if (!this.ctx || !this.osc || !this.subOsc || !this.filterChain || !this.vca) return;

    const freq = midiToFreq(midiNote);
    const subFreq = freq / 2; // One octave below
    const p = this.params;

    // --- Pitch ---
    if (slide && p.slideTime > 0) {
      // Slide: exponential glide to target frequency
      const slideTau = p.slideTime / 1000 / 3;
      this.osc.frequency.setTargetAtTime(freq, time, slideTau);
      this.subOsc.frequency.setTargetAtTime(subFreq, time, slideTau);
    } else {
      this.osc.frequency.setValueAtTime(freq, time);
      this.subOsc.frequency.setValueAtTime(subFreq, time);
    }

    // --- VCA with punch envelope ---
    if (tie && this.noteIsOn) {
      // Tie: do NOT re-trigger VCA -- keep it open, just glide pitch + filter
      // Only re-trigger the filter envelope mildly for squelch
      this.scheduleFilterEnvelope(time, accent, true);
    } else {
      // Normal trigger or first note
      // VCA: fast attack with transient punch for percussive character
      this.vca.gain.cancelScheduledValues(time);
      const level = accent ? 1.0 : 0.75;
      const punchAmount = accent ? p.punch * 0.4 : p.punch * 0.15; // Scale punch by accent

      // Transient punch: brief overshoot at note onset for attack
      this.vca.gain.setValueAtTime(0.001, time);
      this.vca.gain.linearRampToValueAtTime(level + punchAmount, time + 0.002); // 2ms overshoot
      this.vca.gain.linearRampToValueAtTime(level, time + 0.008); // 6ms settle to sustain level

      // Filter envelope: the heart of the 303 sound
      this.scheduleFilterEnvelope(time, accent, slide);
    }

    this.noteIsOn = true;
  }

  /** Release (note off) */
  releaseNote(time: number): void {
    if (!this.vca) return;
    this.vca.gain.cancelScheduledValues(time);
    // 303-style release: fairly fast but not instant
    this.vca.gain.setTargetAtTime(0, time, 0.015);
    this.noteIsOn = false;
    // Clear any pending filter envelope
    if (this._filterEnvTimer) {
      clearInterval(this._filterEnvTimer);
      this._filterEnvTimer = null;
    }
  }

  /** Rest (no note on this step) */
  rest(time: number): void {
    this.releaseNote(time);
  }

  /** Update parameters live */
  setParams(p: Partial<BassParams>): void {
    Object.assign(this.params, p);

    if (this.osc && p.waveform) this.osc.type = p.waveform;
    if (this.filterChain) {
      if (p.cutoff !== undefined || p.resonance !== undefined) {
        const cutoff = p.cutoff ?? this.params.cutoff;
        const res = Math.min((p.resonance ?? this.params.resonance) / 30, 1.0);
        this.filterChain.update(cutoff, res, this.ctx?.currentTime ?? 0);
      }
      // Hot-swap filter chain when filterModel changes
      if (p.filterModel && p.filterModel !== this.params.filterModel) {
        if (this.ctx && this.osc && this.vca) {
          // Disconnect old filter chain from signal path
          this.osc.disconnect(this.filterChain.input);
          this.filterChain.output.disconnect(this.vca);

          // Create new filter chain
          this.filterChain = createFilterChain(this.ctx, p.filterModel);

          // Reconnect new filter chain to signal path
          this.osc.connect(this.filterChain.input);
          this.filterChain.output.connect(this.vca);

          // Apply current cutoff/resonance to new filter
          const cutoff = this.params.cutoff;
          const res = Math.min(this.params.resonance / 30, 1.0);
          this.filterChain.update(cutoff, res, this.ctx.currentTime);
        }
      }
    }
    if (this.subGain && p.subOsc !== undefined) this.subGain.gain.value = p.subOsc;
    if (this.subLPF && p.subFilter !== undefined) this.subLPF.frequency.value = p.subFilter;
    if (this.harmonicMix && p.harmonics !== undefined) this.harmonicMix.gain.value = p.harmonics;
    if (this.output && p.volume !== undefined) this.output.gain.value = p.volume;
    if (p.distortion !== undefined) this.updateDistortion();
    if (p.harmonics !== undefined) this.updateHarmonicEnhancer();
  }

  /** Get output node for routing to mixer */
  getOutput(): GainNode | null {
    return this.output;
  }

  get isInitialized(): boolean {
    return this.isRunning;
  }
}

export const bassEngine = new BassEngine();
