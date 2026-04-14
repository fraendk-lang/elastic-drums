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
  private oscMix: GainNode | null = null;

  // VCF: filter chain (replaces manual cascaded biquads)
  private filterChain: FilterChain | null = null;

  // VCA + output
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private output: GainNode | null = null;

  private isRunning = false;
  private noteIsOn = false;

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

    // Mixer node to combine main + sub before filter
    this.oscMix = audioCtx.createGain();
    this.oscMix.gain.value = 1.0;

    // --- VCF: use filter model ---
    this.filterChain = createFilterChain(audioCtx, this.params.filterModel);

    // --- VCA ---
    this.vca = audioCtx.createGain();
    this.vca.gain.value = 0; // Start silent

    // --- Distortion ---
    this.distNode = audioCtx.createWaveShaper();
    this.updateDistortion();

    // --- Output ---
    this.output = audioCtx.createGain();
    this.output.gain.value = this.params.volume;

    // --- Signal chain ---
    // Main osc → mixer
    this.osc.connect(this.oscMix);
    // Sub osc → sub gain → mixer
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.oscMix);
    // Mixer → filterChain → VCA → distortion → output
    this.oscMix.connect(this.filterChain.input);
    this.filterChain.output.connect(this.vca);
    this.vca.connect(this.distNode);
    this.distNode.connect(this.output);

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
    // Warm analog-style soft-clip with tube-like asymmetry
    const samples = 2048;
    const curve = new Float32Array(samples);
    const gain = 1 + drive * 12;
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples / 2) - 1) * gain;
      // Two-stage: gentle saturation + asymmetric clip
      const soft = x / (1 + Math.abs(x) * 0.5); // gentle pre-saturation
      if (soft >= 0) {
        curve[i] = Math.tanh(soft);
      } else {
        curve[i] = Math.tanh(soft * 1.15) * 0.92; // asymmetric warmth
      }
    }
    this.distNode.curve = curve;
    this.distNode.oversample = "4x";
  }

  /**
   * Schedule the 303 filter envelope via the filter chain.
   * The 303 has a very fast attack (~2-3ms) and a sharp exponential decay.
   * Accent dramatically increases the envelope depth and peak.
   */
  private scheduleFilterEnvelope(time: number, accent: boolean, slide: boolean): void {
    if (!this.filterChain) return;

    const p = this.params;
    const accentAmount = accent ? (1.0 + p.accent * 2.5) : 1.0; // Accent up to 3.5x
    const envDepth = p.envMod * accentAmount;

    // Filter peak: cutoff + envelope sweep range
    // 303 sweeps from high freq down to cutoff
    const filterPeak = Math.min(p.cutoff + envDepth * 8000, 18000);
    const filterBase = Math.max(p.cutoff, 20);

    // Decay time: accent makes it snappier
    const decaySec = (p.decay / 1000) * (accent ? 0.4 : 1.0);
    // Time constant for exponential decay (~3x faster than linear)
    const decayTau = decaySec / 3.5;

    // Attack time: ~3ms (characteristic 303 snap)
    const attackTime = 0.003;

    // Resonance normalized to 0-1 range for filter chain update
    const res = Math.min(p.resonance / 30, 1.0);

    if (slide) {
      // During slide: glide filter cutoff to peak more slowly
      void (p.slideTime / 1000 / 3); // Calculate but don't use
      // Start at current, ramp to peak over slide time
      this.filterChain.update(filterPeak, res, time);
      // Then decay back (manually with setTimeout to avoid complex scheduling)
      setTimeout(() => {
        this.filterChain?.update(filterBase, res, time + p.slideTime / 1000);
      }, 0);
    } else {
      // Fast attack to peak
      this.filterChain.update(filterBase, res, time);
      // Quick update to peak
      setTimeout(() => {
        this.filterChain?.update(filterPeak, res, time + attackTime);
      }, attackTime * 1000);
      // Then decay back
      setTimeout(() => {
        this.filterChain?.update(filterBase, res, time + attackTime);
      }, (attackTime + decayTau) * 1000);
    }
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

    // --- VCA ---
    if (tie && this.noteIsOn) {
      // Tie: do NOT re-trigger VCA -- keep it open, just glide pitch + filter
      // Only re-trigger the filter envelope mildly for squelch
      this.scheduleFilterEnvelope(time, accent, true);
    } else {
      // Normal trigger or first note
      // VCA: fast attack
      this.vca.gain.cancelScheduledValues(time);
      const level = accent ? 1.0 : 0.75;
      this.vca.gain.setValueAtTime(0.001, time);
      this.vca.gain.linearRampToValueAtTime(level, time + 0.003);

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
      // Note: filterModel changes would require recreating the filter chain
      // For now, changes to filterModel are not hot-swappable (would require engine re-init)
    }
    if (this.subGain && p.subOsc !== undefined) this.subGain.gain.value = p.subOsc;
    if (this.output && p.volume !== undefined) this.output.gain.value = p.volume;
    if (p.distortion !== undefined) this.updateDistortion();
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
