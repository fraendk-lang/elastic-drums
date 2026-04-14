/**
 * MIDI Clock — Send/Receive 24 PPQ
 *
 * Supports:
 * - Sending MIDI Clock to external hardware/software
 * - Receiving MIDI Clock for external sync
 * - Start/Stop/Continue messages
 */

import { useEffect, useRef, useCallback } from "react";

// MIDI Clock messages
const MIDI_CLOCK = 0xF8;      // Timing clock (24 PPQ)
const MIDI_START = 0xFA;       // Start
const MIDI_CONTINUE = 0xFB;   // Continue
const MIDI_STOP = 0xFC;       // Stop

interface MidiClockState {
  mode: "off" | "send" | "receive";
  output: MIDIOutput | null;
  sendInterval: ReturnType<typeof setInterval> | null;
  externalBpm: number;
  lastClockTime: number;
  clockCount: number;
}

const state: MidiClockState = {
  mode: "off",
  output: null,
  sendInterval: null,
  externalBpm: 120,
  lastClockTime: 0,
  clockCount: 0,
};

// ─── MIDI Clock Send ────────────────────────────────────

export function startMidiClockSend(bpm: number): void {
  stopMidiClockSend();
  if (!state.output) return;

  // 24 PPQ = 24 clocks per quarter note
  const intervalMs = (60000 / bpm) / 24;

  // Send Start message
  state.output.send([MIDI_START]);

  state.sendInterval = setInterval(() => {
    state.output?.send([MIDI_CLOCK]);
  }, intervalMs);
}

export function stopMidiClockSend(): void {
  if (state.sendInterval) {
    clearInterval(state.sendInterval);
    state.sendInterval = null;
  }
  state.output?.send([MIDI_STOP]);
}

export function updateMidiClockBpm(bpm: number): void {
  if (state.sendInterval) {
    // Restart with new BPM
    startMidiClockSend(bpm);
  }
}

export function setMidiClockOutput(output: MIDIOutput | null): void {
  state.output = output;
}

// ─── MIDI Clock Receive ─────────────────────────────────

export function handleMidiClockMessage(
  data: Uint8Array,
  onBpmChange?: (bpm: number) => void,
  onStart?: () => void,
  onStop?: () => void,
  onContinue?: () => void,
): void {
  if (!data || data.length < 1) return;
  const status = data[0]!;

  switch (status) {
    case MIDI_CLOCK: {
      const now = performance.now();
      state.clockCount++;

      if (state.lastClockTime > 0 && state.clockCount >= 24) {
        // Calculate BPM from 24 clock messages (= 1 quarter note)
        const elapsed = now - state.lastClockTime;
        const measuredBpm = Math.round(60000 / elapsed);
        if (measuredBpm >= 30 && measuredBpm <= 300) {
          // Smooth the BPM reading
          state.externalBpm = state.externalBpm * 0.7 + measuredBpm * 0.3;
          onBpmChange?.(Math.round(state.externalBpm));
        }
        state.clockCount = 0;
        state.lastClockTime = now;
      }
      if (state.lastClockTime === 0) {
        state.lastClockTime = now;
        state.clockCount = 0;
      }
      break;
    }
    case MIDI_START:
      state.clockCount = 0;
      state.lastClockTime = 0;
      onStart?.();
      break;
    case MIDI_STOP:
      state.clockCount = 0;
      state.lastClockTime = 0;
      onStop?.();
      break;
    case MIDI_CONTINUE:
      onContinue?.();
      break;
  }
}

// ─── React Hook ─────────────────────────────────────────

export interface UseMidiClockOptions {
  mode: "off" | "send" | "receive";
  bpm: number;
  isPlaying: boolean;
  onExternalBpm?: (bpm: number) => void;
  onExternalStart?: () => void;
  onExternalStop?: () => void;
}

export interface UseMidiClockResult {
  getOutputs: () => MIDIOutput[];
  selectOutput: (output: MIDIOutput) => void;
}

export function useMidiClock(opts: UseMidiClockOptions): UseMidiClockResult {
  const { mode, bpm, isPlaying, onExternalBpm, onExternalStart, onExternalStop } = opts;
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const outputsRef = useRef<MIDIOutput[]>([]);

  // Initialize MIDI access
  useEffect(() => {
    if (mode === "off") return;
    if (!navigator.requestMIDIAccess) return;

    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      midiAccessRef.current = access;
      outputsRef.current = Array.from(access.outputs.values());

      if (mode === "send" && outputsRef.current.length > 0) {
        setMidiClockOutput(outputsRef.current[0]!);
      }

      if (mode === "receive") {
        access.inputs.forEach((input) => {
          input.onmidimessage = (e: MIDIMessageEvent) => {
            if (e.data) {
              handleMidiClockMessage(
                e.data,
                onExternalBpm,
                onExternalStart,
                onExternalStop,
              );
            }
          };
        });
      }
    }).catch((err) => {
      console.warn("MIDI Clock: access denied", err);
    });

    return () => {
      if (mode === "send") {
        stopMidiClockSend();
        setMidiClockOutput(null);
      }
    };
  }, [mode]);

  // Sync clock send with transport
  useEffect(() => {
    if (mode !== "send") return;
    if (isPlaying) {
      startMidiClockSend(bpm);
    } else {
      stopMidiClockSend();
    }
  }, [mode, isPlaying, bpm]);

  // Update BPM while sending
  useEffect(() => {
    if (mode === "send" && isPlaying) {
      updateMidiClockBpm(bpm);
    }
  }, [mode, bpm, isPlaying]);

  const getOutputs = useCallback((): MIDIOutput[] => {
    return outputsRef.current;
  }, []);

  const selectOutput = useCallback((output: MIDIOutput) => {
    setMidiClockOutput(output);
    if (isPlaying) {
      startMidiClockSend(bpm);
    }
  }, [bpm, isPlaying]);

  return { getOutputs, selectOutput };
}
