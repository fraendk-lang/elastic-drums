import { create } from "zustand";

interface TransportState {
  bpm: number;
  isPlaying: boolean;
  swing: number;
  currentStep: number;
  setBpm: (bpm: number) => void;
  setPlaying: (playing: boolean) => void;
  setSwing: (swing: number) => void;
  setCurrentStep: (step: number) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  bpm: 120,
  isPlaying: false,
  swing: 50,
  currentStep: 0,
  setBpm: (bpm) => set({ bpm: Math.max(30, Math.min(300, bpm)) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSwing: (swing) => set({ swing: Math.max(50, Math.min(75, swing)) }),
  setCurrentStep: (currentStep) => set({ currentStep }),
}));
