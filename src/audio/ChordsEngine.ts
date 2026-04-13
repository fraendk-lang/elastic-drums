/**
 * Chords Pad Synth Engine — 6-Voice Polyphonic
 *
 * Architecture:
 *   Voice 0: VCO + SubOsc ──┐
 *   Voice 1: VCO + SubOsc ──┤
 *   Voice 2: VCO + SubOsc ──┤
 *   Voice 3: VCO + SubOsc ──┼→ Mixer → Filter1 → Filter2 → VCA → Distortion → Output
 *   Voice 4: VCO + SubOsc ──┤
 *   Voice 5: VCO + SubOsc ──┘
 *
 * Features:
 *   - 6 oscillator voices with configurable waveform + sub-oscillators
 *   - Detune spread across voices for thick pad sound
 *   - Shared dual cascaded biquad filter (24dB/oct)
 *   - Configurable attack/release VCA envelope
 *   - Filter envelope with configurable attack (not fixed 3ms like 303)
 *   - Asymmetric soft-clip distortion
 *   - Tie mode glides pitch without re-triggering VCA
 */

export interface ChordsParams {
  waveform: "sawtooth" | "square" | "triangle";
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
}

export const DEFAULT_CHORDS_PARAMS: ChordsParams = {
  waveform: "sawtooth",
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
  tie: boolean;
}

// MIDI note to frequency
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Voice {
  osc: OscillatorNode;
  subOsc: OscillatorNode;
  subGain: GainNode;
}

const NUM_VOICES = 6;

export class ChordsEngine {
  private ctx: AudioContext | null = null;

  // 6 voice pairs
  private voices: Voice[] = [];

  // Shared mixer
  private mixer: GainNode | null = null;

  // VCF: two cascaded biquads for 24dB/oct
  private filter1: BiquadFilterNode | null = null;
  private filter2: BiquadFilterNode | null = null;

  // VCA + output
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private output: GainNode | null = null;

  private isRunning = false;
  private chordIsOn = false;

  params: ChordsParams = { ...DEFAULT_CHORDS_PARAMS };

  init(audioCtx: AudioContext): void {
    this.ctx = audioCtx;

    // --- Shared mixer ---
    this.mixer = audioCtx.createGain();
    this.mixer.gain.value = 1.0 / NUM_VOICES; // Normalize

    // --- Create 6 voice pairs ---
    const detuneSpread = [-1, -0.6, -0.2, 0.2, 0.6, 1]; // Spread multipliers
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

      // Route: osc → mixer, subOsc → subGain → mixer
      osc.connect(this.mixer);
      subOsc.connect(subGain);
      subGain.connect(this.mixer);

      osc.start();
      subOsc.start();

      this.voices.push({ osc, subOsc, subGain });
    }

    // --- VCF: dual cascaded biquad for 24dB/oct ---
    this.filter1 = audioCtx.createBiquadFilter();
    this.filter1.type = "lowpass";
    this.filter1.frequency.value = this.params.cutoff;
    this.filter1.Q.value = this.params.resonance;

    this.filter2 = audioCtx.createBiquadFilter();
    this.filter2.type = "lowpass";
    this.filter2.frequency.value = this.params.cutoff;
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

    // --- Signal chain: mixer → filter1 → filter2 → VCA → distortion → output ---
    this.mixer.connect(this.filter1);
    this.filter1.connect(this.filter2);
    this.filter2.connect(this.vca);
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

  /**
   * Schedule the filter envelope on both cascaded filters.
   * Uses configurable attack time (not fixed 3ms like the 303).
   * Accent boosts envelope depth.
   */
  private scheduleFilterEnvelope(time: number, accent: boolean, glide: boolean): void {
    if (!this.filter1 || !this.filter2) return;

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

    // -- Filter 1 (main) --
    this.filter1.frequency.cancelScheduledValues(time);
    if (glide) {
      // During tie/glide: smooth transition
      this.filter1.frequency.setTargetAtTime(filterPeak, time, attackSec / 3);
    } else {
      this.filter1.frequency.setValueAtTime(filterBase, time);
      this.filter1.frequency.linearRampToValueAtTime(filterPeak, time + attackSec);
    }
    this.filter1.frequency.setTargetAtTime(filterBase, time + attackSec, decayTau);

    // -- Filter 2 (cascaded) -- follows same envelope
    this.filter2.frequency.cancelScheduledValues(time);
    if (glide) {
      this.filter2.frequency.setTargetAtTime(filterPeak, time, attackSec / 3);
    } else {
      this.filter2.frequency.setValueAtTime(filterBase, time);
      this.filter2.frequency.linearRampToValueAtTime(filterPeak, time + attackSec);
    }
    this.filter2.frequency.setTargetAtTime(filterBase, time + attackSec, decayTau);
  }

  /** Trigger a chord (up to 6 voices) */
  triggerChord(midiNotes: number[], time: number, accent: boolean, tie: boolean): void {
    if (!this.ctx || !this.vca || this.voices.length === 0) return;

    const p = this.params;

    // --- Set each voice's frequency ---
    for (let i = 0; i < NUM_VOICES; i++) {
      const voice = this.voices[i];
      if (!voice) continue;

      if (i < midiNotes.length) {
        const freq = midiToFreq(midiNotes[i]!);
        const subFreq = freq / 2;

        if (tie && this.chordIsOn) {
          // Glide to new pitch
          const glideTau = p.attack / 1000 / 3;
          voice.osc.frequency.setTargetAtTime(freq, time, glideTau);
          voice.subOsc.frequency.setTargetAtTime(subFreq, time, glideTau);
        } else {
          voice.osc.frequency.setValueAtTime(freq, time);
          voice.subOsc.frequency.setValueAtTime(subFreq, time);
        }
      }
    }

    // --- VCA ---
    if (tie && this.chordIsOn) {
      // Tie: do NOT re-trigger VCA -- keep it open, just glide pitch + filter
      this.scheduleFilterEnvelope(time, accent, true);
    } else {
      // Normal trigger
      const attackSec = p.attack / 1000;
      const level = accent ? 1.0 : 0.75;

      this.vca.gain.cancelScheduledValues(time);
      this.vca.gain.setValueAtTime(0.001, time);
      this.vca.gain.linearRampToValueAtTime(level, time + attackSec);

      // Filter envelope
      this.scheduleFilterEnvelope(time, accent, false);
    }

    this.chordIsOn = true;
  }

  /** Release chord (exponential release with configurable time) */
  releaseChord(time: number): void {
    if (!this.vca) return;
    const releaseTau = this.params.release / 1000 / 3;
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setTargetAtTime(0, time, releaseTau);
    this.chordIsOn = false;
  }

  /** Rest (no chord on this step) */
  rest(time: number): void {
    this.releaseChord(time);
  }

  /** Update parameters live */
  setParams(p: Partial<ChordsParams>): void {
    Object.assign(this.params, p);

    if (p.waveform) {
      for (const voice of this.voices) {
        voice.osc.type = p.waveform;
      }
    }
    if (p.detune !== undefined) {
      const detuneSpread = [-1, -0.6, -0.2, 0.2, 0.6, 1];
      for (let i = 0; i < this.voices.length; i++) {
        const voice = this.voices[i];
        if (voice) {
          voice.osc.detune.value = p.detune * detuneSpread[i]!;
          voice.subOsc.detune.value = p.detune * detuneSpread[i]!;
        }
      }
    }
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
    if (p.subOsc !== undefined) {
      for (const voice of this.voices) {
        voice.subGain.gain.value = p.subOsc;
      }
    }
    if (p.filterType) {
      if (this.filter1) this.filter1.type = p.filterType;
      if (this.filter2) this.filter2.type = p.filterType;
    }
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

export const chordsEngine = new ChordsEngine();
