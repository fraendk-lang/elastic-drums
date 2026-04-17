/**
 * Wavetable library — PeriodicWave objects with character.
 *
 * Each wavetable is defined by Fourier real/imag coefficients.
 * Use setPeriodicWave() on an OscillatorNode for lush, harmonic-rich tones
 * beyond the basic sawtooth/square/triangle.
 */

export type WavetableName =
  | "harmonic"
  | "bright-saw"
  | "hollow"
  | "glass"
  | "vocal"
  | "pulse-25"
  | "digital"
  | "warm-stack";

export const WAVETABLE_NAMES: WavetableName[] = [
  "harmonic",
  "bright-saw",
  "hollow",
  "glass",
  "vocal",
  "pulse-25",
  "digital",
  "warm-stack",
];

function coeffs(realArr: number[], imagArr: number[]): { real: Float32Array; imag: Float32Array } {
  const n = Math.max(realArr.length, imagArr.length);
  const real = new Float32Array(new ArrayBuffer(n * 4));
  const imag = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    real[i] = realArr[i] ?? 0;
    imag[i] = imagArr[i] ?? 0;
  }
  return { real, imag };
}

/**
 * Build coefficients for a given wavetable name.
 * Real[0] is DC offset (should be 0). Imag is usually the "main" component
 * because sine waves are typically expressed as sums of sin(nωt).
 */
function buildCoeffs(name: WavetableName): { real: Float32Array; imag: Float32Array } {
  switch (name) {
    case "harmonic": {
      // First 8 harmonics with natural decay — classic organ-like
      const imag = [0, 1, 0.5, 0.33, 0.25, 0.2, 0.15, 0.12, 0.09];
      return coeffs([0], imag);
    }
    case "bright-saw": {
      // Sawtooth-like but emphasizes upper harmonics (brighter than regular saw)
      const n = 32;
      const imag: number[] = [0];
      for (let i = 1; i < n; i++) imag.push((1 / i) * (1 + i * 0.08));
      return coeffs([0], imag);
    }
    case "hollow": {
      // Only odd harmonics with strong fundamental — square-ish but softer
      const imag = [0, 1, 0, 0.3, 0, 0.1, 0, 0.04, 0, 0.02];
      return coeffs([0], imag);
    }
    case "glass": {
      // Sparse high harmonics — bell/glass texture
      const imag = [0, 0.6, 0.0, 0.1, 0.5, 0.0, 0.2, 0.0, 0.3, 0.0, 0.1, 0.2];
      return coeffs([0], imag);
    }
    case "vocal": {
      // Approximate "aah" formant vowel (strong 2nd + 4th harmonic)
      const imag = [0, 1.0, 0.8, 0.3, 0.5, 0.15, 0.08, 0.05, 0.03];
      return coeffs([0], imag);
    }
    case "pulse-25": {
      // 25% duty cycle pulse — thinner than square
      const n = 32;
      const imag: number[] = [0];
      const duty = 0.25;
      for (let i = 1; i < n; i++) {
        imag.push((2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty));
      }
      return coeffs([0], imag);
    }
    case "digital": {
      // Sharp edges with distinct "stepped" character — digital/FM feel
      const imag = [0, 1, 0, 0.6, 0, 0.4, 0.2, 0.5, 0, 0.3, 0, 0.2];
      return coeffs([0], imag);
    }
    case "warm-stack": {
      // Fundamentals + 3rd + 5th stack — rich, analog-warm
      const imag = [0, 1.0, 0.6, 0.5, 0.35, 0.3, 0.2, 0.15, 0.1, 0.08];
      return coeffs([0], imag);
    }
  }
}

// Cache PeriodicWaves per context
const waveCache = new WeakMap<AudioContext, Map<WavetableName, PeriodicWave>>();

export function getWavetable(ctx: AudioContext, name: WavetableName): PeriodicWave {
  let ctxCache = waveCache.get(ctx);
  if (!ctxCache) {
    ctxCache = new Map();
    waveCache.set(ctx, ctxCache);
  }
  const cached = ctxCache.get(name);
  if (cached) return cached;

  const { real, imag } = buildCoeffs(name);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  ctxCache.set(name, wave);
  return wave;
}
