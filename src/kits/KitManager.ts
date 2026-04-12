/**
 * Kit Manager — Enhanced with FX, Pan, Sends
 */

import { audioEngine } from "../audio/AudioEngine";
import type { PatternData } from "../store/drumStore";

export interface VoiceKitParams {
  tune?: number;
  decay?: number;
  click?: number;
  drive?: number;
  sub?: number;
  pitch?: number;
  tone?: number;
  snap?: number;
  body?: number;
  level?: number;
  spread?: number;
}

export interface VoiceMixParams {
  pan?: number;        // -1..1
  reverbSend?: number; // 0..1
  delaySend?: number;  // 0..1
  filterType?: BiquadFilterType; // "allpass", "lowpass", "highpass", "bandpass"
  filterFreq?: number; // Hz
  insertDrive?: number; // 0..1
}

export interface DrumKit {
  id: string;
  name: string;
  category: string;
  tags: string[];
  author: string;
  bpmRange: [number, number];
  description?: string;
  voices: Record<number, VoiceKitParams>;
  mix?: Record<number, VoiceMixParams>;
  masterFx?: {
    reverbLevel?: number;   // 0..1
    delayTime?: number;     // ms
    delayFeedback?: number; // 0..1
    delayLevel?: number;    // 0..1
    saturation?: number;    // 0..1
    eqLow?: number;         // dB
    eqMid?: number;
    eqHigh?: number;
  };
  pattern?: {
    length: number;
    swing: number;
    tracks: Record<number, {
      steps: number[];
      vel?: number[];
      ratchets?: Record<number, number>; // stepIdx → ratchetCount
    }>;
  };
}

// Apply a kit to the audio engine
export function applyKit(kit: DrumKit): void {
  // Voice params
  for (const [voiceStr, params] of Object.entries(kit.voices)) {
    const voice = Number(voiceStr);
    for (const [paramId, value] of Object.entries(params)) {
      if (value !== undefined) {
        audioEngine.setVoiceParam(voice, paramId, value);
      }
    }
  }

  // Mix params (pan, sends, insert FX)
  if (kit.mix) {
    for (const [voiceStr, mix] of Object.entries(kit.mix)) {
      const voice = Number(voiceStr);
      if (mix.pan !== undefined) audioEngine.setChannelPan(voice, mix.pan);
      if (mix.reverbSend !== undefined) audioEngine.setChannelReverbSend(voice, mix.reverbSend);
      if (mix.delaySend !== undefined) audioEngine.setChannelDelaySend(voice, mix.delaySend);
      if (mix.filterType && mix.filterFreq) {
        audioEngine.setChannelFilter(voice, mix.filterType, mix.filterFreq, 2);
      } else {
        audioEngine.bypassChannelFilter(voice);
      }
      if (mix.insertDrive !== undefined) {
        audioEngine.setChannelDrive(voice, mix.insertDrive);
      }
    }
  }

  // Master FX
  if (kit.masterFx) {
    const fx = kit.masterFx;
    if (fx.reverbLevel !== undefined) audioEngine.setReverbLevel(fx.reverbLevel);
    if (fx.delayTime !== undefined || fx.delayFeedback !== undefined) {
      audioEngine.setDelayParams(
        (fx.delayTime ?? 375) / 1000,
        fx.delayFeedback ?? 0.4,
        4000,
      );
    }
    if (fx.delayLevel !== undefined) audioEngine.setDelayLevel(fx.delayLevel);
    if (fx.saturation !== undefined) audioEngine.setMasterSaturation(fx.saturation);
    if (fx.eqLow !== undefined || fx.eqMid !== undefined || fx.eqHigh !== undefined) {
      audioEngine.setMasterEQ(fx.eqLow ?? 0, fx.eqMid ?? 0, fx.eqHigh ?? 0);
    }
  }
}

// Convert kit pattern to PatternData
export function kitToPattern(kit: DrumKit): PatternData | null {
  if (!kit.pattern) return null;

  const tracks = Array.from({ length: 12 }, () => ({
    steps: Array.from({ length: 64 }, () => ({
      active: false, velocity: 100, microTiming: 0, probability: 100,
      ratchetCount: 1, condition: "always" as const, paramLocks: {},
    })),
    mute: false, solo: false, volume: 100, pan: 0, length: kit.pattern!.length,
  }));

  for (const [trackStr, info] of Object.entries(kit.pattern.tracks)) {
    const t = Number(trackStr);
    const track = tracks[t]!;
    track.length = kit.pattern.length;
    for (let i = 0; i < info.steps.length; i++) {
      const stepIdx = info.steps[i]!;
      const step = track.steps[stepIdx]!;
      step.active = true;
      if (info.vel?.[i] !== undefined) step.velocity = info.vel[i]!;
      if (info.ratchets?.[stepIdx] !== undefined) step.ratchetCount = info.ratchets[stepIdx]!;
    }
  }

  return {
    name: kit.name,
    tracks,
    length: kit.pattern.length,
    swing: kit.pattern.swing,
  };
}
