import { create } from "zustand";

type OverlayId = "mixer" | "browser" | "euclidean" | "song" | "scene" | "fxPanel" | "kitBrowser" | "help" | "mobileVoice" | "sampleBrowser" | "midiPlayer";

interface OverlayState {
  open: Set<OverlayId>;
  isOpen: (id: OverlayId) => boolean;
  toggle: (id: OverlayId) => void;
  openOverlay: (id: OverlayId) => void;
  closeOverlay: (id: OverlayId) => void;
  closeAll: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  open: new Set(),
  isOpen: (id) => get().open.has(id),
  toggle: (id) => set((s) => {
    const next = new Set(s.open);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { open: next };
  }),
  openOverlay: (id) => set((s) => {
    const next = new Set(s.open);
    next.add(id);
    return { open: next };
  }),
  closeOverlay: (id) => set((s) => {
    const next = new Set(s.open);
    next.delete(id);
    return { open: next };
  }),
  closeAll: () => set({ open: new Set() }),
}));
