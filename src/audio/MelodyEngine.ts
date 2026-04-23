/**
 * Melody Synth Engine — Monophonic Analog Lead
 *
 * Architecture:
 *   Synth Types:
 *     - "subtractive": VCO (Saw/Square/Triangle) + Sub-Osc → VCF (filter model) → VCA → Distortion → Output
 *     - "fm": FM Synthesis (2-operator)
 *     - "am": Amplitude Modulation synthesis
 *     - "pluck": Karplus-Strong physical modeling
 *
 * Lead synth behaviour:
 *   - Filter envelope attack ~5ms (slightly softer than 303 for lead character)
 *   - Sharp exponential decay
 *   - Accent boosts filter envelope depth AND shortens decay
 *   - Self-oscillating resonance near max Q
 *   - Slide glides BOTH pitch AND filter cutoff
 *   - Note tie holds VCA open (no re-trigger) while gliding pitch/filter
 *   - Legato mode: always slides between notes regardless of step.slide flag
 *   - Sub-oscillator one octave below main VCO (subtractive only)
 *   - Filter cutoff range up to 12000 Hz for bright lead tones
 */

import { scaleNote } from "./BassEngine";
import { createFilterChain, type FilterModel, type FilterChain } from "./filters";
import { playFM, playAM, playPluck } from "./SynthVoices";
import { getWavetable, type WavetableName } from "./Wavetables";

export { scaleNote };

export interface MelodyParams {
  synthType: "subtractive" | "fm" | "am" | "pluck";  // Synthesis type
  waveform: "sawtooth" | "square" | "triangle" | "wavetable";
  wavetable?: WavetableName; // Used when waveform === "wavetable"
  filterModel: FilterModel;  // "lpf" | "ladder" | "steiner-lp" | "steiner-bp" | "steiner-hp"
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
  pulseWidth: number;  // PWM: 0-1, default 0.5
  unison: number;      // Unison detune spread: 0-1, default 0
  vibratoRate: number; // LFO rate: 0.5-8 Hz, default 4
  vibratoDepth: number; // LFO depth: 0-1, default 0
  fmHarmonicity: number; // FM carrier:modulator ratio, default 3
  fmModIndex: number;  // FM brightness, default 10
}

export const DEFAULT_MELODY_PARAMS: MelodyParams = {
  synthType: "subtractive",
  waveform: "sawtooth",
  filterModel: "lpf",
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
  pulseWidth: 0.5,
  unison: 0,
  vibratoRate: 4,
  vibratoDepth: 0,
  fmHarmonicity: 3,
  fmModIndex: 10,
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
  velocity?: number; // 0-1 note velocity
  slide: boolean;
  tie: boolean;       // Hold note across to next step (no re-trigger)
  gateLength?: number; // Step length in sequencer steps
}

interface PolyVoiceSlot {
  osc: OscillatorNode;
  sub: OscillatorNode;
  subGain: GainNode;
  filter: BiquadFilterNode;
  vca: GainNode;
  dist: WaveShaperNode;
  inUse: boolean;
  releaseAt: number; // audio-clock time when voice tail ends (for voice stealing)
}

export class MelodyEngine {
  private ctx: AudioContext | null = null;

  // VCO
  private osc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private oscMix: GainNode | null = null;

  // PWM (pulse width modulation) — for square waves
  private pwmOsc2: OscillatorNode | null = null;
  private pwmMix: GainNode | null = null;

  // Unison oscillators (3-voice unison)
  private unisonOsc1: OscillatorNode | null = null;
  private unisonOsc2: OscillatorNode | null = null;
  private unisonGain1: GainNode | null = null;
  private unisonGain2: GainNode | null = null;

  // Vibrato LFO
  private vibratoLfo: OscillatorNode | null = null;
  private vibratoGain: GainNode | null = null;

  // VCF: filter chain (replaces manual cascaded biquads) — used for subtractive only
  private filterChain: FilterChain | null = null;

  // VCA + output
  private vca: GainNode | null = null;
  private distNode: WaveShaperNode | null = null;
  private output: GainNode | null = null;

  private isRunning = false;
  private noteIsOn = false;
  private _autoReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  params: MelodyParams = { ...DEFAULT_MELODY_PARAMS };

  private applyWaveform(osc: OscillatorNode): void {
    if (!this.ctx) return;
    if (this.params.waveform === "wavetable") {
      osc.setPeriodicWave(getWavetable(this.ctx, this.params.wavetable ?? "harmonic"));
    } else {
      osc.type = this.params.waveform;
    }
  }

  init(audioCtx: AudioContext): void {
    // Clean up any existing pool before re-init (e.g. after AudioContext close/reopen)
    this.destroyPool();
    this.ctx = audioCtx;

    // --- VCO (main) ---
    this.osc = audioCtx.createOscillator();
    this.applyWaveform(this.osc);
    this.osc.frequency.value = 261.63; // C3 (MIDI 48)

    // --- Sub-oscillator (one octave below) ---
    this.subOsc = audioCtx.createOscillator();
    this.subOsc.type = "square"; // Sub is always square for weight
    this.subOsc.frequency.value = 261.63 / 2;

    this.subGain = audioCtx.createGain();
    this.subGain.gain.value = this.params.subOsc;

    // --- PWM for square waves (using two detuned sawtooths) ---
    this.pwmOsc2 = audioCtx.createOscillator();
    this.pwmOsc2.type = "sawtooth";
    this.pwmOsc2.frequency.value = 261.63;
    this.pwmOsc2.detune.value = 0; // Will be updated when PWM changes

    this.pwmMix = audioCtx.createGain();
    this.pwmMix.gain.value = 0; // Off by default (only active for square + PWM)

    // --- Unison oscillators ---
    this.unisonOsc1 = audioCtx.createOscillator();
    this.applyWaveform(this.unisonOsc1);
    this.unisonOsc1.frequency.value = 261.63;

    this.unisonOsc2 = audioCtx.createOscillator();
    this.applyWaveform(this.unisonOsc2);
    this.unisonOsc2.frequency.value = 261.63;

    this.unisonGain1 = audioCtx.createGain();
    this.unisonGain1.gain.value = 0; // Off by default

    this.unisonGain2 = audioCtx.createGain();
    this.unisonGain2.gain.value = 0; // Off by default

    // --- Vibrato LFO ---
    this.vibratoLfo = audioCtx.createOscillator();
    this.vibratoLfo.frequency.value = this.params.vibratoRate;

    this.vibratoGain = audioCtx.createGain();
    this.vibratoGain.gain.value = 0; // Off by default

    this.vibratoLfo.connect(this.vibratoGain);
    this.vibratoGain.connect(this.osc.frequency);
    this.vibratoGain.connect(this.subOsc.frequency);
    if (this.unisonOsc1) this.vibratoGain.connect(this.unisonOsc1.frequency);
    if (this.unisonOsc2) this.vibratoGain.connect(this.unisonOsc2.frequency);
    this.vibratoLfo.start();

    // Mixer node to combine all oscs before filter
    this.oscMix = audioCtx.createGain();
    this.oscMix.gain.value = 1.0;

    // --- VCF: use filter model (subtractive synth only) ---
    // For non-subtractive synths, filterChain remains null
    if (this.params.synthType === "subtractive") {
      this.filterChain = createFilterChain(audioCtx, this.params.filterModel);
    }

    // --- VCA ---
    this.vca = audioCtx.createGain();
    this.vca.gain.value = 0; // Start silent

    // --- Distortion ---
    this.distNode = audioCtx.createWaveShaper();
    this.updateDistortion();

    // --- Output ---
    this.output = audioCtx.createGain();
    this.output.gain.value = 0; // Muted until first note trigger

    // --- Signal chain ---
    // Main osc → mixer
    this.osc.connect(this.oscMix);

    // Sub osc → sub gain → mixer
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.oscMix);

    // PWM osc → PWM mix → mixer (for square wave PWM)
    this.pwmOsc2.connect(this.pwmMix);
    this.pwmMix.connect(this.oscMix);

    // Unison oscs → unison gains → mixer
    this.unisonOsc1.connect(this.unisonGain1);
    this.unisonGain1.connect(this.oscMix);
    this.unisonOsc2.connect(this.unisonGain2);
    this.unisonGain2.connect(this.oscMix);

    // Mixer → filterChain → VCA → distortion → output
    if (this.filterChain) {
      this.oscMix.connect(this.filterChain.input);
      this.filterChain.output.connect(this.vca);
    } else {
      // Fallback if filterChain not initialized (for non-subtractive synths)
      this.oscMix.connect(this.vca);
    }
    this.vca.connect(this.distNode);
    this.distNode.connect(this.output);

    // Start all oscillators
    this.osc.start();
    this.subOsc.start();
    this.pwmOsc2.start();
    this.unisonOsc1.start();
    this.unisonOsc2.start();
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
   * Schedule the filter envelope via the filter chain.
   * Fast attack (~5ms for lead character) and sharp exponential decay.
   * Accent dramatically increases the envelope depth and peak.
   */
  private scheduleFilterEnvelope(time: number, accent: boolean, slide: boolean): void {
    if (!this.filterChain) return;

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

    // Resonance normalized to 0-1 range for filter chain update
    const res = Math.min(p.resonance / 30, 1.0);

    if (slide) {
      // During slide: glide filter cutoff to peak over 1/3 of slideTime, then decay to base.
      // All three updates are queued synchronously as audio-timed parameter events —
      // no setTimeout (which mis-aligns wall-clock vs audio-clock).
      const glideTime = p.slideTime / 1000 / 3;
      this.filterChain.update(filterBase, res, time);
      this.filterChain.update(filterPeak, res, time + glideTime);
      this.filterChain.update(filterBase, res, time + p.slideTime / 1000);
    } else {
      // Fast 5ms attack to peak, then exponential decay back to base.
      // Queue all three events synchronously — correct audio-time scheduling.
      this.filterChain.update(filterBase, res, time);
      this.filterChain.update(filterPeak, res, time + attackTime);
      this.filterChain.update(filterBase, res, time + attackTime + decayTau);
    }
  }

  /** Trigger a melody note */
  triggerNote(midiNote: number, timeRaw: number, accent: boolean, slide: boolean, tie: boolean, velocity = 0.85): void {
    if (!this.ctx) return;
    // Clamp scheduling time to at least 2 ms in the future.
    // Scheduling in the past causes cancelScheduledValues to abruptly
    // zero the VCA, producing the characteristic crackle/click artefact.
    const time = Math.max(timeRaw, this.ctx.currentTime + 0.002);

    // Unmute output — 3ms ramp prevents DC clicks from running oscillators
    // while staying below audible soft-attack threshold (scene transitions
    // on bar-downbeats stay tight).
    if (this.output && this.output.gain.value === 0) {
      const t = this.ctx.currentTime;
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(0.0001, t);
      this.output.gain.linearRampToValueAtTime(this.params.volume, t + 0.003);
    }

    const p = this.params;

    // Dispatch based on synthesis type
    switch (p.synthType) {
      case "fm":
        // FM Synthesis with parameterized harmonicity and modIndex
        if (!this.ctx || !this.vca) return;
        playFM(
          this.ctx, this.vca, time,
          midiNote, p.volume * (0.45 + Math.max(0, Math.min(1, velocity)) * 0.55), 0.3,
          p.fmHarmonicity, p.fmModIndex,  // harmonicity, modIndex (from params)
          0.01, 0.2, 0.3, 0.1  // ADSR
        );
        break;

      case "am":
        // Amplitude Modulation
        if (!this.ctx || !this.vca) return;
        playAM(
          this.ctx, this.vca, time,
          midiNote, p.volume * (0.45 + Math.max(0, Math.min(1, velocity)) * 0.55), 0.3,
          2, 0.8,  // harmonicity, modDepth
          0.01, 0.15, 0.5, 0.1  // ADSR
        );
        break;

      case "pluck":
        // Karplus-Strong with parameterized dampening and resonance
        if (!this.ctx || !this.vca) return;
        playPluck(
          this.ctx, this.vca, time,
          midiNote, p.volume * (0.45 + Math.max(0, Math.min(1, velocity)) * 0.55), p.cutoff, 0.98
        );
        break;

      case "subtractive":
      default:
        // Subtractive synthesis
        if (!this.ctx || !this.osc || !this.subOsc || !this.filterChain || !this.vca) return;

        const freq = midiToFreq(midiNote);
        const subFreq = freq / 2; // One octave below

        // Legato mode: always slide between notes
        const useSlide = p.legato || slide;

        // --- Waveform-specific setup ---
        if (p.waveform === "square" && p.pulseWidth !== 0.5) {
          // PWM mode: Use two detuned sawtooths (osc1 - osc2 = variable width pulse)
          if (this.pwmOsc2 && this.pwmMix) {
            const pwmCents = (p.pulseWidth - 0.5) * 100; // Map 0-1 to ±50 cents
            this.pwmOsc2.detune.setValueAtTime(pwmCents, time);
            this.pwmMix.gain.setValueAtTime(0.5, time); // Mix two saws at equal level for PWM
          }
        } else if (this.pwmMix) {
          this.pwmMix.gain.setValueAtTime(0, time); // Disable PWM
        }

        // Unison mode: activate extra oscillators
        if (p.unison > 0 && this.unisonOsc1 && this.unisonOsc2 && this.unisonGain1 && this.unisonGain2) {
          const unisonDetune = p.unison * 15; // 0-1 maps to 0-15 cents spread
          this.unisonOsc1.detune.setValueAtTime(-unisonDetune, time);
          this.unisonOsc2.detune.setValueAtTime(unisonDetune, time);
          this.unisonGain1.gain.setValueAtTime(0.33, time); // 3-voice mix (1/3 each)
          this.unisonGain2.gain.setValueAtTime(0.33, time);
        } else if (this.unisonGain1 && this.unisonGain2) {
          this.unisonGain1.gain.setValueAtTime(0, time);
          this.unisonGain2.gain.setValueAtTime(0, time);
        }

        // Vibrato LFO
        if (this.vibratoLfo && this.vibratoGain) {
          this.vibratoLfo.frequency.setValueAtTime(p.vibratoRate, time);
          this.vibratoGain.gain.setValueAtTime(p.vibratoDepth * 20, time); // Depth in Hz (0-20 Hz max)
        }

        // --- Pitch ---
        if (useSlide && p.slideTime > 0) {
          // Slide: exponential glide to target frequency
          const slideTau = p.slideTime / 1000 / 3;
          this.osc.frequency.setTargetAtTime(freq, time, slideTau);
          this.subOsc.frequency.setTargetAtTime(subFreq, time, slideTau);
          if (this.unisonOsc1) this.unisonOsc1.frequency.setTargetAtTime(freq, time, slideTau);
          if (this.unisonOsc2) this.unisonOsc2.frequency.setTargetAtTime(freq, time, slideTau);
          if (this.pwmOsc2) this.pwmOsc2.frequency.setTargetAtTime(freq, time, slideTau);
        } else {
          this.osc.frequency.setValueAtTime(freq, time);
          this.subOsc.frequency.setValueAtTime(subFreq, time);
          if (this.unisonOsc1) this.unisonOsc1.frequency.setValueAtTime(freq, time);
          if (this.unisonOsc2) this.unisonOsc2.frequency.setValueAtTime(freq, time);
          if (this.pwmOsc2) this.pwmOsc2.frequency.setValueAtTime(freq, time);
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
          const velocityLevel = 0.45 + Math.max(0, Math.min(1, velocity)) * 0.55;
          const level = (accent ? 1.0 : 0.75) * velocityLevel;
          this.vca.gain.setValueAtTime(0.001, time);
          this.vca.gain.linearRampToValueAtTime(level, time + 0.005);

          // Filter envelope: the heart of the lead sound
          this.scheduleFilterEnvelope(time, accent, useSlide);
        }

        this.noteIsOn = true;

        // Auto-release safety net (4s max)
        if (this._autoReleaseTimer) clearTimeout(this._autoReleaseTimer);
        this._autoReleaseTimer = setTimeout(() => {
          this._autoReleaseTimer = null;
          if (this.noteIsOn) this.releaseNote(this.ctx?.currentTime ?? 0);
        }, 4000);
        break;
    }
  }

  /** Release (note off) */
  releaseNote(time: number): void {
    if (!this.vca || !this.ctx) return;
    // Clamp to 1 ms ahead to avoid cancelling already-applied envelope work
    const safeTime = Math.max(time, this.ctx.currentTime + 0.001);
    this.vca.gain.cancelScheduledValues(safeTime);
    // Fairly fast release but not instant
    this.vca.gain.setTargetAtTime(0, safeTime, 0.015);
    this.noteIsOn = false;
    if (this._autoReleaseTimer) { clearTimeout(this._autoReleaseTimer); this._autoReleaseTimer = null; }
  }

  /** Rest (no note on this step) */
  rest(time: number): void {
    this.releaseNote(time);
  }

  /** Emergency stop for stuck notes */
  panic(time?: number): void {
    if (!this.ctx || !this.vca) return;
    const t = time ?? this.ctx.currentTime;
    this.vca.gain.cancelScheduledValues(t);
    this.vca.gain.setValueAtTime(0, t);
    if (this.output) {
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(0, t);
    }
    this.noteIsOn = false;
  }

  /** Update parameters live */
  setParams(p: Partial<MelodyParams>): void {
    // Capture before merging — Object.assign mutates this.params immediately,
    // so comparisons like `p.x !== this.params.x` below would always be false.
    const prevFilterModel = this.params.filterModel;
    const prevSynthType = this.params.synthType;
    Object.assign(this.params, p);

    if (this.osc && (p.waveform || p.wavetable)) {
      this.applyWaveform(this.osc);
      if (this.unisonOsc1) this.applyWaveform(this.unisonOsc1);
      if (this.unisonOsc2) this.applyWaveform(this.unisonOsc2);
    }
    if (p.vibratoRate !== undefined && this.vibratoLfo) {
      this.vibratoLfo.frequency.value = p.vibratoRate;
    }
    if (p.vibratoDepth !== undefined && this.vibratoGain) {
      this.vibratoGain.gain.value = p.vibratoDepth * 20;
    }

    // Hot-swap synthType: create/destroy filter chain as needed
    if (p.synthType && p.synthType !== prevSynthType) {
      const switchingToSubtractive = p.synthType === "subtractive";

      if (switchingToSubtractive && !this.filterChain && this.ctx && this.oscMix && this.vca) {
        // Switching TO subtractive: create and wire filter chain
        this.filterChain = createFilterChain(this.ctx, this.params.filterModel);
        this.oscMix.disconnect(this.vca);
        this.oscMix.connect(this.filterChain.input);
        this.filterChain.output.connect(this.vca);
        // Apply current params to new filter
        const cutoff = this.params.cutoff;
        const res = Math.min(this.params.resonance / 30, 1.0);
        this.filterChain.update(cutoff, res, this.ctx.currentTime);
      } else if (!switchingToSubtractive && this.filterChain && this.oscMix && this.vca) {
        // Switching FROM subtractive: disconnect filter chain, bypass to VCA
        this.oscMix.disconnect(this.filterChain.input);
        this.filterChain.output.disconnect(this.vca);
        this.oscMix.connect(this.vca);
        // Keep filterChain for potential future use
      }
    }

    if (this.filterChain) {
      if (p.cutoff !== undefined || p.resonance !== undefined) {
        const cutoff = p.cutoff ?? this.params.cutoff;
        const res = Math.min((p.resonance ?? this.params.resonance) / 30, 1.0);
        this.filterChain.update(cutoff, res, this.ctx?.currentTime ?? 0);
      }
      // Hot-swap filter chain when filterModel changes (only matters for subtractive)
      if (p.filterModel && p.filterModel !== prevFilterModel && this.params.synthType === "subtractive") {
        if (this.ctx && this.oscMix && this.vca) {
          // Disconnect old filter chain from signal path
          this.oscMix.disconnect(this.filterChain.input);
          this.filterChain.output.disconnect(this.vca);

          // Create new filter chain
          this.filterChain = createFilterChain(this.ctx, p.filterModel);

          // Reconnect new filter chain to signal path
          this.oscMix.connect(this.filterChain.input);
          this.filterChain.output.connect(this.vca);

          // Apply current cutoff/resonance to new filter
          const cutoff = this.params.cutoff;
          const res = Math.min(this.params.resonance / 30, 1.0);
          this.filterChain.update(cutoff, res, this.ctx.currentTime);
        }
      }
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

  /** Stop all running oscillators and clear context reference.
   *  Call before AudioContext.close() to avoid orphaned oscillators. */
  destroy(): void {
    this.destroyPool();
    for (const osc of [this.osc, this.subOsc, this.unisonOsc1, this.unisonOsc2, this.vibratoLfo]) {
      if (osc) {
        try { osc.stop(); } catch { /* already stopped */ }
      }
    }
    this.osc = null;
    this.subOsc = null;
    this.unisonOsc1 = null;
    this.unisonOsc2 = null;
    this.vibratoLfo = null;
    this.isRunning = false;
    this.ctx = null;
  }

  /**
   * POLYPHONIC voices — pool-based, zero GC.
   *
   * Instead of creating new Web Audio nodes per trigger (GC pressure, CPU spikes),
   * we maintain a fixed pool of pre-allocated voice graphs. Oscillators run
   * continuously at VCA=0 when idle. On trigger we just schedule parameter events
   * — no node allocation, no node destruction, no GC.
   *
   * Pool size: 16 subtractive voices (covers arp + 4-note chord layers comfortably).
   * Non-subtractive types (FM/AM/pluck) stay fire-and-forget (they're cheap one-shots).
   */

  // ── Pool types & state ─────────────────────────────────────────────────────

  private static readonly POOL_SIZE = 16;

  private voicePool: PolyVoiceSlot[] = [];

  private poolReady = false;

  // ── Pool lifecycle ──────────────────────────────────────────────────────────

  private initPool(): void {
    if (this.poolReady || !this.ctx || !this.output) return;
    const ctx = this.ctx;

    for (let i = 0; i < MelodyEngine.POOL_SIZE; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 261.63;

      const sub = ctx.createOscillator();
      sub.type = "square";
      sub.frequency.value = 130.81;

      const subGain = ctx.createGain();
      subGain.gain.value = 0;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2000;
      filter.Q.value = 1;

      const vca = ctx.createGain();
      vca.gain.value = 0; // silent until triggered

      const dist = ctx.createWaveShaper();
      dist.curve = null; // bypass until distortion > 0

      // Wire: osc+sub → filter → vca → dist → output
      osc.connect(filter);
      sub.connect(subGain);
      subGain.connect(filter);
      filter.connect(vca);
      vca.connect(dist);
      dist.connect(this.output);

      osc.start();
      sub.start();

      this.voicePool.push({
        osc, sub, subGain, filter, vca, dist,
        inUse: false,
        releaseAt: 0,
      });
    }
    this.poolReady = true;
  }

  private acquirePoolVoice(): PolyVoiceSlot | null {
    const pool = this.voicePool;
    // 1. Prefer an idle slot
    for (const v of pool) {
      if (!v.inUse) { v.inUse = true; return v; }
    }
    // 2. Steal the voice whose envelope ends soonest (least perceptible interruption)
    let oldest = pool[0]!;
    for (const v of pool) {
      if (v.releaseAt < oldest.releaseAt) oldest = v;
    }
    // Hard-silence the stolen voice immediately
    if (this.ctx) {
      const now = this.ctx.currentTime;
      oldest.vca.gain.cancelScheduledValues(now);
      oldest.vca.gain.setValueAtTime(0, now);
    }
    oldest.inUse = true;
    return oldest;
  }

  private releasePoolVoice(
    voice: PolyVoiceSlot,
    releaseEndTime: number,
  ): void {
    // Return to pool after the release tail finishes.
    // Use JS timer — cheap, not on audio thread.
    const msUntilFree = Math.max(50, (releaseEndTime - (this.ctx?.currentTime ?? 0)) * 1000);
    setTimeout(() => { voice.inUse = false; }, msUntilFree);
    voice.releaseAt = releaseEndTime;
  }

  // ── Trigger ────────────────────────────────────────────────────────────────

  triggerPolyNote(
    midiNote: number,
    startTime: number,
    duration: number,
    velocity = 0.85,
    accent = false
  ): (() => void) | null {
    if (!this.ctx || !this.output) return null;

    // Unmute output bus — 3ms click-safe, scene-transition-tight
    if (this.output.gain.value === 0) {
      const t = this.ctx.currentTime;
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(0.0001, t);
      this.output.gain.linearRampToValueAtTime(this.params.volume, t + 0.003);
    }

    const p = this.params;
    const ctx = this.ctx;
    const velLevel = 0.35 + Math.max(0, Math.min(1, velocity)) * 0.65;
    const accentBoost = accent ? (1 + p.accent * 0.8) : 1;
    const level = velLevel * accentBoost;

    // Non-subtractive: lightweight fire-and-forget helpers (no node explosion risk)
    switch (p.synthType) {
      case "fm":
        playFM(
          ctx, this.output, startTime,
          midiNote, p.volume * level, duration,
          p.fmHarmonicity, p.fmModIndex,
          0.008, Math.max(0.06, duration * 0.3), 0.3, Math.max(0.05, duration * 0.3)
        );
        return null;
      case "am":
        playAM(
          ctx, this.output, startTime,
          midiNote, p.volume * level, duration,
          2, 0.8,
          0.008, 0.15, 0.5, Math.max(0.05, duration * 0.3)
        );
        return null;
      case "pluck":
        playPluck(
          ctx, this.output, startTime,
          midiNote, p.volume * level, p.cutoff, 0.98
        );
        return null;
    }

    // ── Subtractive: use pool voice — zero allocation ──────────────────────

    if (!this.poolReady) this.initPool();
    const voice = this.acquirePoolVoice();
    if (!voice) return null;

    const { osc, sub, subGain, filter, vca, dist } = voice;
    const freq = midiToFreq(midiNote);

    // Update oscillator waveform + frequency
    this.applyWaveform(osc);
    osc.frequency.cancelScheduledValues(startTime);
    osc.frequency.setValueAtTime(freq, startTime);

    sub.frequency.cancelScheduledValues(startTime);
    sub.frequency.setValueAtTime(freq / 2, startTime);
    subGain.gain.cancelScheduledValues(startTime);
    subGain.gain.setValueAtTime(p.subOsc, startTime);

    // Update filter
    const fType = (p.filterType === "highpass" || p.filterType === "bandpass" || p.filterType === "notch")
      ? p.filterType : "lowpass";
    filter.type = fType;
    filter.Q.value = Math.max(0.0001, p.resonance * 0.6);

    // Update distortion curve (reuse from mono path — same shape)
    dist.curve = (p.distortion > 0.01 && this.distNode?.curve) ? this.distNode.curve : null;
    dist.oversample = p.distortion > 0.01 ? "2x" : "none";

    // ── Filter envelope ────────────────────────────────────────────────────
    const envAmount = p.envMod * (accent ? 1 + p.accent * 2 : 1);
    const filterPeak = Math.min(p.cutoff + envAmount * 10000, 18000);
    const filterBase = Math.max(p.cutoff, 40);
    const fAttack = 0.005;
    const fDecaySec = (p.decay / 1000) * (accent ? 0.5 : 1);

    filter.frequency.cancelScheduledValues(startTime);
    filter.frequency.setValueAtTime(filterBase, startTime);
    filter.frequency.linearRampToValueAtTime(filterPeak, startTime + fAttack);
    filter.frequency.setTargetAtTime(filterBase, startTime + fAttack, Math.max(0.02, fDecaySec / 3.5));

    // ── Amp envelope ───────────────────────────────────────────────────────
    const attack = 0.006;
    const decayT = Math.min(0.12, duration * 0.25);
    const sustain = 0.78;
    const release = Math.min(0.9, Math.max(0.04, duration * 0.35));
    const peak = level;
    const sustainLvl = peak * sustain;
    const scheduledReleaseStart = startTime + Math.max(attack + decayT, duration);
    const releaseEndTime = scheduledReleaseStart + release;

    vca.gain.cancelScheduledValues(startTime);
    vca.gain.setValueAtTime(0.0001, startTime);
    vca.gain.linearRampToValueAtTime(peak, startTime + attack);
    vca.gain.linearRampToValueAtTime(sustainLvl, startTime + attack + decayT);
    vca.gain.setValueAtTime(sustainLvl, scheduledReleaseStart);
    vca.gain.exponentialRampToValueAtTime(0.0001, releaseEndTime);
    // Ensure silence after release — pool voice must go fully quiet
    vca.gain.setValueAtTime(0, releaseEndTime + 0.005);

    // Schedule return to pool
    this.releasePoolVoice(voice, releaseEndTime + 0.01);

    // ── Early-release handle (pointer-up on XY pad, note-off, etc.) ────────
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const t = Math.max(ctx.currentTime, startTime + attack);
      vca.gain.cancelScheduledValues(t);
      vca.gain.setTargetAtTime(0.0001, t, release / 4);
      // Silence + pool return after early-release tail
      const earlyEnd = t + release + 0.06;
      vca.gain.setValueAtTime(0, earlyEnd);
      this.releasePoolVoice(voice, earlyEnd);
    };
  }

  // ── Pool teardown ──────────────────────────────────────────────────────────

  private destroyPool(): void {
    for (const v of this.voicePool) {
      try { v.osc.stop(); } catch { /* ok */ }
      try { v.sub.stop(); } catch { /* ok */ }
      try { v.osc.disconnect(); } catch { /* ok */ }
      try { v.sub.disconnect(); } catch { /* ok */ }
      try { v.subGain.disconnect(); } catch { /* ok */ }
      try { v.filter.disconnect(); } catch { /* ok */ }
      try { v.vca.disconnect(); } catch { /* ok */ }
      try { v.dist.disconnect(); } catch { /* ok */ }
    }
    this.voicePool = [];
    this.poolReady = false;
  }
}

export const melodyEngine = new MelodyEngine();
