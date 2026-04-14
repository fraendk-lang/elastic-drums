import { useEffect } from "react";
import { useDrumStore } from "../store/drumStore";

/**
 * QWERTY → Pad mapping (2 rows × 4 + 4)
 *
 * Layout mirrors the 4×3 pad grid:
 *   Q W E R  →  KICK  SNARE  CLAP  TOM LO
 *   A S D F  →  TOM M TOM H  HH CL HH OP
 *   Z X C V  →  CYM   RIDE   PRC1  PRC2
 *
 * Transport:
 *   Space    →  Play/Stop
 *   1-9, 0   →  Load Preset 1-10 (0 = 10th)
 *   ←  →     →  Prev/Next Preset (cycles through all)
 *   T        →  Tap Tempo (handled in Transport)
 */

const KEY_TO_VOICE: Record<string, number> = {
  q: 0,  w: 1,  e: 2,  r: 3,
  a: 4,  s: 5,  d: 6,  f: 7,
  z: 8,  x: 9,  c: 10, v: 11,
};

// Map number keys to preset indices: 1→0, 2→1, ... 9→8, 0→9
const KEY_TO_PRESET: Record<string, number> = {
  "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
  "6": 5, "7": 6, "8": 7, "9": 8, "0": 9,
};

export function useKeyboard() {
  const triggerVoice = useDrumStore((s) => s.triggerVoice);
  const setSelectedVoice = useDrumStore((s) => s.setSelectedVoice);
  const togglePlay = useDrumStore((s) => s.togglePlay);
  const loadPreset = useDrumStore((s) => s.loadPreset);
  const nextPreset = useDrumStore((s) => s.nextPreset);
  const prevPreset = useDrumStore((s) => s.prevPreset);

  useEffect(() => {
    const pressed = new Set<string>();

    const handleDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      const key = e.key.toLowerCase();

      // Prevent repeat triggers from held keys
      if (pressed.has(key)) return;
      pressed.add(key);

      // Voice triggers
      const voice = KEY_TO_VOICE[key];
      if (voice !== undefined) {
        e.preventDefault();
        triggerVoice(voice);
        setSelectedVoice(voice);
        return;
      }

      // Transport
      if (key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }

      // Preset loading (1-9, 0): direct access to presets
      const presetIdx = KEY_TO_PRESET[e.key]; // Use e.key (not lowercased) for number keys
      if (presetIdx !== undefined) {
        e.preventDefault();
        loadPreset(presetIdx);
        return;
      }

      // Preset navigation — cycles through ALL presets (including beyond 10)
      if (key === "arrowright") {
        e.preventDefault();
        nextPreset();
        return;
      }
      if (key === "arrowleft") {
        e.preventDefault();
        prevPreset();
        return;
      }
    };

    const handleUp = (e: KeyboardEvent) => {
      pressed.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);

    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
    };
  }, [triggerVoice, setSelectedVoice, togglePlay, loadPreset, nextPreset, prevPreset]);
}
