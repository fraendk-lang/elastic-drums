/**
 * Stems Export — Render each drum track as an individual WAV file
 * Uses OfflineAudioContext to render each track in isolation.
 */

interface StepData {
  active: boolean;
  velocity: number;
  ratchetCount?: number;
  microTiming?: number;
  probability?: number;
  condition?: string;
  paramLocks: Record<string, number>;
}

interface TrackData {
  steps: StepData[];
  mute: boolean;
  length: number;
}

interface PatternData {
  tracks: TrackData[];
  length: number;
  swing: number;
}

interface StemsExportOptions {
  pattern: PatternData;
  bpm: number;
  cycles: number;
  onProgress?: (track: number, total: number) => void;
}

const VOICE_NAMES = [
  "kick", "snare", "clap", "tom-lo", "tom-mid", "tom-hi",
  "hh-closed", "hh-open", "cymbal", "ride", "perc1", "perc2",
];

export async function exportStems(opts: StemsExportOptions): Promise<void> {
  const { pattern, bpm, cycles, onProgress } = opts;
  const secondsPerStep = 60 / bpm / 4;
  const totalSteps = pattern.length * cycles;
  const duration = totalSteps * secondsPerStep + 2; // +2s for tails
  const sampleRate = 44100;

  const activeTrackIndices = pattern.tracks
    .map((t, i) => (!t.mute && t.steps.some((s) => s.active) ? i : -1))
    .filter((i) => i >= 0);

  for (let ti = 0; ti < activeTrackIndices.length; ti++) {
    const trackIdx = activeTrackIndices[ti]!;
    onProgress?.(ti + 1, activeTrackIndices.length);

    const offline = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);
    const trackData = pattern.tracks[trackIdx]!;

    // Schedule all steps for this track
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let step = 0; step < pattern.length; step++) {
        const absStep = step % trackData.length;
        const s = trackData.steps[absStep];
        if (!s?.active) continue;

        const globalStep = cycle * pattern.length + step;
        const swingRatio = (pattern.swing - 50) / 100;
        let stepTime = globalStep * secondsPerStep;
        if (swingRatio > 0 && globalStep % 2 === 1) {
          stepTime += secondsPerStep * swingRatio;
        }

        const vel = s.velocity / 127;
        // Use the real audio engine's synthesis (through OfflineAudioContext)
        // For now, create a basic trigger — full engine integration requires refactoring
        triggerOfflineVoice(offline, trackIdx, vel, stepTime, s.paramLocks);
      }
    }

    const rendered = await offline.startRendering();
    const wav = encodeWav(rendered);
    downloadBlob(wav, `${VOICE_NAMES[trackIdx] ?? `track-${trackIdx}`}.wav`);
  }
}

function triggerOfflineVoice(
  ctx: OfflineAudioContext,
  _voice: number,
  velocity: number,
  time: number,
  _paramLocks: Record<string, number>,
): void {
  // Simplified trigger — in a full implementation this would use the AudioEngine's synthesis
  // For now, generate a click to indicate stem positions (placeholder for full synthesis)
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(velocity * 0.5, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.15);
}

function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Interleave channels
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
