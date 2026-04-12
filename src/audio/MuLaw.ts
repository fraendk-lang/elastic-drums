/**
 * µ-Law Companding (µ=255)
 *
 * Emulates the 8-bit µ-Law compression used in the LinnDrum.
 * This gives 12-bit dynamic range with 8-bit storage, producing
 * the characteristic "crunchy" vintage drum machine sound.
 *
 * Process: input → µ-Law encode → quantize to N bits → µ-Law decode
 */

const MU = 255;
const LOG_MU_PLUS_1 = Math.log(1 + MU);

/** µ-Law encode: compress dynamic range */
function muLawEncode(sample: number): number {
  const sign = sample < 0 ? -1 : 1;
  const abs = Math.min(Math.abs(sample), 1);
  return sign * Math.log(1 + MU * abs) / LOG_MU_PLUS_1;
}

/** µ-Law decode: expand back */
function muLawDecode(compressed: number): number {
  const sign = compressed < 0 ? -1 : 1;
  const abs = Math.abs(compressed);
  return sign * (Math.pow(1 + MU, abs) - 1) / MU;
}

/** Quantize to N bits (simulates limited bit depth) */
function quantize(value: number, bits: number): number {
  const levels = Math.pow(2, bits);
  return Math.round(value * levels) / levels;
}

/**
 * Apply µ-Law vintage processing to an AudioBuffer
 * @param buffer - Input AudioBuffer
 * @param ctx - AudioContext for creating output buffer
 * @param bits - Bit depth for quantization (8 = classic LinnDrum, 12 = subtle)
 * @param sampleRateReduction - Factor to reduce sample rate (1 = none, 2 = half, etc.)
 * @returns New AudioBuffer with vintage processing
 */
export function applyMuLaw(
  buffer: AudioBuffer,
  ctx: AudioContext,
  bits = 8,
  sampleRateReduction = 1,
): AudioBuffer {
  const output = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const out = output.getChannelData(ch);

    let holdSample = 0;

    for (let i = 0; i < input.length; i++) {
      // Sample rate reduction (sample & hold)
      if (sampleRateReduction > 1 && i % sampleRateReduction !== 0) {
        out[i] = holdSample;
        continue;
      }

      // µ-Law encode → quantize → decode
      const encoded = muLawEncode(input[i]!);
      const quantized = quantize(encoded, bits);
      const decoded = muLawDecode(quantized);

      holdSample = decoded;
      out[i] = decoded;
    }
  }

  return output;
}

/**
 * Create a µ-Law processing AudioWorklet-compatible function
 * for real-time processing (used when WASM is not available)
 */
export function createMuLawProcessor(bits = 8, reduction = 1) {
  return (samples: Float32Array): void => {
    let hold = 0;
    for (let i = 0; i < samples.length; i++) {
      if (reduction > 1 && i % reduction !== 0) {
        samples[i] = hold;
        continue;
      }
      const encoded = muLawEncode(samples[i]!);
      const quantized = quantize(encoded, bits);
      hold = muLawDecode(quantized);
      samples[i] = hold;
    }
  };
}
