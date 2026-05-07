/**
 * Demo Song Loader — applies a DemoSong to all engine stores.
 *
 * Sequence:
 *   1. Stop transport if running
 *   2. Apply kit + drum pattern (uses existing applyKit / kitToPattern)
 *   3. Set BPM
 *   4. Load bass preset by name + populate bass sequencer
 *   5. Load chords preset by name + populate chord sequencer
 *   6. Load melody preset by name + populate melody sequencer (if present)
 *   7. Auto-play after a short settle delay
 */

import { useDrumStore } from "../store/drumStore";
import { useBassStore, BASS_PRESETS } from "../store/bassStore";
import { useChordsStore, CHORDS_PRESETS } from "../store/chordsStore";
import { useMelodyStore, MELODY_PRESETS } from "../store/melodyStore";
import { applyKit, kitToPattern } from "../kits/KitManager";
import { FACTORY_KITS } from "../kits/factoryKits";
import type { DemoSong } from "./demoSongs";

export function loadDemoSong(song: DemoSong, opts: { autoPlay?: boolean } = {}): void {
  const autoPlay = opts.autoPlay ?? true;

  // ── 1. Stop transport ────────────────────────────────────
  const drum = useDrumStore.getState();
  if (drum.isPlaying) drum.togglePlay();

  // ── 2. Apply kit (samples + voice params + mixer + master FX) ──
  const kit = FACTORY_KITS.find((k) => k.id === song.kitId);
  if (kit) {
    applyKit(kit);
    const drumPattern = kitToPattern(kit);
    if (drumPattern) {
      // Override pattern length for demo (kits often use shorter patterns)
      useDrumStore.setState({
        pattern: drumPattern,
        bpm: song.bpm,
        currentPatternIndex: -1,
      });
    } else {
      useDrumStore.setState({ bpm: song.bpm });
    }
  } else {
    useDrumStore.setState({ bpm: song.bpm });
    console.warn(`[loadDemoSong] Kit not found: ${song.kitId}`);
  }

  // ── 3. Apply swing if specified ──────────────────────────
  if (song.swing !== undefined) {
    useDrumStore.getState().setSwing(song.swing);
  }

  // ── 4. Bass — preset + steps ────────────────────────────
  if (song.bassPresetName) {
    const idx = BASS_PRESETS.findIndex((p) => p.name === song.bassPresetName);
    if (idx >= 0) {
      const bassState = useBassStore.getState();
      bassState.loadPreset(idx);
      if (song.bassSteps) {
        bassState.loadBassPattern({
          steps: song.bassSteps,
          length: song.bassLength ?? song.bassSteps.length,
          params: useBassStore.getState().params,
          rootNote: song.rootNote,
          rootName: song.rootName,
          scaleName: song.scaleName,
        });
      }
    } else {
      console.warn(`[loadDemoSong] Bass preset not found: ${song.bassPresetName}`);
    }
  }

  // ── 5. Chords — preset + steps ──────────────────────────
  if (song.chordsPresetName) {
    const idx = CHORDS_PRESETS.findIndex((p) => p.name === song.chordsPresetName);
    if (idx >= 0) {
      const chordsState = useChordsStore.getState();
      chordsState.loadPreset(idx);
      if (song.chordsSteps) {
        chordsState.loadChordsPattern({
          steps: song.chordsSteps,
          length: song.chordsLength ?? song.chordsSteps.length,
          params: useChordsStore.getState().params,
          rootNote: song.rootNote,
          rootName: song.rootName,
          scaleName: song.scaleName,
        });
      }
    } else {
      console.warn(`[loadDemoSong] Chords preset not found: ${song.chordsPresetName}`);
    }
  }

  // ── 6. Melody — preset + steps (optional) ───────────────
  if (song.melodyPresetName) {
    const idx = MELODY_PRESETS.findIndex((p) => p.name === song.melodyPresetName);
    if (idx >= 0) {
      const melodyState = useMelodyStore.getState();
      melodyState.loadPreset(idx);
      if (song.melodySteps) {
        melodyState.loadMelodyPattern({
          steps: song.melodySteps,
          length: song.melodyLength ?? song.melodySteps.length,
          params: useMelodyStore.getState().params,
          rootNote: song.rootNote,
          rootName: song.rootName,
          scaleName: song.scaleName,
        });
      }
    } else {
      console.warn(`[loadDemoSong] Melody preset not found: ${song.melodyPresetName}`);
    }
  }

  // ── 7. Auto-play after a short settle delay ─────────────
  if (autoPlay) {
    setTimeout(() => {
      if (!useDrumStore.getState().isPlaying) {
        useDrumStore.getState().togglePlay();
      }
    }, 80);
  }
}
