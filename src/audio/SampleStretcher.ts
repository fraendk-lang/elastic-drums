/**
 * SampleStretcher — Real time-stretching of AudioBuffers without pitch change.
 *
 * Uses SoundTouch.js (Olli Parviainen's WSOLA-based algorithm, JS port).
 * Pre-renders a stretched buffer offline so the audio thread can play it
 * back at playbackRate=1 without real-time DSP cost.
 *
 * Quality:
 *   - Drum loops at ±20% stretch: clean, transients preserved
 *   - Melodic at ±30% stretch: audible smearing on long sustained notes
 *   - Anything > 50% stretch: heavy artifacts (use re-pitch instead)
 */

import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs";
import type { WarpMarker } from "./SampleManager";

const CHUNK = 4096;
const CROSSFADE_SAMPLES = 32; // ~0.7ms at 44.1kHz — soften segment seams

/**
 * Time-stretch an AudioBuffer by `ratio` without changing pitch.
 * @param input  Source buffer
 * @param ratio  Tempo factor: ratio > 1 = output is shorter (faster), < 1 = longer (slower).
 *               If ratio = 1, returns the input unchanged.
 * @param ctx    AudioContext used to allocate the output buffer
 */
export function stretchBuffer(
  input: AudioBuffer,
  ratio: number,
  ctx: BaseAudioContext,
): AudioBuffer {
  // Skip if effectively no stretch
  if (Math.abs(ratio - 1) < 0.001) return input;

  const source = new WebAudioBufferSource(input);
  const st = new SoundTouch();
  st.tempo = ratio;          // <1 = stretch (slower), >1 = compress (faster)
  st.pitch = 1.0;             // pitch stays constant — that's the whole point
  // Quality: SoundTouch picks reasonable defaults; tweaks here can hurt drums
  // (long sequence/seekwindow blurs transients).

  const filter = new SimpleFilter(source, st);

  // Output length: input duration / ratio (e.g., ratio 1.1 = 10% shorter output)
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const outBuffer = ctx.createBuffer(input.numberOfChannels, outLen, input.sampleRate);

  // SoundTouch.js extract() always returns interleaved stereo (L,R,L,R,...).
  const tempInterleaved = new Float32Array(CHUNK * 2);
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < outBuffer.numberOfChannels; ch++) {
    channelData.push(outBuffer.getChannelData(ch));
  }

  let written = 0;
  while (written < outLen) {
    const want = Math.min(CHUNK, outLen - written);
    const got = filter.extract(tempInterleaved, want);
    if (got === 0) break; // EOF

    // De-interleave into the output channels
    if (outBuffer.numberOfChannels === 1) {
      const out = channelData[0]!;
      for (let i = 0; i < got; i++) {
        // Mono input → mix L+R back to mono (or just take L since source duplicates it)
        out[written + i] = tempInterleaved[i * 2] ?? 0;
      }
    } else {
      const outL = channelData[0]!;
      const outR = channelData[1]!;
      for (let i = 0; i < got; i++) {
        outL[written + i] = tempInterleaved[i * 2] ?? 0;
        outR[written + i] = tempInterleaved[i * 2 + 1] ?? 0;
      }
    }
    written += got;
  }

  return outBuffer;
}

// ─── Segmented stretch (multi-warp-marker) ────────────────────────────────

/**
 * Slice a source buffer between two sample positions into a new AudioBuffer.
 */
function sliceBuffer(input: AudioBuffer, startSample: number, endSample: number, ctx: BaseAudioContext): AudioBuffer {
  const len = Math.max(1, endSample - startSample);
  const out = ctx.createBuffer(input.numberOfChannels, len, input.sampleRate);
  for (let ch = 0; ch < input.numberOfChannels; ch++) {
    const src = input.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      dst[i] = src[startSample + i] ?? 0;
    }
  }
  return out;
}

/**
 * Copy a stretched segment into the output buffer at writeOffset, with a
 * short equal-power crossfade against any audio already present at the seam.
 */
function blitSegment(out: AudioBuffer, segment: AudioBuffer, writeOffset: number): void {
  const channels = out.numberOfChannels;
  const segLen = segment.length;
  const fade = Math.min(CROSSFADE_SAMPLES, segLen, writeOffset);

  for (let ch = 0; ch < channels; ch++) {
    const dst = out.getChannelData(ch);
    const src = segment.getChannelData(Math.min(ch, segment.numberOfChannels - 1));

    // Crossfade region: writeOffset-fade .. writeOffset
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      const eqOld = Math.cos(t * Math.PI * 0.5);
      const eqNew = Math.sin(t * Math.PI * 0.5);
      const idx = writeOffset - fade + i;
      if (idx >= 0 && idx < dst.length) {
        dst[idx] = (dst[idx] ?? 0) * eqOld + (src[i] ?? 0) * eqNew;
      }
    }

    // Main copy after crossfade region
    for (let i = fade; i < segLen; i++) {
      const idx = writeOffset + i - fade;
      if (idx < dst.length) dst[idx] = src[i] ?? 0;
    }
  }
}

/**
 * Time-stretch a source buffer using multiple warp markers. Each adjacent
 * marker pair defines a segment that is stretched independently to align
 * the source position to its target beat in the project timeline.
 *
 * @param input        Source buffer
 * @param markers      Warp markers, sorted ascending by bufferTime
 * @param projectBpm   Target project tempo in BPM
 * @param ctx          AudioContext for buffer allocation
 */
export function stretchSegmented(
  input: AudioBuffer,
  markers: WarpMarker[],
  projectBpm: number,
  ctx: BaseAudioContext,
): AudioBuffer {
  if (markers.length < 2 || projectBpm <= 0) return input;

  const sorted = [...markers].sort((a, b) => a.bufferTime - b.bufferTime);
  const totalBeats = sorted[sorted.length - 1]!.beat - sorted[0]!.beat;
  if (totalBeats <= 0) return input;

  const secondsPerBeat = 60 / projectBpm;
  const totalDuration = totalBeats * secondsPerBeat;
  const outLen = Math.max(1, Math.floor(totalDuration * input.sampleRate));
  const outBuffer = ctx.createBuffer(input.numberOfChannels, outLen, input.sampleRate);

  let writeOffset = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const m1 = sorted[i]!;
    const m2 = sorted[i + 1]!;

    const sourceStart = Math.max(0, Math.floor(m1.bufferTime * input.sampleRate));
    const sourceEnd = Math.min(input.length, Math.ceil(m2.bufferTime * input.sampleRate));
    if (sourceEnd <= sourceStart) continue;

    const sourceDuration = (sourceEnd - sourceStart) / input.sampleRate;
    const targetBeats = m2.beat - m1.beat;
    if (targetBeats <= 0) continue;
    const targetDuration = targetBeats * secondsPerBeat;
    const ratio = sourceDuration / targetDuration;

    // Extract source slice
    const slice = sliceBuffer(input, sourceStart, sourceEnd, ctx);

    // Stretch (or copy directly if ratio ≈ 1)
    const stretched = Math.abs(ratio - 1) < 0.005 ? slice : stretchBuffer(slice, ratio, ctx);

    // Blit into output with crossfade at the seam
    blitSegment(outBuffer, stretched, writeOffset);
    writeOffset += stretched.length;
    if (i > 0) writeOffset -= Math.min(CROSSFADE_SAMPLES, stretched.length);
  }

  return outBuffer;
}
