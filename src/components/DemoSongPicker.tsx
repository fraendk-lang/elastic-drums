/**
 * DemoSongPicker — modal grid of curated demo songs.
 *
 * Click a card → loads everything (kit, drums, bass, chords, melody, FX)
 * and starts playback. The "Wow" moment for first-time users.
 */

import { DEMO_SONGS, type DemoSong } from "../data/demoSongs";
import { loadDemoSong } from "../data/loadDemoSong";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Per-genre accent colors for the cards
const GENRE_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  "Lo-Fi Hip Hop":      { fg: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.35)"  },
  "Synthwave":          { fg: "#ec4899", bg: "rgba(236,72,153,0.10)",  border: "rgba(236,72,153,0.35)"  },
  "Liquid DnB":         { fg: "#22d3ee", bg: "rgba(34,211,238,0.10)",  border: "rgba(34,211,238,0.35)"  },
  "Deep House":         { fg: "#22c55e", bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.35)"   },
  "Ambient / Cinematic":{ fg: "#a78bfa", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.35)" },
};

const DEFAULT_COLOR = { fg: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.30)" };

export function DemoSongPicker({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  const handlePick = (song: DemoSong) => {
    loadDemoSong(song);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl mx-4 rounded-xl border border-white/10 bg-[#0d0d10] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/8">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">DEMO SONGS</h2>
            <p className="text-[10px] text-white/40 mt-0.5">
              Click a song → it loads everything and starts playing
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white text-xl leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Grid */}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {DEMO_SONGS.map((song) => {
            const c = GENRE_COLORS[song.genre] ?? DEFAULT_COLOR;
            return (
              <button
                key={song.id}
                onClick={() => handlePick(song)}
                className="group relative text-left p-4 rounded-lg border bg-[#0a0a0e] hover:bg-[#13131a] transition-all overflow-hidden"
                style={{ borderColor: c.border }}
              >
                {/* Genre badge */}
                <div
                  className="inline-block px-2 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase mb-2"
                  style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
                >
                  {song.genre}
                </div>

                {/* Title */}
                <div className="text-[15px] font-bold text-white tracking-tight">
                  {song.name}
                </div>

                {/* Description */}
                <div className="text-[10px] text-white/55 mt-1 leading-snug">
                  {song.description}
                </div>

                {/* Stats row */}
                <div className="mt-3 flex items-center justify-between text-[9px] text-white/35">
                  <span className="font-mono">{song.bpm} BPM</span>
                  <span>{song.rootName} {song.scaleName}</span>
                </div>

                {/* Hover play indicator */}
                <div
                  className="absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: c.fg }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="#0a0a0e">
                    <path d="M2 1 L2 9 L9 5 Z" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-white/8 text-[9px] text-white/35 flex items-center justify-between">
          <span>Loads kit, bass, chords, melody + pattern in one click</span>
          <span className="text-white/25">{DEMO_SONGS.length} Songs</span>
        </div>
      </div>
    </div>
  );
}
