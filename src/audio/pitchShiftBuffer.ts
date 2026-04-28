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

  const st          = new SoundTouch();
  st.pitchSemitones = semitones;
  // tempo stays 1.0 (default) — WSOLA handles time-stretch internally

  const src    = new WebAudioBufferSource(buffer);
  const filter = new SimpleFilter(src, st);

  // SoundTouch WSOLA needs several chunks to prime its internal analysis
  // windows before it starts producing output. Allow up to 8 consecutive
  // zero-frame returns before treating the stream as exhausted.
  const maxFrames      = length + CHUNK_SIZE * 8;
  const interleaved    = new Float32Array(maxFrames * 2);
  let   totalFrames    = 0;
  let   consecutiveZeros = 0;
  const chunk          = new Float32Array(CHUNK_SIZE * 2);

  while (totalFrames < maxFrames) {
    chunk.fill(0);
    const frames = filter.extract(chunk, CHUNK_SIZE);
    if (frames === 0) {
      if (++consecutiveZeros > 8) break; // stream truly exhausted
      continue;                          // let WSOLA keep priming
    }
    consecutiveZeros = 0;
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
 *
 * bpmRatio: globalBpm / originalBpm — the same ratio applied as playbackRate.
 * In beats/complex modes the engine time-stretches by setting playbackRate=bpmRatio,
 * which also shifts pitch by log2(bpmRatio)*12 semitones. We pre-cancel that here
 * so the perceived pitch stays at `semitones` regardless of tempo.
 */
export async function pitchShiftBuffer(
  buffer: AudioBuffer,
  semitones: number,
  mode: WarpMode = "beats",
  bpmRatio = 1,   // compensate playbackRate pitch shift in beats/complex mode
): Promise<AudioBuffer> {
  if (mode === "repitch") return buffer; // RE-PITCH: handled by playbackRate

  // Pre-cancel the pitch shift introduced by playbackRate = bpmRatio
  const compSemitones = semitones - (bpmRatio > 0 && bpmRatio !== 1 ? Math.log2(bpmRatio) * 12 : 0);
  if (Math.abs(compSemitones) < 0.01) return buffer;

  return mode === "complex"
    ? phaseVocoderShift(buffer, compSemitones)
    : soundTouchShift(buffer, compSemitones);
}
