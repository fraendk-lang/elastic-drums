/**
 * Sample Kit Loader — loads drum sample kits from public/samples/
 *
 * Kit structure: public/samples/{kit-name}/{voice}.wav
 * Voices: kick, snare, clap, tom-lo, tom-mid, tom-hi, hh-closed, hh-open, cymbal, ride, perc1, perc2
 */

export interface SampleKit {
  id: string;
  name: string;
  path: string; // e.g. "/samples/808-classic"
}

// Registry of available sample kits
export const SAMPLE_KITS: SampleKit[] = [
  { id: "house-classic",   name: "House Classic",   path: "/samples/house-classic" },
  { id: "house-deep",      name: "House Deep",      path: "/samples/house-deep" },
  { id: "house-minimal",   name: "House Minimal",   path: "/samples/house-minimal" },
  { id: "house-punchy",    name: "House Punchy",    path: "/samples/house-punchy" },
  { id: "house-dark",      name: "House Dark",      path: "/samples/house-dark" },
  { id: "house-snappy",    name: "House Snappy",    path: "/samples/house-snappy" },
  { id: "house-percussive", name: "House Percussive", path: "/samples/house-percussive" },
  { id: "house-rimshot",   name: "House Rimshot",   path: "/samples/house-rimshot" },
  { id: "house-fx",        name: "House FX",        path: "/samples/house-fx" },
  { id: "house-full-perc", name: "Full Percussion", path: "/samples/house-full-perc" },
];

const VOICE_FILENAMES = [
  "kick", "snare", "clap", "tom-lo", "tom-mid", "tom-hi",
  "hh-closed", "hh-open", "cymbal", "ride", "perc1", "perc2",
];

export async function loadSampleKit(
  ctx: AudioContext,
  kit: SampleKit,
): Promise<(AudioBuffer | null)[]> {
  const buffers: (AudioBuffer | null)[] = [];

  for (const voice of VOICE_FILENAMES) {
    try {
      // Try WAV first, then MP3
      let response = await fetch(`${kit.path}/${voice}.wav`);
      if (!response.ok) response = await fetch(`${kit.path}/${voice}.mp3`);
      if (!response.ok) {
        buffers.push(null);
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      buffers.push(audioBuffer);
    } catch {
      buffers.push(null);
    }
  }

  return buffers;
}
