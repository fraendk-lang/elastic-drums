/**
 * Elastic Drums Audio Engine (Browser)
 *
 * Phase 1: Pure Web Audio synthesis (no WASM)
 * All 12 voices with improved, warmer sound design.
 * Voice parameters are stored per-voice and controlled from the UI.
 */

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
  3: [ // Tom Lo
    { id: "tune", label: "TUNE", min: 50, max: 200, default: 100 },
    { id: "decay", label: "DECAY", min: 50, max: 600, default: 300 },
  ],
  4: [ // Tom Mid
    { id: "tune", label: "TUNE", min: 80, max: 280, default: 140 },
    { id: "decay", label: "DECAY", min: 50, max: 600, default: 250 },
  ],
  5: [ // Tom Hi
    { id: "tune", label: "TUNE", min: 120, max: 400, default: 200 },
    { id: "decay", label: "DECAY", min: 50, max: 500, default: 200 },
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
    { id: "tune", label: "TUNE", min: 200, max: 3000, default: 800 },
    { id: "decay", label: "DECAY", min: 30, max: 500, default: 120 },
  ],
  11: [ // Perc 2
    { id: "tune", label: "TUNE", min: 200, max: 3000, default: 1200 },
    { id: "decay", label: "DECAY", min: 30, max: 500, default: 120 },
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
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterEqLow: BiquadFilterNode | null = null;
  private masterEqMid: BiquadFilterNode | null = null;
  private masterEqHigh: BiquadFilterNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;

  // Send FX
  private sendAGains: GainNode[] = [];       // Per-channel reverb send amount
  private sendBGains: GainNode[] = [];       // Per-channel delay send amount
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayFilter: BiquadFilterNode | null = null;
  private delayGain: GainNode | null = null;
  private sendABus: GainNode | null = null;  // Reverb bus
  private sendBBus: GainNode | null = null;  // Delay bus

  // Peak-hold with slow decay for smooth, accurate meters
  private peakLevels = new Float32Array(12);
  private masterPeakLevel = 0;
  private readonly PEAK_DECAY = 0.92;  // Per-frame decay rate

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
      this.masterAnalyser.fftSize = 2048;
      this.masterAnalyser.smoothingTimeConstant = 0.3;

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

      // Routing
      this.masterGain.connect(this.masterEqLow);
      this.masterEqLow.connect(this.masterEqMid);
      this.masterEqMid.connect(this.masterEqHigh);
      this.masterEqHigh.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

      // Create 12 channel strips with insert FX
      for (let i = 0; i < 12; i++) {
        // Insert filter (bypass by default: allpass)
        const filter = this.ctx.createBiquadFilter();
        filter.type = "allpass";
        filter.frequency.value = 1000;

        // Insert distortion (bypass by default: null curve)
        const shaper = this.ctx.createWaveShaper();

        // Channel gain (volume fader)
        const gain = this.ctx.createGain();
        gain.gain.value = 1.0;

        // Analyser (meter)
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.3;

        // Routing: filter → shaper → gain → analyser → master
        filter.connect(shaper);
        shaper.connect(gain);
        gain.connect(analyser);
        analyser.connect(this.masterGain);

        this.channelFilters.push(filter);
        this.channelShapers.push(shaper);
        this.channelGains.push(gain);
        this.channelAnalysers.push(analyser);
      }

      // ─── Send FX Buses ──────────────────────────────────
      // Send A: Reverb (ConvolverNode with generated impulse)
      this.sendABus = this.ctx.createGain();
      this.sendABus.gain.value = 1.0;

      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.35;

      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.generateReverbIR(this.ctx, 2.0, 2.5);

      this.sendABus.connect(this.reverbNode);
      this.reverbNode.connect(this.reverbGain);
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

      // Delay routing: bus → delay → filter → feedback → delay (loop)
      //                                    → delayGain → master
      this.sendBBus.connect(this.delayNode);
      this.delayNode.connect(this.delayFilter);
      this.delayFilter.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delayNode); // Feedback loop
      this.delayFilter.connect(this.delayGain);
      this.delayGain.connect(this.masterGain);

      // Create per-channel send gains
      for (let i = 0; i < 12; i++) {
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

      // Initialize peak-hold buffers
      this.peakLevels = new Float32Array(12);
      this.masterPeakLevel = 0;
    }
    return this.ctx;
  }

  /** Generate algorithmic reverb impulse response */
  private generateReverbIR(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Exponentially decaying noise
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * decay / 6));
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

  /** Helper: read peak from an AnalyserNode */
  private readPeak(analyser: AnalyserNode): number {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]! / 128 - 1);
      if (v > peak) peak = v;
    }
    return peak;
  }

  /** Read current level for a channel (0..1) with peak-hold */
  getChannelLevel(channel: number): number {
    const analyser = this.channelAnalysers[channel];
    if (!analyser) return 0;

    const instantPeak = this.readPeak(analyser) * 2.5; // Boost for visual clarity

    // Peak-hold with decay: rises instantly, falls slowly
    if (instantPeak > this.peakLevels[channel]!) {
      this.peakLevels[channel] = instantPeak;
    } else {
      this.peakLevels[channel]! *= this.PEAK_DECAY;
    }

    return Math.min(this.peakLevels[channel]!, 1);
  }

  /** Read master output level (0..1) with peak-hold */
  getMasterLevel(): number {
    if (!this.masterAnalyser) return 0;

    const instantPeak = this.readPeak(this.masterAnalyser) * 2.5;

    if (instantPeak > this.masterPeakLevel) {
      this.masterPeakLevel = instantPeak;
    } else {
      this.masterPeakLevel *= this.PEAK_DECAY;
    }

    return Math.min(this.masterPeakLevel, 1);
  }

  /** Expose AudioContext for sample decoding */
  getAudioContext(): AudioContext | null {
    return this.ctx;
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

  /** Sync delay time to BPM (note division: 1/4, 1/8, 3/16, 1/16) */
  syncDelayToBpm(bpm: number, division: number = 0.375): void {
    const beatSec = 60 / bpm;
    if (this.delayNode) this.delayNode.delayTime.value = beatSec * division;
  }

  /** Set channel volume (0..1) */
  setChannelVolume(channel: number, volume: number): void {
    const gain = this.channelGains[channel];
    if (gain) gain.gain.value = volume;
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
        console.warn("WASM worklet error:", e.data.message);
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

    // Send to WASM worklet if active
    this.postToWorklet({ type: "trigger", voice, velocity });

    // Always also trigger TS synthesis (for immediate pad feedback + fallback)
    this.scheduleVoice(ctx, voice, velocity, ctx.currentTime);
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

  // Sample lookup callback — set by SampleManager to avoid circular imports
  private sampleLookup: ((voice: number) => AudioBuffer | null) | null = null;

  /** Register sample lookup function */
  setSampleLookup(fn: (voice: number) => AudioBuffer | null): void {
    this.sampleLookup = fn;
  }

  private scheduleVoice(ctx: AudioContext, voice: number, velocity: number, t: number): void {
    // Check if this voice has a sample loaded — play sample instead of synth
    if (this.sampleLookup) {
      const buffer = this.sampleLookup(voice);
      if (buffer) {
        const p = this.voiceParams[voice] ?? {};
        this.playSampleAtTime(buffer, voice, velocity, t, p.tune ?? 0);
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
      case 6: this.hihat(ctx, t, velocity, true, out, p); break;
      case 7: this.hihat(ctx, t, velocity, false, out, p); break;
      case 8:
      case 9: this.cymbal(ctx, t, velocity, p.tune ?? 400, out, p); break;
      case 10:
      case 11: this.perc(ctx, t, velocity, p.tune ?? 800, out, p); break;
    }
  }

  // ─── KICK ──────────────────────────────────────────────
  // TR-808 Bridged-T: deep sine sweep + click transient + sub layer + soft drive
  private kick(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.9;
    const baseFreq = p.tune ?? 52;
    const decaySec = (p.decay ?? 550) / 1000;
    const clickAmt = (p.click ?? 50) / 100;
    const driveAmt = (p.drive ?? 40) / 100;
    const subAmt = (p.sub ?? 60) / 100;
    const pitchSweep = (p.pitch ?? 45) / 10; // multiplier for pitch envelope

    // Master output with soft-clip waveshaper
    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.setValueAtTime(vol, t + decaySec * 0.9);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

    const shaper = ctx.createWaveShaper();
    if (driveAmt > 0.05) {
      const curve = new Float32Array(1024);
      const driveGain = 1 + driveAmt * 4;
      for (let i = 0; i < 1024; i++) {
        const x = (i / 512 - 1) * driveGain;
        curve[i] = Math.tanh(x);
      }
      shaper.curve = curve;
      shaper.oversample = "4x";
    }

    // Low-shelf EQ boost for warmth
    const eq = ctx.createBiquadFilter();
    eq.type = "lowshelf";
    eq.frequency.value = 120;
    eq.gain.value = 4;

    shaper.connect(eq);
    eq.connect(master);
    master.connect(out);

    // Main body oscillator — pitch sweep controlled by PITCH param
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq * pitchSweep, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.8, t + 0.012);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, t + 0.06);
    osc.frequency.setTargetAtTime(baseFreq * 0.95, t + 0.1, 0.2);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.85, t);
    bodyGain.gain.setValueAtTime(0.85, t + 0.02);
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
      sub.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, t + 0.05);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0, t);
      subGain.gain.linearRampToValueAtTime(subAmt * 0.7, t + 0.015);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 1.1);

      sub.connect(subGain);
      subGain.connect(shaper);
      sub.start(t);
      sub.stop(t + decaySec * 1.1 + 0.05);
    }

    // Click transient — filtered noise burst
    if (clickAmt > 0.05) {
      const click = this.getNoise(ctx, 0.012, t);
      const clickHpf = ctx.createBiquadFilter();
      clickHpf.type = "highpass";
      clickHpf.frequency.value = 3500;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(clickAmt * 0.5, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);

    click.connect(clickHpf);
      clickHpf.connect(clickGain);
      clickGain.connect(master);
    }
  }

  // ─── SNARE ─────────────────────────────────────────────
  // 808 dual-oscillator + snappy noise with body resonance
  private snare(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.65;
    const tune = p.tune ?? 180;
    const decaySec = (p.decay ?? 220) / 1000;
    const toneMix = (p.tone ?? 55) / 100;
    const snap = (p.snap ?? 70) / 100;
    const bodyAmt = (p.body ?? 60) / 100;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.05);
    master.connect(out);

    // Body — two detuned sine oscillators for thickness
    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(tune * 1.45, t);
    osc1.frequency.exponentialRampToValueAtTime(tune, t + 0.015);

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(tune * 2.2, t);
    osc2.frequency.exponentialRampToValueAtTime(tune * 0.9, t + 0.02);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(toneMix * bodyAmt, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.7);

    // Resonant body filter
    const bodyBpf = ctx.createBiquadFilter();
    bodyBpf.type = "peaking";
    bodyBpf.frequency.value = 200;
    bodyBpf.Q.value = 2;
    bodyBpf.gain.value = 6;

    osc1.connect(bodyGain);
    osc2.connect(bodyGain);
    bodyGain.connect(bodyBpf);
    bodyBpf.connect(master);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + decaySec + 0.05);
    osc2.stop(t + decaySec + 0.05);

    // Snappy noise — bandpass filtered with fast decay
    const noise = this.getNoise(ctx, decaySec, t);
    const noiseBpf = ctx.createBiquadFilter();
    noiseBpf.type = "highpass";
    noiseBpf.frequency.value = 2000;

    const noiseHpf = ctx.createBiquadFilter();
    noiseHpf.type = "lowpass";
    noiseHpf.frequency.setValueAtTime(12000, t);
    noiseHpf.frequency.exponentialRampToValueAtTime(4000, t + decaySec * 0.5);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(snap * 0.9, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.55);

    noise.connect(noiseBpf);
    noiseBpf.connect(noiseHpf);
    noiseHpf.connect(noiseGain);
    noiseGain.connect(master);
  }

  // ─── CLAP ──────────────────────────────────────────────
  // 808 multi-burst noise with reverb-like tail
  private clap(ctx: AudioContext, t: number, vel: number, out: AudioNode, p: VoiceParams): void {
    const levelBoost = (p.level ?? 100) / 100;
    const vol = vel * 0.75 * levelBoost;  // Boosted from 0.55
    const decaySec = (p.decay ?? 350) / 1000;
    const toneFreq = p.tone ?? 1800;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.1);
    master.connect(out);

    // Bandpass for clap character
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = toneFreq;
    bpf.Q.value = 0.8;
    bpf.connect(master);

    // 4 stochastic noise bursts with increasing spacing
    const burstTimes = [0, 0.008, 0.019, 0.033];
    for (const offset of burstTimes) {
      const burst = this.getNoise(ctx, 0.006, t + offset);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t + offset);
      g.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.006);
      burst.connect(g);
      g.connect(bpf);
    }

    // Decay tail
    const tail = this.getNoise(ctx, decaySec, t + 0.04);
    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.5, t + 0.04);
    tailGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    tail.connect(tailGain);
    tailGain.connect(bpf);
  }

  // ─── TOM ───────────────────────────────────────────────
  // 909-style: sine with pitch envelope, variable tune
  private tom(ctx: AudioContext, t: number, vel: number, tune: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.6;
    const decaySec = (p.decay ?? 300) / 1000;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.05);
    master.connect(out);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tune * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(tune, t + 0.035);

    // Second harmonic for body
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(tune * 3.5, t);
    osc2.frequency.exponentialRampToValueAtTime(tune * 1.5, t + 0.02);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.25, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.4);

    osc.connect(master);
    osc2.connect(bodyGain);
    bodyGain.connect(master);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + decaySec + 0.05);
    osc2.stop(t + decaySec + 0.05);
  }

  // ─── HIHAT ─────────────────────────────────────────────
  // 909-style: 6 metallic square oscillators + filtered noise
  private hihat(ctx: AudioContext, t: number, vel: number, closed: boolean, out: AudioNode, p: VoiceParams): void {
    const vol = vel * (closed ? 0.32 : 0.38);
    const decaySec = (p.decay ?? (closed ? 45 : 250)) / 1000;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec + 0.01);
    master.connect(out);

    // Highpass for metallic shimmer
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = closed ? 8000 : 6500;
    hpf.connect(master);

    // 6 square-wave oscillators at 909 metallic ratios
    const baseFreq = p.tune ?? 330;
    const ratios = [1.0, 1.4471, 1.7409, 1.9307, 2.5377, 2.7616];
    for (const r of ratios) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = baseFreq * r;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

      osc.connect(g);
      g.connect(hpf);
      osc.start(t);
      osc.stop(t + decaySec + 0.02);
    }

    // Noise layer for sizzle
    const noise = this.getNoise(ctx, decaySec, t);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.8);
    noise.connect(ng);
    ng.connect(hpf);
  }

  // ─── CYMBAL / RIDE ─────────────────────────────────────
  // Extended metallic oscillator bank with long decay
  private cymbal(ctx: AudioContext, t: number, vel: number, baseFreq: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.28;
    const decaySec = (p.decay ?? 800) / 1000;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    master.connect(out);

    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 4500;
    hpf.connect(master);

    const ratios = [1.0, 1.4471, 1.7409, 1.9307, 2.5377, 2.7616, 3.1415];
    for (const r of ratios) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = baseFreq * r;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.055, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decaySec);

      osc.connect(g);
      g.connect(hpf);
      osc.start(t);
      osc.stop(t + decaySec + 0.05);
    }

    // Noise shimmer
    const noise = this.getNoise(ctx, decaySec, t);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.1, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec * 0.7);
    noise.connect(ng);
    ng.connect(hpf);
  }

  // ─── PERCUSSION ────────────────────────────────────────
  // Resonant filtered noise hit (conga/bongo/shaker character)
  private perc(ctx: AudioContext, t: number, vel: number, freq: number, out: AudioNode, p: VoiceParams): void {
    const vol = vel * 0.5;
    const decaySec = (p.decay ?? 120) / 1000;

    const master = ctx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    master.connect(out);

    // Resonant bandpass — gives tonal character
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.setValueAtTime(freq, t);
    bpf.Q.value = 12;
    bpf.connect(master);

    const noise = this.getNoise(ctx, decaySec, t);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1.0, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decaySec);
    noise.connect(ng);
    ng.connect(bpf);

    // Sine transient for body
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 0.8, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.02);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(og);
    og.connect(master);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  get isInitialized(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }
}

// Singleton
export const audioEngine = new AudioEngine();
