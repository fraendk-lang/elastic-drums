// src/store/mixerBarStore.ts
/**
 * Mixer Bar Store — persistent channel state for the permanent MixerBar.
 * 15 channels (0-11: drums, 12: bass, 13: chords, 14: lead).
 * State persists within the session (not in IndexedDB).
 */

import { create } from "zustand";

export const NUM_MIXER_CHANNELS = 15;

/** Fader position 0-1000 (750 = 0dB unity) */
export type FaderPos = number;

export interface ChannelMixState {
  fader:   FaderPos;   // 0-1000, 750 = unity
  muted:   boolean;
  soloed:  boolean;
  pan:     number;     // -1 to +1
  eqLo:    number;     // -12 to +12 dB
  eqMid:   number;     // -12 to +12 dB
  eqHi:    number;     // -12 to +12 dB
  sendRev: number;     // 0-100
  sendDly: number;     // 0-100
}

const defaultChannel = (): ChannelMixState => ({
  fader: 750, muted: false, soloed: false,
  pan: 0, eqLo: 0, eqMid: 0, eqHi: 0,
  sendRev: 0, sendDly: 0,
});

interface MixerBarState {
  channels: ChannelMixState[];
  expandedChannel: number | null;  // which channel strip is expanded
  setFader:   (ch: number, val: FaderPos) => void;
  setMute:    (ch: number, muted: boolean) => void;
  setSolo:    (ch: number, soloed: boolean) => void;
  setPan:     (ch: number, pan: number) => void;
  setEQ:      (ch: number, band: "lo" | "mid" | "hi", gain: number) => void;
  setSendRev: (ch: number, val: number) => void;
  setSendDly: (ch: number, val: number) => void;
  setExpanded:(ch: number | null) => void;
}

export const useMixerBarStore = create<MixerBarState>((set) => ({
  channels: Array.from({ length: NUM_MIXER_CHANNELS }, defaultChannel),
  expandedChannel: null,

  setFader: (ch, val) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, fader: val }; return { channels: c }; }),

  setMute: (ch, muted) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, muted }; return { channels: c }; }),

  setSolo: (ch, soloed) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, soloed }; return { channels: c }; }),

  setPan: (ch, pan) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, pan }; return { channels: c }; }),

  setEQ: (ch, band, gain) =>
    set((s) => {
      const c = [...s.channels];
      const field = band === "lo" ? "eqLo" : band === "mid" ? "eqMid" : "eqHi";
      c[ch] = { ...c[ch]!, [field]: gain };
      return { channels: c };
    }),

  setSendRev: (ch, val) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, sendRev: val }; return { channels: c }; }),

  setSendDly: (ch, val) =>
    set((s) => { const c = [...s.channels]; c[ch] = { ...c[ch]!, sendDly: val }; return { channels: c }; }),

  setExpanded: (ch) => set({ expandedChannel: ch }),
}));

/** Logarithmic fader law: position (0..1000) → gain */
export function faderToGain(pos: number): number {
  const p = pos / 1000;
  if (p <= 0) return 0;
  // S-curve: unity at 0.75
  const x = p / 0.75;
  return x < 1 ? x * x * x * 0.5 + 0.5 * x : 1 + (x - 1) * 1.5;
}
