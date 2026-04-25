/**
 * pitchShiftBuffer — offline pitch shifting dispatcher
 *
 * Routes to the correct algorithm based on warp mode:
 *   'beats'   → SoundTouch WSOLA  (good for rhythmic/transient content)
 *   'complex' → Phase Vocoder     (good for melodic/sustained content)
 *
 * Both modes preserve tempo (duration ≈ unchanged).
 * BPM sync is applied separately via AudioBufferSourceNode.playbackRate.
 */

import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs";
import { phaseVocoderShift } from "./phaseVocoderShift";

export type WarpMode = "repitch" | "beats" | "complex";

const CHUNK_SIZE = 8192;

// ── SoundTouch WSOLA (beats mode) ────────────────────────────────────────

async function soundTouchShift(buffer: AudioBuffer, semitones: number): Promise<AudioBuffer> {
  const { sampleRate, length } = buffer;

  const st           = new SoundTouch(sampleRate);
  st.pitchSemiTones  = semitones;
  st.tempo           = 1.0;

  const src      = new WebAudioBufferSource(buffer);
  const filter   = new SimpleFilter(src, st);

  const maxFrames   = length + CHUNK_SIZE * 4;
  const interleaved = new Float32Array(maxFrames * 2);
  let   totalFrames = 0;

  while (totalFrames < maxFrames) {
    const chunk  = new Float32Array(CHUNK_SIZE * 2);
    const frames = filter.extract(chunk, CHUNK_SIZE);
    if (frames === 0) break;
    const needed = totalFrames * 2 + frames * 2;
    if (needed > interleaved.length) break;
    interleaved.set(chunk.subarray(0, frames * 2), totalFrames * 2);
    totalFrames += frames;
  }

  if (totalFrames === 0) return buffer;

  const numCh  = Math.min(buffer.numberOfChannels, 2);
  const offCtx = new OfflineAudioContext(numCh, totalFrames, sampleRate);
  const out    = offCtx.createBuffer(numCh, totalFrames, sampleRate);

  const L = out.getChannelData(0);
  const R = numCh > 1 ? out.getChannelData(1) : null;
  for (let i = 0; i < totalFrames; i++) {
    L[i] = interleaved[i * 2]     ?? 0;
    if (R) R[i] = interleaved[i * 2 + 1] ?? 0;
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Pitch-shift an AudioBuffer offline. Mode determines algorithm quality.
 * 'repitch' is never called here — RE-PITCH bypasses offline processing entirely.
 */
export async function pitchShiftBuffer(
  buffer: AudioBuffer,
  semitones: number,
  mode: WarpMode = "beats",
): Promise<AudioBuffer> {
  if (Math.abs(semitones) < 0.01) return buffer;
  if (mode === "repitch")         return buffer; // RE-PITCH: handled by playbackRate

  return mode === "complex"
    ? phaseVocoderShift(buffer, semitones)
    : soundTouchShift(buffer, semitones);
}
