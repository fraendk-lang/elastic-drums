/**
 * Song Export — Record the live audio output to WAV
 *
 * Uses MediaRecorder to capture the real audio output including
 * all synths, FX, mixer, and master processing. Records in real-time
 * for maximum quality and accuracy.
 */

import { audioEngine } from "../audio/AudioEngine";

export type ExportState = "idle" | "recording" | "processing";

export interface SongExportOptions {
  filename?: string;
  onStateChange?: (state: ExportState) => void;
  onProgress?: (seconds: number) => void;
}

let _recorder: MediaRecorder | null = null;
let _recordingDest: MediaStreamAudioDestinationNode | null = null;
let _chunks: Blob[] = [];
let _progressTimer: ReturnType<typeof setInterval> | null = null;
let _startTime = 0;

/** Start recording the audio output */
export function startSongRecording(opts?: SongExportOptions): boolean {
  if (_recorder) return false; // Already recording

  const dest = audioEngine.createRecordingStream();
  if (!dest) return false;

  _recordingDest = dest;
  _chunks = [];
  _startTime = performance.now();

  // Use high-quality audio codec
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=pcm")
    ? "audio/webm;codecs=pcm"
    : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

  _recorder = new MediaRecorder(dest.stream, {
    mimeType,
    audioBitsPerSecond: 256000,
  });

  _recorder.ondataavailable = (e) => {
    if (e.data.size > 0) _chunks.push(e.data);
  };

  _recorder.start(100); // Collect data every 100ms
  opts?.onStateChange?.("recording");

  // Progress timer
  _progressTimer = setInterval(() => {
    const elapsed = (performance.now() - _startTime) / 1000;
    opts?.onProgress?.(elapsed);
  }, 250);

  return true;
}

/** Stop recording and download as WAV */
export async function stopSongRecording(opts?: SongExportOptions): Promise<void> {
  if (!_recorder || _recorder.state === "inactive") return;

  if (_progressTimer) {
    clearInterval(_progressTimer);
    _progressTimer = null;
  }

  opts?.onStateChange?.("processing");

  return new Promise<void>((resolve) => {
    _recorder!.onstop = async () => {
      // Convert recorded WebM to WAV
      const webmBlob = new Blob(_chunks, { type: _recorder!.mimeType });

      try {
        // Decode the recorded audio using AudioContext
        const arrayBuffer = await webmBlob.arrayBuffer();
        const ctx = audioEngine.getAudioContext() ?? new AudioContext();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Encode as high-quality WAV (16-bit PCM)
        const wav = encodeWav(audioBuffer);
        const wavBlob = new Blob([wav], { type: "audio/wav" });

        // Download
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        const duration = Math.round((performance.now() - _startTime) / 1000);
        a.download = opts?.filename ?? `elastic-drums-song-${duration}s.wav`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Fallback: download as WebM if WAV encoding fails
        const url = URL.createObjectURL(webmBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = opts?.filename?.replace(".wav", ".webm") ?? "elastic-drums-song.webm";
        a.click();
        URL.revokeObjectURL(url);
      }

      // Cleanup
      if (_recordingDest) {
        audioEngine.disconnectRecordingStream(_recordingDest);
        _recordingDest = null;
      }
      _recorder = null;
      _chunks = [];
      opts?.onStateChange?.("idle");
      resolve();
    };

    _recorder!.stop();
  });
}

/** Check if currently recording */
export function isRecording(): boolean {
  return _recorder !== null && _recorder.state === "recording";
}

/** Get elapsed recording time in seconds */
export function getRecordingTime(): number {
  if (!_recorder) return 0;
  return (performance.now() - _startTime) / 1000;
}

// ─── WAV Encoder (24-bit for higher quality) ─────────────

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = length * numChannels * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const wav = new ArrayBuffer(totalSize);
  const view = new DataView(wav);

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeStr(view, 8, "WAVE");

  // fmt chunk
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave and convert
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return wav;
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
