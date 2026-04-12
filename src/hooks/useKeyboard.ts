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
 *   1-6      →  Load Preset 1-6
 *   ←  →     →  Prev/Next Preset
 */

const KEY_TO_VOICE: Record<string, number> = {
  q: 0,  w: 1,  e: 2,  r: 3,
  a: 4,  s: 5,  d: 6,  f: 7,
  z: 8,  x: 9,  c: 10, v: 11,
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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

      // Preset loading (1-6)
      if (key >= "1" && key <= "6") {
        loadPreset(Number(key) - 1);
        return;
      }

      // Preset navigation
      if (key === "arrowright") {
        nextPreset();
        return;
      }
      if (key === "arrowleft") {
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
