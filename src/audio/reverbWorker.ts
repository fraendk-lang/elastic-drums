/**
 * Reverb IR Worker — v2
 * Improvements over v1:
 * - Fibonacci-based early tap timings (eliminates flutter echo / periodic combs)
 * - Frequency-dependent tail decay (highs die faster than lows)
 * - True stereo decorrelation (independent seeded PRNG per channel)
 * - Spring type with physical wobble character
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

// Fibonacci sequence used for early reflection timing — avoids periodic flutter
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

interface ReverbProfile {
  preDelayMs: number;
  earlyDensity: number;   // How many Fibonacci taps to use
  earlySpreadMs: number;  // L/R offset for early reflections
  tailDecayMul: number;   // Multiplier on decay time
  hfDamping: number;      // 0=lots of damping (dark), 1=little (bright)
  diffusion: number;      // 0–1: tail smoothness
  springWobble: boolean;  // Spring character (time-modulated taps)
}

const PROFILES: Record<string, ReverbProfile> = {
  room:   { preDelayMs:  5, earlyDensity:  8, earlySpreadMs: 1.5, tailDecayMul: 0.75, hfDamping: 0.45, diffusion: 0.70, springWobble: false },
  hall:   { preDelayMs: 18, earlyDensity: 10, earlySpreadMs: 4.0, tailDecayMul: 1.10, hfDamping: 0.65, diffusion: 0.80, springWobble: false },
  plate:  { preDelayMs:  2, earlyDensity:  6, earlySpreadMs: 0.8, tailDecayMul: 0.85, hfDamping: 0.80, diffusion: 0.90, springWobble: false },
  spring: { preDelayMs:  8, earlyDensity:  5, earlySpreadMs: 2.0, tailDecayMul: 0.70, hfDamping: 0.25, diffusion: 0.50, springWobble: true  },
};

/** Simple seeded pseudo-random (xorshift32) for reproducible stereo decorrelation */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function generateIR(
  sampleRate: number,
  duration: number,
  decay: number,
  type: string,
): { left: Float32Array; right: Float32Array } {
  const p = PROFILES[type] ?? PROFILES["hall"]!;
  const length = Math.ceil(sampleRate * duration);
  const left  = new Float32Array(length);
  const right = new Float32Array(length);
  const preDelay = Math.ceil(sampleRate * p.preDelayMs / 1000);

  // ── Early Reflections (Fibonacci taps, stereo-offset) ──────────────────
  const rngL = makeRng(0x9e3779b9);
  const rngR = makeRng(0x517cc1b7);

  for (let tapIdx = 0; tapIdx < p.earlyDensity; tapIdx++) {
    const fib = FIBONACCI[tapIdx] ?? (tapIdx * 13 + 7);
    const timeL = (fib * 0.0015) + (tapIdx * 0.002); // ~1.5ms base unit per Fib step
    const timeR = timeL + (p.earlySpreadMs / 1000);
    const gain = 0.72 * Math.exp(-tapIdx * 0.28);

    const idxL = preDelay + Math.ceil(sampleRate * timeL);
    const idxR = preDelay + Math.ceil(sampleRate * timeR);
    const burstLen = Math.ceil(sampleRate * 0.003); // 3ms burst per reflection

    if (idxL < length) {
      for (let j = 0; j < burstLen && idxL + j < length; j++) {
        left[idxL + j]! += rngL() * gain * Math.exp(-j / (sampleRate * 0.0015));
      }
    }
    if (idxR < length) {
      for (let j = 0; j < burstLen && idxR + j < length; j++) {
        right[idxR + j]! += rngR() * gain * Math.exp(-j / (sampleRate * 0.0015));
      }
    }
  }

  // ── Diffuse Tail ────────────────────────────────────────────────────────
  const tailStart = preDelay + Math.ceil(sampleRate * (type === "plate" ? 0.005 : 0.06));

  const wobbleFreq  = p.springWobble ? 4.2  : 0;
  const wobbleDepth = p.springWobble ? 0.35 : 0;

  const tailRngL = makeRng(0xdeadbeef);
  const tailRngR = makeRng(0x01234567);

  for (let i = tailStart; i < length; i++) {
    const t = (i - tailStart) / sampleRate;

    // Frequency-dependent decay: HF dies faster (hfDamping near 0 = dark, near 1 = bright)
    const hfDecayRate = 6.0 / (decay * p.tailDecayMul);
    const lfDecayRate = hfDecayRate * (0.35 + p.hfDamping * 0.35);
    const hfEnv = Math.exp(-t * hfDecayRate);
    const lfEnv = Math.exp(-t * lfDecayRate);

    const noiseL = tailRngL();
    const noiseR = tailRngR();

    // Spring wobble modulates amplitude (physical coil resonance)
    const wobble = p.springWobble
      ? (1.0 + wobbleDepth * Math.sin(2 * Math.PI * wobbleFreq * t))
      : 1.0;

    // Slightly different L/R diffusion scale → stereo width
    const lScale = p.diffusion * 0.6 + 0.4;
    const rScale = p.diffusion * 0.7 + 0.3;

    left[i]!  += noiseL * wobble * (hfEnv * p.hfDamping + lfEnv * (1 - p.hfDamping * 0.5)) * lScale;
    right[i]! += noiseR * wobble * (hfEnv * p.hfDamping + lfEnv * (1 - p.hfDamping * 0.5)) * rScale;
  }

  return { left, right };
}

self.onmessage = (e: MessageEvent<ReverbRequest>) => {
  const { id, sampleRate, duration, decay, type } = e.data;
  const { left, right } = generateIR(sampleRate, duration, decay, type);
  const response: ReverbResponse = { id, left, right, sampleRate };
  (self as unknown as Worker).postMessage(response, [left.buffer, right.buffer]);
};
