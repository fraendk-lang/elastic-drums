/**
 * Pattern URL Sharing
 *
 * Encodes a pattern as a compact Base64 string in the URL hash.
 * Recipients can load the shared beat by opening the link.
 *
 * Format: #p={base64(JSON.stringify(compactPattern))}
 */

import type { PatternData } from "../store/drumStore";

// Compact pattern format (minimal JSON size)
interface CompactPattern {
  n: string;     // name
  l: number;     // length
  s: number;     // swing
  b: number;     // bpm
  t: CompactTrack[];
}

interface CompactTrack {
  s: CompactStep[];  // Only active steps
}

interface CompactStep {
  i: number;  // step index
  v: number;  // velocity
  r?: number; // ratchet (omit if 1)
  c?: string; // condition (omit if "always")
}

export function encodePattern(pattern: PatternData, bpm: number): string {
  const compact: CompactPattern = {
    n: pattern.name,
    l: pattern.length,
    s: pattern.swing,
    b: bpm,
    t: pattern.tracks.map((track) => ({
      s: track.steps
        .map((step, idx) => {
          if (!step.active) return null;
          const cs: CompactStep = { i: idx, v: step.velocity };
          if (step.ratchetCount > 1) cs.r = step.ratchetCount;
          if (step.condition !== "always") cs.c = step.condition;
          return cs;
        })
        .filter((s): s is CompactStep => s !== null),
    })),
  };

  const json = JSON.stringify(compact);
  const encoded = btoa(encodeURIComponent(json));
  return encoded;
}

export function decodePattern(encoded: string): { pattern: PatternData; bpm: number } | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const compact: CompactPattern = JSON.parse(json);

    const tracks = compact.t.map((ct) => {
      const steps = Array.from({ length: 64 }, () => ({
        active: false, velocity: 100, microTiming: 0, probability: 100,
        ratchetCount: 1, condition: "always" as const, gateLength: 1, paramLocks: {},
      }));

      for (const cs of ct.s) {
        const step = steps[cs.i];
        if (step) {
          step.active = true;
          step.velocity = cs.v;
          if (cs.r) step.ratchetCount = cs.r;
          if (cs.c) (step as { condition: string }).condition = cs.c;
        }
      }

      return {
        steps, mute: false, solo: false, volume: 100, pan: 0, length: compact.l,
      };
    });

    // Pad to 12 tracks
    while (tracks.length < 12) {
      tracks.push({
        steps: Array.from({ length: 64 }, () => ({
          active: false, velocity: 100, microTiming: 0, probability: 100,
          ratchetCount: 1, condition: "always" as const, gateLength: 1, paramLocks: {},
        })),
        mute: false, solo: false, volume: 100, pan: 0, length: compact.l,
      });
    }

    return {
      pattern: { name: compact.n, tracks, length: compact.l, swing: compact.s },
      bpm: compact.b,
    };
  } catch {
    return null;
  }
}

/** Copy share URL to clipboard */
export function sharePattern(pattern: PatternData, bpm: number): string {
  const encoded = encodePattern(pattern, bpm);
  const url = `${window.location.origin}${window.location.pathname}#p=${encoded}`;

  navigator.clipboard?.writeText(url).then(
    () => console.log("Pattern URL copied to clipboard"),
    () => console.log("Share URL:", url),
  );

  return url;
}

/** Check URL for shared pattern on load */
export function loadSharedPattern(): { pattern: PatternData; bpm: number } | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#p=")) return null;

  const encoded = hash.slice(3);
  const result = decodePattern(encoded);

  // Clear hash after loading
  if (result) {
    history.replaceState(null, "", window.location.pathname);
  }

  return result;
}
