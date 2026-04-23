/**
 * Auto-Record Export
 *
 * Records the live audio output for a precise number of bars, then
 * downloads as high-quality WAV. Optionally sends the WAV to the
 * Railway MP3 server and downloads as MP3.
 *
 * Why live recording instead of OfflineAudioContext?
 *   The running AudioEngine has loaded sample buffers, VA synthesis
 *   chains, FX, and the mixer all wired together. Replicating that
 *   in an offline context would require a full engine refactor.
 *   MediaRecorder captures the real mix at zero extra cost.
 *
 * Flow:
 *   1. Start transport if it was stopped (restored at end)
 *   2. Tap "createRecordingStream()" to get a MediaStream from master output
 *   3. MediaRecorder captures chunks while playing
 *   4. After N bars + short tail: stop, decode WebM → WAV, download
 *   5. Optional: POST WAV to Railway /mp3 → download MP3
 */

import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "../store/drumStore";

// ─── Types ────────────────────────────────────────────────

export type RecordExportState =
  | "idle"
  | "starting"    // Waiting for transport + quantise
  | "recording"   // MediaRecorder is running
  | "encoding"    // WebM → WAV conversion
  | "uploading"   // Sending WAV to Railway (MP3 mode only)
  | "done"
  | "error";

export interface RecordExportProgress {
  state:       RecordExportState;
  barsDone:    number;   // 0 … barsTotal
  barsTotal:   number;
  elapsedSec:  number;
  totalSec:    number;
  errorMsg?:   string;
}

export type ProgressCallback = (p: RecordExportProgress) => void;

// ─── Cancellation token ───────────────────────────────────

let _cancelFlag = false;
let _recorder: MediaRecorder | null = null;

export function cancelAutoRecord(): void {
  _cancelFlag = true;
  if (_recorder && _recorder.state !== "inactive") {
    try { _recorder.stop(); } catch { /* ok */ }
  }
}

// ─── Main entry point ─────────────────────────────────────

interface AutoRecordOptions {
  bars:        number;        // Number of bars to record (default: 4)
  tail:        number;        // Extra seconds after N bars (default: 0.5)
  mp3ServerUrl?: string;      // If set, POST WAV to Railway → download MP3
  filename?:   string;        // Override filename (without extension)
  onProgress?: ProgressCallback;
}

export async function autoRecordExport(opts: AutoRecordOptions): Promise<void> {
  const {
    bars        = 4,
    tail        = 0.5,
    mp3ServerUrl,
    onProgress,
  } = opts;

  _cancelFlag = false;
  const filename = opts.filename ?? `elastic-groove-${bars}bars`;

  const report = (state: RecordExportState, extra?: Partial<RecordExportProgress>) => {
    onProgress?.({ state, barsDone: 0, barsTotal: bars, elapsedSec: 0, totalSec: 0, ...extra });
  };

  report("starting");

  // ── 1. Ensure transport is running ──────────────────────
  const drumStore      = useDrumStore.getState();
  const wasPlaying     = drumStore.isPlaying;
  const bpm            = drumStore.bpm;
  const secondsPerBar  = (60 / bpm) * 4;
  const totalSec       = bars * secondsPerBar + tail;

  if (!wasPlaying) {
    useDrumStore.getState().togglePlay();
    // Brief pause so first step fires cleanly
    await _sleep(80);
  }

  if (_cancelFlag) { _cleanup(wasPlaying); report("idle"); return; }

  // ── 2. Create MediaRecorder ─────────────────────────────
  const dest = audioEngine.createRecordingStream();
  if (!dest) {
    report("error", { errorMsg: "AudioContext not initialised — press PLAY first." });
    _cleanup(wasPlaying);
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=pcm")
    ? "audio/webm;codecs=pcm"
    : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

  const chunks: Blob[] = [];
  _recorder = new MediaRecorder(dest.stream, {
    mimeType,
    audioBitsPerSecond: 320_000,
  });
  _recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  _recorder.start(100);

  // ── 3. Record for N bars ────────────────────────────────
  report("recording", { barsTotal: bars, totalSec });

  const startMs = performance.now();
  const updateInterval = setInterval(() => {
    if (_cancelFlag) return;
    const elapsedSec = (performance.now() - startMs) / 1000;
    const barsDone   = Math.min(bars, elapsedSec / secondsPerBar);
    onProgress?.({
      state: "recording",
      barsDone,
      barsTotal: bars,
      elapsedSec,
      totalSec,
    });
  }, 200);

  await _sleep(totalSec * 1000);
  clearInterval(updateInterval);

  // ── 4. Stop recorder ────────────────────────────────────
  const rawBlob = await new Promise<Blob>((resolve) => {
    _recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    try { _recorder!.stop(); } catch { resolve(new Blob(chunks, { type: mimeType })); }
  });
  audioEngine.disconnectRecordingStream(dest);
  _recorder = null;

  if (_cancelFlag) { _cleanup(wasPlaying); report("idle"); return; }

  // ── 5. Decode + encode as WAV ───────────────────────────
  report("encoding", { barsDone: bars, barsTotal: bars, elapsedSec: totalSec, totalSec });

  let wavBlob: Blob;
  try {
    const ctx = audioEngine.getAudioContext() ?? new AudioContext({ sampleRate: 44100 });
    const arrayBuf  = await rawBlob.arrayBuffer();
    const audioBuf  = await ctx.decodeAudioData(arrayBuf);
    const wavBuf    = _encodeWav(audioBuf);
    wavBlob         = new Blob([wavBuf], { type: "audio/wav" });
  } catch (err) {
    console.error("[autoRecordExport] WAV encode failed:", err);
    // Fall back to raw WebM
    wavBlob = rawBlob;
  }

  // ── 6a. WAV download ────────────────────────────────────
  if (!mp3ServerUrl) {
    const ext = wavBlob.type.includes("wav") ? "wav" : "webm";
    _downloadBlob(wavBlob, `${filename}.${ext}`);
    _cleanup(wasPlaying);
    report("done", { barsDone: bars, barsTotal: bars, elapsedSec: totalSec, totalSec });
    return;
  }

  // ── 6b. MP3 via Railway ─────────────────────────────────
  report("uploading", { barsDone: bars, barsTotal: bars, elapsedSec: totalSec, totalSec });

  try {
    const server = mp3ServerUrl.replace(/\/$/, "");
    const response = await fetch(`${server}/mp3`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wavBlob,
    });

    if (!response.ok) {
      const msg = await response.text().catch(() => response.statusText);
      throw new Error(`Server ${response.status}: ${msg}`);
    }

    const mp3Blob = await response.blob();
    _downloadBlob(mp3Blob, `${filename}.mp3`);
    report("done", { barsDone: bars, barsTotal: bars, elapsedSec: totalSec, totalSec });
  } catch (err) {
    console.error("[autoRecordExport] MP3 upload failed:", err);
    // Offer WAV as fallback
    _downloadBlob(wavBlob, `${filename}.wav`);
    report("error", {
      errorMsg: `MP3 server error — downloaded WAV instead. (${err instanceof Error ? err.message : String(err)})`,
    });
  }

  _cleanup(wasPlaying);
}

// ─── Helpers ──────────────────────────────────────────────

function _cleanup(restorePlay: boolean): void {
  if (!restorePlay && useDrumStore.getState().isPlaying) {
    useDrumStore.getState().togglePlay();
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 16-bit PCM WAV encoder
function _encodeWav(buf: AudioBuffer): ArrayBuffer {
  const numCh = buf.numberOfChannels;
  const sr    = buf.sampleRate;
  const len   = buf.length;
  const bps   = 2; // bytes per sample (16-bit)
  const data  = len * numCh * bps;
  const total = 44 + data;
  const view  = new DataView(new ArrayBuffer(total));

  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  w(0, "RIFF"); view.setUint32(4, total - 8, true);
  w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * bps, true);
  view.setUint16(32, numCh * bps, true);
  view.setUint16(34, 16, true);
  w(36, "data"); view.setUint32(40, data, true);

  const channels = Array.from({ length: numCh }, (_, ch) => buf.getChannelData(ch));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch]![i]!));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  return view.buffer;
}
