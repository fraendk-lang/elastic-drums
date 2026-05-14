/**
 * Resampling — capture the live master output to an AudioBuffer and drop
 * it on a pad slot, MPC / Maschine-style "bounce".
 *
 * Reuses `audioEngine.createRecordingStream()` (the same MediaStream-tap
 * used by autoRecordExport) and decodes the resulting WebM blob back to
 * an AudioBuffer in-memory — no file download, no user prompt.
 *
 * The recording is bar-aligned to the drum scheduler so the loop starts on
 * a downbeat and the resulting sample loops cleanly when played from the pad.
 * If transport is stopped, it starts transport, captures, then restores
 * the original playing state.
 */

import { audioEngine } from "../audio/AudioEngine";
import { sampleManager } from "../audio/SampleManager";
import { useDrumStore, getDrumTransportStartTime } from "../store/drumStore";

export interface ResampleOptions {
  bars: number;           // How many bars to record (1, 2, 4 typical)
  voiceIndex: number;     // 0-11 — pad slot to drop the sample on
  name?: string;          // Display name; defaults to "Resample Nbar"
  tailSec?: number;       // Extra seconds after N bars for reverb/delay tails
  onProgress?: (state: "starting" | "recording" | "encoding" | "done", barsDone: number) => void;
}

export async function resampleToPad(opts: ResampleOptions): Promise<void> {
  const { bars, voiceIndex, tailSec = 0.5, onProgress } = opts;
  const name = opts.name ?? `Resample ${bars}bar`;

  await audioEngine.resume();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) throw new Error("AudioContext not initialised");

  const drum = useDrumStore.getState();
  const bpm = drum.bpm;
  const secPerBar = (60 / bpm) * 4;
  const wasPlaying = drum.isPlaying;

  // ── 1. Start transport if it wasn't running, and wait one bar
  //      so the AUDIO is settled before we begin capture (avoids
  //      catching transient noise from the play-start click).
  onProgress?.("starting", 0);
  if (!wasPlaying) {
    drum.togglePlay();
    await waitForNextBar(ctx, secPerBar);
  } else {
    await waitForNextBar(ctx, secPerBar);
  }

  // ── 2. Set up MediaRecorder on the master tap
  const dest = audioEngine.createRecordingStream();
  if (!dest) throw new Error("Failed to tap master output");

  // Pick the best available codec — Safari is fussy.
  const mimeCandidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
  const recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 192_000 } : { audioBitsPerSecond: 192_000 });
  const chunks: BlobPart[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });

  // ── 3. Record
  const stopPromise = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve());
  });
  recorder.start();
  onProgress?.("recording", 0);

  // Progress ping per bar
  const startCtx = ctx.currentTime;
  const totalDuration = bars * secPerBar + tailSec;
  const progressTicker = window.setInterval(() => {
    const elapsed = ctx.currentTime - startCtx;
    const barsDone = Math.min(bars, Math.floor(elapsed / secPerBar));
    onProgress?.("recording", barsDone);
    if (elapsed >= totalDuration) window.clearInterval(progressTicker);
  }, 200);

  await waitSec(ctx, totalDuration);
  recorder.stop();
  window.clearInterval(progressTicker);
  await stopPromise;
  audioEngine.disconnectRecordingStream(dest);

  // Restore transport state
  if (!wasPlaying && useDrumStore.getState().isPlaying) {
    useDrumStore.getState().togglePlay();
  }

  // ── 4. Decode → AudioBuffer → assign to pad
  onProgress?.("encoding", bars);
  const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
  const arrayBuf = await blob.arrayBuffer();
  // decodeAudioData mutates the input buffer in some browsers → slice for safety
  const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));

  // Trim leading silence from MediaRecorder priming (rough — first ~30ms)
  const trimmed = trimLeadingSilence(ctx, audioBuffer, 0.0008, 0.05);
  sampleManager.decodeAndSet(voiceIndex, trimmed, name);

  onProgress?.("done", bars);
}

// ─── Helpers ────────────────────────────────────────────────────

/** Wait until the AudioContext clock crosses the next bar boundary. */
function waitForNextBar(ctx: AudioContext, secPerBar: number): Promise<void> {
  const transportStart = getDrumTransportStartTime();
  const elapsed = ctx.currentTime - transportStart;
  const remainder = secPerBar - (elapsed % secPerBar);
  // If we're already very close to the bar (< 30ms), wait for the FOLLOWING
  // bar so the recording has a clean head.
  const wait = remainder < 0.03 ? remainder + secPerBar : remainder;
  return waitSec(ctx, wait);
}

/** Promise that resolves after `secs` of AudioContext time. */
function waitSec(ctx: AudioContext, secs: number): Promise<void> {
  const start = ctx.currentTime;
  return new Promise((resolve) => {
    const check = () => {
      if (ctx.currentTime - start >= secs) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Trim near-silence from the start of the buffer. MediaRecorder emits its
 * first packet ~10-30ms after .start() and the very first frames can be
 * silent or contain encoder-warmup artefacts. Walk forward until we hit a
 * sample louder than `threshold`, but never trim more than `maxTrim` seconds
 * (safety against trimming real attack).
 */
function trimLeadingSilence(ctx: AudioContext, buffer: AudioBuffer, threshold: number, maxTrim: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const maxTrimSamples = Math.floor(maxTrim * sr);
  const data0 = buffer.getChannelData(0);
  let startSample = 0;
  for (let i = 0; i < Math.min(data0.length, maxTrimSamples); i++) {
    if (Math.abs(data0[i]!) > threshold) { startSample = i; break; }
  }
  if (startSample <= 0) return buffer;
  const newLen = buffer.length - startSample;
  const out = ctx.createBuffer(buffer.numberOfChannels, newLen, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch).subarray(startSample);
    out.copyToChannel(src, ch);
  }
  return out;
}
