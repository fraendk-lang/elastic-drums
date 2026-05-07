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

const CHUNK = 4096;

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
