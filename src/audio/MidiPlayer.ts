/**
 * MIDI File Player — imports .mid files and plays through the app's synth engines.
 *
 * Maps MIDI channels:
 *   Channel 10 (drums) → Drum voices via audioEngine.triggerVoice()
 *   Channel 1 (bass)   → BassEngine or SoundFont
 *   Channel 2 (chords) → ChordsEngine or SoundFont
 *   Channel 3 (lead)   → MelodyEngine or SoundFont
 */

import { Midi } from "@tonejs/midi";

export interface MidiFileInfo {
  name: string;
  duration: number;     // seconds
  bpm: number;
  trackCount: number;
  tracks: { name: string; noteCount: number; channel: number }[];
}

// GM Drum Map → Elastic Drum voice index
const GM_DRUM_MAP: Record<number, number> = {
  36: 0,  // Bass Drum → KICK
  35: 0,  // Acoustic Bass Drum → KICK
  38: 1,  // Acoustic Snare → SNARE
  40: 1,  // Electric Snare → SNARE
  39: 2,  // Hand Clap → CLAP
  37: 2,  // Side Stick → CLAP
  41: 3,  // Low Floor Tom → TOM LO
  43: 3,  // High Floor Tom → TOM LO
  45: 4,  // Low Tom → TOM MID
  47: 4,  // Low-Mid Tom → TOM MID
  48: 5,  // Hi-Mid Tom → TOM HI
  50: 5,  // High Tom → TOM HI
  42: 6,  // Closed Hi-Hat → HH CL
  44: 6,  // Pedal Hi-Hat → HH CL
  46: 7,  // Open Hi-Hat → HH OP
  49: 8,  // Crash Cymbal → CYMBAL
  57: 8,  // Crash 2 → CYMBAL
  51: 9,  // Ride Cymbal → RIDE
  59: 9,  // Ride 2 → RIDE
  56: 10, // Cowbell → PERC 1
  54: 10, // Tambourine → PERC 1
  75: 11, // Claves → PERC 2
  76: 11, // Hi Wood Block → PERC 2
};

class MidiPlayer {
  private midi: Midi | null = null;
  private playing = false;
  private startTime = 0;
  private scheduledEvents: ReturnType<typeof setTimeout>[] = [];
  private onDrumTrigger: ((voice: number, velocity: number) => void) | null = null;
  private onBassTrigger: ((note: number, velocity: number, duration: number) => void) | null = null;
  private onChordTrigger: ((notes: number[], velocity: number, duration: number) => void) | null = null;
  private onMelodyTrigger: ((note: number, velocity: number, duration: number) => void) | null = null;
  private onProgress: ((position: number, duration: number) => void) | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private looping = false;

  /** Parse a MIDI file from ArrayBuffer */
  async loadFile(buffer: ArrayBuffer): Promise<MidiFileInfo> {
    this.stop();
    this.midi = new Midi(buffer);

    return {
      name: this.midi.name || "Untitled",
      duration: this.midi.duration,
      bpm: this.midi.header.tempos[0]?.bpm ?? 120,
      trackCount: this.midi.tracks.length,
      tracks: this.midi.tracks.map((t, i) => ({
        name: t.name || `Track ${i + 1}`,
        noteCount: t.notes.length,
        channel: t.channel ?? i,
      })),
    };
  }

  /** Set callback functions for triggering sounds */
  setCallbacks(opts: {
    onDrum?: (voice: number, velocity: number) => void;
    onBass?: (note: number, velocity: number, duration: number) => void;
    onChord?: (notes: number[], velocity: number, duration: number) => void;
    onMelody?: (note: number, velocity: number, duration: number) => void;
    onProgress?: (position: number, duration: number) => void;
  }): void {
    this.onDrumTrigger = opts.onDrum ?? null;
    this.onBassTrigger = opts.onBass ?? null;
    this.onChordTrigger = opts.onChord ?? null;
    this.onMelodyTrigger = opts.onMelody ?? null;
    this.onProgress = opts.onProgress ?? null;
  }

  /** Play the loaded MIDI file */
  play(loop = false): void {
    if (!this.midi) return;
    this.stop();
    this.playing = true;
    this.looping = loop;
    this.startTime = performance.now();

    // Schedule all note events
    for (let trackIdx = 0; trackIdx < this.midi.tracks.length; trackIdx++) {
      const track = this.midi.tracks[trackIdx]!;
      const ch = track.channel;

      // Detect drum tracks: channel 9, or name contains "drum", or has GM drum note range
      const isDrum = ch === 9
        || (track.name ?? "").toLowerCase().includes("drum")
        || (ch === undefined && track.notes.some((n) => n.midi >= 35 && n.midi <= 81 && GM_DRUM_MAP[n.midi] !== undefined));

      // Route non-drum tracks by index: first=bass, second=chords, third+=melody
      let melodicRole: "bass" | "chords" | "melody" = "melody";
      if (!isDrum) {
        const melodicIdx = trackIdx - (isDrum ? 0 : 0); // Track position among non-drum tracks
        if (ch === 0 || melodicIdx <= 1) melodicRole = "bass";
        else if (ch === 1 || melodicIdx === 2) melodicRole = "chords";
        else melodicRole = "melody";
      }

      for (const note of track.notes) {
        const timeMs = note.time * 1000;
        const velocity = note.velocity;
        const duration = note.duration;
        const midi = note.midi;

        const timer = setTimeout(() => {
          if (!this.playing) return;

          if (isDrum) {
            const voice = GM_DRUM_MAP[midi];
            if (voice !== undefined && this.onDrumTrigger) {
              this.onDrumTrigger(voice, velocity);
            }
          } else {
            switch (melodicRole) {
              case "bass":
                this.onBassTrigger?.(midi, velocity, duration);
                break;
              case "chords":
                this.onChordTrigger?.([midi], velocity, duration);
                break;
              case "melody":
                this.onMelodyTrigger?.(midi, velocity, duration);
                break;
            }
          }
        }, timeMs);

        this.scheduledEvents.push(timer);
      }
    }

    // Progress tracking
    this.progressTimer = setInterval(() => {
      if (!this.playing || !this.midi) return;
      const elapsed = (performance.now() - this.startTime) / 1000;
      this.onProgress?.(elapsed, this.midi.duration);

      // Loop or stop at end
      if (elapsed >= this.midi.duration) {
        if (this.looping) {
          this.play(true); // Restart
        } else {
          this.stop();
        }
      }
    }, 100);
  }

  private onStopCallback: (() => void) | null = null;

  /** Register a callback to release all voices when playback stops */
  setOnStop(cb: () => void): void {
    this.onStopCallback = cb;
  }

  /** Stop playback and release all active notes */
  stop(): void {
    this.playing = false;
    for (const timer of this.scheduledEvents) clearTimeout(timer);
    this.scheduledEvents = [];
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    // Release all active notes to prevent hangs
    this.onStopCallback?.();
  }

  /** Pause/resume */
  get isPlaying(): boolean { return this.playing; }
  get isLoaded(): boolean { return this.midi !== null; }
  get fileInfo(): MidiFileInfo | null {
    if (!this.midi) return null;
    return {
      name: this.midi.name || "Untitled",
      duration: this.midi.duration,
      bpm: this.midi.header.tempos[0]?.bpm ?? 120,
      trackCount: this.midi.tracks.length,
      tracks: this.midi.tracks.map((t, i) => ({
        name: t.name || `Track ${i + 1}`,
        noteCount: t.notes.length,
        channel: t.channel ?? i,
      })),
    };
  }
}

export const midiPlayer = new MidiPlayer();
