/**
 * Elastic Drums Audio Engine — Facade / Orchestrator
 * Delegates to: VoiceRenderer, SendFx, Metering, MixerRouting
 */

export type { VoiceParams, VoiceParamDef } from './VoiceRenderer';
export { VOICE_PARAM_DEFS } from './VoiceRenderer';
export { DELAY_DIVISIONS, DELAY_DIVISION_NAMES, REVERB_TYPES } from './SendFx';

import { voiceRenderer } from './VoiceRenderer';
import { sendFxManager } from './SendFx';
import { meteringEngine, MeteringEngine } from './Metering';
import { mixerRouter } from './MixerRouting';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterEqLow: BiquadFilterNode | null = null;
  private masterEqMid: BiquadFilterNode | null = null;
  private masterEqHigh: BiquadFilterNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;

  private pumpGain: GainNode | null = null;

  private channelGains: GainNode[] = [];
  private channelAnalysers: AnalyserNode[] = [];

  private wasmMode = false;
  private workletNode: AudioWorkletNode | null = null;
  private wasmReady = false;

  constructor() {}

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.noiseBuffer = this.generateNoiseBuffer(this.ctx, 2.0);

      // ─── Master output chain ─────────────────────────────
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;

      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 4096;
      this.masterAnalyser.smoothingTimeConstant = 0.15;

      // 3-Band EQ
      this.masterEqLow = this.ctx.createBiquadFilter();
      this.masterEqLow.type = "lowshelf";
      this.masterEqLow.frequency.value = 100;

      this.masterEqMid = this.ctx.createBiquadFilter();
      this.masterEqMid.type = "peaking";
      this.masterEqMid.frequency.value = 1000;
      this.masterEqMid.Q.value = 0.7;

      this.masterEqHigh = this.ctx.createBiquadFilter();
      this.masterEqHigh.type = "highshelf";
      this.masterEqHigh.frequency.value = 8000;

      // Bus Compressor
      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -12;
      this.masterCompressor.ratio.value = 4;
      this.masterCompressor.attack.value = 0.01;
      this.masterCompressor.release.value = 0.15;
      this.masterCompressor.knee.value = 6;

      // Brick-wall Limiter
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1;
      this.masterLimiter.ratio.value = 20;
      this.masterLimiter.attack.value = 0.001;
      this.masterLimiter.release.value = 0.05;

      // Pump (sidechain-style) gain node — LFO is created by SendFx
      this.pumpGain = this.ctx.createGain();
      this.pumpGain.gain.value = 1.0;

      // ─── Initialize SendFx module ────────────────────────
      // SendFx creates: masterFilter, saturation, flanger, reverb, delay, pump LFO, noise
      const fxNodes = sendFxManager.init(this.ctx, this.masterGain, this.pumpGain);

      // ─── Wire master signal chain ────────────────────────
      // masterGain → EQ → masterFilter → flanger → saturation → pumpGain → compressor → limiter → analyser → out
      this.masterGain.connect(this.masterEqLow);
      this.masterEqLow.connect(this.masterEqMid);
      this.masterEqMid.connect(this.masterEqHigh);
      this.masterEqHigh.connect(fxNodes.masterFilter);

      // masterFilter → flanger (input/output) → saturation (dry+wet parallel)
      fxNodes.masterFilter.connect(fxNodes.flangerInput);
      fxNodes.flangerOutput.connect(fxNodes.masterSaturationDry);
      fxNodes.flangerOutput.connect(fxNodes.masterSaturation);
      fxNodes.masterSaturation.connect(fxNodes.masterSaturationWet);
      fxNodes.masterSaturationDry.connect(this.pumpGain);
      fxNodes.masterSaturationWet.connect(this.pumpGain);

      // pumpGain → compressor → limiter → analyser → speakers
      this.pumpGain.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

      // ─── Mixer channels & bus groups ─────────────────────
      for (const group of ["drums", "hats", "perc", "bass", "chords", "melody"]) {
        mixerRouter.createBusGroup(group, this.ctx, this.masterGain);
      }

      for (let i = 0; i < 15; i++) {
        const ch = mixerRouter.createChannel(this.ctx, this.masterGain);
        this.channelGains.push(ch.gain);
        this.channelAnalysers.push(ch.analyser);
      }

      const groups = ["drums", "drums", "drums", "drums", "drums", "drums", "hats", "hats", "hats", "hats", "perc", "perc", "bass", "chords", "melody"];
      groups.forEach((g, i) => mixerRouter.setChannelGroup(i, g, this.masterGain!));

      // ─── Per-channel send FX ─────────────────────────────
      for (let i = 0; i < 15; i++) {
        sendFxManager.createChannelSends(this.channelGains[i]!);
      }

      // ─── Voice renderer setup ────────────────────────────
      voiceRenderer.setNoiseBuffer(this.noiseBuffer);

      meteringEngine.reset(15);
    }
    return this.ctx;
  }

  async resume(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === "suspended") await ctx.resume();
    if (!this.wasmReady && !this.workletNode) {
      try {
        await this.initWasmWorklet(ctx);
      } catch (err) {
        console.log("WASM AudioWorklet not available, using TypeScript synthesis:", err);
      }
    }
  }

  private async initWasmWorklet(ctx: AudioContext): Promise<void> {
    const wasmResponse = await fetch("/wasm/elastic-drums-wasm.wasm");
    if (!wasmResponse.ok) throw new Error("WASM file not found");
    const wasmBinary = await wasmResponse.arrayBuffer();
    await ctx.audioWorklet.addModule("/drum-worklet.js");
    this.workletNode = new AudioWorkletNode(ctx, "elastic-drums-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.workletNode.connect(this.masterGain!);
    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === "ready") {
        this.wasmReady = true;
        this.wasmMode = true;
        console.log("✅ WASM AudioWorklet active — C++ DSP running in audio thread");
      } else if (e.data.type === "error") {
        console.log("WASM worklet init failed (using TS fallback):", e.data.message);
      }
    };
    this.workletNode.port.postMessage({ type: "wasm-binary", binary: wasmBinary }, [wasmBinary]);
  }

  private postToWorklet(msg: Record<string, unknown>): void {
    if (this.wasmMode && this.workletNode) this.workletNode.port.postMessage(msg);
  }

  get isWasmActive(): boolean { return this.wasmMode; }
  get currentTime(): number { return this.ctx?.currentTime ?? 0; }
  get isInitialized(): boolean { return this.ctx !== null && this.ctx.state === "running"; }

  getAudioContext(): AudioContext | null { return this.ctx; }
  getMasterGainNode(): GainNode | null { return this.masterGain; }

  setVoiceParam(voice: number, paramId: string, value: number): void { voiceRenderer.setVoiceParam(voice, paramId, value); }
  getVoiceParam(voice: number, paramId: string): number { return voiceRenderer.getVoiceParam(voice, paramId); }
  getVoiceParams(voice: number): Record<string, number> { return voiceRenderer.getVoiceParams(voice); }
  setSampleLookup(fn: (voice: number) => AudioBuffer | null): void { voiceRenderer.setSampleLookup(fn); }

  triggerVoice(voice: number, velocity = 0.8): void {
    const ctx = this.getContext();
    if (ctx.state === "suspended") ctx.resume();
    if (this.wasmMode) {
      this.postToWorklet({ type: "trigger", voice, velocity });
    } else {
      const out = mixerRouter.getChannelOutput(voice);
      voiceRenderer.scheduleVoice(ctx, voice, velocity, ctx.currentTime, out);
    }
  }

  triggerVoiceAtTime(voice: number, velocity: number, time: number): void {
    const ctx = this.getContext();
    if (this.wasmMode) return;
    const out = mixerRouter.getChannelOutput(voice);
    voiceRenderer.scheduleVoice(ctx, voice, velocity, time, out);
  }

  playSampleAtTime(buffer: AudioBuffer, voice: number, velocity: number, time: number, tune = 0): void {
    const ctx = this.getContext();
    const out = mixerRouter.getChannelOutput(voice);
    voiceRenderer.playSampleAtTime(ctx, buffer, voice, velocity, time, out, tune);
  }

  syncPatternToWasm(pattern: { tracks: Array<{ steps: Array<{ active: boolean; velocity: number; ratchetCount: number }>; length: number }>; length: number; swing: number }): void {
    this.postToWorklet({ type: "syncPattern", ...pattern });
  }

  setWasmPlaying(playing: boolean): void { this.postToWorklet({ type: "setPlaying", playing }); }
  setWasmBpm(bpm: number): void { this.postToWorklet({ type: "setBpm", bpm }); }

  getChannelOutput(voice: number): AudioNode { return mixerRouter.getChannelOutput(voice); }
  getChannelAnalyser(channel: number): AnalyserNode | null { return mixerRouter.getChannelAnalyser(channel); }
  setChannelVolume(channel: number, volume: number): void { if (this.ctx) mixerRouter.setChannelVolume(channel, volume, this.ctx); }
  setChannelFilter(channel: number, type: BiquadFilterType, frequency: number, q: number): void { mixerRouter.setChannelFilter(channel, type, frequency, q); }
  bypassChannelFilter(channel: number): void { mixerRouter.bypassChannelFilter(channel); }
  setChannelDrive(channel: number, drive: number): void { mixerRouter.setChannelDrive(channel, drive); }
  setChannelPan(channel: number, pan: number): void { mixerRouter.setChannelPan(channel, pan); }
  setChannelElevation(channel: number, elevation: number): void { mixerRouter.setChannelElevation(channel, elevation); }
  setBinauralMode(enabled: boolean): void { mixerRouter.setBinauralMode(enabled); }
  getBinauralMode(): boolean { return mixerRouter.getBinauralMode(); }

  createBusGroup(name: string): void { const ctx = this.getContext(); mixerRouter.createBusGroup(name, ctx, this.masterGain!); }
  setChannelGroup(channel: number, group: string): void { mixerRouter.setChannelGroup(channel, group, this.masterGain!); }
  getGroupLevel(group: string): number { return mixerRouter.getGroupLevel(group); }
  setGroupVolume(group: string, volume: number): void { mixerRouter.setGroupVolume(group, volume); }
  getGroupNames(): string[] { return mixerRouter.getGroupNames(); }
  getChannelGroup(channel: number): string { return mixerRouter.getChannelGroup(channel); }

  setReverbLevel(level: number): void { sendFxManager.setReverbLevel(level); }
  setReverbType(type: "room" | "hall" | "plate" | "ambient"): void { sendFxManager.setReverbType(type); }
  getReverbType(): string { return sendFxManager.getReverbType(); }
  setReverbSize(size: number): void { sendFxManager.setReverbSize(size); }
  setReverbDecay(decay: number): void { sendFxManager.setReverbDecay(decay); }
  setReverbDamping(freq: number): void { sendFxManager.setReverbDamping(freq); }
  setReverbPreDelay(ms: number): void { sendFxManager.setReverbPreDelay(ms); }

  setDelayParams(time: number, feedback: number, filterFreq: number): void { sendFxManager.setDelayParams(time, feedback, filterFreq); }
  setDelayLevel(level: number): void { sendFxManager.setDelayLevel(level); }
  syncDelayToBpm(bpm: number, division?: number): void { sendFxManager.syncDelayToBpm(bpm, division); }
  setDelayDivision(divName: string, bpm: number): void { sendFxManager.setDelayDivision(divName, bpm); }
  setDelayType(type: "stereo" | "pingpong" | "tape"): void { sendFxManager.setDelayType(type); }
  getDelayType(): string { return sendFxManager.getDelayType(); }
  getDelayDivision(): string { return sendFxManager.getDelayDivision(); }

  setChannelReverbSend(channel: number, amount: number): void { sendFxManager.setChannelReverbSend(channel, amount); }
  setChannelDelaySend(channel: number, amount: number): void { sendFxManager.setChannelDelaySend(channel, amount); }

  setMasterFilter(type: BiquadFilterType, freq: number, q: number): void { sendFxManager.setMasterFilter(type, freq, q); }
  bypassMasterFilter(): void { sendFxManager.bypassMasterFilter(); }

  startNoise(volume = 0.3): void { sendFxManager.startNoise(volume); }
  stopNoise(): void { sendFxManager.stopNoise(); }

  startStutter(rate: number): void { if (this.masterCompressor) sendFxManager.startStutter(rate, this.masterCompressor); }
  stopStutter(): void { if (this.masterCompressor) sendFxManager.stopStutter(this.masterCompressor); }

  setMasterSaturation(amount: number): void { sendFxManager.setMasterSaturation(amount); }

  setPump(rate: number, depth: number): void { sendFxManager.setPump(rate, depth); }
  syncPumpToBpm(bpm: number, division?: number): void { sendFxManager.syncPumpToBpm(bpm, division); }

  startFlanger(sweepRate: number, depth: number, feedback: number): void { sendFxManager.startFlanger(sweepRate, depth, feedback); }
  setFlangerParams(sweepRate: number, depth: number, feedback: number): void { sendFxManager.setFlangerParams(sweepRate, depth, feedback); }
  stopFlanger(): void { sendFxManager.stopFlanger(); }

  getChannelMeter(channel: number): { rmsDb: number; peakDb: number; rmsLinear: number; peakLinear: number } {
    const analyser = this.channelAnalysers[channel];
    if (!analyser) return { rmsDb: -Infinity, peakDb: -Infinity, rmsLinear: 0, peakLinear: 0 };
    return meteringEngine.getChannelMeter(channel, analyser);
  }

  getMasterMeter(): { rmsDb: number; peakDb: number; rmsLinear: number; peakLinear: number } {
    if (!this.masterAnalyser) return { rmsDb: -Infinity, peakDb: -Infinity, rmsLinear: 0, peakLinear: 0 };
    return meteringEngine.getMasterMeter(this.masterAnalyser);
  }

  getChannelLevel(channel: number): number {
    const analyser = this.channelAnalysers[channel];
    if (!analyser) return 0;
    return meteringEngine.getChannelLevel(channel, analyser);
  }

  getMasterLevel(): number {
    if (!this.masterAnalyser) return 0;
    return meteringEngine.getMasterLevel(this.masterAnalyser);
  }

  static linearToDb(linear: number): number { return MeteringEngine.linearToDb(linear); }
  static dbToLinear(db: number): number { return MeteringEngine.dbToLinear(db); }

  setMasterEQ(low: number, mid: number, high: number): void {
    if (this.masterEqLow) this.masterEqLow.gain.value = low;
    if (this.masterEqMid) this.masterEqMid.gain.value = mid;
    if (this.masterEqHigh) this.masterEqHigh.gain.value = high;
  }

  setMasterCompressor(threshold: number, ratio: number, attack: number, release: number, knee: number): void {
    if (!this.masterCompressor) return;
    this.masterCompressor.threshold.value = threshold;
    this.masterCompressor.ratio.value = ratio;
    this.masterCompressor.attack.value = attack;
    this.masterCompressor.release.value = release;
    this.masterCompressor.knee.value = knee;
  }

  getCompressorReduction(): number { if (!this.masterCompressor) return 0; return (this.masterCompressor as any).reduction ?? 0; }
  setLimiterEnabled(enabled: boolean): void { if (!this.masterLimiter) return; this.masterLimiter.threshold.value = enabled ? -1 : 0; }
  setLimiterThreshold(thresholdDb: number): void { if (!this.masterLimiter) return; this.masterLimiter.threshold.value = thresholdDb; }

  setMasterVolume(volume: number): void {
    if (!this.masterGain) return;
    const ctx = this.getContext();
    const now = ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(volume, now + 0.015);
  }

  createRecordingStream(): MediaStreamAudioDestinationNode | null {
    if (!this.ctx || !this.masterAnalyser) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.masterAnalyser.connect(dest);
    return dest;
  }

  disconnectRecordingStream(dest: MediaStreamAudioDestinationNode): void {
    if (this.masterAnalyser) {
      try { this.masterAnalyser.disconnect(dest); } catch { /* already disconnected */ }
    }
  }

  private generateNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(duration * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}

export const audioEngine = new AudioEngine();
