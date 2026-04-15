/**
 * Metering Engine — Level analysis and conversion utilities
 *
 * Handles RMS and peak metering with exponential smoothing and decay.
 * - RMS = sqrt(mean(sample²)) — true signal power
 * - Peak = max(abs(sample))   — instantaneous peak
 */

export class MeteringEngine {
  private peakLevels: Float32Array;
  private rmsLevels: Float32Array;
  private masterPeakLevel = 0;
  private masterRmsLevel = 0;
  private readonly PEAK_DECAY = 0.995;
  private readonly RMS_SMOOTH = 0.5;
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;
  private frequencyBuffer: Float32Array<ArrayBuffer> | null = null;

  constructor(channelCount = 15) {
    this.peakLevels = new Float32Array(channelCount);
    this.rmsLevels = new Float32Array(channelCount);
  }

  /** Analyse level from an AnalyserNode — returns { rms, peak } in linear amplitude */
  analyseLevel(analyser: AnalyserNode): { rms: number; peak: number } {
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

  /** Get channel meter readings with smoothing */
  getChannelMeter(channel: number, analyser: AnalyserNode): { rmsDb: number; peakDb: number; rmsLinear: number; peakLinear: number } {
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
      rmsDb: MeteringEngine.linearToDb(smoothRms),
      peakDb: MeteringEngine.linearToDb(holdPeak),
      rmsLinear: smoothRms,
      peakLinear: holdPeak,
    };
  }

  /** Get master meter readings */
  getMasterMeter(analyser: AnalyserNode): { rmsDb: number; peakDb: number; rmsLinear: number; peakLinear: number } {
    if (!analyser) return { rmsDb: -Infinity, peakDb: -Infinity, rmsLinear: 0, peakLinear: 0 };

    const { rms, peak } = this.analyseLevel(analyser);

    this.masterRmsLevel = this.RMS_SMOOTH * this.masterRmsLevel + (1 - this.RMS_SMOOTH) * rms;

    if (peak > this.masterPeakLevel) {
      this.masterPeakLevel = peak;
    } else {
      this.masterPeakLevel *= this.PEAK_DECAY;
    }

    return {
      rmsDb: MeteringEngine.linearToDb(this.masterRmsLevel),
      peakDb: MeteringEngine.linearToDb(this.masterPeakLevel),
      rmsLinear: this.masterRmsLevel,
      peakLinear: this.masterPeakLevel,
    };
  }

  /** Legacy compat */
  getChannelLevel(channel: number, analyser: AnalyserNode): number {
    return this.getChannelMeter(channel, analyser).rmsLinear * 2;
  }

  getMasterLevel(analyser: AnalyserNode): number {
    return this.getMasterMeter(analyser).rmsLinear * 2;
  }

  /**
   * FFT summary for more meaningful visual analysis than raw bins.
   * Returns musically useful bands plus centroid/rolloff so the UI can show
   * whether a signal is dark, bright, or tilted toward the highs.
   */
  getSpectrumSummary(analyser: AnalyserNode, sampleRate: number): {
    sub: number;
    low: number;
    mid: number;
    high: number;
    air: number;
    centroidHz: number;
    rolloffHz: number;
    tilt: number;
  } {
    const binCount = analyser.frequencyBinCount;
    if (!this.frequencyBuffer || this.frequencyBuffer.length < binCount) {
      this.frequencyBuffer = new Float32Array(binCount);
    }

    analyser.getFloatFrequencyData(this.frequencyBuffer);
    const data = this.frequencyBuffer;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / binCount;

    let weightedFreq = 0;
    let energySum = 0;
    const magnitudes = new Float32Array(binCount);

    const bands = {
      sub: 0,
      low: 0,
      mid: 0,
      high: 0,
      air: 0,
    };

    for (let i = 0; i < binCount; i++) {
      const db = data[i]!;
      const magnitude = Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
      magnitudes[i] = magnitude;
      const freq = i * binHz;

      energySum += magnitude;
      weightedFreq += magnitude * freq;

      if (freq < 80) bands.sub += magnitude;
      else if (freq < 320) bands.low += magnitude;
      else if (freq < 2500) bands.mid += magnitude;
      else if (freq < 8000) bands.high += magnitude;
      else bands.air += magnitude;
    }

    const centroidHz = energySum > 0 ? weightedFreq / energySum : 0;

    let cumulative = 0;
    const rolloffTarget = energySum * 0.85;
    let rolloffHz = 0;
    for (let i = 0; i < binCount; i++) {
      cumulative += magnitudes[i]!;
      if (cumulative >= rolloffTarget) {
        rolloffHz = i * binHz;
        break;
      }
    }

    const normalizeBand = (value: number) => Math.min(1, value * 2.5);
    const lowEnergy = bands.sub + bands.low + 1e-6;
    const highEnergy = bands.high + bands.air + 1e-6;
    const tilt = Math.max(-1, Math.min(1, Math.log10(highEnergy / lowEnergy)));

    return {
      sub: normalizeBand(bands.sub),
      low: normalizeBand(bands.low),
      mid: normalizeBand(bands.mid),
      high: normalizeBand(bands.high),
      air: normalizeBand(bands.air),
      centroidHz,
      rolloffHz,
      tilt,
    };
  }

  /** Reset peak/RMS for a channel count */
  reset(channelCount: number): void {
    this.peakLevels = new Float32Array(channelCount);
    this.rmsLevels = new Float32Array(channelCount);
    this.masterPeakLevel = 0;
    this.masterRmsLevel = 0;
    this.frequencyBuffer = null;
  }
}

export const meteringEngine = new MeteringEngine();

// Re-export static methods for backward compatibility
export const linearToDb = MeteringEngine.linearToDb;
export const dbToLinear = MeteringEngine.dbToLinear;
