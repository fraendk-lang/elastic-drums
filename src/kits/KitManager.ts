/**
 * Kit Manager
 *
 * A Kit = complete voice parameter setup for all 12 voices + optional starter pattern.
 * Each kit creates a distinct sonic character by adjusting the VA synth parameters.
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

export interface DrumKit {
  id: string;
  name: string;
  category: string;
  tags: string[];
  author: string;
  bpmRange: [number, number];
  voices: Record<number, VoiceKitParams>;
  pattern?: {
    length: number;
    swing: number;
    tracks: Record<number, { steps: number[]; vel?: number[] }>;
  };
}

// Apply a kit to the audio engine
export function applyKit(kit: DrumKit): void {
  for (const [voiceStr, params] of Object.entries(kit.voices)) {
    const voice = Number(voiceStr);
    for (const [paramId, value] of Object.entries(params)) {
      if (value !== undefined) {
        audioEngine.setVoiceParam(voice, paramId, value);
      }
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
      if (info.vel?.[i] !== undefined) {
        step.velocity = info.vel[i]!;
      }
    }
  }

  return {
    name: kit.name,
    tracks,
    length: kit.pattern.length,
    swing: kit.pattern.swing,
  };
}
