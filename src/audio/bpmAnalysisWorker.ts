/**
 * BPM Analysis Web Worker
 *
 * Accepts raw mono channel data + sample rate, returns:
 *   - bpm: detected tempo (70–180 BPM range)
 *   - firstBeatOffset: seconds from file start to beat 1
 *
 * Algorithm:
 *   1. Downsample to energy envelope at ~43 fps (hop = sampleRate / 43)
 *   2. Autocorrelation of the envelope → find dominant period
 *   3. Parabolic interpolation for sub-frame BPM accuracy
 *   4. Onset strength function → cross-correlate with beat pulse train
 *      to find the phase offset of beat 1
 *
 * Only the first 30 s of audio is analysed (fast + sufficient for loops).
 */

interface AnalysisRequest {
  id: number;
  channelData: Float32Array;
  sampleRate: number;
}

interface AnalysisResult {
  id: number;
  bpm: number;
  firstBeatOffset: number; // seconds
}

// ── Config ──────────────────────────────────────────────────────────────────

const ANALYSIS_SECONDS = 30;       // cap analysis window
const ENVELOPE_FPS     = 43;       // energy frames per second after downsampling
const BPM_MIN          = 70;
const BPM_MAX          = 180;

// ── Energy envelope ─────────────────────────────────────────────────────────

function energyEnvelope(data: Float32Array, sampleRate: number): Float32Array {
  const hopSize   = Math.floor(sampleRate / ENVELOPE_FPS);
  const maxFrames = Math.floor(ANALYSIS_SECONDS * ENVELOPE_FPS);
  const numFrames = Math.min(Math.floor(data.length / hopSize), maxFrames);

  const env = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let sum = 0;
    for (let j = 0; j < hopSize; j++) {
      const s = data[start + j] ?? 0;
      sum += s * s;
    }
    env[i] = Math.sqrt(sum / hopSize);
  }
  return env;
}

// ── Autocorrelation (one-sided, normalised by overlap length) ────────────────

function autocorrelate(signal: Float32Array): Float32Array {
  const n  = signal.length;
  const ac = new Float32Array(Math.ceil(n / 2));
  for (let lag = 0; lag < ac.length; lag++) {
    let sum = 0;
    const len = n - lag;
    for (let i = 0; i < len; i++) {
      sum += (signal[i] ?? 0) * (signal[i + lag] ?? 0);
    }
    ac[lag] = sum / len;
  }
  return ac;
}

// ── BPM from autocorrelation peak ───────────────────────────────────────────

function estimateBpm(env: Float32Array): number {
  const ac = autocorrelate(env);

  // lag range corresponding to BPM_MIN … BPM_MAX
  const framesPerMin = 60 * ENVELOPE_FPS;
  const lagMin = Math.max(1, Math.round(framesPerMin / BPM_MAX));
  const lagMax = Math.min(ac.length - 2, Math.round(framesPerMin / BPM_MIN));

  // Find best lag (highest autocorrelation)
  let bestLag  = lagMin;
  let bestVal  = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const v = ac[lag] ?? 0;
    if (v > bestVal) { bestVal = v; bestLag = lag; }
  }

  // Parabolic interpolation for fractional lag
  const y0 = ac[bestLag - 1] ?? 0;
  const y1 = ac[bestLag]     ?? 0;
  const y2 = ac[bestLag + 1] ?? 0;
  const d  = 2 * (2 * y1 - y0 - y2);
  const refinedLag = d !== 0 ? bestLag + (y0 - y2) / d : bestLag;

  let bpm = framesPerMin / refinedLag;

  // Fold into 70–180 range (handle half / double tempo artefacts)
  while (bpm < BPM_MIN) bpm *= 2;
  while (bpm > BPM_MAX) bpm /= 2;

  return Math.round(bpm * 10) / 10;
}

// ── Beat phase offset ────────────────────────────────────────────────────────

function findBeatOffset(env: Float32Array, bpm: number): number {
  // Onset strength: half-wave rectified first difference of envelope
  const onset = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) {
    onset[i] = Math.max(0, (env[i] ?? 0) - (env[i - 1] ?? 0));
  }

  // Beat period in frames
  const framesPerBeat = (60 / bpm) * ENVELOPE_FPS;

  // Search over 64 phase candidates (sub-beat resolution)
  const steps    = 64;
  let bestOffset = 0;
  let bestScore  = -1;

  const beatsInWindow = Math.floor(env.length / framesPerBeat);

  for (let step = 0; step < steps; step++) {
    const phaseFrames = (step / steps) * framesPerBeat;
    let score = 0;
    for (let b = 0; b < beatsInWindow; b++) {
      const fi = Math.round(phaseFrames + b * framesPerBeat);
      if (fi < onset.length) score += onset[fi] ?? 0;
    }
    if (score > bestScore) {
      bestScore  = score;
      bestOffset = step / steps;
    }
  }

  // Offset in seconds (within one beat period)
  return bestOffset * (60 / bpm);
}

// ── Worker message handler ───────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const { id, channelData, sampleRate } = e.data;

  try {
    const env             = energyEnvelope(channelData, sampleRate);
    const bpm             = estimateBpm(env);
    const firstBeatOffset = findBeatOffset(env, bpm);

    const result: AnalysisResult = { id, bpm, firstBeatOffset };
    self.postMessage(result);
  } catch (err) {
    // Fallback: 120 BPM, no offset
    console.warn("[bpmAnalysisWorker] analysis failed:", err);
    self.postMessage({ id, bpm: 120, firstBeatOffset: 0 } as AnalysisResult);
  }
};
