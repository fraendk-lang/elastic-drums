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

// Lazy Web Worker for off-thread reverb IR generation (avoids ~40-100ms main-thread block)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite handles ?worker imports at build time
import ReverbWorkerCtor from "./reverbWorker?worker";

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

  // Off-thread IR generation
  private _reverbWorker: Worker | null = null;
  private _reverbWorkerPending = 0; // monotonic request ID — only the latest response is applied

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
  /** Legacy single-filter node (kept as the public masterFilter input/output
   *  alias — signal routes through it first but its .type stays "allpass" */
  private masterFilter: BiquadFilterNode | null = null;
  /** Dedicated HP filter (always active, freq at 20Hz = transparent when bypassed) */
  private masterFilterHp: BiquadFilterNode | null = null;
  /** Output node after HP stage — AudioEngine routes from here */
  private masterFilterOut: GainNode | null = null;
  private masterSaturation: WaveShaperNode | null = null;
  private masterSaturationDry: GainNode | null = null;
  private masterSaturationWet: GainNode | null = null;

  // ─── Performance FX: Noise ─────────────────────────────
  private activeNoiseSource: AudioBufferSourceNode | null = null;
  private activeNoiseGain: GainNode | null = null;
  private activeNoiseFilter: BiquadFilterNode | null = null; // sweeping LPF
  private noiseBuffer: AudioBuffer | null = null;

  // ─── Performance FX: Stutter ──────────────────────────
  private stutterLfo: OscillatorNode | null = null;
  private stutterGain: GainNode | null = null;
  /** Timer ID for the pending 40 ms stutter-teardown — cancel if startStutter fires again */
  private _stopStutterTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Performance FX: Pump (sidechain LFO) ──────────────
  private pumpGain: GainNode | null = null;
  private pumpLfo: OscillatorNode | null = null;
  private pumpDepth: GainNode | null = null;

  // ─── Send FX: Chorus (Send C) ──────────────────────────
  private sendCBus: GainNode | null = null;
  private chorusDelayL: DelayNode | null = null;
  private chorusDelayR: DelayNode | null = null;
  private chorusLfoL: OscillatorNode | null = null;
  private chorusLfoR: OscillatorNode | null = null;
  private chorusLfoGainL: GainNode | null = null;
  private chorusLfoGainR: GainNode | null = null;
  private chorusWet: GainNode | null = null;

  // ─── Send FX: Phaser (Send D) ──────────────────────────
  private sendDBus: GainNode | null = null;
  private phaserAllpass: BiquadFilterNode[] = [];
  private phaserLfo: OscillatorNode | null = null;
  private phaserLfoGain: GainNode | null = null;
  private phaserFeedback: GainNode | null = null;
  private phaserWet: GainNode | null = null;

  // Send channel gains (per-channel send A, B, C, D)
  private sendAGains: GainNode[] = [];
  private sendBGains: GainNode[] = [];
  private sendCGains: GainNode[] = [];
  private sendDGains: GainNode[] = [];

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
    masterFilterOut: GainNode;
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
    // Buffer starts null (ConvolverNode passes through silently until IR is ready)
    // IR is generated off-thread to avoid a ~40-100ms main-thread stall
    this._scheduleReverbIR(ctx, 2.0, 2.5, "hall");

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

    // ─── Send C: Stereo Chorus ──────────────────────────
    this.sendCBus = ctx.createGain();
    this.sendCBus.gain.value = 1.0;

    // Two delay lines (L/R) modulated by slow LFOs 90° out of phase
    this.chorusDelayL = ctx.createDelay(0.05);
    this.chorusDelayL.delayTime.value = 0.015; // 15ms center
    this.chorusDelayR = ctx.createDelay(0.05);
    this.chorusDelayR.delayTime.value = 0.025; // 25ms center

    this.chorusLfoL = ctx.createOscillator();
    this.chorusLfoL.type = "sine";
    this.chorusLfoL.frequency.value = 0.6;
    this.chorusLfoGainL = ctx.createGain();
    this.chorusLfoGainL.gain.value = 0.008; // ±8ms depth
    this.chorusLfoL.connect(this.chorusLfoGainL);
    this.chorusLfoGainL.connect(this.chorusDelayL.delayTime);
    this.chorusLfoL.start();

    this.chorusLfoR = ctx.createOscillator();
    this.chorusLfoR.type = "sine";
    this.chorusLfoR.frequency.value = 0.75; // Slightly different rate
    this.chorusLfoGainR = ctx.createGain();
    this.chorusLfoGainR.gain.value = 0.008;
    this.chorusLfoR.connect(this.chorusLfoGainR);
    this.chorusLfoGainR.connect(this.chorusDelayR.delayTime);
    this.chorusLfoR.start();

    const chorusMerger = ctx.createChannelMerger(2);
    this.chorusWet = ctx.createGain();
    this.chorusWet.gain.value = 0.6;

    this.sendCBus.connect(this.chorusDelayL);
    this.sendCBus.connect(this.chorusDelayR);
    this.chorusDelayL.connect(chorusMerger, 0, 0);
    this.chorusDelayR.connect(chorusMerger, 0, 1);
    chorusMerger.connect(this.chorusWet);
    this.chorusWet.connect(masterGain);

    // ─── Send D: Phaser (4-stage allpass) ───────────────
    this.sendDBus = ctx.createGain();
    this.sendDBus.gain.value = 1.0;

    this.phaserAllpass = [];
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = 400 * Math.pow(2, i * 0.5); // 400, 566, 800, 1131
      ap.Q.value = 4;
      this.phaserAllpass.push(ap);
    }

    this.phaserLfo = ctx.createOscillator();
    this.phaserLfo.type = "sine";
    this.phaserLfo.frequency.value = 0.4;
    this.phaserLfoGain = ctx.createGain();
    this.phaserLfoGain.gain.value = 300; // ±300 Hz sweep

    // LFO modulates all 4 allpass frequencies
    this.phaserLfo.connect(this.phaserLfoGain);
    for (const ap of this.phaserAllpass) {
      this.phaserLfoGain.connect(ap.frequency);
    }
    this.phaserLfo.start();

    this.phaserFeedback = ctx.createGain();
    this.phaserFeedback.gain.value = 0.5;

    this.phaserWet = ctx.createGain();
    this.phaserWet.gain.value = 0.6;

    // Chain: bus → ap1 → ap2 → ap3 → ap4 → wet → master
    this.sendDBus.connect(this.phaserAllpass[0]!);
    for (let i = 0; i < 3; i++) {
      this.phaserAllpass[i]!.connect(this.phaserAllpass[i + 1]!);
    }
    // Feedback: last allpass → first (creates resonant sweeps)
    this.phaserAllpass[3]!.connect(this.phaserFeedback);
    this.phaserFeedback.connect(this.phaserAllpass[0]!);
    this.phaserAllpass[3]!.connect(this.phaserWet);
    this.phaserWet.connect(masterGain);

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

    // Performance FX master filter — chained LP → HP, both always active.
    // Type never changes, so no biquad-state-reset clicks when XY pad crosses
    // LP↔HP boundary. Transparent defaults: LP freq 20kHz, HP freq 20Hz.
    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = "lowpass";
    this.masterFilter.frequency.value = 20000; // transparent
    this.masterFilter.Q.value = 0.707;

    this.masterFilterHp = ctx.createBiquadFilter();
    this.masterFilterHp.type = "highpass";
    this.masterFilterHp.frequency.value = 20;  // transparent
    this.masterFilterHp.Q.value = 0.707;

    this.masterFilter.connect(this.masterFilterHp);

    // Dedicated output node so AudioEngine can route past the HP stage
    this.masterFilterOut = ctx.createGain();
    this.masterFilterOut.gain.value = 1.0;
    this.masterFilterHp.connect(this.masterFilterOut);

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
      masterFilterOut: this.masterFilterOut!,
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
    if (!this.ctx || !this.sendABus || !this.sendBBus || !this.sendCBus || !this.sendDBus) return;

    const sendA = this.ctx.createGain();
    sendA.gain.value = 0;
    channelGain.connect(sendA);
    sendA.connect(this.sendABus);
    this.sendAGains.push(sendA);

    const sendB = this.ctx.createGain();
    sendB.gain.value = 0;
    channelGain.connect(sendB);
    sendB.connect(this.sendBBus);
    this.sendBGains.push(sendB);

    const sendC = this.ctx.createGain();
    sendC.gain.value = 0;
    channelGain.connect(sendC);
    sendC.connect(this.sendCBus);
    this.sendCGains.push(sendC);

    const sendD = this.ctx.createGain();
    sendD.gain.value = 0;
    channelGain.connect(sendD);
    sendD.connect(this.sendDBus);
    this.sendDGains.push(sendD);
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

  /** Set per-channel chorus send amount (0..1) */
  setChannelChorusSend(channel: number, amount: number): void {
    const send = this.sendCGains[channel];
    if (send) send.gain.value = amount;
  }
  getChannelChorusSend(channel: number): number {
    return this.sendCGains[channel]?.gain.value ?? 0;
  }

  /** Set per-channel phaser send amount (0..1) */
  setChannelPhaserSend(channel: number, amount: number): void {
    const send = this.sendDGains[channel];
    if (send) send.gain.value = amount;
  }
  getChannelPhaserSend(channel: number): number {
    return this.sendDGains[channel]?.gain.value ?? 0;
  }

  /** Chorus master level (wet gain) */
  setChorusLevel(level: number): void {
    if (this.chorusWet) this.chorusWet.gain.value = level;
  }
  getChorusLevel(): number {
    return this.chorusWet?.gain.value ?? 0;
  }

  /** Chorus rate (0.1..4 Hz) */
  setChorusRate(rate: number): void {
    if (this.chorusLfoL) this.chorusLfoL.frequency.value = rate;
    if (this.chorusLfoR) this.chorusLfoR.frequency.value = rate * 1.25;
  }

  /** Chorus depth (0..1, scales LFO mod depth) */
  setChorusDepth(depth: number): void {
    const d = Math.max(0, Math.min(1, depth)) * 0.012;
    if (this.chorusLfoGainL) this.chorusLfoGainL.gain.value = d;
    if (this.chorusLfoGainR) this.chorusLfoGainR.gain.value = d;
  }

  /** Phaser master level */
  setPhaserLevel(level: number): void {
    if (this.phaserWet) this.phaserWet.gain.value = level;
  }
  getPhaserLevel(): number {
    return this.phaserWet?.gain.value ?? 0;
  }

  /** Phaser rate (0.05..4 Hz) */
  setPhaserRate(rate: number): void {
    if (this.phaserLfo) this.phaserLfo.frequency.value = rate;
  }

  /** Phaser feedback (0..0.9) */
  setPhaserFeedback(amount: number): void {
    if (this.phaserFeedback) this.phaserFeedback.gain.value = Math.max(0, Math.min(0.9, amount));
  }

  /** Set reverb wet level */
  setReverbLevel(level: number): void {
    if (this.reverbGain) this.reverbGain.gain.value = level;
  }

  getReverbLevel(): number {
    return this.reverbGain?.gain.value ?? 0;
  }

  /** Set reverb type — regenerates IR off-thread */
  setReverbType(type: "room" | "hall" | "plate" | "ambient"): void {
    if (!this.ctx || !this.reverbNode) return;
    this.reverbType = type;
    // Adjust duration based on type
    const durations: Record<string, number> = { room: 1.0, hall: 2.5, plate: 1.8, ambient: 4.0 };
    const decays: Record<string, number> = { room: 1.5, hall: 2.5, plate: 2.0, ambient: 5.0 };
    this.reverbSize = durations[type] ?? 2.0;
    this.reverbDecayVal = decays[type] ?? 2.5;
    this._scheduleReverbIR(this.ctx, this.reverbSize, this.reverbDecayVal, type);
  }

  /** Set reverb size (IR duration multiplier) — regenerates IR off-thread */
  setReverbSize(size: number): void {
    if (!this.ctx || !this.reverbNode) return;
    this.reverbSize = Math.max(0.3, Math.min(6, size));
    this._scheduleReverbIR(this.ctx, this.reverbSize, this.reverbDecayVal, this.reverbType);
  }

  /** Set reverb decay rate — regenerates IR off-thread */
  setReverbDecay(decay: number): void {
    if (!this.ctx || !this.reverbNode) return;
    this.reverbDecayVal = Math.max(0.5, Math.min(8, decay));
    this._scheduleReverbIR(this.ctx, this.reverbSize, this.reverbDecayVal, this.reverbType);
  }

  /**
   * Kick off off-thread IR generation. Only the most-recent request (by ID)
   * is applied — stale responses from rapid parameter changes are dropped.
   */
  private _scheduleReverbIR(
    ctx: AudioContext,
    duration: number,
    decay: number,
    type: string,
  ): void {
    if (!this._reverbWorker) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        this._reverbWorker = new ReverbWorkerCtor() as Worker;
        this._reverbWorker.onmessage = (e: MessageEvent) => {
          const { id, left: leftRaw, right: rightRaw, sampleRate } = e.data as { id: number; left: Float32Array; right: Float32Array; sampleRate: number };
          // Drop stale responses (e.g. rapid type-change)
          if (id !== this._reverbWorkerPending) return;
          if (!this.ctx || !this.reverbNode) return;
          // Wrap in explicit Float32Array<ArrayBuffer> to satisfy copyToChannel types
          const left  = new Float32Array(leftRaw.buffer  as ArrayBuffer);
          const right = new Float32Array(rightRaw.buffer as ArrayBuffer);
          const buffer = this.ctx.createBuffer(2, left.length, sampleRate);
          buffer.copyToChannel(left, 0);
          buffer.copyToChannel(right, 1);
          this.reverbNode.buffer = buffer;
        };
        this._reverbWorker.onerror = (err) => {
          console.warn("ReverbWorker error — falling back to main-thread IR:", err);
          this._reverbWorker = null;
          if (!this.ctx) return;
          const buf = this.generateReverbIR(ctx, duration, decay, type);
          if (this.reverbNode) this.reverbNode.buffer = buf;
        };
      } catch {
        // Worker unavailable (CSP or old browser) — run synchronously
        if (this.reverbNode) this.reverbNode.buffer = this.generateReverbIR(ctx, duration, decay, type);
        return;
      }
    }
    const id = ++this._reverbWorkerPending;
    this._reverbWorker.postMessage({ id, sampleRate: ctx.sampleRate, duration, decay, type });
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

  /** Smooth reverb level transition — uses AudioParam.setTargetAtTime, no clicks */
  setReverbLevelSmooth(target: number, timeConstant: number): void {
    if (!this.reverbGain || !this.ctx) return;
    this.reverbGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.reverbGain.gain.setTargetAtTime(
      Math.max(0, target),
      this.ctx.currentTime,
      timeConstant,
    );
  }

  /** Smooth delay level transition — uses AudioParam.setTargetAtTime, no clicks */
  setDelayLevelSmooth(target: number, timeConstant: number): void {
    if (!this.delayGain || !this.ctx) return;
    this.delayGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.delayGain.gain.setTargetAtTime(
      Math.max(0, target),
      this.ctx.currentTime,
      timeConstant,
    );
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
    if (!this.masterFilter || !this.masterFilterHp) return;
    const ctx = this.masterFilter.context;
    const now = ctx.currentTime;
    const tc = 0.012; // ~12ms smoothing kills zipper noise on fast drags
    const clampedFreq = Math.max(20, Math.min(20000, freq));
    const clampedQ = Math.max(0.0001, Math.min(30, q));

    // Dual-biquad architecture: LP stage + HP stage chained. Types never change,
    // so crossing the LP↔HP boundary produces no biquad-state-reset click.
    // Transparent defaults: LP at 20kHz = pass-through; HP at 20Hz = pass-through.
    if (type === "lowpass") {
      this.masterFilter.frequency.cancelScheduledValues(now);
      this.masterFilter.frequency.setTargetAtTime(clampedFreq, now, tc);
      this.masterFilter.Q.cancelScheduledValues(now);
      this.masterFilter.Q.setTargetAtTime(clampedQ, now, tc);
      // Reset HP to transparent
      this.masterFilterHp.frequency.cancelScheduledValues(now);
      this.masterFilterHp.frequency.setTargetAtTime(20, now, tc);
      this.masterFilterHp.Q.cancelScheduledValues(now);
      this.masterFilterHp.Q.setTargetAtTime(0.707, now, tc);
    } else if (type === "highpass") {
      this.masterFilterHp.frequency.cancelScheduledValues(now);
      this.masterFilterHp.frequency.setTargetAtTime(clampedFreq, now, tc);
      this.masterFilterHp.Q.cancelScheduledValues(now);
      this.masterFilterHp.Q.setTargetAtTime(clampedQ, now, tc);
      // Reset LP to transparent
      this.masterFilter.frequency.cancelScheduledValues(now);
      this.masterFilter.frequency.setTargetAtTime(20000, now, tc);
      this.masterFilter.Q.cancelScheduledValues(now);
      this.masterFilter.Q.setTargetAtTime(0.707, now, tc);
    } else {
      // bandpass / notch / etc — fall back to LP stage, rare path
      this.masterFilter.frequency.cancelScheduledValues(now);
      this.masterFilter.frequency.setTargetAtTime(clampedFreq, now, tc);
      this.masterFilter.Q.cancelScheduledValues(now);
      this.masterFilter.Q.setTargetAtTime(clampedQ, now, tc);
    }
  }

  /** Bypass master filter (reset to allpass) */
  bypassMasterFilter(): void {
    if (!this.masterFilter || !this.masterFilterHp) return;
    const ctx = this.masterFilter.context;
    const now = ctx.currentTime;
    const tc = 0.025; // Slightly slower ramp for smooth "release" to bypass
    // Smoothly return both stages to transparent settings — no type changes → no clicks
    this.masterFilter.frequency.cancelScheduledValues(now);
    this.masterFilter.frequency.setTargetAtTime(20000, now, tc);
    this.masterFilter.Q.cancelScheduledValues(now);
    this.masterFilter.Q.setTargetAtTime(0.707, now, tc);
    this.masterFilterHp.frequency.cancelScheduledValues(now);
    this.masterFilterHp.frequency.setTargetAtTime(20, now, tc);
    this.masterFilterHp.Q.cancelScheduledValues(now);
    this.masterFilterHp.Q.setTargetAtTime(0.707, now, tc);
  }

  /** Start noise burst (hold to play).
   *  - Gain envelope: 18 ms attack to target volume (prevents click).
   *  - Filter envelope: LPF sweeps 300 Hz → 7 kHz over ~280 ms on attack (whoosh)
   *                     and back on release (240 ms) so the noise "opens up"
   *                     and "closes" musically instead of hitting as raw hash.
   *  - Spectral shaping: HPF @ 80 Hz removes rumble, -3 dB peak at 3.5 kHz
   *    tames the brittle presence band.
   */
  startNoise(volume = 0.14): void {
    if (!this.ctx || !this.noiseBuffer || !this.pumpGain) return;
    this.stopNoise(); // Clean up any previous
    const now = this.ctx.currentTime;

    this.activeNoiseSource = this.ctx.createBufferSource();
    this.activeNoiseSource.buffer = this.noiseBuffer;
    this.activeNoiseSource.loop = true;

    // Clean out rumble — fixed HPF
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 80;
    hpf.Q.value = 0.5;

    // Tame piercing presence band
    const tilt = this.ctx.createBiquadFilter();
    tilt.type = "peaking";
    tilt.frequency.value = 3500;
    tilt.Q.value = 0.6;
    tilt.gain.value = -3;

    // SWEEPING LPF — this is the envelope. Starts low, ramps up during attack.
    this.activeNoiseFilter = this.ctx.createBiquadFilter();
    this.activeNoiseFilter.type = "lowpass";
    this.activeNoiseFilter.Q.value = 0.9;
    this.activeNoiseFilter.frequency.setValueAtTime(300, now);
    this.activeNoiseFilter.frequency.exponentialRampToValueAtTime(7000, now + 0.28);

    this.activeNoiseGain = this.ctx.createGain();
    this.activeNoiseGain.gain.setValueAtTime(0, now);
    this.activeNoiseGain.gain.linearRampToValueAtTime(volume, now + 0.018);

    this.activeNoiseSource.connect(hpf);
    hpf.connect(tilt);
    tilt.connect(this.activeNoiseFilter);
    this.activeNoiseFilter.connect(this.activeNoiseGain);
    this.activeNoiseGain.connect(this.pumpGain);
    this.activeNoiseSource.start();
  }

  /** Stop noise burst — filter sweeps back DOWN (LPF closes) while gain fades.
   *  Creates a natural "close" sound instead of a hard cut. */
  stopNoise(): void {
    if (!this.ctx) return;
    if (this.activeNoiseGain && this.activeNoiseFilter) {
      const now = this.ctx.currentTime;
      const source = this.activeNoiseSource;
      const gainNode = this.activeNoiseGain;
      const filterNode = this.activeNoiseFilter;
      this.activeNoiseSource = null;
      this.activeNoiseGain = null;
      this.activeNoiseFilter = null;

      try {
        // Filter release: sweep down to 200 Hz over 240 ms
        filterNode.frequency.cancelScheduledValues(now);
        filterNode.frequency.setValueAtTime(filterNode.frequency.value, now);
        filterNode.frequency.exponentialRampToValueAtTime(200, now + 0.24);
        // Gain release: fade to 0 over 250 ms (slightly longer than filter so click is hidden)
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.25);
      } catch { /* */ }

      // Stop the buffer + disconnect after fade completes
      window.setTimeout(() => {
        if (source) {
          try { source.stop(); } catch { /* already stopped */ }
          try { source.disconnect(); } catch { /* */ }
        }
        try { gainNode.disconnect(); } catch { /* */ }
        try { filterNode.disconnect(); } catch { /* */ }
      }, 280);
      return;
    }
    if (this.activeNoiseSource) {
      try { this.activeNoiseSource.stop(); } catch { /* */ }
      try { this.activeNoiseSource.disconnect(); } catch { /* */ }
      this.activeNoiseSource = null;
    }
  }

  /** Start stutter/gate effect — inserts a gain gate between pump and compressor.
   *  Smooth entry: ramps base gain + LFO depth over 30 ms so entering the gate
   *  doesn't click. Square LFO for the classic hard-gate stutter pulse. */
  startStutter(rate: number, masterCompressor: DynamicsCompressorNode): void {
    if (!this.ctx || !this.pumpGain || !masterCompressor) return;
    this.stopStutter(masterCompressor);
    const now = this.ctx.currentTime;

    this.stutterGain = this.ctx.createGain();
    // Start at 1.0 (bypass), ramp to 0.5 center over 30 ms
    this.stutterGain.gain.setValueAtTime(1.0, now);
    this.stutterGain.gain.linearRampToValueAtTime(0.5, now + 0.03);

    // Disconnect pumpGain → compressor and re-route through gate
    this.pumpGain.disconnect(masterCompressor);
    this.pumpGain.connect(this.stutterGain);
    this.stutterGain.connect(masterCompressor);

    // LFO modulates the gate gain
    this.stutterLfo = this.ctx.createOscillator();
    this.stutterLfo.type = "square";
    this.stutterLfo.frequency.value = rate;

    // LFO depth ramps from 0 → 0.5 over 30 ms so first pulse isn't a jump
    const lfoScale = this.ctx.createGain();
    lfoScale.gain.setValueAtTime(0, now);
    lfoScale.gain.linearRampToValueAtTime(0.5, now + 0.03);
    this.stutterLfo.connect(lfoScale);
    lfoScale.connect(this.stutterGain.gain);

    this.stutterLfo.start();
  }

  /** Stop stutter — fades the gate back to 1.0 over 30 ms before disconnecting.
   *  Cancels any already-pending teardown timer to prevent the previous stop
   *  from disconnecting a newly-started stutter (rapid-retrigger race condition). */
  stopStutter(masterCompressor: DynamicsCompressorNode): void {
    if (!this.ctx) return;

    // Cancel any previous teardown that hasn't fired yet
    if (this._stopStutterTimer !== null) {
      clearTimeout(this._stopStutterTimer);
      this._stopStutterTimer = null;
    }

    const lfo = this.stutterLfo;
    const gate = this.stutterGain;
    this.stutterLfo = null;
    this.stutterGain = null;

    if (gate) {
      const now = this.ctx.currentTime;
      try {
        gate.gain.cancelScheduledValues(now);
        gate.gain.setValueAtTime(gate.gain.value, now);
        gate.gain.linearRampToValueAtTime(1.0, now + 0.03);
      } catch { /* */ }
    }

    // Disconnect after fade completes — restore direct pumpGain → compressor.
    // Guard: only reconnect if NO new stutter was started before the timer fires.
    this._stopStutterTimer = window.setTimeout(() => {
      this._stopStutterTimer = null;
      if (lfo) {
        try { lfo.stop(); } catch { /* */ }
        try { lfo.disconnect(); } catch { /* */ }
      }
      // Only restore direct routing if stutter is still stopped
      if (gate && this.stutterGain === null && this.pumpGain && masterCompressor) {
        try { this.pumpGain.disconnect(gate); } catch { /* */ }
        try { gate.disconnect(); } catch { /* */ }
        try { this.pumpGain.connect(masterCompressor); } catch { /* */ }
      } else if (gate) {
        // New stutter already started — just clean up the old gate node
        try { gate.disconnect(); } catch { /* */ }
      }
    }, 40);
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

    // Cancel any pending stutter teardown
    if (this._stopStutterTimer !== null) {
      clearTimeout(this._stopStutterTimer);
      this._stopStutterTimer = null;
    }

    // Terminate reverb worker
    if (this._reverbWorker) {
      this._reverbWorker.terminate();
      this._reverbWorker = null;
    }

    this.ctx = null;
  }
}

// Export singleton instance
export const sendFxManager = new SendFxManager();
