/**
 * Send Effects Manager
 *
 * Manages all send buses (reverb, delay), flanger, and performance FX:
 * - Send A: Reverb (convolver-based with algorithmic IR)
 * - Send B: Stereo Delay (ping-pong, tape wobble modes)
 * - Flanger: Dedicated short-delay modulation inserted in master chain
 * - Master Filter: Performance FX (XY-pad filter)
 * - Master Saturation: Tube-style distortion (parallel wet/dry)
 * - Pump: Sidechain-style LFO gain modulation
 * - Stutter/Gate: Square LFO on pump output
 * - Noise: White noise burst generator
 */

// Delay sync divisions: name → beat multiplier (1 = quarter note)
export const DELAY_DIVISIONS: Record<string, number> = {
  "1/4": 1, "1/8": 0.5, "1/16": 0.25,
  "1/8D": 0.75, "1/8T": 0.333, "1/4D": 1.5, "1/16T": 0.167,
};

export const DELAY_DIVISION_NAMES = Object.keys(DELAY_DIVISIONS);

export const REVERB_TYPES = ["room", "hall", "plate", "ambient"] as const;

export class SendFxManager {
  private ctx: AudioContext | null = null;

  // ─── Send FX: Reverb (Send A) ──────────────────────────
  private sendABus: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private reverbAnalyser: AnalyserNode | null = null;
  private reverbDamping: BiquadFilterNode | null = null;
  private reverbPreDelay: DelayNode | null = null;

  // Reverb state
  private reverbType: "room" | "hall" | "plate" | "ambient" = "hall";
  private reverbSize = 2.5;
  private reverbDecayVal = 2.5;

  // ─── Send FX: Delay (Send B) ───────────────────────────
  private sendBBus: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayFilter: BiquadFilterNode | null = null;
  private delayGain: GainNode | null = null;
  private delayAnalyser: AnalyserNode | null = null;
  private delayPanner: StereoPannerNode | null = null;
  private delayTapeLfo: OscillatorNode | null = null;
  private delayTapeLfoGain: GainNode | null = null;

  // Delay state
  private delayType: "stereo" | "pingpong" | "tape" = "stereo";
  private delayDivision = "1/8";

  // ─── Send FX: Flanger (insert in master chain) ─────────
  private flangerInput: GainNode | null = null;
  private flangerOutput: GainNode | null = null;
  private flangerDelay: DelayNode | null = null;
  private flangerLfo: OscillatorNode | null = null;
  private flangerLfoGain: GainNode | null = null;
  private flangerFeedback: GainNode | null = null;
  private flangerWet: GainNode | null = null;
  private flangerDry: GainNode | null = null;
  private flangerActive = false;

  // ─── Performance FX: Master Chain ──────────────────────
  private masterFilter: BiquadFilterNode | null = null;
  private masterSaturation: WaveShaperNode | null = null;
  private masterSaturationDry: GainNode | null = null;
  private masterSaturationWet: GainNode | null = null;

  // ─── Performance FX: Noise ─────────────────────────────
  private activeNoiseSource: AudioBufferSourceNode | null = null;
  private activeNoiseGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // ─── Performance FX: Stutter ──────────────────────────
  private stutterLfo: OscillatorNode | null = null;
  private stutterGain: GainNode | null = null;

  // ─── Performance FX: Pump (sidechain LFO) ──────────────
  private pumpGain: GainNode | null = null;
  private pumpLfo: OscillatorNode | null = null;
  private pumpDepth: GainNode | null = null;

  // Send channel gains (per-channel send A and B)
  private sendAGains: GainNode[] = [];
  private sendBGains: GainNode[] = [];

  /**
   * Initialize all send FX nodes and routing
   * Returns the master compressor and pump gain for external connections
   */
  init(
    ctx: AudioContext,
    masterGain: GainNode,
    pumpGain: GainNode,
    _masterCompressor?: DynamicsCompressorNode
  ): {
    flangerInput: GainNode;
    flangerOutput: GainNode;
    sendABus: GainNode;
    sendBBus: GainNode;
    masterFilter: BiquadFilterNode;
    masterSaturationDry: GainNode;
    masterSaturation: WaveShaperNode;
    masterSaturationWet: GainNode;
    pumpGain: GainNode;
  } {
    this.ctx = ctx;

    // ─── Send FX Buses ──────────────────────────────────
    // Send A: Reverb (ConvolverNode with generated impulse)
    this.sendABus = ctx.createGain();
    this.sendABus.gain.value = 1.0;

    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverbAnalyser = ctx.createAnalyser();
    this.reverbAnalyser.fftSize = 2048;
    this.reverbAnalyser.smoothingTimeConstant = 0.18;

    this.reverbPreDelay = ctx.createDelay(0.2);
    this.reverbPreDelay.delayTime.value = 0.012;

    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = this.generateReverbIR(ctx, 2.0, 2.5, "hall");

    this.reverbDamping = ctx.createBiquadFilter();
    this.reverbDamping.type = "lowpass";
    this.reverbDamping.frequency.value = 8000;
    this.reverbDamping.Q.value = 0.5;

    // Reverb chain: bus → pre-delay → convolver → damping → gain → master
    this.sendABus.connect(this.reverbPreDelay);
    this.reverbPreDelay.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbDamping);
    this.reverbDamping.connect(this.reverbGain);
    this.reverbGain.connect(this.reverbAnalyser);
    this.reverbAnalyser.connect(masterGain);

    // Send B: Stereo Delay (ping-pong style)
    this.sendBBus = ctx.createGain();
    this.sendBBus.gain.value = 1.0;

    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.375; // 3/16 at 120 BPM

    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.4;

    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = "lowpass";
    this.delayFilter.frequency.value = 4000;

    this.delayGain = ctx.createGain();
    this.delayGain.gain.value = 0.3;
    this.delayAnalyser = ctx.createAnalyser();
    this.delayAnalyser.fftSize = 2048;
    this.delayAnalyser.smoothingTimeConstant = 0.18;

    this.delayPanner = ctx.createStereoPanner();
    this.delayPanner.pan.value = 0;

    // Tape mode LFO (wow/flutter): modulates delay time subtly
    this.delayTapeLfo = ctx.createOscillator();
    this.delayTapeLfo.type = "sine";
    this.delayTapeLfo.frequency.value = 0.6; // Slow wobble
    this.delayTapeLfoGain = ctx.createGain();
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
    this.delayGain.connect(this.delayAnalyser);
    this.delayAnalyser.connect(masterGain);

    // === Dedicated Flanger FX ===
    // Flanger uses its OWN short delay (1–10ms) + LFO sweep, NOT the global delay
    this.flangerInput = ctx.createGain();
    this.flangerInput.gain.value = 1.0;
    this.flangerOutput = ctx.createGain();
    this.flangerOutput.gain.value = 1.0;

    this.flangerDelay = ctx.createDelay(0.02); // Max 20ms
    this.flangerDelay.delayTime.value = 0.005; // 5ms center

    this.flangerLfo = ctx.createOscillator();
    this.flangerLfo.type = "sine";
    this.flangerLfo.frequency.value = 0.3; // Slow sweep

    this.flangerLfoGain = ctx.createGain();
    this.flangerLfoGain.gain.value = 0.004; // ±4ms sweep depth

    this.flangerFeedback = ctx.createGain();
    this.flangerFeedback.gain.value = 0.6;

    this.flangerWet = ctx.createGain();
    this.flangerWet.gain.value = 0; // Off by default
    this.flangerDry = ctx.createGain();
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

    // === Master Saturation (parallel wet/dry) ===
    this.masterSaturation = ctx.createWaveShaper();
    this.masterSaturationDry = ctx.createGain();
    this.masterSaturationWet = ctx.createGain();
    this.masterSaturationDry.gain.value = 1.0; // Start bypassed
    this.masterSaturationWet.gain.value = 0.0;
    // Default: clean (no curve)

    // Performance FX master filter (default: allpass = bypassed)
    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = "allpass";
    this.masterFilter.frequency.value = 1000;
    this.masterFilter.Q.value = 1;

    // Pre-generate noise buffer for performance FX
    this.noiseBuffer = this.generateNoiseBuffer(ctx, 2.0);

    // Store references for later use
    this.pumpGain = pumpGain;

    // === Pump (sidechain-style LFO on master gain) ===
    this.pumpDepth = ctx.createGain();
    this.pumpDepth.gain.value = 0; // Start off

    this.pumpLfo = ctx.createOscillator();
    this.pumpLfo.type = "sine";
    this.pumpLfo.frequency.value = 2.0; // Default: 120 BPM quarter note
    this.pumpLfo.connect(this.pumpDepth);
    this.pumpDepth.connect(this.pumpGain.gain);
    this.pumpLfo.start();

    // Return routing points that AudioEngine needs to connect
    return {
      flangerInput: this.flangerInput,
      flangerOutput: this.flangerOutput,
      sendABus: this.sendABus,
      sendBBus: this.sendBBus,
      masterFilter: this.masterFilter,
      masterSaturationDry: this.masterSaturationDry,
      masterSaturation: this.masterSaturation,
      masterSaturationWet: this.masterSaturationWet,
      pumpGain: this.pumpGain,
    };
  }

  /**
   * Create send gains for a single channel
   * Called once per channel during channel initialization
   */
  createChannelSends(channelGain: GainNode): void {
    if (!this.ctx || !this.sendABus || !this.sendBBus) return;

    const sendA = this.ctx.createGain();
    sendA.gain.value = 0; // Default: no reverb send
    channelGain.connect(sendA);
    sendA.connect(this.sendABus);
    this.sendAGains.push(sendA);

    const sendB = this.ctx.createGain();
    sendB.gain.value = 0; // Default: no delay send
    channelGain.connect(sendB);
    sendB.connect(this.sendBBus);
    this.sendBGains.push(sendB);
  }

  /**
   * Generate algorithmic reverb impulse response by type
   * @private
   */
  private generateReverbIR(ctx: AudioContext, duration: number, decay: number, type: string): AudioBuffer {
    const sr = ctx.sampleRate;
    const length = Math.ceil(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);

    // Type-specific parameters
    const profiles: Record<
      string,
      {
        preDelayMs: number;
        earlyDensity: number;
        earlySpread: number;
        tailDecayMul: number;
        brightness: number;
      }
    > = {
      room: { preDelayMs: 5, earlyDensity: 8, earlySpread: 2, tailDecayMul: 1.0, brightness: 0.7 },
      hall: { preDelayMs: 15, earlyDensity: 6, earlySpread: 5, tailDecayMul: 1.0, brightness: 0.5 },
      plate: { preDelayMs: 1, earlyDensity: 0, earlySpread: 1, tailDecayMul: 0.8, brightness: 0.9 },
      ambient: { preDelayMs: 25, earlyDensity: 4, earlySpread: 10, tailDecayMul: 1.5, brightness: 0.3 },
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
        data[i] =
          (data[i] ?? 0) + (Math.random() * 2 - 1) * envelope * (p.brightness + warmth * (1 - p.brightness));
      }
    }

    return buffer;
  }

  /**
   * Generate white noise buffer
   * @private
   */
  private generateNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.ceil(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
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

  getChannelReverbSend(channel: number): number {
    return this.sendAGains[channel]?.gain.value ?? 0;
  }

  getChannelDelaySend(channel: number): number {
    return this.sendBGains[channel]?.gain.value ?? 0;
  }

  /** Set reverb wet level */
  setReverbLevel(level: number): void {
    if (this.reverbGain) this.reverbGain.gain.value = level;
  }

  getReverbLevel(): number {
    return this.reverbGain?.gain.value ?? 0;
  }

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
  getReverbType(): string {
    return this.reverbType;
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

  getDelayLevel(): number {
    return this.delayGain?.gain.value ?? 0;
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
  getDelayType(): string {
    return this.delayType;
  }

  /** Get current delay division */
  getDelayDivision(): string {
    return this.delayDivision;
  }

  getReturnAnalyser(type: "reverb" | "delay"): AnalyserNode | null {
    return type === "reverb" ? this.reverbAnalyser : this.delayAnalyser;
  }

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

  /** Start noise burst (hold to play) */
  startNoise(volume = 0.3): void {
    if (!this.ctx || !this.noiseBuffer || !this.pumpGain) return;
    this.stopNoise(); // Clean up any previous
    this.activeNoiseSource = this.ctx.createBufferSource();
    this.activeNoiseSource.buffer = this.noiseBuffer;
    this.activeNoiseSource.loop = true;
    this.activeNoiseGain = this.ctx.createGain();
    this.activeNoiseGain.gain.value = volume;
    this.activeNoiseSource.connect(this.activeNoiseGain);
    this.activeNoiseGain.connect(this.pumpGain);
    this.activeNoiseSource.start();
  }

  /** Stop noise burst */
  stopNoise(): void {
    if (this.activeNoiseSource) {
      try {
        this.activeNoiseSource.stop();
      } catch {
        /* already stopped */
      }
      this.activeNoiseSource.disconnect();
      this.activeNoiseSource = null;
    }
    if (this.activeNoiseGain) {
      this.activeNoiseGain.disconnect();
      this.activeNoiseGain = null;
    }
  }

  /** Start stutter/gate effect — inserts a gain gate between pump and compressor */
  startStutter(rate: number, masterCompressor: DynamicsCompressorNode): void {
    if (!this.ctx || !this.pumpGain || !masterCompressor) return;
    this.stopStutter(masterCompressor);

    // Create a gate gain node and insert it into the signal chain
    this.stutterGain = this.ctx.createGain();
    this.stutterGain.gain.value = 1.0;

    // Disconnect pumpGain → compressor and re-route through gate
    this.pumpGain.disconnect(masterCompressor);
    this.pumpGain.connect(this.stutterGain);
    this.stutterGain.connect(masterCompressor);

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
  stopStutter(masterCompressor: DynamicsCompressorNode): void {
    if (this.stutterLfo) {
      try {
        this.stutterLfo.stop();
      } catch {
        /* */
      }
      this.stutterLfo.disconnect();
      this.stutterLfo = null;
    }
    if (this.stutterGain && this.pumpGain && masterCompressor) {
      // Restore direct connection
      this.stutterGain.disconnect();
      try {
        this.pumpGain.disconnect(this.stutterGain);
      } catch {
        /* */
      }
      this.pumpGain.connect(masterCompressor);
    }
    if (this.stutterGain) {
      this.stutterGain.disconnect();
      this.stutterGain = null;
    }
  }

  // ─── Flanger FX Controls ────────────────────────────────

  /** Activate flanger with sweep position (x) and feedback/depth (y) */
  startFlanger(sweepRate: number, depth: number, feedback: number): void {
    if (!this.flangerLfo || !this.flangerLfoGain || !this.flangerFeedback || !this.flangerWet || !this.flangerDry)
      return;
    this.flangerActive = true;
    this.flangerLfo.frequency.value = sweepRate; // 0.1–5 Hz
    this.flangerLfoGain.gain.value = 0.001 + depth * 0.008; // Sweep depth 1–9ms
    this.flangerFeedback.gain.value = Math.min(0.95, feedback); // Resonance
    this.flangerWet.gain.value = 0.7; // Wet mix on
    this.flangerDry.gain.value = 0.6; // Slight dry reduction for effect
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

  /** Destroy all running oscillators and clean up resources */
  destroy(): void {
    // Stop and disconnect delayTapeLfo
    if (this.delayTapeLfo) {
      try {
        this.delayTapeLfo.stop();
      } catch {
        /* already stopped */
      }
      this.delayTapeLfo.disconnect();
      this.delayTapeLfo = null;
    }

    // Stop and disconnect flangerLfo
    if (this.flangerLfo) {
      try {
        this.flangerLfo.stop();
      } catch {
        /* already stopped */
      }
      this.flangerLfo.disconnect();
      this.flangerLfo = null;
    }

    // Stop and disconnect pumpLfo
    if (this.pumpLfo) {
      try {
        this.pumpLfo.stop();
      } catch {
        /* already stopped */
      }
      this.pumpLfo.disconnect();
      this.pumpLfo = null;
    }

    // Clean up any active performance FX
    this.stopNoise();
    if (this.ctx) {
      this.stopStutter(this.ctx.createDynamicsCompressor());
    }

    // Disconnect all nodes
    if (this.sendABus) {
      this.sendABus.disconnect();
      this.sendABus = null;
    }
    if (this.sendBBus) {
      this.sendBBus.disconnect();
      this.sendBBus = null;
    }
    if (this.flangerInput) {
      this.flangerInput.disconnect();
      this.flangerInput = null;
    }
    if (this.flangerOutput) {
      this.flangerOutput.disconnect();
      this.flangerOutput = null;
    }
    if (this.pumpGain) {
      this.pumpGain.disconnect();
      this.pumpGain = null;
    }

    this.ctx = null;
  }
}

// Export singleton instance
export const sendFxManager = new SendFxManager();
