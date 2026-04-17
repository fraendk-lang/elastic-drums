/**
 * MIDI Clock Mode — module-level state shared between UI and useMidiClock hook.
 * Kept out of MidiClockPanel.tsx so the panel component can be lazy-loaded.
 */

export type MidiClockMode = "off" | "send" | "receive";

let _mode: MidiClockMode = "off";
const _listeners = new Set<() => void>();

export function getMidiClockMode(): MidiClockMode {
  return _mode;
}

export function setMidiClockMode(mode: MidiClockMode): void {
  _mode = mode;
  _listeners.forEach((fn) => fn());
}

export function subscribeMidiClockMode(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
