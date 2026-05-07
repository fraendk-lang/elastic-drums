/**
 * Wavetable library — PeriodicWave objects with character.
 *
 * Each wavetable is defined by Fourier real/imag coefficients.
 * Use setPeriodicWave() on an OscillatorNode for lush, harmonic-rich tones
 * beyond the basic sawtooth/square/triangle.
 *
 * v2 additions: organ, strings, piano + improved vocal/glass
 */

export type WavetableName =
  | "harmonic"
  | "bright-saw"
  | "hollow"
  | "glass"
  | "vocal"
  | "pulse-25"
  | "digital"
  | "warm-stack"
  // v2 additions
  | "organ"
  | "strings"
  | "piano";

export const WAVETABLE_NAMES: WavetableName[] = [
  "harmonic",
  "bright-saw",
  "hollow",
  "glass",
  "vocal",
  "pulse-25",
  "digital",
  "warm-stack",
  "organ",
  "strings",
  "piano",
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
      // Bell/crystal texture: inharmonic-like sparse spectrum with strong
      // non-adjacent partials — models the clang + ring of struck glass
      //         H1    H2    H3    H4    H5    H6    H7    H8    H9    H10   H11   H12   H13   H14   H15   H16
      const imag = [0, 0.75, 0.0, 0.05, 0.60, 0.0, 0.25, 0.0, 0.35, 0.05, 0.12, 0.20, 0.08, 0.0, 0.15, 0.0, 0.10];
      return coeffs([0], imag);
    }
    case "vocal": {
      // "Aah" vowel with two formant peaks.
      // F1 ≈ 700 Hz (strong around H3–H4 for a 200 Hz fundamental)
      // F2 ≈ 1200 Hz (H5–H6 region) + some F3 energy around H10–H12
      // Envelope: strong fundamental → formant peaks → gentle HF tail
      const imag = [
        0,    // DC
        1.00, // H1 fundamental
        0.65, // H2
        0.72, // H3 — F1 region
        0.62, // H4 — F1 region
        0.55, // H5 — F2 onset
        0.68, // H6 — F2 peak
        0.42, // H7
        0.22, // H8
        0.18, // H9
        0.32, // H10 — F3 onset
        0.26, // H11
        0.28, // H12 — F3 peak
        0.16, // H13
        0.08, // H14
        0.12, // H15
      ];
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

    // ── v2: New wavetables ─────────────────────────────────────────────────

    case "organ": {
      // Hammond B3 tonewheels — 9 drawbars at classic "full" position.
      // Drawbars: 16' (×0.5), 8' (×1), 5⅓' (×1.5), 4' (×2), 2⅔' (×3),
      //           2' (×4), 1⅗' (×5), 1⅓' (×6), 1' (×8)
      // Non-integer ratios are rounded to nearest harmonic.
      // Classic gospel/jazz setting: strong 8'+5⅓'+4'+2⅔' = [1, 2, 3]+[4, 5, 6]
      const imag = [
        0,    // DC
        1.00, // H1  = 8'  (draw full)
        0.00, // H2  (skip — 4' at H2 would conflict; use H4 instead)
        0.88, // H3  ≈ 5⅓' (drawbar 2)
        0.80, // H4  = 4' (drawbar 3)
        0.00, // H5
        0.72, // H6  ≈ 2⅔' (drawbar 4)
        0.00, // H7
        0.55, // H8  = 2' (drawbar 5)
        0.00, // H9
        0.45, // H10 ≈ 1⅗' (drawbar 6, approximated)
        0.00, // H11
        0.35, // H12 ≈ 1⅓' (drawbar 7)
        0.00, // H13
        0.00, // H14
        0.00, // H15
        0.28, // H16 = 1' (drawbar 8)
      ];
      return coeffs([0], imag);
    }

    case "strings": {
      // Bowed string ensemble — rich sawtooth-like spectrum with a characteristic
      // double-peak (bow pressure resonance) and gentle HF roll-off.
      // Even and odd harmonics both present; slight emphasis on H3, H6.
      const imag: number[] = [0]; // H0 = DC
      for (let h = 1; h <= 20; h++) {
        // Slow natural decay with slight formant bumps at H3 and H6
        const base = 1.0 / h;
        const formant = h === 3 ? 1.25 : h === 6 ? 1.15 : h === 9 ? 1.05 : 1.0;
        imag.push(base * formant);
      }
      return coeffs([0], imag);
    }

    case "piano": {
      // Acoustic piano — percussive onset character via high partial content.
      // Strong fundamental, weaker 2nd, strong 3rd, then alternating odd-emphasis.
      // Real piano has inharmonic partials (Railsback curve) which we approximate
      // by giving odd harmonics slightly more weight than even ones.
      const imag: number[] = [
        0,    // DC
        1.00, // H1
        0.35, // H2 — weaker than strings (piano has less even harmonic energy)
        0.60, // H3 — strong in piano
        0.40, // H4
        0.38, // H5 — odd harmonics stay present longer in piano
        0.28, // H6
        0.35, // H7
        0.18, // H8
        0.28, // H9 — odd
        0.15, // H10
        0.22, // H11 — odd emphasis
        0.12, // H12
        0.08, // H13
        0.12, // H14 — slight brightening in upper mids
        0.07, // H15
        0.10, // H16 — upper partial sparkle
      ];
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
