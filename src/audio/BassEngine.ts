/**
 * Bass Synth Engine — TB-303 Style
 *
 * Architecture:
 *   VCO (Saw/Square) → VCF (Resonant 24dB LP) → VCA → Distortion → Output
 *
 * Features:
 *   - Sawtooth or Square waveform
 *   - Resonant lowpass filter with envelope
 *   - Accent (boosts filter envelope depth)
 *   - Slide/Glide (portamento between notes)
 *   - Built-in distortion for acid character
 */

// Bass synth engine — standalone, connected to AudioContext directly

export interface BassParams {
  waveform: "sawtooth" | "square";
  cutoff: number;      // Filter cutoff Hz (200-8000)
  resonance: number;   // Filter Q (0-30)
  envMod: number;      // Filter envelope depth (0-1)
  decay: number;       // Filter envelope decay ms (50-1000)
  accent: number;      // Accent intensity (0-1)
  slideTime: number;   // Portamento time ms (0-200)
  distortion: number;  // Drive amount (0-1)
  volume: number;      // Output level (0-1)
}

export const DEFAULT_BASS_PARAMS: BassParams = {
  waveform: "sawtooth",
  cutoff: 600,
  resonance: 12,
  envMod: 0.6,
  decay: 200,
  accent: 0.5,
  slideTime: 60,
  distortion: 0.3,
  volume: 0.7,
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
}

export class BassEngine {
  private ctx: AudioContext | null = null;

  // Persistent oscillator + filter (for slide/portamento)
  private osc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private output: GainNode | null = null;
  private isRunning = false;

  params: BassParams = { ...DEFAULT_BASS_PARAMS };

  init(audioCtx: AudioContext): void {
    this.ctx = audioCtx;

    // Build signal chain: VCO → VCF → VCA → Distortion → Output → Master
    this.osc = audioCtx.createOscillator();
    this.osc.type = this.params.waveform;
    this.osc.frequency.value = 130.81; // C3

    // 24dB resonant lowpass (two cascaded biquads for steeper slope)
    this.filter = audioCtx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.params.cutoff;
    this.filter.Q.value = this.params.resonance;

    this.vca = audioCtx.createGain();
    this.vca.gain.value = 0; // Start silent

    // Distortion
    this.distNode = audioCtx.createWaveShaper();
    this.updateDistortion();

    this.output = audioCtx.createGain();
    this.output.gain.value = this.params.volume;

    // Connect chain
    this.osc.connect(this.filter);
    this.filter.connect(this.vca);
    this.vca.connect(this.distNode);
    this.distNode.connect(this.output);

    // Connect to master (via audioEngine's destination)
    this.output.connect(audioCtx.destination);

    this.osc.start();
    this.isRunning = true;
  }

  private updateDistortion(): void {
    if (!this.distNode) return;
    const drive = this.params.distortion;
    if (drive < 0.01) {
      this.distNode.curve = null;
      return;
    }
    const curve = new Float32Array(512);
    const gain = 1 + drive * 10;
    for (let i = 0; i < 512; i++) {
      const x = (i / 256 - 1) * gain;
      curve[i] = Math.tanh(x);
    }
    this.distNode.curve = curve;
    this.distNode.oversample = "4x";
  }

  /** Trigger a bass note */
  triggerNote(midiNote: number, time: number, accent: boolean, slide: boolean): void {
    if (!this.ctx || !this.osc || !this.filter || !this.vca) return;

    const freq = midiToFreq(midiNote);
    const p = this.params;

    // Pitch: slide or instant
    if (slide && p.slideTime > 0) {
      this.osc.frequency.setTargetAtTime(freq, time, p.slideTime / 1000 / 3);
    } else {
      this.osc.frequency.setValueAtTime(freq, time);
    }

    // VCA envelope: instant attack, release handled by next note or rest
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setValueAtTime(accent ? 1.0 : 0.8, time);

    // Filter envelope: the heart of the 303 sound
    const envDepth = p.envMod * (accent ? 1.5 : 1.0); // Accent boosts envelope
    const filterPeak = Math.min(p.cutoff + envDepth * 6000, 12000);
    const decaySec = p.decay / 1000 * (accent ? 0.7 : 1.0); // Accent = faster decay

    this.filter.frequency.cancelScheduledValues(time);
    this.filter.frequency.setValueAtTime(filterPeak, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(p.cutoff, 20), time + decaySec
    );
  }

  /** Release (note off) */
  releaseNote(time: number): void {
    if (!this.vca) return;
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setTargetAtTime(0, time, 0.02);
  }

  /** Rest (no note on this step) */
  rest(time: number): void {
    this.releaseNote(time);
  }

  /** Update parameters */
  setParams(p: Partial<BassParams>): void {
    Object.assign(this.params, p);

    if (this.osc && p.waveform) this.osc.type = p.waveform;
    if (this.filter) {
      if (p.cutoff !== undefined) this.filter.frequency.value = p.cutoff;
      if (p.resonance !== undefined) this.filter.Q.value = p.resonance;
    }
    if (this.output && p.volume !== undefined) this.output.gain.value = p.volume;
    if (p.distortion !== undefined) this.updateDistortion();
  }

  get isInitialized(): boolean {
    return this.isRunning;
  }
}

export const bassEngine = new BassEngine();
