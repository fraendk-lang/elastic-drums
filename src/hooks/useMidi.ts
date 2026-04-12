import { useEffect, useRef } from "react";
import { useDrumStore } from "../store/drumStore";

/**
 * Web MIDI API integration
 *
 * Default MIDI mapping (GM Drum Map):
 *   Note 36 (C1)  → Kick       Note 42 (F#1) → HH Closed
 *   Note 38 (D1)  → Snare      Note 46 (A#1) → HH Open
 *   Note 39 (D#1) → Clap       Note 49 (C#2) → Cymbal
 *   Note 41 (F1)  → Tom Lo     Note 51 (D#2) → Ride
 *   Note 43 (G1)  → Tom Mid    Note 37 (C#1) → Perc 1
 *   Note 45 (A1)  → Tom Hi     Note 40 (E1)  → Perc 2
 */

const DEFAULT_NOTE_MAP: Record<number, number> = {
  36: 0, 38: 1, 39: 2, 41: 3, 43: 4, 45: 5,
  42: 6, 46: 7, 49: 8, 51: 9, 37: 10, 40: 11,
};

// MIDI Learn: user-assigned mappings override defaults
const midiLearnMap = new Map<number, number>();
let midiLearnTarget: number | null = null;

export function setMidiLearnTarget(voiceIndex: number | null) {
  midiLearnTarget = voiceIndex;
}

export function useMidi() {
  const triggerVoice = useDrumStore((s) => s.triggerVoice);
  const setSelectedVoice = useDrumStore((s) => s.setSelectedVoice);
  const connected = useRef(false);

  useEffect(() => {
    if (connected.current) return;
    if (!navigator.requestMIDIAccess) {
      console.log("Web MIDI API not available");
      return;
    }

    navigator.requestMIDIAccess().then(
      (midi: MIDIAccess) => {
        connected.current = true;
        console.log(`MIDI connected: ${midi.inputs.size} input(s)`);

        const handleMessage = (e: MIDIMessageEvent) => {
          const data = e.data;
          if (!data || data.length < 2) return;

          const status = data[0]!;
          const note = data[1]!;
          const velocity = data.length > 2 ? data[2]! : 0;
          const command = status & 0xf0;

          // Note On (0x90) with velocity > 0
          if (command === 0x90 && velocity > 0) {
            // MIDI Learn mode
            if (midiLearnTarget !== null) {
              midiLearnMap.set(note, midiLearnTarget);
              console.log(`MIDI Learn: Note ${note} → Voice ${midiLearnTarget}`);
              midiLearnTarget = null;
              return;
            }

            const voice = midiLearnMap.get(note) ?? DEFAULT_NOTE_MAP[note];
            if (voice !== undefined) {
              triggerVoice(voice);
              setSelectedVoice(voice);
            }
          }
        };

        // Attach to all MIDI inputs
        midi.inputs.forEach((input: MIDIInput) => {
          input.onmidimessage = handleMessage;
          console.log(`  → ${input.name}`);
        });

        // Handle hot-plug
        midi.onstatechange = (e: Event) => {
          const ce = e as MIDIConnectionEvent;
          const port = ce.port;
          if (port && port.type === "input" && port.state === "connected") {
            (port as MIDIInput).onmidimessage = handleMessage;
            console.log(`MIDI input connected: ${port.name}`);
          }
        };
      },
      (err: unknown) => {
        console.warn("MIDI access denied:", err);
      },
    );
  }, [triggerVoice, setSelectedVoice]);
}
