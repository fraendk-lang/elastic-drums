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
import { getWavetable, type WavetableName } from "./Wavetables";

export type FilterMode = "lowpass" | "highpass" | "bandpass" | "notch";

export interface BassParams {
  waveform: "sawtooth" | "square" | "wavetable";
  wavetable?: WavetableName;
  filterType: FilterMode;
  filterModel: FilterModel;  // "lpf" | "ladder" | "steiner-lp" | "steiner-bp" | "steiner-hp"
  cutoff: number;      // Filter cutoff Hz (200-8000)
  resonance: number;   // Filter Q (0-30)
  envMod: number;      // Filter envelope depth (0-1)
  decay: number;       // Filter envelope decay ms (50-1000)
  accent: number;      // Accent intensity (0-1)
  slideTime: number;   // Portamento time ms (0-200)
  legato: boolean;     // When true, every note slides to the next (acid-style glide)
  distortion: number;  // Drive amount (0-1)
  volume: number;      // Output level (0-1)
  subOsc: number;      // Sub-oscillator level (0-1), 0 = off
  punch: number;       // Transient punch amount (0-1), default 0.3
  harmonics: number;   // Harmonic enhancer mix (0-1), default 0.15
  subFilter: number;   // Sub lowpass cutoff (30-150Hz), default 80
  lfoEnabled:  boolean;
  lfoTarget:   "filter" | "pitch" | "volume";
  lfoShape:    "sine" | "triangle" | "sawtooth" | "square";
  lfoRate:     number;   // 0.1–20 Hz (free)
  lfoDepth:    number;   // 0–1
  lfoSync:     boolean;
  lfoSyncNote: "1/16" | "1/8" | "1/4" | "1/2" | "1" | "2" | "4";
}

export const DEFAULT_BASS_PARAMS: BassParams = {
  waveform: "sawtooth",
  filterType: "lowpass",
  filterModel: "ladder",  // Moog-style for classic 303 warmth
  // Balanced 303 defaults: cutoff open enough to hear the resonance sweep,
  // resonance at 7 gives the classic "wah" without self-oscillation.
  // envMod at 0.65 gives a satisfying filter opening on each note.
  cutoff: 450,        // was 200 — audible starting point, accent sweeps up
  resonance: 7,       // was 0 — the defining 303 character
  envMod: 0.65,       // was 0.75 — slightly narrower sweep for tighter feel
  decay: 180,         // was 200 — snappier envelope
  accent: 0.5,
  slideTime: 60,
  legato: false,
  distortion: 0.14,   // was 0.08 — more analog grit and warmth
  volume: 0.7,
  subOsc: 0,
  punch: 0.35,        // was 0.3 — slightly more transient snap
  harmonics: 0.15,
  subFilter: 80,
  lfoEnabled:  false,
  lfoTarget:   "filter",
  lfoShape:    "sine",
  lfoRate:     2.0,
  lfoDepth:    0.3,
  lfoSync:     false,
  lfoSyncNote: "1/4",
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

function lfoWave(shape: BassParams["lfoShape"], phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  switch (shape) {
    case "sine":     return Math.sin(2 * Math.PI * p);
    case "triangle": return 1 - 4 * Math.abs(p - 0.5);
    case "sawtooth": return p * 2 - 1;
    case "square":   return p < 0.5 ? 1 : -1;
  }
}

const SYNC_BEATS: Record<BassParams["lfoSyncNote"], number> = {
  "1/16": 0.25, "1/8": 0.5, "1/4": 1, "1/2": 2, "1": 4, "2": 8, "4": 16,
};

export interface BassStep {
  active: boolean;
  note: number;      // Scale degree (0-based)
  octave: number;    // -1, 0, +1
  accent: boolean;
  velocity?: number; // 0-1 note velocity
  slide: boolean;
  tie: boolean;       // Legato continuation / no re-trigger from previous step
  gateLength?: number; // Step length in sequencer steps (1 = default 16th)
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

  // Auto-release safety net: setTimeout that cannot be killed by cancelScheduledValues
  private _autoReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  /** rAF handle — replaces setInterval for jitter-free, audio-clock-driven LFO */
  private _lfoRaf: number | null = null;
  /** Phase accumulated up to the last startLFO call */
  private _lfoPhaseBase = 0;
  /** ctx.currentTime at the moment the current rAF loop was launched */
  private _lfoStartAudioTime = 0;
  private _bpm = 120;
  private _filterEnvFreq = -1;

  params: BassParams = { ...DEFAULT_BASS_PARAMS };

  init(audioCtx: AudioContext): void {
    // C2 fix: idempotent re-init — clean up previous state if already running
    if (this.isRunning) this.destroy();
    this.ctx = audioCtx;

    // --- VCO (main) ---
    this.osc = audioCtx.createOscillator();
    if (this.params.waveform === "wavetable") {
      this.osc.setPeriodicWave(getWavetable(audioCtx, this.params.wavetable ?? "harmonic"));
    } else {
      this.osc.type = this.params.waveform;
    }
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
    this.dcBlocker.frequency.value = 30; // Higher cutoff to effectively remove DC offset
    this.dcBlocker.Q.value = 0.7;

    // --- Output (starts muted — unmuted on first triggerNote) ---
    this.output = audioCtx.createGain();
    this.output.gain.value = 0;

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
    // Start LFO if it was enabled before init (e.g. preset loaded before audio context)
    if (this.params.lfoEnabled) this.startLFO();

    // ── Analog drift — slow randomised pitch wobble on both oscillators ────
    // Real analogue VCOs drift continuously due to thermal effects on the
    // exponential converter, capacitor leakage and component tolerance.
    // The drift is what makes analogue synths sound "alive" — perfectly
    // stable digital oscillators sound sterile by comparison.
    //
    // Implementation: two slow random-walk LFOs (~0.07-0.12 Hz) at slightly
    // different rates so they decorrelate over time, summed into each osc's
    // detune AudioParam at ±2 cents. Below human "tuning" perception
    // (~5 cents) so it's felt as warmth, not as out-of-tune. Started once
    // at init and runs forever — has no relationship with note triggers.
    const driftDepth = 2; // cents
    const driftLfo1 = audioCtx.createOscillator();
    driftLfo1.type = "sine";
    driftLfo1.frequency.value = 0.09; // ~11 sec period
    const driftGain1 = audioCtx.createGain();
    driftGain1.gain.value = driftDepth;
    driftLfo1.connect(driftGain1);
    driftGain1.connect(this.osc.detune);

    const driftLfo2 = audioCtx.createOscillator();
    driftLfo2.type = "sine";
    driftLfo2.frequency.value = 0.073; // ~14 sec period — non-integer ratio
    const driftGain2 = audioCtx.createGain();
    driftGain2.gain.value = driftDepth * 0.8;
    driftLfo2.connect(driftGain2);
    driftGain2.connect(this.subOsc.detune);

    driftLfo1.start();
    driftLfo2.start();
  }

  private updateDistortion(): void {
    if (!this.distNode) return;
    const drive = this.params.distortion;
    if (drive < 0.01) {
      this.distNode.curve = null;
      return;
    }
    // Analog-style soft-clip saturation (no DC bias — was causing audible hum at idle)
    const samples = 2048;
    const curve = new Float32Array(samples);
    const driveGain = 1 + drive * 8;
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples / 2) - 1) * driveGain;
      // Symmetric tanh saturation — clean, warm, no DC offset
      curve[i] = Math.tanh(x);
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
   * Fast attack + sharp exponential decay using pre-scheduled AudioParam automation.
   *
   * Runs entirely on the audio thread — immune to JS/GC/React timer jitter.
   * This eliminates the click/dropout artefacts on Safari that the old
   * setInterval(16ms) approach caused when the main thread stalled.
   */
  private scheduleFilterEnvelope(time: number, accent: boolean, slide: boolean, velocity = 1.0): void {
    if (!this.filterChain || !this.ctx) return;

    const p = this.params;
    const accentMul = accent ? (1.0 + p.accent * 2.5) : 1.0;
    // Velocity-sensitive envMod: accent notes always open fully; non-accent scales by velocity
    const velFactor = accent ? 1.0 : Math.pow(Math.max(0.1, Math.min(1.0, velocity)), 0.65);
    const envDepth = p.envMod * accentMul * velFactor;
    const filterPeak = Math.min(p.cutoff + envDepth * 8000, 18000);
    const filterBase = Math.max(p.cutoff, 20);
    const decaySec = (p.decay / 1000) * (accent ? 0.4 : 1.0);
    const res = Math.min(p.resonance / 30, 1.0);
    const attackSec = ((slide || p.legato) ? p.slideTime : 3) / 1000;

    // All scheduling happens on the audio thread — no JS timer needed.
    this.filterChain.scheduleEnvelope(filterBase, filterPeak, attackSec, decaySec, res, time);
    // Keep _filterEnvFreq updated for LFO filter-mod base (approximate peak)
    this._filterEnvFreq = filterPeak;
  }

  /** Trigger a bass note */
  triggerNote(midiNote: number, time: number, accent: boolean, slide: boolean, tie: boolean, velocity = 0.85): void {
    if (!this.ctx || !this.osc || !this.subOsc || !this.filterChain || !this.vca) return;

    const freq = midiToFreq(midiNote);
    const subFreq = freq / 2; // One octave below
    const p = this.params;

    // Unmute output — 3 ms click-safe ramp, scene-transition-tight.
    //
    // Previously this only fired when `output.gain.value === 0`. Bug: if the
    // panic ramp from sceneStore.loadScene was MID-DESCENT (e.g. heading
    // toward 0 over 8 ms but only 3 ms in), `.value` was still ~0.5, the
    // unmute-guard skipped the reset, and the panic ramp continued running
    // → finished at 0 a few ms later → cut the new scene's first bass note
    // mid-trigger. Frank-described as "dezente Sprünge" at scene changes.
    //
    // Fix: always cancel any scheduled values + ramp up to target volume.
    // Cheap and idempotent — a fresh trigger while idle (already at volume)
    // just sets-then-ramps to the same value = inaudible no-op.
    if (this.output && this.ctx) {
      const t = this.ctx.currentTime;
      const curValue = this.output.gain.value;
      this.output.gain.cancelScheduledValues(t);
      if (this.params.lfoEnabled && this.params.lfoTarget === "volume") {
        // LFO controls output gain — set directly so the ramp doesn't fight the LFO
        this.output.gain.setValueAtTime(this.params.volume, t);
      } else {
        this.output.gain.setValueAtTime(Math.max(0.0001, curValue), t);
        this.output.gain.linearRampToValueAtTime(this.params.volume, t + 0.003);
      }
    }

    // Legato mode forces slide on every note (acid-style glide between all notes)
    const useSlide = slide || p.legato;

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

    // --- VCA with punch envelope ---
    if (tie && this.noteIsOn) {
      // Tie: do NOT re-trigger VCA -- keep it open, just glide pitch + filter
      // Only re-trigger the filter envelope mildly for squelch
      this.scheduleFilterEnvelope(time, accent, true, velocity);
    } else {
      // Normal trigger or first note
      // VCA: fast attack with transient punch for percussive character
      this.vca.gain.cancelScheduledValues(time);
      const velocityLevel = 0.45 + Math.max(0, Math.min(1, velocity)) * 0.55;
      const level = (accent ? 1.0 : 0.75) * velocityLevel;
      const punchAmount = accent ? p.punch * 0.4 : p.punch * 0.15; // Scale punch by accent

      // Transient punch: brief overshoot at note onset for attack
      this.vca.gain.setValueAtTime(0.001, time);
      this.vca.gain.linearRampToValueAtTime(level + punchAmount, time + 0.002); // 2ms overshoot
      this.vca.gain.linearRampToValueAtTime(level, time + 0.008); // 6ms settle to sustain level

      // Filter envelope: the heart of the 303 sound (velocity-sensitive)
      this.scheduleFilterEnvelope(time, accent, useSlide, velocity);
    }

    this.noteIsOn = true;

    // Auto-release safety net: force-release after 4 seconds max.
    // Uses setTimeout which CANNOT be cancelled by cancelScheduledValues.
    // This guarantees no note hangs forever, regardless of scheduling conflicts.
    if (this._autoReleaseTimer) clearTimeout(this._autoReleaseTimer);
    this._autoReleaseTimer = setTimeout(() => {
      this._autoReleaseTimer = null;
      if (this.noteIsOn) this.releaseNote(this.ctx?.currentTime ?? 0);
    }, 4000);
  }

  /** Release (note off) */
  releaseNote(time: number): void {
    if (!this.vca) return;
    this.vca.gain.cancelScheduledValues(time);
    // 303-style release: fairly fast but not instant
    this.vca.gain.setTargetAtTime(0, time, 0.015);
    this.noteIsOn = false;
    // Clear auto-release timer since we're releasing now
    if (this._autoReleaseTimer) { clearTimeout(this._autoReleaseTimer); this._autoReleaseTimer = null; }
    // Cancel any scheduled filter envelope — smoothly return to cutoff
    if (this.filterChain && this.ctx) {
      this.filterChain.cancelEnvelope(Math.max(this.params.cutoff, 20), Math.min(this.params.resonance / 30, 1.0), time);
    }
    this._filterEnvFreq = -1;
  }

  /** Rest (no note on this step) */
  rest(time: number): void {
    this.releaseNote(time);
  }

  // ────────────────────────────────────────────────────────────────────────
  // POLY PATH — fire-and-forget per-voice synthesis for chordal bass.
  //
  // The main triggerNote() path is mono (303-style — one oscillator + filter
  // chain shared, with slide/tie semantics). triggerPolyNote() builds a
  // self-contained voice graph for ONE note that auto-releases after the
  // requested duration. Multiple calls produce real polyphony without
  // stepping on the mono path.
  //
  // Voices are simpler than the mono path (single LP biquad, no Steiner /
  // ladder modelling, no harmonic-enhancer side-chain) to keep CPU sane and
  // because chordal use is typically background harmony, not lead.
  //
  // Returns a release callback that triggers an early release (e.g., when
  // the user lifts their finger before the requested duration elapsed).
  // ────────────────────────────────────────────────────────────────────────

  /** Voice-stealing pool — capped at 4 simultaneous poly voices */
  private polyVoices: { node: OscillatorNode; sub: OscillatorNode; vca: GainNode; releaseAt: number }[] = [];
  private static readonly MAX_POLY_VOICES = 4;

  triggerPolyNote(midiNote: number, startTime: number, duration: number, velocity = 0.85, accent = false): (() => void) | null {
    if (!this.ctx || !this.output) return null;
    const ctx = this.ctx;
    const p = this.params;

    // Voice stealing: drop the oldest voice if we're at the cap
    if (this.polyVoices.length >= BassEngine.MAX_POLY_VOICES) {
      const stolen = this.polyVoices.shift();
      if (stolen) {
        try {
          stolen.vca.gain.cancelScheduledValues(startTime);
          stolen.vca.gain.setTargetAtTime(0, startTime, 0.01);
          stolen.node.stop(startTime + 0.05);
          stolen.sub.stop(startTime + 0.05);
        } catch { /* already stopped */ }
      }
    }

    // Unmute the engine output bus if it's silent (matches mono path behaviour)
    if (this.output.gain.value === 0) {
      const t = ctx.currentTime;
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(0.0001, t);
      this.output.gain.linearRampToValueAtTime(p.volume, t + 0.003);
    }

    const freq = midiToFreq(midiNote);

    // ── Main oscillator ──
    const osc = ctx.createOscillator();
    osc.type = (p.waveform === "sawtooth" ? "sawtooth" : p.waveform === "square" ? "square" : "triangle");
    osc.frequency.setValueAtTime(freq, startTime);

    // ── Sub osc one octave below ──
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(freq / 2, startTime);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(p.subOsc * 0.7, startTime);

    // ── Per-voice LP filter ──
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(Math.max(0.7, Math.min(20, p.resonance * 0.6)), startTime);
    // Filter envelope: cutoff sweeps from base to peak via envMod
    const baseCutoff = Math.max(60, p.cutoff);
    const peakCutoff = Math.min(20000, baseCutoff + (p.envMod * 2400) + (accent ? 1200 : 0));
    filter.frequency.setValueAtTime(peakCutoff, startTime);
    // Decay back to base over the note's "decay" param (ms)
    const decayTau = Math.max(0.005, (p.decay / 1000) / 3);
    filter.frequency.setTargetAtTime(baseCutoff, startTime + 0.005, decayTau);

    // ── VCA envelope ──
    const vca = ctx.createGain();
    const velLevel = 0.45 + Math.max(0, Math.min(1, velocity)) * 0.55;
    const level = (accent ? 1.0 : 0.75) * velLevel;
    const punch = (accent ? p.punch * 0.4 : p.punch * 0.15);
    const releaseTime = 0.08;
    const releaseEnd = startTime + duration + releaseTime;

    vca.gain.setValueAtTime(0.001, startTime);
    vca.gain.linearRampToValueAtTime(level + punch, startTime + 0.002); // attack overshoot
    vca.gain.linearRampToValueAtTime(level, startTime + 0.012);          // settle
    vca.gain.setValueAtTime(level, startTime + duration);
    vca.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
    vca.gain.setValueAtTime(0, releaseEnd + 0.005);

    // ── Wire it up: osc + sub → filter → vca → output ──
    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(vca);
    vca.connect(this.output);

    osc.start(startTime);
    sub.start(startTime);
    osc.stop(releaseEnd + 0.02);
    sub.stop(releaseEnd + 0.02);

    // Track in pool for voice-stealing
    const voiceEntry = { node: osc, sub, vca, releaseAt: releaseEnd };
    this.polyVoices.push(voiceEntry);

    // Schedule cleanup from pool after note ends
    const cleanupDelay = (releaseEnd - ctx.currentTime + 0.1) * 1000;
    setTimeout(() => {
      const idx = this.polyVoices.indexOf(voiceEntry);
      if (idx >= 0) this.polyVoices.splice(idx, 1);
    }, Math.max(50, cleanupDelay));

    // Early-release handle
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const t = Math.max(ctx.currentTime, startTime + 0.012);
      try {
        vca.gain.cancelScheduledValues(t);
        vca.gain.setTargetAtTime(0.001, t, releaseTime / 4);
        const earlyEnd = t + releaseTime + 0.02;
        vca.gain.setValueAtTime(0, earlyEnd);
        osc.stop(earlyEnd + 0.02);
        sub.stop(earlyEnd + 0.02);
      } catch { /* already stopped */ }
    };
  }

  /** Stop and remove all currently-playing poly voices (e.g., panic / engine teardown) */
  stopAllPoly(time?: number): void {
    if (!this.ctx) return;
    const t = time ?? this.ctx.currentTime;
    for (const v of this.polyVoices) {
      try {
        v.vca.gain.cancelScheduledValues(t);
        v.vca.gain.setValueAtTime(0, t);
        v.node.stop(t + 0.02);
        v.sub.stop(t + 0.02);
      } catch { /* already stopped */ }
    }
    this.polyVoices = [];
  }

  /** Emergency stop for stuck notes (~8ms ramp to avoid scene-transition clicks) */
  panic(time?: number): void {
    if (!this.ctx || !this.vca) return;
    const t = time ?? this.ctx.currentTime;
    const FADE = 0.008;
    const curVca = this.vca.gain.value;
    this.vca.gain.cancelScheduledValues(t);
    this.vca.gain.setValueAtTime(curVca, t);
    this.vca.gain.linearRampToValueAtTime(0, t + FADE);
    // Also mute output to kill any filter self-oscillation bleed
    if (this.output) {
      const curOut = this.output.gain.value;
      this.output.gain.cancelScheduledValues(t);
      this.output.gain.setValueAtTime(curOut, t);
      this.output.gain.linearRampToValueAtTime(0, t + FADE);
    }
    this.noteIsOn = false;
    if (this.filterChain && this.ctx) {
      this.filterChain.cancelEnvelope(Math.max(this.params.cutoff, 20), Math.min(this.params.resonance / 30, 1.0), t);
    }
    this._filterEnvFreq = -1;
  }

  /** Update parameters live */
  setParams(p: Partial<BassParams>): void {
    // Capture before merging — Object.assign mutates this.params immediately,
    // so any comparison like `p.x !== this.params.x` below would always be false.
    const prevFilterModel = this.params.filterModel;
    Object.assign(this.params, p);

    if (this.osc && this.ctx && (p.waveform || p.wavetable)) {
      if (this.params.waveform === "wavetable") {
        this.osc.setPeriodicWave(getWavetable(this.ctx, this.params.wavetable ?? "harmonic"));
      } else if (p.waveform && p.waveform !== "wavetable") {
        this.osc.type = p.waveform;
      }
    }
    if (this.filterChain) {
      if (p.cutoff !== undefined || p.resonance !== undefined) {
        const cutoff = p.cutoff ?? this.params.cutoff;
        const res = Math.min((p.resonance ?? this.params.resonance) / 30, 1.0);
        this.filterChain.update(cutoff, res, this.ctx?.currentTime ?? 0);
      }
      // Hot-swap filter chain when filterModel changes
      if (p.filterModel && p.filterModel !== prevFilterModel) {
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

    if (
      p.lfoEnabled !== undefined ||
      p.lfoTarget  !== undefined ||
      p.lfoShape   !== undefined ||
      p.lfoRate    !== undefined ||
      p.lfoDepth   !== undefined ||
      p.lfoSync    !== undefined ||
      p.lfoSyncNote !== undefined
    ) {
      if (this.params.lfoEnabled) {
        this.startLFO();
      } else {
        this.stopLFO();
      }
    }
  }

  /**
   * Sweep the filter on the running voice in real-time.
   * Called by PerformancePad Y-axis on every pointer-move.
   */
  sweepLiveFilter(cutoff: number, resonanceNorm?: number): void {
    if (!this.filterChain || !this.ctx) return;
    const clampedCutoff = Math.max(20, Math.min(22000, cutoff));
    const res = resonanceNorm !== undefined ? Math.min(resonanceNorm, 1.0) : Math.min(this.params.resonance / 30, 1.0);
    this.filterChain.update(clampedCutoff, res, this.ctx.currentTime);
    this.params.cutoff = clampedCutoff;
  }

  /** Sweep output volume directly — used by PerformancePad "volume" Y-axis. */
  sweepLiveVolume(gain: number): void {
    if (!this.output) return;
    const clamped = Math.max(0, Math.min(1.5, gain));
    this.output.gain.setTargetAtTime(clamped, this.ctx?.currentTime ?? 0, 0.01);
  }

  startLFO(): void {
    const wasRunning = this._lfoRaf !== null;

    // Capture accumulated phase before stopping so restarts (BPM/rate changes)
    // continue from the current LFO position rather than jumping.
    if (wasRunning && this.ctx) {
      const rate = this.params.lfoSync
        ? (this._bpm / 60) / SYNC_BEATS[this.params.lfoSyncNote]
        : this.params.lfoRate;
      this._lfoPhaseBase += (this.ctx.currentTime - this._lfoStartAudioTime) * rate;
    }

    this.stopLFO();
    if (!this.params.lfoEnabled || !this.ctx) return;

    // Fresh start: reset phase; restart (rate/BPM change): keep accumulated phase.
    if (!wasRunning) this._lfoPhaseBase = 0;
    this._lfoStartAudioTime = this.ctx.currentTime;

    // rAF tick — phase is derived from AudioContext clock, so it is immune to
    // main-thread GC / rendering jitter that plagued the old setInterval(16) approach.
    const tick = () => {
      if (!this.ctx || this._lfoRaf === null) return;

      const rate = this.params.lfoSync
        ? (this._bpm / 60) / SYNC_BEATS[this.params.lfoSyncNote]
        : this.params.lfoRate;

      const phase = this._lfoPhaseBase + (this.ctx.currentTime - this._lfoStartAudioTime) * rate;
      const raw = lfoWave(this.params.lfoShape, phase);
      const depth = this.params.lfoDepth;

      switch (this.params.lfoTarget) {
        case "filter": {
          if (!this.filterChain) break;
          // Use envelope's current frequency as base when envelope is active
          const base = this._filterEnvFreq > 0 ? this._filterEnvFreq : this.params.cutoff;
          const mod = raw * depth * base * 1.5;
          const freq = Math.max(50, Math.min(18000, base + mod));
          const res = Math.min(this.params.resonance / 30, 1.0);
          this.filterChain.update(freq, res, this.ctx.currentTime);
          break;
        }
        case "pitch": {
          if (!this.osc) break;
          const detuneCents = raw * depth * 100;
          this.osc.detune.setValueAtTime(detuneCents, this.ctx.currentTime);
          this.subOsc?.detune.setValueAtTime(detuneCents, this.ctx.currentTime);
          break;
        }
        case "volume": {
          if (!this.output) break;
          const baseVol = this.params.volume;
          const gain = Math.max(0, baseVol * (1 + raw * depth * 0.5));
          this.output.gain.setValueAtTime(gain, this.ctx.currentTime);
          break;
        }
      }

      this._lfoRaf = requestAnimationFrame(tick);
    };

    this._lfoRaf = requestAnimationFrame(tick);
  }

  stopLFO(): void {
    if (this._lfoRaf !== null) {
      cancelAnimationFrame(this._lfoRaf);
      this._lfoRaf = null;
    }
    if (this.ctx) {
      if (this.filterChain) {
        const res = Math.min(this.params.resonance / 30, 1.0);
        this.filterChain.update(this.params.cutoff, res, this.ctx.currentTime);
      }
      if (this.osc) this.osc.detune.setValueAtTime(0, this.ctx.currentTime);
      if (this.subOsc) this.subOsc.detune.setValueAtTime(0, this.ctx.currentTime);
      if (this.output) this.output.gain.setValueAtTime(this.params.volume, this.ctx.currentTime);
    }
  }

  /** Update BPM for sync-mode LFO — call from scheduler on every tick */
  setBpm(bpm: number): void {
    this._bpm = bpm;
    // If LFO is running in sync mode, restart it at the new rate.
    // startLFO() will capture the current phase before restarting.
    if (this._lfoRaf !== null && this.params.lfoSync) this.startLFO();
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
    this.stopLFO();
    if (this._autoReleaseTimer) {
      clearTimeout(this._autoReleaseTimer);
      this._autoReleaseTimer = null;
    }
    if (this.osc) {
      try { this.osc.stop(); } catch { /* already stopped */ }
      this.osc = null;
    }
    if (this.subOsc) {
      try { this.subOsc.stop(); } catch { /* already stopped */ }
      this.subOsc = null;
    }
    this.isRunning = false;
    this.ctx = null;
  }
}

export const bassEngine = new BassEngine();
