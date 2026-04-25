/**
 * phaseVocoderShift — offline pitch shifting via Phase Vocoder
 *
 * Shifts pitch without changing tempo. Better quality than WSOLA for
 * melodic content (synths, chords). Uses Cooley-Tukey radix-2 FFT.
 *
 * Algorithm: analysis (FFT) → bin remapping by pitchFactor → synthesis (IFFT + OLA)
 */

const PV_FRAME   = 2048;          // FFT frame size (must be power of 2)
const PV_OVERLAP = 4;             // 75% overlap
const PV_HOP     = PV_FRAME / PV_OVERLAP; // 512 samples per hop
const TWO_PI     = 2 * Math.PI;

// ── Hann window (precomputed, shared across calls) ──────────────────────
const _hann = new Float64Array(PV_FRAME);
for (let i = 0; i < PV_FRAME; i++) {
  _hann[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (PV_FRAME - 1)));
}

// ── Cooley-Tukey radix-2 in-place FFT ───────────────────────────────────
// re[] = real part, im[] = imaginary part (both Float64Array of length 2^n)
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t;
      t = im[i]!; im[i] = im[j]!; im[j] = t;
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang  = -TWO_PI / len;
    const wRe  = Math.cos(ang);
    const wIm  = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0;
      for (let j = 0; j < (len >> 1); j++) {
        const k   = i + j + (len >> 1);
        const vRe = re[k]! * uRe - im[k]! * uIm;
        const vIm = re[k]! * uIm + im[k]! * uRe;
        re[k] = re[i + j]! - vRe;
        im[k] = im[i + j]! - vIm;
        re[i + j] = re[i + j]! + vRe;
        im[i + j] = im[i + j]! + vIm;
        const newU = uRe * wRe - uIm * wIm;
        uIm        = uRe * wIm + uIm * wRe;
        uRe        = newU;
      }
    }
  }
}

// Inverse FFT (conjugate → FFT → conjugate + scale)
function ifft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i]!;
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = -im[i]! / n; }
}

// ── Single-channel Phase Vocoder pitch shift ─────────────────────────────
// Returns a new Float32Array of the same length as `input`, pitch-shifted.
function pvShiftChannel(input: Float32Array, pitchFactor: number): Float32Array {
  const len       = input.length;
  const numFrames = Math.max(1, Math.floor((len - PV_FRAME) / PV_HOP) + 1);
  const outLen    = numFrames * PV_HOP + PV_FRAME;
  const output    = new Float64Array(outLen);
  const normAcc   = new Float64Array(outLen); // overlap-added window squares for normalization

  // Per-bin state (reset per call — no shared state between calls)
  const lastPhase  = new Float64Array(PV_FRAME);
  const synthPhase = new Float64Array(PV_FRAME);

  const re = new Float64Array(PV_FRAME);
  const im = new Float64Array(PV_FRAME);

  for (let frame = 0; frame < numFrames; frame++) {
    const inOff = frame * PV_HOP;

    // 1. Extract + apply Hann window
    for (let i = 0; i < PV_FRAME; i++) {
      re[i] = (input[inOff + i] ?? 0) * _hann[i]!;
      im[i] = 0;
    }

    // 2. FFT
    fft(re, im);

    // 3. Compute magnitude and true frequency for each positive bin
    const mag      = new Float64Array(PV_FRAME);
    const trueFreq = new Float64Array(PV_FRAME);
    for (let k = 0; k < PV_FRAME / 2; k++) {
      mag[k]           = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
      const phase      = Math.atan2(im[k]!, re[k]!);
      const expected   = (TWO_PI * k * PV_HOP) / PV_FRAME;
      let   delta      = phase - lastPhase[k]! - expected;
      // Wrap phase difference to [-π, π]
      delta           -= TWO_PI * Math.round(delta / TWO_PI);
      trueFreq[k]      = (TWO_PI * k) / PV_FRAME + delta / PV_HOP;
      lastPhase[k]     = phase;
    }

    // 4. Pitch-shift: remap bins by pitchFactor
    //    Output bin k reads from source bin k/pitchFactor (linear interpolation)
    const outRe = new Float64Array(PV_FRAME);
    const outIm = new Float64Array(PV_FRAME);
    for (let k = 0; k < PV_FRAME / 2; k++) {
      const srcBin = k / pitchFactor;
      const srcLo  = Math.floor(srcBin);
      const frac   = srcBin - srcLo;
      if (srcLo < 0 || srcLo >= PV_FRAME / 2 - 1) continue;

      // Interpolated magnitude
      const m  = mag[srcLo]! * (1 - frac) + mag[srcLo + 1]! * frac;
      // Interpolated true frequency, scaled to output bin's frequency range
      const tf = (trueFreq[srcLo]! * (1 - frac) + trueFreq[srcLo + 1]! * frac) * pitchFactor;

      // Accumulate synthesis phase
      synthPhase[k] = synthPhase[k]! + tf * PV_HOP;

      // Reconstruct complex coefficient
      outRe[k] = m * Math.cos(synthPhase[k]!);
      outIm[k] = m * Math.sin(synthPhase[k]!);

      // Mirror for real output (conjugate symmetry)
      if (k > 0 && PV_FRAME - k < PV_FRAME) {
        outRe[PV_FRAME - k] = outRe[k]!;
        outIm[PV_FRAME - k] = -outIm[k]!;
      }
    }

    // 5. IFFT
    ifft(outRe, outIm);

    // 6. Overlap-add (windowed synthesis)
    const outOff = frame * PV_HOP;
    for (let i = 0; i < PV_FRAME; i++) {
      output[outOff + i]   = output[outOff + i]! + outRe[i]! * _hann[i]!;
      normAcc[outOff + i]  = normAcc[outOff + i]! + _hann[i]! * _hann[i]!;
    }
  }

  // 7. Normalize by sum-of-squared-windows to reconstruct amplitude
  const result = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = normAcc[i]! > 1e-8 ? (output[i]! / normAcc[i]!) : 0;
  }
  return result;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Pitch-shift an AudioBuffer by `semitones` half-steps, preserving tempo.
 * Uses a Phase Vocoder (better than WSOLA for melodic/harmonic content).
 *
 * @param buffer    Source AudioBuffer
 * @param semitones Pitch offset in semitones (integer recommended, ±24 max)
 * @returns New AudioBuffer with shifted pitch, same approximate duration
 */
export async function phaseVocoderShift(
  buffer: AudioBuffer,
  semitones: number,
): Promise<AudioBuffer> {
  if (Math.abs(semitones) < 0.01) return buffer;

  const pitchFactor = Math.pow(2, semitones / 12);
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const { sampleRate, length } = buffer;

  // Process each channel (synchronous, CPU-bound — runs on main thread)
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(pvShiftChannel(buffer.getChannelData(c), pitchFactor));
  }

  // Wrap in AudioBuffer via OfflineAudioContext
  const offCtx = new OfflineAudioContext(numChannels, length, sampleRate);
  const out    = offCtx.createBuffer(numChannels, length, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    out.copyToChannel(channels[c]! as Float32Array<ArrayBuffer>, c);
  }
  return out;
}
