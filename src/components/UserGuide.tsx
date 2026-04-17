/**
 * User Guide — in-app manual covering the full workflow.
 *
 * Sections load on demand as the user navigates. Content is authored
 * here (not fetched) so the docs stay in sync with the code.
 */

import { useEffect, useState, useCallback } from "react";

interface UserGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Section {
  id: string;
  title: string;
  body: ReactBody;
}

type ReactBody = { blocks: Block[] };

type Block =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "list"; items: string[] }
  | { type: "kbd"; keys: string; desc: string }[]
  | { type: "tip"; text: string };

const SECTIONS: Section[] = [
  {
    id: "start",
    title: "1. Getting Started",
    body: {
      blocks: [
        { type: "p", text: "Elastic Drums is a loop-based mini-DAW with four parallel engines: Drums (12 voices), Bass (303-style), Chords (polyphonic pad), and Melody (lead synth)." },
        { type: "p", text: "Each engine has its own sequencer and shares the master transport. Press Space to Play / Stop." },
        { type: "tip", text: "Tip: Start with a drum preset (press number key 1–9), then use the Euclidean generator (EUCLID button) to fill the other tracks quickly." },
      ],
    },
  },
  {
    id: "drums",
    title: "2. Drum Sequencer",
    body: {
      blocks: [
        { type: "h3", text: "Creating a pattern" },
        { type: "list", items: [
          "Click a step in the grid to toggle it on/off.",
          "Right-click a step to cycle its velocity (soft → medium → accent).",
          "Shift+right-click to cycle ratchet (single → 2x → 3x → 4x etc).",
          "Alt+right-click to set a conditional trig (probability, fill, etc).",
          "Drag the right edge of a step to extend its gate length.",
        ]},
        { type: "h3", text: "Pads / Voices" },
        { type: "p", text: "Click a pad to trigger it, or use QWER / ASDF / ZXCV on keyboard. Drag a sample onto any pad (WAV/MP3/OGG/FLAC) to replace the synth with a sample. Drop multiple samples with different velocities to build velocity layers." },
        { type: "tip", text: "Hold a step + turn a knob on the selected voice to set a Parameter Lock (P-Lock) that only fires on that step." },
      ],
    },
  },
  {
    id: "synths",
    title: "3. Bass / Chords / Melody",
    body: {
      blocks: [
        { type: "p", text: "Each synth has its own 16-step piano-roll sequencer below the drums. Click the track name (BASS/CHORDS/MELODY) in the tabs to switch." },
        { type: "h3", text: "Scale + Root" },
        { type: "p", text: "Set the root note and scale once — all generated patterns stay in key. The scale also highlights in-scale rows in the Piano Roll." },
        { type: "h3", text: "Pop/House/etc. presets" },
        { type: "p", text: "Click the chevron next to the strategy name to cycle through genre generators. Click the name itself to re-roll the current strategy. Bass defaults are intentionally closed (low cutoff, low resonance, low drive) — use envelope + accent to open them upwards for classic 303 behavior." },
        { type: "tip", text: "If a generated pattern sounds too harsh, check the Bass cutoff knob — it should sit well below the middle. Start closed, modulate upwards." },
      ],
    },
  },
  {
    id: "pianoroll",
    title: "4. Piano Roll",
    body: {
      blocks: [
        { type: "p", text: "The Piano Roll opens any of the four tracks as a full-screen MIDI editor." },
        { type: "h3", text: "Essential shortcuts" },
        { type: "list", items: [
          "B = Draw mode · S = Select mode · L = Loop",
          "Click grid to place notes · drag edges to resize",
          "Shift+Drag = axis lock · Alt+Drag = duplicate + drag",
          "D = duplicate selected · 0–9 = set velocity",
          "Ctrl+Z undo · Ctrl+Shift+Z redo",
          "Arrow keys move selection (Shift = octave/bar)",
        ]},
        { type: "h3", text: "Transform menu" },
        { type: "p", text: "With notes selected, use the transform buttons: TRSP (Transpose ±1/±Oct), REV (Reverse), INV (Invert), LEG (Legato), HUM (Humanize), ×2/÷2 (Stretch)." },
      ],
    },
  },
  {
    id: "scenes-clips",
    title: "5. Scenes, Clips & Arrangement",
    body: {
      blocks: [
        { type: "h3", text: "Scenes" },
        { type: "p", text: "A Scene is a full snapshot of all four sequencers + their synth parameters. Capture via the SCENE button or Shift+1…0 shortcuts. Queue to switch live — launch quantize (NOW / 1 / 2 / 4 BAR) determines when the switch happens." },
        { type: "h3", text: "Clips" },
        { type: "p", text: "The CLIPS view is Ableton-style: a 4×8 matrix where each cell is one track's pattern. Click empty to capture, filled to queue, Ctrl+click to re-capture. Each track plays independently — you can mix clips from different scenes." },
        { type: "h3", text: "Arrangement" },
        { type: "p", text: "ARR opens a linear timeline of scenes. Drag scenes from the palette to the timeline, set repeats and optional tempo change per entry. Enable SONG MODE ON to play through the arrangement." },
      ],
    },
  },
  {
    id: "mixer",
    title: "6. Mixer & FX",
    body: {
      blocks: [
        { type: "h3", text: "Mixer" },
        { type: "p", text: "Click OPEN in the Mix Bus widget. Each channel has: Filter (LP/HP/BP) + Drive, 3-band EQ, Compressor, FX Rack (insert chain), send knobs for Reverb/Delay/Chorus/Phaser, Pan, Crossfader A/B group, Volume fader." },
        { type: "h3", text: "Sidechain" },
        { type: "p", text: "Kick can duck Bass / Chords / Melody independently. Toggle SC in the mixer header, then assign targets + amount + release." },
        { type: "h3", text: "FX Pad (XY)" },
        { type: "p", text: "Kaoss-style performance FX — Filter, Delay, Reverb, Flanger, Crush. Pick a target (master or individual track), hold and move the pad. HOLD latches the current position. REC records motion, press PLAY to loop it." },
      ],
    },
  },
  {
    id: "automation",
    title: "7. Automation & Modulation",
    body: {
      blocks: [
        { type: "h3", text: "Per-step Automation Lane" },
        { type: "p", text: "The small lane next to each synth sequencer draws value breakpoints per step. Pick any synth parameter from the dropdown; drag to set values; right-click a step to clear it." },
        { type: "h3", text: "Mod Matrix (MOD button)" },
        { type: "p", text: "Four LFO slots — pick a shape (sine/tri/saw/sqr/ramp), rate, destination (any synth or master param), and depth. The LFO runs freely and modulates the parameter around its current value." },
        { type: "h3", text: "Macro Knobs (MACRO button)" },
        { type: "p", text: "Eight user-driven macro controls. Each can bind up to 4 parameters with per-binding min/max/invert. Perfect for live performance snapshots." },
      ],
    },
  },
  {
    id: "midi",
    title: "8. MIDI",
    body: {
      blocks: [
        { type: "h3", text: "MIDI Input" },
        { type: "p", text: "Connect any MIDI keyboard/controller. Notes trigger drum pads via the GM drum map (kick=C1, snare=D1, etc). MIDI MAP opens the CC learn panel — click ASSIGN next to a target, move a knob on your controller, and it's mapped." },
        { type: "h3", text: "MIDI Record in Piano Roll" },
        { type: "p", text: "Arm the MIDI REC button in the Piano Roll toolbar, start playback, and play external notes — they're captured into the current clip at the playhead position." },
        { type: "h3", text: "MIDI Clock" },
        { type: "p", text: "SYNC button opens the clock panel. SEND makes Elastic Drums the master clock for external gear. RECEIVE follows external tempo + start/stop." },
      ],
    },
  },
  {
    id: "export",
    title: "9. Saving & Exporting",
    body: {
      blocks: [
        { type: "p", text: "The EXPORT dropdown (top-right) offers:" },
        { type: "list", items: [
          "Save / Load — persistent pattern library in IndexedDB",
          "Export MIDI — downloads a .mid file with all tracks",
          "Export WAV — bounces the current pattern to stereo WAV",
          "Export Stems (4×) — four WAVs: drums, hats, cym+perc, full mix",
          "Record Audio — live recording of entire session to WAV",
          "Share URL — encodes pattern into a URL you can paste anywhere",
        ]},
        { type: "p", text: "All changes auto-save to IndexedDB. Reload the page and your work is restored." },
      ],
    },
  },
  {
    id: "shortcuts",
    title: "10. Keyboard Shortcuts",
    body: {
      blocks: [
        { type: "list", items: [
          "Space — Play / Stop",
          "Q W E R · A S D F · Z X C V — Trigger pads (12 voices)",
          "1–0 — Load preset pattern 1–10",
          "Shift+1–0 — Trigger Scene 1–10",
          "← → — Previous / Next preset",
          "T — Tap tempo",
          "Ctrl+Z / Ctrl+Shift+Z — Undo / Redo (global)",
          "Right-click step — cycle velocity",
          "Shift+right-click — cycle ratchet",
          "Alt+right-click — cycle condition",
          "Escape — close any overlay",
        ]},
      ],
    },
  },
];

export function UserGuide({ isOpen, onClose }: UserGuideProps) {
  const [activeId, setActiveId] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const selectSection = useCallback((id: string) => setActiveId(id), []);

  if (!isOpen) return null;

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]!;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl w-[92vw] max-w-5xl h-[85vh] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar — TOC */}
        <div className="w-56 shrink-0 border-r border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 overflow-y-auto">
          <div className="px-4 py-3 border-b border-[var(--ed-border)]">
            <h2 className="text-sm font-black tracking-wider">USER GUIDE</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)] mt-0.5">
              Elastic Drums manual
            </div>
          </div>
          <nav className="py-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSection(s.id)}
                className={`w-full text-left px-4 py-1.5 text-[10px] font-bold tracking-wide transition-colors ${
                  s.id === activeId
                    ? "bg-[var(--ed-accent-orange)]/15 text-[var(--ed-accent-orange)] border-l-2 border-[var(--ed-accent-orange)]"
                    : "text-[var(--ed-text-secondary)] hover:bg-white/5 hover:text-[var(--ed-text-primary)]"
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-6 py-3 border-b border-[var(--ed-border)] flex items-center justify-between">
            <h3 className="text-base font-black tracking-wide">{active.title}</h3>
            <button
              onClick={onClose}
              className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-xl px-2"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 text-[var(--ed-text-primary)]">
            {active.body.blocks.map((block, i) => {
              if ("type" in block) {
                if (block.type === "p") {
                  return (
                    <p key={i} className="text-[12px] leading-relaxed text-[var(--ed-text-secondary)]">
                      {block.text}
                    </p>
                  );
                }
                if (block.type === "h3") {
                  return (
                    <h4 key={i} className="text-[11px] font-black tracking-[0.14em] text-[var(--ed-accent-orange)] mt-4 mb-1 uppercase">
                      {block.text}
                    </h4>
                  );
                }
                if (block.type === "list") {
                  return (
                    <ul key={i} className="space-y-1 text-[12px] leading-relaxed text-[var(--ed-text-secondary)] list-disc list-inside">
                      {block.items.map((it, j) => <li key={j}>{it}</li>)}
                    </ul>
                  );
                }
                if (block.type === "tip") {
                  return (
                    <div key={i} className="mt-2 rounded-lg border border-[var(--ed-accent-green)]/30 bg-[var(--ed-accent-green)]/8 px-3 py-2 text-[11px] text-[var(--ed-text-primary)]">
                      <strong className="text-[var(--ed-accent-green)]">💡 </strong>{block.text}
                    </div>
                  );
                }
              }
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
