/**
 * Elastic Drums Audio Engine (Browser)
 *
 * Phase 1: Pure Web Audio synthesis (no WASM)
 * All 12 voices with improved, warmer sound design.
 * Voice parameters are stored per-voice and controlled from the UI.
 */

// Delay sync divisions: name → beat multiplier (1 = quarter note)
export const DELAY_DIVISIONS: Record<string, number> = {
  "1/4": 1, "1/8": 0.5, "1/16": 0.25,
  "1/8D": 0.75, "1/8T": 0.333, "1/4D": 1.5, "1/16T": 0.167,
};

export const DELAY_DIVISION_NAMES = Object.keys(DELAY_DIVISIONS);

export const REVERB_TYPES = ["room", "hall", "plate", "ambient"] as const;

// Parameter definitions per voice type
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

// Which params each voice type exposes
export const VOICE_PARAM_DEFS: Record<number, VoiceParamDef[]> = {
  0: [ // Kick
    { id: "tune", label: "TUNE", min: 30, max: 120, default: 52 },
    { id: "decay", label: "DECAY", min: 100, max: 1200, default: 550 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 50 },
    { id: "drive", label: "DRIVE", min: 0, max: 100, default: 40 },
    { id: "sub", label: "SUB", min: 0, max: 100, default: 60 },
    { id: "pitch", label: "PITCH", min: 20, max: 80, default: 45, step: 1 },
  ],
  1: [ // Snare
    { id: "tune", label: "TUNE", min: 100, max: 350, default: 180 },
    { id: "decay", label: "DECAY", min: 50, max: 500, default: 220 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 55 },
    { id: "snap", label: "SNAP", min: 0, max: 100, default: 70 },
    { id: "body", label: "BODY", min: 0, max: 100, default: 60 },
  ],
  2: [ // Clap
    { id: "decay", label: "DECAY", min: 80, max: 800, default: 350 },
    { id: "tone", label: "TONE", min: 500, max: 5000, default: 1800 },
    { id: "spread", label: "SPREAD", min: 0, max: 100, default: 50 },
    { id: "level", label: "LEVEL", min: 0, max: 150, default: 100 },
  ],
  3: [ // Tom Lo — 808 style, ~166 Hz
    { id: "tune", label: "TUNE", min: 80, max: 300, default: 166 },
    { id: "decay", label: "DECAY", min: 80, max: 800, default: 350 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 40 },
  ],
  4: [ // Tom Mid — 808 style, ~220 Hz
    { id: "tune", label: "TUNE", min: 120, max: 400, default: 220 },
    { id: "decay", label: "DECAY", min: 60, max: 600, default: 280 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 45 },
  ],
  5: [ // Tom Hi — 808 style, ~310 Hz
    { id: "tune", label: "TUNE", min: 180, max: 600, default: 310 },
    { id: "decay", label: "DECAY", min: 40, max: 500, default: 220 },
    { id: "click", label: "CLICK", min: 0, max: 100, default: 50 },
  ],
  6: [ // HH Closed
    { id: "tune", label: "TUNE", min: 200, max: 600, default: 330 },
    { id: "decay", label: "DECAY", min: 10, max: 120, default: 45 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 60 },
  ],
  7: [ // HH Open
    { id: "tune", label: "TUNE", min: 200, max: 600, default: 330 },
    { id: "decay", label: "DECAY", min: 50, max: 600, default: 250 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 60 },
  ],
  8: [ // Cymbal
    { id: "tune", label: "TUNE", min: 250, max: 700, default: 380 },
    { id: "decay", label: "DECAY", min: 200, max: 2000, default: 800 },
  ],
  9: [ // Ride
    { id: "tune", label: "TUNE", min: 300, max: 800, default: 480 },
    { id: "decay", label: "DECAY", min: 200, max: 2000, default: 800 },
  ],
  10: [ // Perc 1
    { id: "type", label: "TYPE", min: 0, max: 7, default: 0, step: 1 },
    { id: "tune", label: "TUNE", min: 100, max: 4000, default: 800 },
    { id: "decay", label: "DECAY", min: 20, max: 800, default: 120 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 50 },
  ],
  11: [ // Perc 2
    { id: "type", label: "TYPE", min: 0, max: 7, default: 3, step: 1 },
    { id: "tune", label: "TUNE", min: 100, max: 4000, default: 1200 },
    { id: "decay", label: "DECAY", min: 20, max: 800, default: 120 },
    { id: "tone", label: "TONE", min: 0, max: 100, default: 50 },
  ],
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // WASM mode
  private wasmMode = false;
  private workletNode: AudioWorkletNode | null = null;
  private wasmReady = false;

  // Per-voice parameter storage
  private voiceParams: VoiceParams[] = [];

  constructor() {
    // Initialize all voice parameters to defaults
    for (let v = 0; v < 12; v++) {
      const params: VoiceParams = {};
      const defs = VOICE_PARAM_DEFS[v] ?? [];
      for (const d of defs) {
        params[d.id] = d.default;
      }
      this.voiceParams.push(params);
    }
  }

  /** Set a voice parameter from the UI */
  setVoiceParam(voice: number, paramId: string, value: number): void {
    const p = this.voiceParams[voice];
    if (p) p[paramId] = value;
  }

  /** Get a voice parameter */
  getVoiceParam(voice: number, paramId: string): number {
    return this.voiceParams[voice]?.[paramId] ?? 0;
  }

  /** Get all params for a voice */
  getVoiceParams(voice: number): VoiceParams {
    return this.voiceParams[voice] ?? {};
  }

  // Per-voice channel strips:
  //   voice audio → channelInsertFilter → channelInsertShaper → channelGain → analyser → master
  private channelGains: GainNode[] = [];
  private channelAnalysers: AnalyserNode[] = [];
  private channelFilters: BiquadFilterNode[] = [];
  private channelShapers: WaveShaperNode[] = [];
  private channelPanners: PannerNode[] = [];
  private binauralMode = false;
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterEqLow: BiquadFilterNode | null = null;
  private masterEqMid: BiquadFilterNode | null = null;
  private masterEqHigh: BiquadFilterNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;

  // Master FX: Bitcrusher, Saturation, Pump
  private masterFilter: BiquadFilterNode | null = null;  // Performance FX master filter
  private masterSaturation: WaveShaperNode | null = null;
  private masterSaturationDry: GainNode | null = null;
  private masterSaturationWet: GainNode | null = null;
  private activeNoiseSource: AudioBufferSourceNode | null = null;
  private activeNoiseGain: GainNode | null = null;
  private stutterLfo: OscillatorNode | null = null;
  private stutterGain: GainNode | null = null;

  // Dedicated Flanger FX (independent from global delay)
  private flangerDelay: DelayNode | null = null;
  private flangerLfo: OscillatorNode | null = null;
  private flangerLfoGain: GainNode | null = null;
  private flangerFeedback: GainNode | null = null;
  private flangerWet: GainNode | null = null;
  private flangerDry: GainNode | null = null;
  private flangerInput: GainNode | null = null;
  private flangerOutput: GainNode | null = null;
  private flangerActive = false;

  private pumpGain: GainNode | null = null;
  private pumpLfo: OscillatorNode | null = null;
  private pumpDepth: GainNode | null = null;

  // Bus Groups: channels can be assigned to groups
  // Group routing: channel → group bus → master
  private groupBuses: Map<string, { gain: GainNode; analyser: AnalyserNode }> = new Map();
  private channelGroupAssignment: string[] = new Array(12).fill("master");

  // Send FX
  private sendAGains: GainNode[] = [];       // Per-channel reverb send amount
  private sendBGains: GainNode[] = [];       // Per-channel delay send amount
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private reverbDamping: BiquadFilterNode | null = null;  // Post-reverb lowpass
  private reverbPreDelay: DelayNode | null = null;        // Pre-delay before reverb
  private reverbType: "room" | "hall" | "plate" | "ambient" = "hall";
  private reverbSize = 2.0;
  private reverbDecayVal = 2.5;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayFilter: BiquadFilterNode | null = null;
  private delayGain: GainNode | null = null;
  private delayPanner: StereoPannerNode | null = null;    // For ping-pong spread
  private delayType: "stereo" | "pingpong" | "tape" = "stereo";
  private delayDivision = "1/8";
  private delayTapeLfo: OscillatorNode | null = null;     // Tape wow/flutter
  private delayTapeLfoGain: GainNode | null = null;
  private sendABus: GainNode | null = null;  // Reverb bus
  private sendBBus: GainNode | null = null;  // Delay bus

  // Professional metering: FFT-based RMS + Peak with hold/decay
  private peakLevels = new Float32Array(12);       // Peak hold (linear)
  private rmsLevels = new Float32Array(12);         // RMS (linear)
  private masterPeakLevel = 0;
  private masterRmsLevel = 0;
  private readonly PEAK_DECAY = 0.995;              // Longer peak hold (~1s visible)
  private readonly RMS_SMOOTH = 0.5;                // Snappier RMS response (was 0.85)

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 44100 });

      // Pre-generate 1 second of noise
      this.noiseBuffer = this.ctx.createBuffer(1, 44100, 44100);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      // Build mixer routing: 12 channels → master
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;

      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 4096;
      this.masterAnalyser.smoothingTimeConstant = 0.15;

      // Master chain: masterGain → EQ → Compressor → Limiter → Analyser → Output
      // 3-Band EQ
      this.masterEqLow = this.ctx.createBiquadFilter();
      this.masterEqLow.type = "lowshelf";
      this.masterEqLow.frequency.value = 100;
      this.masterEqLow.gain.value = 0;

      this.masterEqMid = this.ctx.createBiquadFilter();
      this.masterEqMid.type = "peaking";
      this.masterEqMid.frequency.value = 1000;
      this.masterEqMid.Q.value = 0.7;
      this.masterEqMid.gain.value = 0;

      this.masterEqHigh = this.ctx.createBiquadFilter();
      this.masterEqHigh.type = "highshelf";
      this.masterEqHigh.frequency.value = 8000;
      this.masterEqHigh.gain.value = 0;

      // Bus Compressor
      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -12;
      this.masterCompressor.ratio.value = 4;
      this.masterCompressor.attack.value = 0.01;
      this.masterCompressor.release.value = 0.15;
      this.masterCompressor.knee.value = 6;

      // Limiter (brick-wall)
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1;
      this.masterLimiter.ratio.value = 20;
      this.masterLimiter.attack.value = 0.001;
      this.masterLimiter.release.value = 0.05;

      // === Master Saturation (parallel wet/dry) ===
      this.masterSaturation = this.ctx.createWaveShaper();
      this.masterSaturationDry = this.ctx.createGain();
      this.masterSaturationWet = this.ctx.createGain();
      this.masterSaturationDry.gain.value = 1.0; // Start bypassed
      this.masterSaturationWet.gain.value = 0.0;
      // Default: clean (no curve)

      // === Pump (sidechain-style LFO on master gain) ===
      this.pumpGain = this.ctx.createGain();
      this.pumpGain.gain.value = 1.0;

      this.pumpDepth = this.ctx.createGain();
      this.pumpDepth.gain.value = 0; // Start off

      this.pumpLfo = this.ctx.createOscillator();
      this.pumpLfo.type = "sine";
      this.pumpLfo.frequency.value = 2.0; // Default: 120 BPM quarter note
      this.pumpLfo.connect(this.pumpDepth);
      this.pumpDepth.connect(this.pumpGain.gain);
      this.pumpLfo.start();

      // === Routing ===
      // masterGain → EQ → Saturation(parallel) → Pump → Compressor → Limiter → Analyser → Output
      this.masterGain.connect(this.masterEqLow);
      this.masterEqLow.connect(this.masterEqMid);
      this.masterEqMid.connect(this.masterEqHigh);

      // Performance FX master filter (default: allpass = bypassed)
      this.masterFilter = this.ctx.createBiquadFilter();
      this.masterFilter.type = "allpass";
      this.masterFilter.frequency.value = 1000;
      this.masterFilter.Q.value = 1;
      this.masterEqHigh.connect(this.masterFilter);

      // Pre-generate noise buffer for performance FX
      this.noiseBuffer = this.generateNoiseBuffer(this.ctx, 2.0);

      // Saturation: dry path
      this.masterFilter.connect(this.masterSaturationDry);
      // Saturation: wet path
      this.masterFilter.connect(this.masterSaturation);
      this.masterSaturation.connect(this.masterSaturationWet);

      // Both paths → pump
      this.masterSaturationDry.connect(this.pumpGain);
      this.masterSaturationWet.connect(this.pumpGain);

      // Pump → compressor → limiter → out
      this.pumpGain.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

      // === Default Bus Groups ===
      this.createBusGroup("drums", this.ctx);    // Kick, Snare, Clap, Toms
      this.createBusGroup("hats", this.ctx);     // HH, Cymbal, Ride
      this.createBusGroup("perc", this.ctx);     // Perc 1, 2

      // Default group assignments
      this.channelGroupAssignment = [
        "drums", "drums", "drums",    // Kick, Snare, Clap
        "drums", "drums", "drums",    // Toms
        "hats", "hats",               // HH Cl, HH Op
        "hats", "hats",               // Cymbal, Ride
        "perc", "perc",               // Perc 1, 2
        "bass",                        // Bass 303
        "chords",                      // Chords Pad
        "melody",                      // Melody Lead
      ];

      // Create 13 channel strips (12 drums + 1 bass) with insert FX
      for (let i = 0; i < 15; i++) {
        // Insert filter (bypass by default: allpass)
        const filter = this.ctx.createBiquadFilter();
        filter.type = "allpass";
        filter.frequency.value = 1000;

        // Insert distortion (bypass by default: null curve)
        const shaper = this.ctx.createWaveShaper();

        // Channel gain (volume fader)
        const gain = this.ctx.createGain();
        gain.gain.value = 1.0;

        // Channel panner (3D / HRTF capable)
        const panner = this.ctx.createPanner();
        panner.panningModel = "equalpower"; // default; switch to "HRTF" for binaural
        panner.distanceModel = "inverse";
        panner.refDistance = 1;
        panner.maxDistance = 10;
        panner.positionX.value = 0; // center
        panner.positionY.value = 0;
        panner.positionZ.value = -1; // in front of listener

        // Analyser (meter)
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.15;

        // Routing: filter → shaper → gain → panner → analyser → master
        filter.connect(shaper);
        shaper.connect(gain);
        gain.connect(panner);
        panner.connect(analyser);
        analyser.connect(this.masterGain);

        this.channelFilters.push(filter);
        this.channelShapers.push(shaper);
        this.channelGains.push(gain);
        this.channelPanners.push(panner);
        this.channelAnalysers.push(analyser);
      }

      // ─── Send FX Buses ──────────────────────────────────
      // Send A: Reverb (ConvolverNode with generated impulse)
      this.sendABus = this.ctx.createGain();
      this.sendABus.gain.value = 1.0;

      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.35;

      this.reverbPreDelay = this.ctx.createDelay(0.2);
      this.reverbPreDelay.delayTime.value = 0.012;

      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.generateReverbIR(this.ctx, 2.0, 2.5, "hall");

      this.reverbDamping = this.ctx.createBiquadFilter();
      this.reverbDamping.type = "lowpass";
      this.reverbDamping.frequency.value = 8000;
      this.reverbDamping.Q.value = 0.5;

      // Reverb chain: bus → pre-delay → convolver → damping → gain → master
      this.sendABus.connect(this.reverbPreDelay);
      this.reverbPreDelay.connect(this.reverbNode);
      this.reverbNode.connect(this.reverbDamping);
      this.reverbDamping.connect(this.reverbGain);
      this.reverbGain.connect(this.masterGain);

      // Send B: Stereo Delay (ping-pong style)
      this.sendBBus = this.ctx.createGain();
      this.sendBBus.gain.value = 1.0;

      this.delayNode = this.ctx.createDelay(2.0);
      this.delayNode.delayTime.value = 0.375; // 3/16 at 120 BPM

      this.delayFeedback = this.ctx.createGain();
      this.delayFeedback.gain.value = 0.4;

      this.delayFilter = this.ctx.createBiquadFilter();
      this.delayFilter.type = "lowpass";
      this.delayFilter.frequency.value = 4000;

      this.delayGain = this.ctx.createGain();
      this.delayGain.gain.value = 0.3;

      this.delayPanner = this.ctx.createStereoPanner();
      this.delayPanner.pan.value = 0;

      // Tape mode LFO (wow/flutter): modulates delay time subtly
      this.delayTapeLfo = this.ctx.createOscillator();
      this.delayTapeLfo.type = "sine";
      this.delayTapeLfo.frequency.value = 0.6; // Slow wobble
      this.delayTapeLfoGain = this.ctx.createGain();
      this.delayTapeLfoGain.gain.value = 0; // Off by default
      this.delayTapeLfo.connect(this.delayTapeLfoGain);
      this.delayTapeLfoGain.connect(this.delayNode.delayTime);
      this.delayTapeLfo.start();

      // Delay routing: bus → delay → filter → feedback → delay (loop)
      //                                    → panner → delayGain → master
      this.sendBBus.connect(this.delayNode);
      this.delayNode.connect(this.delayFilter);
      this.delayFilter.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delayNode); // Feedback loop
      this.delayFilter.connect(this.delayPanner);
      this.delayPanner.connect(this.delayGain);
      this.delayGain.connect(this.masterGain);

      // === Dedicated Flanger FX ===
      // Flanger uses its OWN short delay (1–10ms) + LFO sweep, NOT the global delay
      this.flangerInput = this.ctx.createGain();
      this.flangerInput.gain.value = 1.0;
      this.flangerOutput = this.ctx.createGain();
      this.flangerOutput.gain.value = 1.0;

      this.flangerDelay = this.ctx.createDelay(0.02); // Max 20ms
      this.flangerDelay.delayTime.value = 0.005;      // 5ms center

      this.flangerLfo = this.ctx.createOscillator();
      this.flangerLfo.type = "sine";
      this.flangerLfo.frequency.value = 0.3; // Slow sweep

      this.flangerLfoGain = this.ctx.createGain();
      this.flangerLfoGain.gain.value = 0.004; // ±4ms sweep depth

      this.flangerFeedback = this.ctx.createGain();
      this.flangerFeedback.gain.value = 0.6;

      this.flangerWet = this.ctx.createGain();
      this.flangerWet.gain.value = 0; // Off by default
      this.flangerDry = this.ctx.createGain();
      this.flangerDry.gain.value = 1.0;

      // LFO → delay time modulation
      this.flangerLfo.connect(this.flangerLfoGain);
      this.flangerLfoGain.connect(this.flangerDelay.delayTime);
      this.flangerLfo.start();

      // Routing: input → dry → output
      //          input → delay → wet → output
      //                  delay → feedback → delay (loop)
      this.flangerInput.connect(this.flangerDry);
      this.flangerInput.connect(this.flangerDelay);
      this.flangerDelay.connect(this.flangerWet);
      this.flangerDelay.connect(this.flangerFeedback);
      this.flangerFeedback.connect(this.flangerDelay);
      this.flangerDry.connect(this.flangerOutput);
      this.flangerWet.connect(this.flangerOutput);

      // Insert flanger into master chain: masterFilter → flangerInput → flangerOutput → saturation
      // Rewire: disconnect masterFilter → saturation paths, route through flanger
      this.masterFilter.disconnect(this.masterSaturationDry);
      this.masterFilter.disconnect(this.masterSaturation);
      this.masterFilter.connect(this.flangerInput);
      this.flangerOutput.connect(this.masterSaturationDry);
      this.flangerOutput.connect(this.masterSaturation);

      // Create per-channel send gains (13 channels)
      for (let i = 0; i < 15; i++) {
        const sendA = this.ctx.createGain();
        sendA.gain.value = 0; // Default: no reverb send
        this.channelGains[i]!.connect(sendA);
        sendA.connect(this.sendABus);
        this.sendAGains.push(sendA);

        const sendB = this.ctx.createGain();
        sendB.gain.value = 0; // Default: no delay send
        this.channelGains[i]!.connect(sendB);
        sendB.connect(this.sendBBus);
        this.sendBGains.push(sendB);
      }

      // Initialize peak-hold buffers (13 channels)
      this.peakLevels = new Float32Array(15);
      this.rmsLevels = new Float32Array(15);
      this.masterPeakLevel = 0;
    }
    return this.ctx;
  }

  /** Generate algorithmic reverb impulse response by type */
  private generateReverbIR(ctx: AudioContext, duration: number, decay: number, type: string): AudioBuffer {
    const sr = ctx.sampleRate;
    const length = Math.ceil(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);

    // Type-specific parameters
    const profiles: Record<string, { preDelayMs: number; earlyDensity: number; earlySpread: number; tailDecayMul: number; brightness: number }> = {
      room:    { preDelayMs: 5,  earlyDensity: 8,  earlySpread: 2,  tailDecayMul: 1.0, brightness: 0.7 },
      hall:    { preDelayMs: 15, earlyDensity: 6,  earlySpread: 5,  tailDecayMul: 1.0, brightness: 0.5 },
      plate:   { preDelayMs: 1,  earlyDensity: 0,  earlySpread: 1,  tailDecayMul: 0.8, brightness: 0.9 },
      ambient: { preDelayMs: 25, earlyDensity: 4,  earlySpread: 10, tailDecayMul: 1.5, brightness: 0.3 },
    };
    const p = profiles[type] ?? profiles.hall!;
    const preDelay = Math.ceil(sr * p.preDelayMs / 1000);

    // Early reflections
    const earlyTaps: { time: number; gain: number }[] = [];
    for (let i = 0; i < p.earlyDensity; i++) {
      earlyTaps.push({
        time: 0.012 + (i + 1) * 0.008 * (1 + Math.random() * 0.3),
        gain: 0.7 * Math.exp(-i * 0.35),
      });
    }

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);

      // Early reflections (discrete taps with stereo offset)
      for (const tap of earlyTaps) {
        const offset = ch === 0 ? 0 : Math.ceil(sr * p.earlySpread / 1000);
        const idx = preDelay + Math.ceil(sr * tap.time) + offset;
        if (idx < length) {
          const burstLen = Math.ceil(sr * 0.004);
          for (let j = 0; j < burstLen; j++) {
            if (idx + j < length) {
              data[idx + j] = (data[idx + j] ?? 0) + (Math.random() * 2 - 1) * tap.gain * Math.exp(-j / (sr * 0.002));
            }
          }
        }
      }

      // Late diffuse tail
      const tailStart = preDelay + Math.ceil(sr * (type === "plate" ? 0.005 : 0.08));
      for (let i = tailStart; i < length; i++) {
        const t = (i - tailStart) / sr;
        const envelope = Math.exp(-t * 6 / (decay * p.tailDecayMul));
        const warmth = Math.exp(-t * (1 + p.brightness * 4));
        data[i] = (data[i] ?? 0) + (Math.random() * 2 - 1) * envelope * (p.brightness + warmth * (1 - p.brightness));
      }
    }

    return buffer;
  }

  /** Get the output node for a voice channel (routes into insert FX chain) */
  getChannelOutput(voice: number): AudioNode {
    this.getContext();
    // Route to filter input (filter → shaper → gain → analyser → master)
    return this.channelFilters[voice] ?? this.channelGains[voice] ?? this.masterGain!;
  }

  /**
   * Read RMS + Peak from an AnalyserNode using FFT frequency domain data.
   * Returns { rms, peak } in linear amplitude (0..1+)
   *
   * Uses getFloatTimeDomainData for sample-accurate waveform analysis:
   * - RMS = sqrt(mean(sample²)) — true signal power
   * - Peak = max(abs(sample))   — instantaneous peak
   */
  // Pre-allocated buffer for meter analysis (avoids 6MB/s GC pressure)
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;

  private analyseLevel(analyser: AnalyserNode): { rms: number; peak: number } {
    if (!this.meterBuffer || this.meterBuffer.length < analyser.fftSize) {
      this.meterBuffer = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(this.meterBuffer);
    const data = this.meterBuffer;

    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < data.length; i++) {
      const sample = data[i]!;
      sumSquares += sample * sample;
      const absSample = Math.abs(sample);
      if (absSample > peak) peak = absSample;
    }

    const rms = Math.sqrt(sumSquares / data.length);
    return { rms, peak };
  }

  /** Convert linear amplitude to dBFS */
  static linearToDb(linear: number): number {
    if (linear < 1e-10) return -Infinity;
    return 20 * Math.log10(linear);
  }

  /** Convert dBFS to linear amplitude */
  static dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
  }

  /**
   * Get channel meter readings
   * Returns { rmsDb, peakDb, rmsLinear, peakLinear }
   */
  getChannelMeter(channel: number): { rmsDb: number; peakDb: number; rmsLinear: number; peakLinear: number } {
    const analyser = this.channelAnalysers[channel];
    if (!analyser) return { rmsDb: -Infinity, peakDb: -Infinity, rmsLinear: 0, peakLinear: 0 };

    const { rms, peak } = this.analyseLevel(analyser);

    // Smooth RMS (exponential moving average)
    this.rmsLevels[channel] = this.RMS_SMOOTH * (this.rmsLevels[channel] ?? 0) + (1 - this.RMS_SMOOTH) * rms;

    // Peak hold with slow decay
    if (peak > (this.peakLevels[channel] ?? 0)) {
      this.peakLevels[channel] = peak;
    } else {
      this.peakLevels[channel]! *= this.PEAK_DECAY;
    }

    const smoothRms = this.rmsLevels[channel]!;
    const holdPeak = this.peakLevels[channel]!;

    return {
      rmsDb: AudioEngine.linearToDb(smoothRms),
      peakDb: AudioEngine.linearToDb(holdPeak),
      rmsLinear: smoothRms,
      peakLinear: holdPeak,
    };
  }

  /** Get master meter readings */
  getMasterMeter(): { rmsDb: number; peakDb: number; rmsLinear: number; peakLinear: number } {
    if (!this.masterAnalyser) return { rmsDb: -Infinity, peakDb: -Infinity, rmsLinear: 0, peakLinear: 0 };

    const { rms, peak } = this.analyseLevel(this.masterAnalyser);

    this.masterRmsLevel = this.RMS_SMOOTH * this.masterRmsLevel + (1 - this.RMS_SMOOTH) * rms;

    if (peak > this.masterPeakLevel) {
      this.masterPeakLevel = peak;
    } else {
      this.masterPeakLevel *= this.PEAK_DECAY;
    }

    return {
      rmsDb: AudioEngine.linearToDb(this.masterRmsLevel),
      peakDb: AudioEngine.linearToDb(this.masterPeakLevel),
      rmsLinear: this.masterRmsLevel,
      peakLinear: this.masterPeakLevel,
    };
  }

  // Legacy compat (for MixerStrip sidebar)
  getChannelLevel(channel: number): number {
    return this.getChannelMeter(channel).rmsLinear * 2;
  }
  getMasterLevel(): number {
    return this.getMasterMeter().rmsLinear * 2;
  }

  /** Expose AudioContext for sample decoding */
  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /** Get analyser node for a channel (for waveform display) */
  getChannelAnalyser(channel: number): AnalyserNode | null {
    return this.channelAnalysers[channel] ?? null;
  }

  /** Play a sample buffer through a voice channel */
  playSampleAtTime(buffer: AudioBuffer, voice: number, velocity: number, time: number, tune = 0): void {
    const ctx = this.getContext();
    const out = this.getChannelOutput(voice);

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

  /** Set per-voice insert filter */
  setChannelFilter(channel: number, type: BiquadFilterType, frequency: number, q: number): void {
    const filter = this.channelFilters[channel];
    if (!filter) return;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
  }

  /** Bypass per-voice filter */
  bypassChannelFilter(channel: number): void {
    const filter = this.channelFilters[channel];
    if (filter) filter.type = "allpass";
  }

  /** Set per-voice insert distortion (drive 0..1) */
  setChannelDrive(channel: number, drive: number): void {
    const shaper = this.channelShapers[channel];
    if (!shaper) return;
    if (drive < 0.01) {
      shaper.curve = null;
      return;
    }
    const curve = new Float32Array(256);
    const gain = 1 + drive * 8;
    for (let i = 0; i < 256; i++) {
      const x = (i / 128 - 1) * gain;
      curve[i] = Math.tanh(x);
    }
    shaper.curve = curve;
  }

  // ─── Send FX Controls ─────────────────────────────────

  /** Set per-channel reverb send amount (0..1) */
  setChannelReverbSend(channel: number, amount: number): void {
    const send = this.sendAGains[channel];
    if (send) send.gain.value = amount;
  }

  /** Set per-channel delay send amount (0..1) */
  setChannelDelaySend(channel: number, amount: number): void {
    const send = this.sendBGains[channel];
    if (send) send.gain.value = amount;
  }

  /** Set reverb wet level */
  setReverbLevel(level: number): void {
    if (this.reverbGain) this.reverbGain.gain.value = level;
  }

  /** Set delay parameters */
  setDelayParams(time: number, feedback: number, filterFreq: number): void {
    if (this.delayNode) this.delayNode.delayTime.value = Math.max(0.01, Math.min(2, time));
    if (this.delayFeedback) this.delayFeedback.gain.value = Math.max(0, Math.min(0.95, feedback));
    if (this.delayFilter) this.delayFilter.frequency.value = filterFreq;
  }

  /** Set delay wet level */
  setDelayLevel(level: number): void {
    if (this.delayGain) this.delayGain.gain.value = level;
  }

  /** Sync delay time to BPM with named division */
  syncDelayToBpm(bpm: number, division?: number): void {
    const beatSec = 60 / bpm;
    const div = division ?? DELAY_DIVISIONS[this.delayDivision] ?? 0.5;
    if (this.delayNode) this.delayNode.delayTime.value = Math.min(2, beatSec * div);
  }

  /** Set delay sync division and apply */
  setDelayDivision(divName: string, bpm: number): void {
    this.delayDivision = divName;
    this.syncDelayToBpm(bpm);
  }

  /** Set delay type: stereo (normal), pingpong (L/R spread), tape (wow/flutter) */
  setDelayType(type: "stereo" | "pingpong" | "tape"): void {
    this.delayType = type;
    // Ping-pong: spread the delay output across stereo field
    if (this.delayPanner) {
      this.delayPanner.pan.value = type === "pingpong" ? 0.7 : 0;
    }
    // Tape: enable LFO modulation on delay time + lower filter
    if (this.delayTapeLfoGain) {
      this.delayTapeLfoGain.gain.value = type === "tape" ? 0.002 : 0;
    }
    if (this.delayFilter) {
      this.delayFilter.frequency.value = type === "tape" ? 2500 : 4000;
    }
  }

  /** Get current delay type */
  getDelayType(): string { return this.delayType; }
  getDelayDivision(): string { return this.delayDivision; }

  /** Set reverb type — regenerates IR */
  setReverbType(type: "room" | "hall" | "plate" | "ambient"): void {
    if (!this.ctx || !this.reverbNode) return;
    this.reverbType = type;
    // Adjust duration based on type
    const durations: Record<string, number> = { room: 1.0, hall: 2.5, plate: 1.8, ambient: 4.0 };
    const decays: Record<string, number> = { room: 1.5, hall: 2.5, plate: 2.0, ambient: 5.0 };
    this.reverbSize = durations[type] ?? 2.0;
    this.reverbDecayVal = decays[type] ?? 2.5;
    this.reverbNode.buffer = this.generateReverbIR(this.ctx, this.reverbSize, this.reverbDecayVal, type);
  }

  /** Set reverb size (IR duration multiplier) */
  setReverbSize(size: number): void {
    if (!this.ctx || !this.reverbNode) return;
    this.reverbSize = Math.max(0.3, Math.min(6, size));
    this.reverbNode.buffer = this.generateReverbIR(this.ctx, this.reverbSize, this.reverbDecayVal, this.reverbType);
  }

  /** Set reverb decay rate */
  setReverbDecay(decay: number): void {
    if (!this.ctx || !this.reverbNode) return;
    this.reverbDecayVal = Math.max(0.5, Math.min(8, decay));
    this.reverbNode.buffer = this.generateReverbIR(this.ctx, this.reverbSize, this.reverbDecayVal, this.reverbType);
  }

  /** Set post-reverb damping (lowpass cutoff) */
  setReverbDamping(freq: number): void {
    if (this.reverbDamping) this.reverbDamping.frequency.value = Math.max(500, Math.min(16000, freq));
  }

  /** Set reverb pre-delay */
  setReverbPreDelay(ms: number): void {
    if (this.reverbPreDelay) this.reverbPreDelay.delayTime.value = Math.max(0, Math.min(150, ms)) / 1000;
  }

  /** Get reverb type */
  getReverbType(): string { return this.reverbType; }

  /** Set channel pan (-1=left, 0=center, 1=right) — maps to 3D position */
  setChannelPan(channel: number, pan: number): void {
    const panner = this.channelPanners[channel];
    if (panner) {
      // Map -1..+1 to X position (-5..+5) for spatial width
      panner.positionX.value = Math.max(-1, Math.min(1, pan)) * 5;
    }
  }

  /** Set channel elevation (-1=below, 0=level, 1=above) for spatial audio */
  setChannelElevation(channel: number, elevation: number): void {
    const panner = this.channelPanners[channel];
    if (panner) panner.positionY.value = Math.max(-1, Math.min(1, elevation)) * 3;
  }

  /** Toggle binaural (HRTF) mode for all channels */
  setBinauralMode(enabled: boolean): void {
    this.binauralMode = enabled;
    const model = enabled ? "HRTF" : "equalpower";
    for (const panner of this.channelPanners) {
      panner.panningModel = model as PanningModelType;
    }
  }

  /** Get binaural mode state */
  getBinauralMode(): boolean { return this.binauralMode; }

  // ─── Performance FX Methods ────────────────────────────

  /** Set master filter (for XY-Pad filter mode) */
  setMasterFilter(type: BiquadFilterType, freq: number, q: number): void {
    if (!this.masterFilter) return;
    this.masterFilter.type = type;
    this.masterFilter.frequency.value = Math.max(20, Math.min(20000, freq));
    this.masterFilter.Q.value = Math.max(0.1, Math.min(30, q));
  }

  /** Bypass master filter (reset to allpass) */
  bypassMasterFilter(): void {
    if (!this.masterFilter) return;
    this.masterFilter.type = "allpass";
    this.masterFilter.frequency.value = 1000;
    this.masterFilter.Q.value = 1;
  }

  /** Generate white noise buffer */
  private generateNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.ceil(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Start noise burst (hold to play) */
  startNoise(volume = 0.3): void {
    if (!this.ctx || !this.noiseBuffer || !this.masterGain) return;
    this.stopNoise(); // Clean up any previous
    this.activeNoiseSource = this.ctx.createBufferSource();
    this.activeNoiseSource.buffer = this.noiseBuffer;
    this.activeNoiseSource.loop = true;
    this.activeNoiseGain = this.ctx.createGain();
    this.activeNoiseGain.gain.value = volume;
    this.activeNoiseSource.connect(this.activeNoiseGain);
    this.activeNoiseGain.connect(this.masterGain);
    this.activeNoiseSource.start();
  }

  /** Stop noise burst */
  stopNoise(): void {
    if (this.activeNoiseSource) {
      try { this.activeNoiseSource.stop(); } catch { /* already stopped */ }
      this.activeNoiseSource.disconnect();
      this.activeNoiseSource = null;
    }
    if (this.activeNoiseGain) {
      this.activeNoiseGain.disconnect();
      this.activeNoiseGain = null;
    }
  }

  /** Start stutter/gate effect — inserts a gain gate between pump and compressor */
  startStutter(rate: number): void {
    if (!this.ctx || !this.pumpGain || !this.masterCompressor) return;
    this.stopStutter();

    // Create a gate gain node and insert it into the signal chain
    this.stutterGain = this.ctx.createGain();
    this.stutterGain.gain.value = 1.0;

    // Disconnect pumpGain → compressor and re-route through gate
    this.pumpGain.disconnect(this.masterCompressor);
    this.pumpGain.connect(this.stutterGain);
    this.stutterGain.connect(this.masterCompressor);

    // LFO modulates the gate gain: 0→1 at the specified rate
    this.stutterLfo = this.ctx.createOscillator();
    this.stutterLfo.type = "square";
    this.stutterLfo.frequency.value = rate;

    // Scale LFO output (±1) to gain range (0→1) via gain node
    const lfoScale = this.ctx.createGain();
    lfoScale.gain.value = 0.5; // Scale ±1 to ±0.5
    this.stutterLfo.connect(lfoScale);
    lfoScale.connect(this.stutterGain.gain); // Adds ±0.5 to base 0.5 → range 0..1

    // Set base gain to 0.5 so the LFO swings between 0 and 1
    this.stutterGain.gain.value = 0.5;

    this.stutterLfo.start();
  }

  /** Stop stutter effect — restore direct connection */
  stopStutter(): void {
    if (this.stutterLfo) {
      try { this.stutterLfo.stop(); } catch { /* */ }
      this.stutterLfo.disconnect();
      this.stutterLfo = null;
    }
    if (this.stutterGain && this.pumpGain && this.masterCompressor) {
      // Restore direct connection
      this.stutterGain.disconnect();
      try { this.pumpGain.disconnect(this.stutterGain); } catch { /* */ }
      this.pumpGain.connect(this.masterCompressor);
    }
    if (this.stutterGain) {
      this.stutterGain.disconnect();
      this.stutterGain = null;
    }
  }

  // ─── Flanger FX Controls ────────────────────────────────

  /** Activate flanger with sweep position (x) and feedback/depth (y) */
  startFlanger(sweepRate: number, depth: number, feedback: number): void {
    if (!this.flangerLfo || !this.flangerLfoGain || !this.flangerFeedback || !this.flangerWet || !this.flangerDry) return;
    this.flangerActive = true;
    this.flangerLfo.frequency.value = sweepRate;               // 0.1–5 Hz
    this.flangerLfoGain.gain.value = 0.001 + depth * 0.008;   // Sweep depth 1–9ms
    this.flangerFeedback.gain.value = Math.min(0.95, feedback); // Resonance
    this.flangerWet.gain.value = 0.7;                          // Wet mix on
    this.flangerDry.gain.value = 0.6;                          // Slight dry reduction for effect
  }

  /** Update flanger parameters live (for XY pad movement) */
  setFlangerParams(sweepRate: number, depth: number, feedback: number): void {
    if (!this.flangerActive) return;
    if (this.flangerLfo) this.flangerLfo.frequency.value = sweepRate;
    if (this.flangerLfoGain) this.flangerLfoGain.gain.value = 0.001 + depth * 0.008;
    if (this.flangerFeedback) this.flangerFeedback.gain.value = Math.min(0.95, feedback);
  }

  /** Deactivate flanger — restore dry signal */
  stopFlanger(): void {
    this.flangerActive = false;
    if (this.flangerWet) this.flangerWet.gain.value = 0;
    if (this.flangerDry) this.flangerDry.gain.value = 1.0;
    if (this.flangerFeedback) this.flangerFeedback.gain.value = 0;
  }

  /** Get master gain node for external FX routing */
  getMasterGainNode(): GainNode | null { return this.masterGain; }

  /** Set channel volume (0..1) — smooth ramp to prevent clicks */
  setChannelVolume(channel: number, volume: number): void {
    const gain = this.channelGains[channel];
    if (gain && this.ctx) {
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.015); // 15ms fade
    }
  }

  /** Create a bus group */
  private createBusGroup(name: string, ctx: AudioContext): void {
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.15;
    gain.connect(analyser);
    analyser.connect(this.masterGain!);
    this.groupBuses.set(name, { gain, analyser });
  }

  /** Assign a channel to a bus group */
  setChannelGroup(channel: number, group: string): void {
    this.channelGroupAssignment[channel] = group;
    // Reconnect: channel analyser → group bus (instead of direct to master)
    const chAnalyser = this.channelAnalysers[channel];
    if (!chAnalyser) return;

    chAnalyser.disconnect();
    const bus = this.groupBuses.get(group);
    if (bus) {
      chAnalyser.connect(bus.gain);
    } else {
      chAnalyser.connect(this.masterGain!);
    }
  }

  /** Get bus group level */
  getGroupLevel(group: string): number {
    const bus = this.groupBuses.get(group);
    if (!bus) return 0;
    const data = new Float32Array(bus.analyser.fftSize);
    bus.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    return Math.sqrt(sum / data.length) * 2;
  }

  /** Set bus group volume */
  setGroupVolume(group: string, volume: number): void {
    const bus = this.groupBuses.get(group);
    if (bus) bus.gain.gain.value = volume;
  }

  /** Get all group names */
  getGroupNames(): string[] {
    return Array.from(this.groupBuses.keys());
  }

  /** Get channel's group assignment */
  getChannelGroup(channel: number): string {
    return this.channelGroupAssignment[channel] ?? "master";
  }

  // ─── Master FX Controls ─────────────────────────────────

  /** Set master saturation (0=off, 1=heavy) */
  setMasterSaturation(amount: number): void {
    if (!this.masterSaturation || !this.masterSaturationDry || !this.masterSaturationWet) return;

    if (amount < 0.01) {
      this.masterSaturationDry.gain.value = 1.0;
      this.masterSaturationWet.gain.value = 0.0;
      this.masterSaturation.curve = null;
      return;
    }

    // Generate saturation curve
    const curve = new Float32Array(1024);
    const gain = 1 + amount * 6;
    for (let i = 0; i < 1024; i++) {
      const x = (i / 512 - 1) * gain;
      // Tube-style saturation: asymmetric soft clip
      curve[i] = Math.tanh(x) * 0.9 + Math.tanh(x * 0.5) * 0.1;
    }
    this.masterSaturation.curve = curve;
    this.masterSaturation.oversample = "4x";

    // Wet/dry mix
    this.masterSaturationDry.gain.value = 1 - amount * 0.7;
    this.masterSaturationWet.gain.value = amount * 0.7;
  }

  /** Set pump effect (sidechain-style) */
  setPump(rate: number, depth: number): void {
    // rate: Hz (e.g., BPM/60 for quarter notes)
    // depth: 0-1
    if (this.pumpLfo) this.pumpLfo.frequency.value = rate;
    if (this.pumpDepth) this.pumpDepth.gain.value = depth * 0.5; // Max 50% gain reduction
  }

  /** Sync pump to BPM */
  syncPumpToBpm(bpm: number, division = 1): void {
    // division: 1 = quarter, 0.5 = eighth, 2 = half
    const rate = (bpm / 60) * division;
    if (this.pumpLfo) this.pumpLfo.frequency.value = rate;
  }

  /** Set master volume (0..1) */
  setMasterVolume(volume: number): void {
    if (this.masterGain) this.masterGain.gain.value = volume;
  }

  /** Set master EQ (low/mid/high in dB, -12..+12) */
  setMasterEQ(low: number, mid: number, high: number): void {
    if (this.masterEqLow) this.masterEqLow.gain.value = low;
    if (this.masterEqMid) this.masterEqMid.gain.value = mid;
    if (this.masterEqHigh) this.masterEqHigh.gain.value = high;
  }

  /** Set master compressor params */
  setMasterCompressor(threshold: number, ratio: number, attack: number, release: number): void {
    if (!this.masterCompressor) return;
    this.masterCompressor.threshold.value = threshold;
    this.masterCompressor.ratio.value = ratio;
    this.masterCompressor.attack.value = attack;
    this.masterCompressor.release.value = release;
  }

  /** Get compressor gain reduction (for meter display) */
  getCompressorReduction(): number {
    return this.masterCompressor?.reduction ?? 0;
  }

  /** Toggle master limiter on/off */
  setLimiterEnabled(enabled: boolean): void {
    if (!this.masterLimiter) return;
    if (enabled) {
      this.masterLimiter.threshold.value = -1;
      this.masterLimiter.ratio.value = 20;
    } else {
      // Bypass: set threshold very high
      this.masterLimiter.threshold.value = 0;
      this.masterLimiter.ratio.value = 1;
    }
  }

  /** Set limiter threshold (dBFS) */
  setLimiterThreshold(threshold: number): void {
    if (this.masterLimiter) this.masterLimiter.threshold.value = threshold;
  }

  private getNoise(ctx: AudioContext, duration: number, startTime: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
    return src;
  }

  async resume(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    // Try to initialize WASM AudioWorklet
    if (!this.wasmReady && !this.workletNode) {
      try {
        await this.initWasmWorklet(ctx);
      } catch (err) {
        console.log("WASM AudioWorklet not available, using TypeScript synthesis:", err);
      }
    }
  }

  private async initWasmWorklet(ctx: AudioContext): Promise<void> {
    // Load WASM binary
    const wasmResponse = await fetch("/wasm/elastic-drums-wasm.wasm");
    if (!wasmResponse.ok) throw new Error("WASM file not found");
    const wasmBinary = await wasmResponse.arrayBuffer();

    // Register worklet processor
    await ctx.audioWorklet.addModule("/drum-worklet.js");

    // Create worklet node
    this.workletNode = new AudioWorkletNode(ctx, "elastic-drums-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Connect to master gain (through our mixer routing)
    this.workletNode.connect(this.masterGain!);

    // Listen for messages from worklet
    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === "ready") {
        this.wasmReady = true;
        this.wasmMode = true;
        console.log("✅ WASM AudioWorklet active — C++ DSP running in audio thread");
      } else if (e.data.type === "error") {
        // WASM init failed — fall back to TS synthesis silently
        console.log("WASM worklet init failed (using TS fallback):", e.data.message);
      }
    };

    // Send WASM binary to worklet
    this.workletNode.port.postMessage({
      type: "wasm-binary",
      binary: wasmBinary,
    }, [wasmBinary]);
  }

  /** Send a command to the WASM worklet */
  private postToWorklet(msg: Record<string, unknown>): void {
    if (this.wasmMode && this.workletNode) {
      this.workletNode.port.postMessage(msg);
    }
  }

  /** Check if WASM DSP is active */
  get isWasmActive(): boolean {
    return this.wasmMode;
  }

  triggerVoice(voice: number, velocity = 0.8): void {
    const ctx = this.getContext();
    if (ctx.state === "suspended") ctx.resume();

    if (this.wasmMode) {
      // WASM active: only send to worklet, no double-trigger
      this.postToWorklet({ type: "trigger", voice, velocity });
    } else {
      // TS fallback: use Web Audio synthesis
      this.scheduleVoice(ctx, voice, velocity, ctx.currentTime);
    }
  }

  triggerVoiceAtTime(voice: number, velocity: number, time: number): void {
    const ctx = this.getContext();

    if (this.wasmMode) {
      // In WASM mode, the sequencer runs inside the worklet — don't double-trigger
      // Only trigger if this is a manual pad hit (time === now)
      return;
    }

    this.scheduleVoice(ctx, voice, velocity, time);
  }

  /** Sync entire pattern to the WASM worklet */
  syncPatternToWasm(pattern: { tracks: Array<{ steps: Array<{ active: boolean; velocity: number; ratchetCount: number }>; length: number }>; length: number; swing: number }): void {
    this.postToWorklet({ type: "syncPattern", ...pattern });
  }

  /** Set transport state in WASM worklet */
  setWasmPlaying(playing: boolean): void {
    this.postToWorklet({ type: "setPlaying", playing });
  }

  setWasmBpm(bpm: number): void {
    this.postToWorklet({ type: "setBpm", bpm });
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  // Sample lookup callback
  private sampleLookup: ((voice: number) => AudioBuffer | null) | null = null;

  // HiHat choke: store the master gain of the last triggered hat
  private lastHHClosedGain: GainNode | null = null;
  private lastHHOpenGain: GainNode | null = null;

  /** Register sample lookup function */
  setSampleLookup(fn: (voice: number) => AudioBuffer | null): void {
    this.sampleLookup = fn;
  }

  private scheduleVoice(ctx: AudioContext, voice: number, velocity: number, t: number): void {
    // Check if this voice has a sample loaded — play sample instead of synth
    if (this.sampleLookup) {
      const buffer = this.sampleLookup(voice);
      if (buffer) {
        // Note: tune param is 0 for samples (drum tune is a frequency, not semitones)
        this.playSampleAtTime(buffer, voice, velocity, t, 0);
        return;
      }
    }

    const out = this.getChannelOutput(voice);
    const p = this.voiceParams[voice] ?? {};

    switch (voice) {
      case 0: this.kick(ctx, t, velocity, out, p); break;
      case 1: this.snare(ctx, t, velocity, out, p); break;
      case 2: this.clap(ctx, t, velocity, out, p); break;
      case 3:
      case 4:
      case 5: this.tom(ctx, t, velocity, p.tune ?? 140, out, p); break;
      case 6:
        // Closed hat chokes open hat
        if (this.lastHHOpenGain) { this.lastHHOpenGain.gain.setValueAtTime(0, t); this.lastHHOpenGain = null; }
        this.lastHHClosedGain = this.hihat(ctx, t, velocity, true, out, p);
        break;
      case 7:
        // Open hat chokes closed hat
        if (this.lastHHClosedGain) { this.lastHHClosedGain.gain.setValueAtTime(0, t); this.lastHHClosedGain = null; }
        this.lastHHOpenGain = this.hihat(ctx, t, velocity, false, out, p);
        break;
      case 8:
      case 9: this.cymbal(ctx, t, velocity, p.tune ?? 400, out, p); break;
      case 10:
      case 11: this.perc(ctx, t, velocity, p.tune ?? 800, out, p); break;
    }
  }

  // ─── KICK ──────────────────────────────────────────────
  // TR-808 Bridged-T: deep sine sweep + click transient + sub layer + soft drive
  private kick(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 1.0; // Louder base level for punch
    const baseFreq = p.tune ?? 52;
    const decaySec = (p.decay ?? 550) / 1000;
    const clickAmt = (p.click ?? 50) / 100;
    const driveAmt = (p.drive ?? 40) / 100;
    const subAmt = (p.sub ?? 60) / 100;
    const pitchSweep = (p.pitch ?? 45) / 10;

    // Master output with soft-clip waveshaper
    const master = ctx.createGain();
    // Punchy envelope: fast attack, hold, then decay
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(vol, t + 0.001); // 1ms attack — instant punch
    master.gain.setValueAtTime(vol, t + decaySec * 0.85);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    const shaper = ctx.createWaveShaper();
    if (driveAmt > 0.05) {
      const curve = new Float32Array(1024);
      const driveGain = 1 + driveAmt * 5; // More drive range
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
    eqLow.gain.value = 5;

    const eqMidCut = ctx.createBiquadFilter();
    eqMidCut.type = "peaking";
    eqMidCut.frequency.value = 300;
    eqMidCut.Q.value = 1.5;
    eqMidCut.gain.value = -3; // Cut boxiness

    shaper.connect(eqLow);
    eqLow.connect(eqMidCut);
    eqMidCut.connect(master);
    master.connect(out);

    // Main body oscillator — 808-style 3-stage pitch sweep
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq * pitchSweep * 2, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * pitchSweep * 0.6, t + 0.003);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.15, t + 0.012);
    osc.frequency.setTargetAtTime(baseFreq * 0.98, t + 0.012, decaySec * 0.25);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.9, t);
    bodyGain.gain.setValueAtTime(0.9, t + 0.015);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    osc.connect(bodyGain);
    bodyGain.connect(shaper);
    osc.start(t);
    osc.stop(t + decaySec + 0.05);

    // Sub layer — one octave below, fades in slightly after attack
    if (subAmt > 0.05) {
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(baseFreq * 2, t);
      sub.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, t + 0.04);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0, t);
      subGain.gain.linearRampToValueAtTime(subAmt * 0.8, t + 0.01);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 1.2);

      sub.connect(subGain);
      subGain.connect(shaper);
      sub.start(t);
      sub.stop(t + decaySec * 1.2 + 0.05);
    }

    // Click transient — filtered noise burst (sharper, louder)
    if (clickAmt > 0.05) {
      const click = this.getNoise(ctx, 0.015, t);
      const clickHpf = ctx.createBiquadFilter();
      clickHpf.type = "highpass";
      clickHpf.frequency.value = 3000;
      const clickBpf = ctx.createBiquadFilter();
      clickBpf.type = "peaking";
      clickBpf.frequency.value = 4500;
      clickBpf.Q.value = 3;
      clickBpf.gain.value = 8; // Boost click presence
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(clickAmt * 0.7, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

      click.connect(clickHpf);
      clickHpf.connect(clickBpf);
      clickBpf.connect(clickGain);
      clickGain.connect(master);
    }
  }

  // ─── SNARE ─────────────────────────────────────────────
  // 808/909 hybrid: dual-oscillator body + crisp noise snap + transient click
  private snare(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.75; // Louder for presence
    const tune = p.tune ?? 180;
    const decaySec = (p.decay ?? 220) / 1000;
    const toneMix = (p.tone ?? 55) / 100;
    const snap = (p.snap ?? 70) / 100;
    const bodyAmt = (p.body ?? 60) / 100;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.05);
    master.connect(out);

    // Body — two detuned oscillators with pitch envelope for crack
    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(tune * 1.8, t);    // Higher start → more crack
    osc1.frequency.exponentialRampToValueAtTime(tune, t + 0.01);

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(tune * 2.8, t);    // More harmonic spread
    osc2.frequency.exponentialRampToValueAtTime(tune * 0.85, t + 0.015);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(toneMix * bodyAmt * 0.9, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.6);

    // Resonant body filter — tighter, more focused
    const bodyBpf = ctx.createBiquadFilter();
    bodyBpf.type = "peaking";
    bodyBpf.frequency.value = 220;
    bodyBpf.Q.value = 2.5;
    bodyBpf.gain.value = 5;

    osc1.connect(bodyGain);
    osc2.connect(bodyGain);
    bodyGain.connect(bodyBpf);
    bodyBpf.connect(master);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + decaySec + 0.05);
    osc2.stop(t + decaySec + 0.05);

    // Transient click — very short noise burst for initial snap
    const click = this.getNoise(ctx, 0.004, t);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(snap * 0.6, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.004);
    click.connect(clickGain);
    clickGain.connect(master);

    // Snappy noise — broader spectrum, more sizzle
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseBpf = ctx.createBiquadFilter();
    noiseBpf.type = "highpass";
    noiseBpf.frequency.value = 1500;

    const noisePresence = ctx.createBiquadFilter();
    noisePresence.type = "peaking";
    noisePresence.frequency.value = 5000;
    noisePresence.Q.value = 1.5;
    noisePresence.gain.value = 4; // Presence boost for air

    const noiseHpf = ctx.createBiquadFilter();
    noiseHpf.type = "lowpass";
    noiseHpf.frequency.setValueAtTime(14000, t);
    noiseHpf.frequency.exponentialRampToValueAtTime(3500, t + decaySec * 0.5);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(snap * 1.0, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.55);

    noise.connect(noiseBpf);
    noiseBpf.connect(noisePresence);
    noisePresence.connect(noiseHpf);
    noiseHpf.connect(noiseGain);
    noiseGain.connect(master);
  }

  // ─── CLAP ──────────────────────────────────────────────
  // 808 multi-burst noise with reverb-like tail + body resonance
  private clap(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams): void {
    const levelBoost = (p.level ?? 100) / 100;
    const vol = vel * 0.85 * levelBoost;
    const decaySec = (p.decay ?? 350) / 1000;
    const toneFreq = p.tone ?? 1800;
    const spread = (p.spread ?? 50) / 100;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.1);
    master.connect(out);

    // Dual bandpass for wider, warmer character
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = toneFreq;
    bpf.Q.value = 1.0;

    const warmth = ctx.createBiquadFilter();
    warmth.type = "peaking";
    warmth.frequency.value = toneFreq * 0.6;
    warmth.Q.value = 1.5;
    warmth.gain.value = 4; // Body warmth

    bpf.connect(warmth);
    warmth.connect(master);

    // 4 noise bursts — spread controls spacing
    const baseSpacing = 0.005 + spread * 0.015;
    const burstTimes = [0, baseSpacing, baseSpacing * 2.3, baseSpacing * 3.8];
    for (let i = 0; i < burstTimes.length; i++) {
      const offset = burstTimes[i]!;
      const burst = this.getNoise(ctx, 0.008, t + offset);
      const g = ctx.createGain();
      // Each burst slightly quieter for natural feel
      const burstVol = 1.0 - i * 0.08;
      g.gain.setValueAtTime(burstVol, t + offset);
      g.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.008);
      burst.connect(g);
      g.connect(bpf);
    }

    // Decay tail — longer, more reverb-like
    const tail = this.getNoise(ctx, decaySec, t + 0.035);
    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.55, t + 0.035);
    tailGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    tail.connect(tailGain);
    tailGain.connect(bpf);
  }

  // ─── TOM ───────────────────────────────────────────────
  // 808-style: warm sine body + overtone + click, deep pitch sweep
  private tom(ctx: AudioContext, t: number, vel: number, tune: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.8; // Louder for presence
    const decaySec = (p.decay ?? 300) / 1000;
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

  // ─── HIHAT ─────────────────────────────────────────────
  // 909-style: 6 metallic square oscillators + filtered noise + tone shaping
  private hihat(ctx: AudioContext, t: number, vel: number, closed: boolean, out: AudioNode, p: VoiceParams): GainNode {
    const vol = vel * (closed ? 0.6 : 0.65);
    const decaySec = (p.decay ?? (closed ? 45 : 250)) / 1000;
    const toneAmt = (p.tone ?? 60) / 100; // 0=dark, 1=bright

    const master = ctx.createGain();
    // Tighter envelope for closed hat
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

    // Highpass for metallic shimmer — tone-dependent
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = closed
      ? 6000 + toneAmt * 4000    // 6k–10k based on tone
      : 4500 + toneAmt * 3000;   // 4.5k–7.5k
    hpf.Q.value = 0.5;

    // Presence peak for shimmer/air
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 10000 + toneAmt * 3000;
    presence.Q.value = 1.2;
    presence.gain.value = 3 + toneAmt * 3;

    hpf.connect(presence);
    presence.connect(master);

    // 6 square-wave oscillators at 909 metallic ratios
    const baseFreq = p.tune ?? 330;
    const ratios = [1.0, 1.4471, 1.7409, 1.9307, 2.5377, 2.7616];
    for (const r of ratios) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = baseFreq * r;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

      osc.connect(g);
      g.connect(hpf);
      osc.start(t);
      osc.stop(t + decaySec + 0.02);
    }

    // Noise layer — more sizzle with tone-shaped bandwidth
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseLpf = ctx.createBiquadFilter();
    noiseLpf.type = "lowpass";
    noiseLpf.frequency.value = 12000 + toneAmt * 6000; // Up to 18kHz for bright
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.75);
    noise.connect(noiseLpf);
    noiseLpf.connect(ng);
    ng.connect(hpf);

    return master; // For choke group
  }

  // ─── CYMBAL / RIDE ─────────────────────────────────────
  // Extended metallic oscillator bank with bell character + shimmer
  private cymbal(ctx: AudioContext, t: number, vel: number, baseFreq: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.6;
    const decaySec = (p.decay ?? 800) / 1000;
    const toneAmt = (p.tone ?? 60) / 100;

    const master = ctx.createGain();
    // Two-stage decay: fast initial, slow sustain (like real cymbal)
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(vol * 0.35, t + decaySec * 0.15);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    master.connect(out);

    // Highpass — tone-dependent
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 3500 + toneAmt * 2000;
    hpf.Q.value = 0.3;

    // Bell presence peak
    const bell = ctx.createBiquadFilter();
    bell.type = "peaking";
    bell.frequency.value = 8000 + toneAmt * 4000;
    bell.Q.value = 2;
    bell.gain.value = 3 + toneAmt * 3;

    // Air/shimmer shelf
    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 12000;
    air.gain.value = 2 + toneAmt * 4;

    hpf.connect(bell);
    bell.connect(air);
    air.connect(master);

    // 8 metallic oscillators — wider ratio spread for richer spectrum
    const ratios = [1.0, 1.4471, 1.7409, 1.9307, 2.5377, 2.7616, 3.1415, 3.7135];
    for (let i = 0; i < ratios.length; i++) {
      const r = ratios[i]!;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = baseFreq * r;

      const g = ctx.createGain();
      // Higher partials decay faster (natural)
      const partialDecay = decaySec * (1 - i * 0.06);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + partialDecay);

      osc.connect(g);
      g.connect(hpf);
      osc.start(t);
      osc.stop(t + partialDecay + 0.05);
    }

    // Noise shimmer — broader, with envelope matching
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseLpf = ctx.createBiquadFilter();
    noiseLpf.type = "lowpass";
    noiseLpf.frequency.value = 14000 + toneAmt * 4000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14, t);
    ng.gain.exponentialRampToValueAtTime(0.06, t + decaySec * 0.2);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.8);
    noise.connect(noiseLpf);
    noiseLpf.connect(ng);
    ng.connect(hpf);
  }

  // ─── PERCUSSION (Multi-Mode) ────────────────────────────
  // TYPE 0=Conga, 1=Bongo, 2=Rim/Sidestick, 3=Cowbell,
  //      4=Shaker, 5=Claves, 6=Tambourine, 7=Triangle
  private perc(ctx: AudioContext, t: number, vel: number, freq: number, out: AudioNode, p: VoiceParams): void {
    const type = Math.round(p.type ?? 0);
    const tune = p.tune ?? freq;
    const decaySec = (p.decay ?? 120) / 1000;
    const toneAmt = (p.tone ?? 50) / 100;
    const vol = vel * 0.75;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.02);
    master.connect(out);

    switch (type) {
      case 0: // ── CONGA: resonant body, pitch drop, warm
      case 1: { // ── BONGO: higher, tighter, sharper attack
        const isBongo = type === 1;
        const bodyFreq = isBongo ? tune * 1.3 : tune;
        const bodyDecay = isBongo ? decaySec * 0.6 : decaySec;

        // Main body — sine with deeper pitch sweep
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(bodyFreq * 2.0, t);
        osc.frequency.exponentialRampToValueAtTime(bodyFreq * 1.05, t + (isBongo ? 0.006 : 0.012));
        osc.frequency.setTargetAtTime(bodyFreq * 0.98, t + 0.015, bodyDecay * 0.3);

        // Warmth filter
        const warmth = ctx.createBiquadFilter();
        warmth.type = "lowshelf";
        warmth.frequency.value = bodyFreq * 2;
        warmth.gain.value = 4;

        const bodyG = ctx.createGain();
        bodyG.gain.setValueAtTime(0.85, t);
        bodyG.gain.exponentialRampToValueAtTime(0.001, t + bodyDecay);
        osc.connect(bodyG); bodyG.connect(warmth); warmth.connect(master);
        osc.start(t); osc.stop(t + bodyDecay + 0.02);

        // Sub resonance for body weight
        const sub = ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.value = bodyFreq * 0.5;
        const subG = ctx.createGain();
        subG.gain.setValueAtTime(0, t);
        subG.gain.linearRampToValueAtTime(0.2, t + 0.005);
        subG.gain.exponentialRampToValueAtTime(0.001, t + bodyDecay * 0.7);
        sub.connect(subG); subG.connect(master);
        sub.start(t); sub.stop(t + bodyDecay + 0.02);

        // Slap noise — louder, tuned
        const slap = this.getNoise(ctx, 0.01, t);
        const slapG = ctx.createGain();
        slapG.gain.setValueAtTime(toneAmt * 0.55, t);
        slapG.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
        const slapBpf = ctx.createBiquadFilter();
        slapBpf.type = "bandpass"; slapBpf.frequency.value = bodyFreq * 3; slapBpf.Q.value = 4;
        slap.connect(slapBpf); slapBpf.connect(slapG); slapG.connect(master);
        break;
      }

      case 2: { // ── RIM / SIDESTICK: sharp click + tuned ring
        // Click transient
        const click = this.getNoise(ctx, 0.003, t);
        const clickG = ctx.createGain();
        clickG.gain.setValueAtTime(0.9, t);
        clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
        click.connect(clickG); clickG.connect(master);

        // Resonant ring — two partials for woody character
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tune;
        const ringG = ctx.createGain();
        ringG.gain.setValueAtTime(0.5, t);
        ringG.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
        osc.connect(ringG); ringG.connect(master);
        osc.start(t); osc.stop(t + 0.04);

        // Second partial for body
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = tune * 1.71; // Inharmonic for wood
        const ring2G = ctx.createGain();
        ring2G.gain.setValueAtTime(0.25, t);
        ring2G.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
        osc2.connect(ring2G); ring2G.connect(master);
        osc2.start(t); osc2.stop(t + 0.03);
        break;
      }

      case 3: { // ── COWBELL: 808-style, two detuned squares + bandpass
        const f1 = tune * 0.7;
        const f2 = tune;

        // Tight bandpass for that classic 808 cowbell tone
        const cowbellBpf = ctx.createBiquadFilter();
        cowbellBpf.type = "bandpass";
        cowbellBpf.frequency.value = (f1 + f2);
        cowbellBpf.Q.value = 3;
        cowbellBpf.connect(master);

        for (const f of [f1, f2]) {
          const osc = ctx.createOscillator();
          osc.type = "square";
          osc.frequency.value = f;
          const g = ctx.createGain();
          // Two-stage decay like real 808
          g.gain.setValueAtTime(0.4, t);
          g.gain.exponentialRampToValueAtTime(0.15, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
          osc.connect(g); g.connect(cowbellBpf);
          osc.start(t); osc.stop(t + decaySec + 0.02);
        }
        break;
      }

      case 4: { // ── SHAKER: rhythmic noise, shaped spectrum
        const noise = this.getNoise(ctx, decaySec, t);
        const hpf = ctx.createBiquadFilter();
        hpf.type = "highpass"; hpf.frequency.value = Math.max(4000, tune);
        // Presence peak for sparkle
        const presence = ctx.createBiquadFilter();
        presence.type = "peaking"; presence.frequency.value = 8000; presence.Q.value = 2; presence.gain.value = 4;
        const ng = ctx.createGain();
        // Shaped envelope: fast attack, medium release
        ng.gain.setValueAtTime(0.7, t);
        ng.gain.exponentialRampToValueAtTime(0.3, t + decaySec * 0.2);
        ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
        noise.connect(hpf); hpf.connect(presence); presence.connect(ng); ng.connect(master);
        break;
      }

      case 5: { // ── CLAVES: sharp tuned click with ring
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        osc.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + 0.035);

        // Subtle second harmonic for wood character
        const h2 = ctx.createOscillator();
        h2.type = "sine";
        h2.frequency.value = tune * 3;
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.2, t);
        hg.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
        h2.connect(hg); hg.connect(master);
        h2.start(t); h2.stop(t + 0.02);
        break;
      }

      case 6: { // ── TAMBOURINE: metallic jingles + noise shimmer
        // More metallic oscillators with wider spread
        for (const ratio of [1.0, 1.47, 2.09, 2.83]) {
          const osc = ctx.createOscillator();
          osc.type = "square";
          osc.frequency.value = tune * ratio;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.1, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.65);
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass"; hp.frequency.value = 5500;
          osc.connect(hp); hp.connect(g); g.connect(master);
          osc.start(t); osc.stop(t + decaySec + 0.02);
        }
        // Noise shimmer — brighter, longer
        const noise = this.getNoise(ctx, decaySec, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.35, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.55);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 7000;
        const air = ctx.createBiquadFilter();
        air.type = "highshelf"; air.frequency.value = 10000; air.gain.value = 4;
        noise.connect(hp); hp.connect(air); air.connect(ng); ng.connect(master);
        break;
      }

      case 7: { // ── TRIANGLE: pure metallic ring, long sustain, inharmonic overtones
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.55, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
        osc.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + decaySec + 0.02);

        // Three inharmonic partials for metallic shimmer
        const partials = [2.76, 5.404, 8.933];
        const partialVols = [0.18, 0.08, 0.04];
        for (let i = 0; i < partials.length; i++) {
          const h = ctx.createOscillator();
          h.type = "sine";
          h.frequency.value = tune * partials[i]!;
          const hg = ctx.createGain();
          hg.gain.setValueAtTime(partialVols[i]!, t);
          hg.gain.exponentialRampToValueAtTime(0.001, t + decaySec * (0.7 - i * 0.15));
          h.connect(hg); hg.connect(master);
          h.start(t); h.stop(t + decaySec + 0.02);
        }
        break;
      }

      default: { // Fallback: resonant noise
        const bpf = ctx.createBiquadFilter();
        bpf.type = "bandpass"; bpf.frequency.value = tune; bpf.Q.value = 12;
        bpf.connect(master);
        const noise = this.getNoise(ctx, decaySec, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(1.0, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
        noise.connect(ng); ng.connect(bpf);
        break;
      }
    }
  }

  get isInitialized(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Create a MediaStream from the master output for recording */
  createRecordingStream(): MediaStreamAudioDestinationNode | null {
    if (!this.ctx || !this.masterAnalyser) return null;
    const dest = this.ctx.createMediaStreamDestination();
    // Tap after the final analyser (which connects to ctx.destination)
    this.masterAnalyser.connect(dest);
    return dest;
  }

  /** Disconnect a recording stream */
  disconnectRecordingStream(dest: MediaStreamAudioDestinationNode): void {
    if (this.masterAnalyser) {
      try { this.masterAnalyser.disconnect(dest); } catch { /* already disconnected */ }
    }
  }
}

// Singleton
export const audioEngine = new AudioEngine();
