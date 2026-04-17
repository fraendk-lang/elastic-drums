/**
 * Mixer Router — Channel strips, bus groups, and panning
 *
 * Manages per-channel processing chains (filter → shaper → gain → panner → analyser),
 * bus group routing, and binaural audio mode.
 */

import { FxChain } from "./FxChain";

export class MixerRouter {
  private channelGains: GainNode[] = [];
  private channelAnalysers: AnalyserNode[] = [];
  private channelFilters: BiquadFilterNode[] = [];
  private channelShapers: WaveShaperNode[] = [];
  private channelPanners: PannerNode[] = [];
  private channelEQs: { lo: BiquadFilterNode; mid: BiquadFilterNode; hi: BiquadFilterNode }[] = [];
  private channelCompressors: DynamicsCompressorNode[] = [];
  private channelFxChains: (FxChain | null)[] = [];
  private binauralMode = false;
  private groupBuses: Map<string, { gain: GainNode; analyser: AnalyserNode }> = new Map();
  private channelGroupAssignment: string[] = [];

  /** Create a channel strip: filter → shaper → EQ(lo→mid→hi) → compressor → gain → panner → analyser → destination */
  createChannel(ctx: AudioContext, destination: GainNode): { filter: BiquadFilterNode; gain: GainNode; analyser: AnalyserNode; panner: PannerNode } {
    // Insert filter (bypass by default: allpass)
    const filter = ctx.createBiquadFilter();
    filter.type = "allpass";
    filter.frequency.value = 1000;

    // Insert distortion (bypass by default: null curve)
    const shaper = ctx.createWaveShaper();

    // 3-Band EQ: lowshelf → peaking mid → highshelf (all flat by default)
    const eqLo = ctx.createBiquadFilter();
    eqLo.type = "lowshelf";
    eqLo.frequency.value = 200;
    eqLo.gain.value = 0; // flat

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.0;
    eqMid.gain.value = 0; // flat

    const eqHi = ctx.createBiquadFilter();
    eqHi.type = "highshelf";
    eqHi.frequency.value = 4000;
    eqHi.gain.value = 0; // flat

    // Per-channel compressor (transparent by default: high threshold = no compression)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = 0;  // 0 dB = effectively bypassed
    compressor.knee.value = 6;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.15;

    // Channel gain (volume fader)
    const gain = ctx.createGain();
    gain.gain.value = 1.0;

    // Channel panner (3D / HRTF capable)
    const panner = ctx.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 10;
    panner.positionX.value = 0;
    panner.positionY.value = 0;
    panner.positionZ.value = -1;

    // Analyser (meter)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.15;

    // FX Rack insert (empty by default, passes audio through)
    const fxChain = new FxChain(ctx);

    // Routing: filter → shaper → fxChain → eqLo → eqMid → eqHi → compressor → gain → panner → analyser → destination
    filter.connect(shaper);
    shaper.connect(fxChain.input);
    fxChain.output.connect(eqLo);
    eqLo.connect(eqMid);
    eqMid.connect(eqHi);
    eqHi.connect(compressor);
    compressor.connect(gain);
    gain.connect(panner);
    panner.connect(analyser);
    analyser.connect(destination);

    this.channelFilters.push(filter);
    this.channelShapers.push(shaper);
    this.channelEQs.push({ lo: eqLo, mid: eqMid, hi: eqHi });
    this.channelCompressors.push(compressor);
    this.channelFxChains.push(fxChain);
    this.channelGains.push(gain);
    this.channelPanners.push(panner);
    this.channelAnalysers.push(analyser);

    return { filter, gain, analyser, panner };
  }

  /** Get all channel nodes */
  getChannelGain(i: number): GainNode | null {
    return this.channelGains[i] ?? null;
  }

  getChannelAnalyser(i: number): AnalyserNode | null {
    return this.channelAnalysers[i] ?? null;
  }

  getChannelFilter(i: number): BiquadFilterNode | null {
    return this.channelFilters[i] ?? null;
  }

  getChannelOutput(i: number): AudioNode {
    return this.channelFilters[i] ?? this.channelGains[i]!;
  }

  /** Set channel volume with smooth ramp */
  setChannelVolume(channel: number, volume: number, ctx: AudioContext): void {
    const gain = this.channelGains[channel];
    if (gain && ctx) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.015); // 15ms fade
    }
  }

  /** Set/bypass channel filter */
  setChannelFilter(channel: number, type: BiquadFilterType, frequency: number, q: number): void {
    const filter = this.channelFilters[channel];
    if (!filter) return;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
  }

  bypassChannelFilter(channel: number): void {
    const filter = this.channelFilters[channel];
    if (filter) filter.type = "allpass";
  }

  /** Get channel EQ nodes */
  getChannelEQ(i: number): { lo: BiquadFilterNode; mid: BiquadFilterNode; hi: BiquadFilterNode } | null {
    return this.channelEQs[i] ?? null;
  }

  /** Set channel EQ band gain (dB) */
  setChannelEQ(channel: number, band: "lo" | "mid" | "hi", gain: number, freq?: number): void {
    const eq = this.channelEQs[channel];
    if (!eq) return;
    eq[band].gain.value = gain;
    if (freq !== undefined) eq[band].frequency.value = freq;
  }

  /** Reset channel EQ to flat */
  resetChannelEQ(channel: number): void {
    const eq = this.channelEQs[channel];
    if (!eq) return;
    eq.lo.gain.value = 0;
    eq.mid.gain.value = 0;
    eq.hi.gain.value = 0;
  }

  /** Get channel compressor node */
  getChannelCompressor(i: number): DynamicsCompressorNode | null {
    return this.channelCompressors[i] ?? null;
  }

  /** Set channel compressor params */
  setChannelCompressor(channel: number, threshold: number, ratio: number, attack: number, release: number, knee?: number): void {
    const comp = this.channelCompressors[channel];
    if (!comp) return;
    comp.threshold.value = threshold;
    comp.ratio.value = ratio;
    comp.attack.value = attack;
    comp.release.value = release;
    if (knee !== undefined) comp.knee.value = knee;
  }

  /** Get channel FX chain */
  getChannelFxChain(i: number): FxChain | null {
    return this.channelFxChains[i] ?? null;
  }

  /** Bypass channel compressor (set threshold to 0 dB) */
  bypassChannelCompressor(channel: number): void {
    const comp = this.channelCompressors[channel];
    if (comp) comp.threshold.value = 0;
  }

  /** Set channel drive (insert distortion) */
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

  /** Set channel pan */
  setChannelPan(channel: number, pan: number): void {
    const panner = this.channelPanners[channel];
    if (panner) {
      // Map -1..+1 to X position (-5..+5) for spatial width
      panner.positionX.value = Math.max(-1, Math.min(1, pan)) * 5;
    }
  }

  setChannelElevation(channel: number, elevation: number): void {
    const panner = this.channelPanners[channel];
    if (panner) panner.positionY.value = Math.max(-1, Math.min(1, elevation)) * 3;
  }

  /** Binaural mode */
  setBinauralMode(enabled: boolean): void {
    this.binauralMode = enabled;
    const model = enabled ? "HRTF" : "equalpower";
    for (const panner of this.channelPanners) {
      panner.panningModel = model as PanningModelType;
    }
  }

  getBinauralMode(): boolean {
    return this.binauralMode;
  }

  /** Bus groups */
  createBusGroup(name: string, ctx: AudioContext, masterGain: GainNode): void {
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.15;
    gain.connect(analyser);
    analyser.connect(masterGain);
    this.groupBuses.set(name, { gain, analyser });
  }

  setChannelGroup(channel: number, group: string, masterGain: GainNode): void {
    this.channelGroupAssignment[channel] = group;
    // Reconnect: channel analyser → group bus (instead of direct to master)
    const chAnalyser = this.channelAnalysers[channel];
    if (!chAnalyser) return;

    chAnalyser.disconnect();
    const bus = this.groupBuses.get(group);
    if (bus) {
      chAnalyser.connect(bus.gain);
    } else {
      chAnalyser.connect(masterGain);
    }
  }

  getGroupLevel(group: string): number {
    const bus = this.groupBuses.get(group);
    if (!bus) return 0;
    const data = new Float32Array(bus.analyser.fftSize);
    bus.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    return Math.sqrt(sum / data.length) * 2;
  }

  getGroupAnalyser(group: string): AnalyserNode | null {
    return this.groupBuses.get(group)?.analyser ?? null;
  }

  setGroupVolume(group: string, volume: number): void {
    const bus = this.groupBuses.get(group);
    if (bus) bus.gain.gain.value = volume;
  }

  getGroupNames(): string[] {
    return Array.from(this.groupBuses.keys());
  }

  getChannelGroup(channel: number): string {
    return this.channelGroupAssignment[channel] ?? "master";
  }
}

export const mixerRouter = new MixerRouter();
