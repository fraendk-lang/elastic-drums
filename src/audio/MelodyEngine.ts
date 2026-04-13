/**
 * Melody Synth Engine — Monophonic Analog Lead
 *
 * Architecture:
 *   VCO (Saw/Square/Triangle) + Sub-Osc → VCF (2x cascaded biquad = 24dB/oct) → VCA → Distortion → Output
 *
 * Lead synth behaviour:
 *   - Filter envelope attack ~5ms (slightly softer than 303 for lead character)
 *   - Sharp exponential decay
 *   - Accent boosts filter envelope depth AND shortens decay
 *   - Self-oscillating resonance near max Q
 *   - Slide glides BOTH pitch AND filter cutoff
 *   - Note tie holds VCA open (no re-trigger) while gliding pitch/filter
 *   - Legato mode: always slides between notes regardless of step.slide flag
 *   - Sub-oscillator one octave below main VCO
 *   - Cascaded dual biquad for proper 24dB/oct rolloff
 *   - Filter cutoff range up to 12000 Hz for bright lead tones
 */

import { scaleNote } from "./BassEngine";

export { scaleNote };

export interface MelodyParams {
  waveform: "sawtooth" | "square" | "triangle";
  cutoff: number;      // Filter cutoff Hz (200-12000)
  resonance: number;   // Filter Q (0-30)
  envMod: number;      // Filter envelope depth (0-1)
  decay: number;       // Filter envelope decay ms (50-800)
  accent: number;      // Accent intensity (0-1)
  slideTime: number;   // Portamento time ms (0-200)
  legato: boolean;     // When true, always slides between notes
  distortion: number;  // Drive amount (0-1)
  volume: number;      // Output level (0-1)
  subOsc: number;      // Sub-oscillator level (0-1), 0 = off
  filterType: "lowpass" | "highpass" | "bandpass" | "notch";
}

export const DEFAULT_MELODY_PARAMS: MelodyParams = {
  waveform: "sawtooth",
  cutoff: 2000,
  resonance: 8,
  envMod: 0.4,
  decay: 150,
  accent: 0.4,
  slideTime: 40,
  legato: false,
  distortion: 0.15,
  volume: 0.5,
  subOsc: 0.1,
  filterType: "lowpass",
};

// MIDI note to frequency
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface MelodyStep {
  active: boolean;
  note: number;      // Scale degree (0-based)
  octave: number;    // -1, 0, +1
  accent: boolean;
  slide: boolean;
  tie: boolean;       // Hold note across to next step (no re-trigger)
}

export class MelodyEngine {
  private ctx: AudioContext | null = null;

  // VCO
  private osc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private oscMix: GainNode | null = null;

  // VCF: two cascaded biquads for 24dB/oct
  private filter1: BiquadFilterNode | null = null;
  private filter2: BiquadFilterNode | null = null;

  // VCA + output
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private output: GainNode | null = null;

  private isRunning = false;
  private noteIsOn = false;

  params: MelodyParams = { ...DEFAULT_MELODY_PARAMS };

  init(audioCtx: AudioContext): void {
    this.ctx = audioCtx;

    // --- VCO (main) ---
    this.osc = audioCtx.createOscillator();
    this.osc.type = this.params.waveform;
    this.osc.frequency.value = 261.63; // C3 (MIDI 48)

    // --- Sub-oscillator (one octave below) ---
    this.subOsc = audioCtx.createOscillator();
    this.subOsc.type = "square"; // Sub is always square for weight
    this.subOsc.frequency.value = 261.63 / 2;

    this.subGain = audioCtx.createGain();
    this.subGain.gain.value = this.params.subOsc;

    // Mixer node to combine main + sub before filter
    this.oscMix = audioCtx.createGain();
    this.oscMix.gain.value = 1.0;

    // --- VCF: dual cascaded biquad for 24dB/oct ---
    this.filter1 = audioCtx.createBiquadFilter();
    this.filter1.type = "lowpass";
    this.filter1.frequency.value = this.params.cutoff;
    this.filter1.Q.value = this.params.resonance;

    this.filter2 = audioCtx.createBiquadFilter();
    this.filter2.type = "lowpass";
    this.filter2.frequency.value = this.params.cutoff;
    // Second stage has lower Q to avoid runaway but still adds slope
    this.filter2.Q.value = Math.max(0, this.params.resonance * 0.85);

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
    // Mixer → filter1 → filter2 → VCA → distortion → output
    this.oscMix.connect(this.filter1);
    this.filter1.connect(this.filter2);
    this.filter2.connect(this.vca);
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

  /**
   * Schedule the filter envelope on both cascaded filters.
   * Fast attack (~5ms for lead character) and sharp exponential decay.
   * Accent dramatically increases the envelope depth and peak.
   */
  private scheduleFilterEnvelope(time: number, accent: boolean, slide: boolean): void {
    if (!this.filter1 || !this.filter2) return;

    const p = this.params;
    const accentAmount = accent ? (1.0 + p.accent * 2.5) : 1.0; // Accent up to 3.5x
    const envDepth = p.envMod * accentAmount;

    // Filter peak: cutoff + envelope sweep range
    // Sweeps from high freq down to cutoff
    const filterPeak = Math.min(p.cutoff + envDepth * 12000, 20000);
    const filterBase = Math.max(p.cutoff, 20);

    // Decay time: accent makes it snappier
    const decaySec = (p.decay / 1000) * (accent ? 0.4 : 1.0);
    // Time constant for exponential decay (~3x faster than linear)
    const decayTau = decaySec / 3.5;

    // Attack time: ~5ms (slightly softer than 303 for lead character)
    const attackTime = 0.005;

    // -- Filter 1 (main) --
    this.filter1.frequency.cancelScheduledValues(time);
    if (slide) {
      // During slide: glide filter cutoff to peak more slowly
      this.filter1.frequency.setTargetAtTime(filterPeak, time, p.slideTime / 1000 / 3);
    } else {
      // Fast attack to peak
      this.filter1.frequency.setValueAtTime(filterBase, time);
      this.filter1.frequency.linearRampToValueAtTime(filterPeak, time + attackTime);
    }
    // Exponential decay back to base cutoff
    this.filter1.frequency.setTargetAtTime(filterBase, time + attackTime, decayTau);

    // -- Filter 2 (cascaded) -- follows same envelope
    this.filter2.frequency.cancelScheduledValues(time);
    if (slide) {
      this.filter2.frequency.setTargetAtTime(filterPeak, time, p.slideTime / 1000 / 3);
    } else {
      this.filter2.frequency.setValueAtTime(filterBase, time);
      this.filter2.frequency.linearRampToValueAtTime(filterPeak, time + attackTime);
    }
    this.filter2.frequency.setTargetAtTime(filterBase, time + attackTime, decayTau);
  }

  /** Trigger a melody note */
  triggerNote(midiNote: number, time: number, accent: boolean, slide: boolean, tie: boolean): void {
    if (!this.ctx || !this.osc || !this.subOsc || !this.filter1 || !this.filter2 || !this.vca) return;

    const freq = midiToFreq(midiNote);
    const subFreq = freq / 2; // One octave below
    const p = this.params;

    // Legato mode: always slide between notes
    const useSlide = p.legato || slide;

    // --- Pitch ---
    if (useSlide && p.slideTime > 0) {
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
      // VCA: fast attack (5ms for lead character)
      this.vca.gain.cancelScheduledValues(time);
      const level = accent ? 1.0 : 0.75;
      this.vca.gain.setValueAtTime(0.001, time);
      this.vca.gain.linearRampToValueAtTime(level, time + 0.005);

      // Filter envelope: the heart of the lead sound
      this.scheduleFilterEnvelope(time, accent, useSlide);
    }

    this.noteIsOn = true;
  }

  /** Release (note off) */
  releaseNote(time: number): void {
    if (!this.vca) return;
    this.vca.gain.cancelScheduledValues(time);
    // Fairly fast release but not instant
    this.vca.gain.setTargetAtTime(0, time, 0.015);
    this.noteIsOn = false;
  }

  /** Rest (no note on this step) */
  rest(time: number): void {
    this.releaseNote(time);
  }

  /** Update parameters live */
  setParams(p: Partial<MelodyParams>): void {
    Object.assign(this.params, p);

    if (this.osc && p.waveform) this.osc.type = p.waveform;
    if (this.filter1) {
      if (p.cutoff !== undefined) {
        this.filter1.frequency.value = p.cutoff;
        if (this.filter2) this.filter2.frequency.value = p.cutoff;
      }
      if (p.resonance !== undefined) {
        this.filter1.Q.value = p.resonance;
        if (this.filter2) this.filter2.Q.value = Math.max(0, p.resonance * 0.85);
      }
    }
    if (this.subGain && p.subOsc !== undefined) this.subGain.gain.value = p.subOsc;
    if (this.output && p.volume !== undefined) this.output.gain.value = p.volume;
    if (p.filterType) { if (this.filter1) this.filter1.type = p.filterType; if (this.filter2) this.filter2.type = p.filterType; }
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

export const melodyEngine = new MelodyEngine();
