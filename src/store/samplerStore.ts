/**
 * Sampler Store — 16-pad sampler sequencer with 25ms lookahead scheduler
 *
 * Matches the BassStore / ChordsStore scheduler pattern:
 *   - module-level setInterval at 25ms
 *   - double-buffer lookahead (0.1s ahead)
 *   - reads bpm + isPlaying from drumStore
 */

import { create } from "zustand";
import { samplerEngine, DEFAULT_PAD_PARAMS, type SamplerPadParams } from "../audio/SamplerEngine";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "./drumStore";

// ─── Types ────────────────────────────────────────────────

export interface SamplerPadState {
  buffer: AudioBuffer | null;
  fileName: string;
  duration: number;
  params: SamplerPadParams;
}

interface SamplerStore {
  pads: SamplerPadState[];
  selectedPad: number;
  steps: boolean[][];          // [16][32]
  velocities: number[][];      // [16][32] — 0–1
  patternLength: number;       // 8 | 16 | 32
  currentStep: number;

  setPadBuffer(index: number, buffer: AudioBuffer, fileName: string): void;
  setParam(index: number, param: Partial<SamplerPadParams>): void;
  selectPad(index: number): void;
  toggleStep(padIndex: number, stepIndex: number): void;
  setVelocity(padIndex: number, stepIndex: number, velocity: number): void;
  setPatternLength(length: number): void;
  clearPad(index: number): void;
}

// ─── Initial State Factories ──────────────────────────────

function createDefaultPad(): SamplerPadState {
  return {
    buffer: null,
    fileName: "",
    duration: 0,
    params: { ...DEFAULT_PAD_PARAMS },
  };
}

function createDefaultSteps(): boolean[][] {
  return Array.from({ length: 16 }, () => new Array(32).fill(false) as boolean[]);
}

function createDefaultVelocities(): number[][] {
  return Array.from({ length: 16 }, () => new Array(32).fill(0.8) as number[]);
}

// ─── Sampler Scheduler ────────────────────────────────────

let samplerTimer: ReturnType<typeof setInterval> | null = null;
let nextSamplerStepTime = 0;

export function startSamplerScheduler(): void {
  nextSamplerStepTime = audioEngine.currentTime + 0.05;
  if (samplerTimer !== null) clearInterval(samplerTimer);

  samplerTimer = setInterval(() => {
    const drumState = useDrumStore.getState();
    if (!drumState.isPlaying) return;

    const bpm = drumState.bpm;
    const secondsPerStep = 60.0 / bpm / 4; // 16th note steps

    while (nextSamplerStepTime < audioEngine.currentTime + 0.1) {
      const { pads, steps, velocities, currentStep, patternLength } = useSamplerStore.getState();
      const stepIndex = currentStep % patternLength;

      // Trigger all active pads on this step
      for (let padIdx = 0; padIdx < 16; padIdx++) {
        const padSteps = steps[padIdx];
        if (!padSteps) continue;
        const isOn = padSteps[stepIndex] ?? false;
        if (!isOn) continue;

        const pad = pads[padIdx];
        if (!pad?.buffer) continue;

        const velocity = velocities[padIdx]?.[stepIndex] ?? 0.8;

        samplerEngine.trigger(
          padIdx,
          pad.buffer,
          pad.params,
          velocity,
          nextSamplerStepTime,
        );

        // For gate mode: schedule release at end of step
        if (pad.params.playMode === "gate") {
          samplerEngine.releaseWithTime(
            padIdx,
            nextSamplerStepTime + secondsPerStep * 0.9,
            pad.params.release,
          );
        }
      }

      useSamplerStore.setState({ currentStep: (currentStep + 1) % patternLength });
      nextSamplerStepTime += secondsPerStep;
    }
  }, 25);
}

export function stopSamplerScheduler(): void {
  if (samplerTimer !== null) {
    clearInterval(samplerTimer);
    samplerTimer = null;
  }
  samplerEngine.stopAll();
  useSamplerStore.setState({ currentStep: 0 });
}

// ─── Store ────────────────────────────────────────────────

export const useSamplerStore = create<SamplerStore>((set) => ({
  pads: Array.from({ length: 16 }, createDefaultPad),
  selectedPad: 0,
  steps: createDefaultSteps(),
  velocities: createDefaultVelocities(),
  patternLength: 16,
  currentStep: 0,

  setPadBuffer: (index, buffer, fileName) =>
    set((s) => {
      const pads = [...s.pads];
      pads[index] = {
        ...pads[index]!,
        buffer,
        fileName,
        duration: buffer.duration,
      };
      return { pads };
    }),

  setParam: (index, param) =>
    set((s) => {
      const pads = [...s.pads];
      pads[index] = {
        ...pads[index]!,
        params: { ...pads[index]!.params, ...param },
      };
      return { pads };
    }),

  selectPad: (index) => set({ selectedPad: index }),

  toggleStep: (padIndex, stepIndex) =>
    set((s) => {
      const steps = s.steps.map((row, i) =>
        i === padIndex
          ? row.map((v, j) => (j === stepIndex ? !v : v))
          : row,
      );
      return { steps };
    }),

  setVelocity: (padIndex, stepIndex, velocity) =>
    set((s) => {
      const velocities = s.velocities.map((row, i) =>
        i === padIndex
          ? row.map((v, j) => (j === stepIndex ? Math.max(0, Math.min(1, velocity)) : v))
          : row,
      );
      return { velocities };
    }),

  setPatternLength: (length) =>
    set({ patternLength: Math.min(32, Math.max(8, length)), currentStep: 0 }),

  clearPad: (index) =>
    set((s) => {
      const pads = [...s.pads];
      pads[index] = createDefaultPad();
      const steps = s.steps.map((row, i) =>
        i === index ? new Array(32).fill(false) as boolean[] : row,
      );
      const velocities = s.velocities.map((row, i) =>
        i === index ? new Array(32).fill(0.8) as number[] : row,
      );
      return { pads, steps, velocities };
    }),
}));
