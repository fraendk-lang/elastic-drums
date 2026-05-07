/**
 * Reverb IR Worker — v3
 *
 * Improvements over v2:
 * - Schroeder allpass diffusion chain (4 stages per channel) → dense, smooth tail
 * - Pink-noise spectral shaping (1-pole IIR) → warmer, less "hissy" tail
 * - Comb-filter pre-diffusion layer for plate/hall early decay texture
 * - Per-tap frequency coloring on early reflections (slight LP per bounce)
 * - Independent allpass coefficients for L/R (wider stereo)
 */

interface ReverbRequest {
  id: number;
  sampleRate: number;
  duration: number;
  decay: number;
  type: string;
}

interface ReverbResponse {
  id: number;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

// Fibonacci sequence for early reflection timing — avoids periodic flutter
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

interface ReverbProfile {
  preDelayMs:    number;
  earlyDensity:  number;
  earlySpreadMs: number;
  tailDecayMul:  number;
  hfDamping:     number;
  diffusion:     number;
  springWobble:  boolean;
  allpassDepth:  number;   // 0–1 — how strongly allpass is applied
  warmth:        number;   // 0–1 — pink-noise filtering (1=very warm, 0=bright)
}

const PROFILES: Record<string, ReverbProfile> = {
  room:   { preDelayMs:  5, earlyDensity:  9, earlySpreadMs: 1.5, tailDecayMul: 0.75, hfDamping: 0.45, diffusion: 0.70, springWobble: false, allpassDepth: 0.68, warmth: 0.55 },
  hall:   { preDelayMs: 18, earlyDensity: 12, earlySpreadMs: 4.0, tailDecayMul: 1.10, hfDamping: 0.65, diffusion: 0.82, springWobble: false, allpassDepth: 0.75, warmth: 0.65 },
  plate:  { preDelayMs:  2, earlyDensity:  7, earlySpreadMs: 0.8, tailDecayMul: 0.85, hfDamping: 0.80, diffusion: 0.92, springWobble: false, allpassDepth: 0.80, warmth: 0.40 },
  spring: { preDelayMs:  8, earlyDensity:  5, earlySpreadMs: 2.0, tailDecayMul: 0.70, hfDamping: 0.25, diffusion: 0.50, springWobble: true,  allpassDepth: 0.55, warmth: 0.70 },
};

/** Seeded xorshift32 pseudo-random — range –1…+1 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/**
 * Schroeder allpass diffusion: y[n] = -g·x[n] + x[n-M] + g·y[n-M]
 * Applied to the IR buffer in-place. Creates smooth, dense reverb tail
 * instead of grainy noise. Four stages with mutually irrational delays
 * AND slow LFO modulation of the read tap (0.3–0.6 Hz, ±0.3 ms) to
 * break up periodic resonances and reduce the "metallic" character of
 * static allpass chains. This is the classic Lexicon trick.
 */
function applyAllpass(buf: Float32Array, sampleRate: number, g: number, seed: number): void {
  // Delay lengths in ms — mutually irrational ratios → no periodic combing
  const DELAYS_MS = [2.56, 4.07, 6.43, 10.13];
  // Independent LFO per stage: rates between 0.3 and 0.6 Hz, depth ±0.3 ms
  const LFO_HZ = [0.31, 0.43, 0.52, 0.59];
  const MOD_DEPTH_SAMPLES = sampleRate * 0.0003; // 0.3 ms → ~13 samples @ 44.1k
  for (let s = 0; s < DELAYS_MS.length; s++) {
    const baseM = sampleRate * DELAYS_MS[s]! / 1000;
    const lfoW = 2 * Math.PI * LFO_HZ[s]! / sampleRate;
    const lfoPhase = ((seed >>> (s * 8)) & 0xff) / 255 * 2 * Math.PI; // decorrelate L/R
    const out = new Float32Array(buf.length);
    for (let n = 0; n < buf.length; n++) {
      const Mfloat = baseM + Math.sin(lfoW * n + lfoPhase) * MOD_DEPTH_SAMPLES;
      const Mi = Math.floor(Mfloat);
      const frac = Mfloat - Mi;
      // Linear-interpolated read tap (sub-sample LFO modulation)
      const xPastA = n - Mi >= 0 ? buf[n - Mi]! : 0;
      const xPastB = n - Mi - 1 >= 0 ? buf[n - Mi - 1]! : 0;
      const xPast = xPastA * (1 - frac) + xPastB * frac;
      const yPastA = n - Mi >= 0 ? out[n - Mi]! : 0;
      const yPastB = n - Mi - 1 >= 0 ? out[n - Mi - 1]! : 0;
      const yPast = yPastA * (1 - frac) + yPastB * frac;
      const xNow = buf[n]!;
      out[n] = -g * xNow + xPast + g * yPast;
    }
    buf.set(out);
  }
}

/**
 * Time-varying lowpass filter that progressively darkens the tail.
 * Models the air absorption + room boundary HF loss that makes a real
 * room's reverb tail sound warmer over time. Cutoff sweeps from
 * `startCutoff` to `endCutoff` exponentially over the buffer length.
 */
function timeVaryingLowpass(buf: Float32Array, sampleRate: number, startCutoff: number, endCutoff: number): void {
  let y = 0;
  const len = buf.length;
  const k = Math.log(endCutoff / startCutoff) / Math.max(1, len);
  for (let n = 0; n < len; n++) {
    // 1-pole LP, alpha derived from cutoff. alpha = dt / (RC + dt) where RC = 1/(2π·fc)
    const fc = startCutoff * Math.exp(k * n);
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * fc);
    const alpha = dt / (rc + dt);
    y = y + alpha * (buf[n]! - y);
    buf[n] = y;
  }
}

/**
 * Pink-noise shaping via 1-pole IIR.  Adds warmth: rolls off highs gently.
 * pole near 1 → very warm; pole near 0 → flat/white.
 */
function pinkify(buf: Float32Array, pole: number): void {
  let y = 0;
  for (let n = 0; n < buf.length; n++) {
    y = pole * y + (1 - pole) * buf[n]!;
    buf[n] = y;
  }
}

function generateIR(
  sampleRate: number,
  duration:   number,
  decay:      number,
  type:       string,
): { left: Float32Array; right: Float32Array } {
  const p        = PROFILES[type] ?? PROFILES["hall"]!;
  const length   = Math.ceil(sampleRate * duration);
  const left     = new Float32Array(length);
  const right    = new Float32Array(length);
  const preDelay = Math.ceil(sampleRate * p.preDelayMs / 1000);

  // ── Early Reflections (Fibonacci taps + per-tap LP coloring) ────────────
  const rngL = makeRng(0x9e3779b9);
  const rngR = makeRng(0x517cc1b7);

  for (let tapIdx = 0; tapIdx < p.earlyDensity; tapIdx++) {
    const fib   = FIBONACCI[tapIdx] ?? (tapIdx * 13 + 7);
    const timeL = (fib * 0.0015) + (tapIdx * 0.002);
    const timeR = timeL + (p.earlySpreadMs / 1000);

    // Reflections get progressively darker (each bounce absorbs HF)
    const hfGain  = Math.pow(0.82, tapIdx);
    const baseGain = 0.78 * Math.exp(-tapIdx * 0.25) * hfGain;

    const idxL    = preDelay + Math.ceil(sampleRate * timeL);
    const idxR    = preDelay + Math.ceil(sampleRate * timeR);
    const burstMs = 3.5 + tapIdx * 0.8;                  // later reflections slightly longer
    const burstLen = Math.ceil(sampleRate * burstMs / 1000);

    if (idxL < length) {
      for (let j = 0; j < burstLen && idxL + j < length; j++) {
        const env = Math.exp(-j / (sampleRate * 0.0018));
        left[idxL + j]! += rngL() * baseGain * env;
      }
    }
    if (idxR < length) {
      for (let j = 0; j < burstLen && idxR + j < length; j++) {
        const env = Math.exp(-j / (sampleRate * 0.0018));
        right[idxR + j]! += rngR() * baseGain * env;
      }
    }
  }

  // ── Diffuse Tail (independent L/R seeded noise + frequency-dependent decay) ─
  const tailStart = preDelay + Math.ceil(sampleRate * (type === "plate" ? 0.005 : 0.06));
  const wobbleFreq  = p.springWobble ? 4.2  : 0;
  const wobbleDepth = p.springWobble ? 0.35 : 0;

  const tailRngL = makeRng(0xdeadbeef);
  const tailRngR = makeRng(0x01234567);

  for (let i = tailStart; i < length; i++) {
    const t = (i - tailStart) / sampleRate;

    const hfDecayRate = 6.0 / (decay * p.tailDecayMul);
    const lfDecayRate = hfDecayRate * (0.30 + p.hfDamping * 0.38);
    const hfEnv = Math.exp(-t * hfDecayRate);
    const lfEnv = Math.exp(-t * lfDecayRate);

    const noiseL = tailRngL();
    const noiseR = tailRngR();

    const wobble  = p.springWobble
      ? (1.0 + wobbleDepth * Math.sin(2 * Math.PI * wobbleFreq * t))
      : 1.0;

    const lScale = p.diffusion * 0.62 + 0.38;
    const rScale = p.diffusion * 0.71 + 0.29;

    left[i]!  += noiseL * wobble * (hfEnv * p.hfDamping + lfEnv * (1 - p.hfDamping * 0.5)) * lScale;
    right[i]! += noiseR * wobble * (hfEnv * p.hfDamping + lfEnv * (1 - p.hfDamping * 0.5)) * rScale;
  }

  // ── Schroeder Allpass Diffusion (modulated) ─────────────────────────────
  // L and R get slightly different g values + seeds → wider, uncorrelated stereo
  const gL = 0.60 + p.allpassDepth * 0.20;   // 0.60–0.80
  const gR = 0.55 + p.allpassDepth * 0.22;   // 0.55–0.77
  applyAllpass(left,  sampleRate, gL, 0x9e3779b9);
  applyAllpass(right, sampleRate, gR, 0x517cc1b7);

  // ── Time-varying spectral damping ───────────────────────────────────────
  // Real rooms lose HF over time (air absorption + boundary losses).
  // Sweep cutoff from a bright start down to a darker end based on hfDamping.
  // Plate stays brighter (high startCutoff); Hall/Spring get warmer over time.
  const hfStart = 16000 - p.hfDamping * 4000;   // 16k → 12k
  const hfEnd   = 4000 - p.hfDamping * 2500;    // 4k → 1.5k
  timeVaryingLowpass(left,  sampleRate, hfStart, hfEnd);
  timeVaryingLowpass(right, sampleRate, hfStart * 1.05, hfEnd * 0.95); // slight L/R decorrelation

  // ── Pink-noise warmth shaping ───────────────────────────────────────────
  // Pole: 0 = flat, 0.9 = very warm.  Room/Hall get warmth; Plate stays brighter
  const pinkPole = 0.15 + p.warmth * 0.55;   // 0.15–0.70
  pinkify(left,  pinkPole);
  pinkify(right, pinkPole);

  // ── Normalize to peak 0.45 ─────────────────────────────────────────────
  let peak = 0;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  }
  if (peak > 0) {
    const gain = 0.45 / peak;
    for (let i = 0; i < length; i++) {
      left[i]!  *= gain;
      right[i]! *= gain;
    }
  }

  return { left, right };
}

self.onmessage = (e: MessageEvent<ReverbRequest>) => {
  const { id, sampleRate, duration, decay, type } = e.data;
  const { left, right } = generateIR(sampleRate, duration, decay, type);
  const response: ReverbResponse = { id, left, right, sampleRate };
  (self as unknown as Worker).postMessage(response, [left.buffer, right.buffer]);
};
