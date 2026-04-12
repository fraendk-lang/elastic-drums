/**
 * Audio Export — Bounce pattern to WAV file
 *
 * Uses OfflineAudioContext to render the pattern offline,
 * then encodes as WAV and downloads.
 */

import type { PatternData } from "../store/drumStore";

export async function exportPatternAsWav(
  pattern: PatternData,
  bpm: number,
  loops = 1,
): Promise<void> {
  const sampleRate = 44100;
  const secondsPerStep = 60 / bpm / 4; // 16th notes
  const totalSteps = pattern.length * loops;
  const totalSeconds = totalSteps * secondsPerStep + 2; // +2s for tails (reverb/delay)
  const totalSamples = Math.ceil(sampleRate * totalSeconds);

  // Create offline context
  const offline = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Schedule all events
  for (let loop = 0; loop < loops; loop++) {
    for (let step = 0; step < pattern.length; step++) {
      const time = (loop * pattern.length + step) * secondsPerStep;

      for (let track = 0; track < 12; track++) {
        const trackData = pattern.tracks[track];
        if (!trackData || trackData.mute) continue;

        const s = trackData.steps[step];
        if (!s?.active) continue;

        const vel = s.velocity / 127;

        // Schedule voice trigger at exact time
        scheduleVoiceOffline(offline, track, vel, time);
      }
    }
  }

  // Render
  const renderedBuffer = await offline.startRendering();

  // Encode as WAV
  const wav = encodeWav(renderedBuffer);
  const blob = new Blob([wav], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);

  // Download
  const a = document.createElement("a");
  a.href = url;
  a.download = `${pattern.name.replace(/[^a-zA-Z0-9]/g, "_")}_${bpm}bpm.wav`;
  a.click();
  URL.revokeObjectURL(url);
}

// Simple voice scheduling for offline render
function scheduleVoiceOffline(ctx: OfflineAudioContext, voice: number, vel: number, time: number): void {
  // Simplified synthesis for offline render
  // Uses the same approach as AudioEngine but on the offline context

  const output = ctx.destination;

  switch (voice) {
    case 0: { // Kick
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(250, time);
      osc.frequency.exponentialRampToValueAtTime(50, time + 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.8, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
      osc.connect(g); g.connect(output);
      osc.start(time); osc.stop(time + 0.55);
      break;
    }
    case 1: { // Snare
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(250, time);
      osc.frequency.exponentialRampToValueAtTime(180, time + 0.01);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
      osc.connect(g); g.connect(output);
      osc.start(time); osc.stop(time + 0.25);

      // Noise
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.15), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = ctx.createBufferSource(); ns.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vel * 0.4, time);
      ng.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      ns.connect(ng); ng.connect(output);
      ns.start(time);
      break;
    }
    default: { // Generic percussion
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.1), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = ctx.createBufferSource(); ns.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.3, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
      const hpf = ctx.createBiquadFilter();
      hpf.type = "highpass";
      hpf.frequency.value = 2000 + voice * 500;
      ns.connect(hpf); hpf.connect(g); g.connect(output);
      ns.start(time);
      break;
    }
  }
}

// WAV encoder
function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = length * numChannels * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const wav = new ArrayBuffer(totalSize);
  const view = new DataView(wav);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels and convert to 16-bit
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

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
