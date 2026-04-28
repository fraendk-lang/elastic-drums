import { useEffect, useRef } from "react";
import { useDrumStore } from "../store/drumStore";
import { macros } from "../audio/Macros";
import { audioEngine } from "../audio/AudioEngine";
import { bassEngine } from "../audio/BassEngine";
import { melodyEngine } from "../audio/MelodyEngine";
import { chordsEngine } from "../audio/ChordsEngine";

/**
 * Web MIDI API integration
 *
 * Channel routing (MIDI channel → engine):
 *   Ch  1 (index 0)  →  Drums      GM Drum Map + MIDI Learn
 *   Ch  2 (index 1)  →  Bass 303   chromatic, gate-style (note-on/note-off)
 *   Ch  3 (index 2)  →  Melody     chromatic, gate-style
 *   Ch  4 (index 3)  →  Chords     polyphonic — holds all currently pressed keys as a chord
 *   Ch 10 (index 9)  →  Drums      GM standard drum channel (alias for Ch 1)
 *   Other channels   →  ignored
 *
 * CC mapping works on all channels.
 *
 * GM Drum Map (Ch 1 / Ch 10):
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

// MIDI Learn: user-assigned mappings override defaults (drums only)
const midiLearnMap = new Map<number, number>();
let midiLearnTarget: number | null = null;

export function setMidiLearnTarget(voiceIndex: number | null) {
  midiLearnTarget = voiceIndex;
}

// ─── Chord note tracking ──────────────────────────────────────────────────────
// Maintains the set of currently held MIDI notes on the Chords channel (ch 4).
// On every note-on/off, the chord engine is re-triggered with the full set.
const _activeChordNotes = new Set<number>();

// ─── CC Mapping ──────────────────────────────────────────────────────────────
export type CcDestination =
  | { kind: "macro"; index: number }
  | { kind: "crossfader" }
  | { kind: "reverb" }
  | { kind: "delay" }
  | { kind: "channel-volume"; channel: number };

const ccMap = new Map<number, CcDestination>();
let ccLearnTarget: CcDestination | null = null;

export function setCcLearnTarget(dest: CcDestination | null) {
  ccLearnTarget = dest;
}

export function getCcMappings(): Array<{ cc: number; dest: CcDestination }> {
  return Array.from(ccMap.entries()).map(([cc, dest]) => ({ cc, dest }));
}

export function clearCcMapping(cc: number) {
  ccMap.delete(cc);
}

function applyCc(dest: CcDestination, value01: number): void {
  switch (dest.kind) {
    case "macro":
      macros.setValue(dest.index, value01);
      break;
    case "crossfader":
      audioEngine.setCrossfader(value01 * 2 - 1); // 0..1 → -1..+1
      break;
    case "reverb":
      audioEngine.setReverbLevel(value01);
      break;
    case "delay":
      audioEngine.setDelayLevel(value01);
      break;
    case "channel-volume":
      audioEngine.setChannelVolume(dest.channel, value01);
      break;
  }
}

// ─── Small scheduling offset ──────────────────────────────────────────────────
// Adds a short lookahead so the audio scheduler receives events slightly in
// the future — avoids glitches when the browser's MIDI callback runs right
// on the audio render boundary.
const SCHED_OFFSET = 0.005; // 5 ms

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

          const status   = data[0]!;
          const note     = data[1]!;
          const velocity = data.length > 2 ? data[2]! : 0;
          const command  = status & 0xf0;
          const channel  = status & 0x0f; // 0-indexed: ch1=0, ch2=1, …, ch10=9

          const ctx = audioEngine.getAudioContext();
          const now = ctx ? ctx.currentTime + SCHED_OFFSET : 0;

          // ── Note On ──────────────────────────────────────────────────────
          const isNoteOn = command === 0x90 && velocity > 0;

          if (isNoteOn) {

            // ── Ch 1 / Ch 10 → Drums ──────────────────────────────────────
            if (channel === 0 || channel === 9) {
              // MIDI Learn mode (drums only)
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
              return;
            }

            // ── Ch 2 → Bass 303 ───────────────────────────────────────────
            if (channel === 1) {
              bassEngine.triggerNote(note, now, false, false, false, velocity / 127);
              return;
            }

            // ── Ch 3 → Melody (Synth 1) ───────────────────────────────────
            if (channel === 2) {
              melodyEngine.triggerNote(note, now, false, false, false, velocity / 127);
              return;
            }

            // ── Ch 4 → Chords (Synth 2) — polyphonic chord memory ─────────
            if (channel === 3) {
              _activeChordNotes.add(note);
              chordsEngine.triggerChord(
                Array.from(_activeChordNotes),
                now,
                false,   // accent
                false,   // tie
                velocity / 127,
              );
              return;
            }
          }

          // ── Note Off ─────────────────────────────────────────────────────
          // Note Off command (0x80) OR Note On with velocity 0
          const isNoteOff = command === 0x80 || (command === 0x90 && velocity === 0);

          if (isNoteOff) {
            // ── Ch 2 → Bass 303 ─────────────────────────────────────────
            if (channel === 1) {
              bassEngine.releaseNote(now);
              return;
            }

            // ── Ch 3 → Melody ───────────────────────────────────────────
            if (channel === 2) {
              melodyEngine.releaseNote(now);
              return;
            }

            // ── Ch 4 → Chords (re-trigger or release) ───────────────────
            if (channel === 3) {
              _activeChordNotes.delete(note);
              if (_activeChordNotes.size === 0) {
                chordsEngine.releaseChord(now);
              } else {
                // Legato: re-trigger remaining held notes as the new chord
                chordsEngine.triggerChord(
                  Array.from(_activeChordNotes),
                  now,
                  false, // accent
                  true,  // tie — smooth transition, no re-attack
                  0.85,
                );
              }
              return;
            }
          }

          // ── Control Change (0xB0) — all channels ─────────────────────────
          if (command === 0xB0) {
            const cc      = data[1]!;
            const ccValue = data[2] ?? 0;

            // CC Learn mode
            if (ccLearnTarget !== null) {
              ccMap.set(cc, ccLearnTarget);
              console.log(`MIDI Learn: CC ${cc} → ${JSON.stringify(ccLearnTarget)}`);
              ccLearnTarget = null;
              return;
            }

            const dest = ccMap.get(cc);
            if (dest) applyCc(dest, ccValue / 127);
          }
        };

        // Attach to all current MIDI inputs
        midi.inputs.forEach((input: MIDIInput) => {
          input.onmidimessage = handleMessage;
          console.log(`  → ${input.name}`);
        });

        // Handle hot-plug
        midi.onstatechange = (e: Event) => {
          const ce   = e as MIDIConnectionEvent;
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
