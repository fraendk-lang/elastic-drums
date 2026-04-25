/**
 * StockLibrary — Elastic Sound Pack MIDI browser
 *
 * Pack → Category → Pattern list → Load to sequencer
 *
 * Uses chromatic scale (rootNote=0) so MIDI note numbers map directly to
 * scale degrees, preserving exact pitches across all target sequencers.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadMidiLibraryIndex,
  fetchAndParseMidi,
  midiToStepPattern,
  type MidiLibraryIndex,
  type MidiLibraryPattern,
  type MidiContentType,
} from "../audio/MidiLibraryParser";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useDrumStore } from "../store/drumStore";
import { useSamplerStore } from "../store/samplerStore";
import { DEFAULT_BASS_PARAMS, type BassStep } from "../audio/BassEngine";
import { DEFAULT_CHORDS_PARAMS, type ChordsStep } from "../audio/ChordsEngine";
import { DEFAULT_MELODY_PARAMS, type MelodyStep } from "../audio/MelodyEngine";

// ─── Types ─────────────────────────────────────────────────────────────────────

type LoadTarget = "bass" | "chords" | "melody" | "drums" | "sampler";

const CAT_LABELS: Record<string, string> = {
  all: "All",
  chords: "Chords",
  bass: "Bass",
  leads: "Leads",
  keys: "Keys",
  arps: "Arps",
  pads: "Pads",
  drums: "Drums",
  oneshots: "One Shots",
};

const CONTENT_TYPE_TARGET: Record<MidiContentType, LoadTarget> = {
  drums: "drums",
  bass: "bass",
  chords: "chords",
  melody: "melody",
};

const TARGET_LABELS: { id: LoadTarget; label: string; color: string }[] = [
  { id: "bass",    label: "BASS",    color: "var(--ed-accent-bass)"   },
  { id: "chords",  label: "CHORDS",  color: "var(--ed-accent-chords)" },
  { id: "melody",  label: "MELODY",  color: "var(--ed-accent-melody)" },
  { id: "drums",   label: "DRUMS",   color: "#f59e0b"                 },
  { id: "sampler", label: "SAMPLER", color: "#e879f9"                 },
];

// GM drum note → drum voice index (0-11)
const GM_DRUM_MAP: Record<number, number> = {
  36: 0, // Kick
  38: 1, // Snare
  40: 1, // Snare electric
  37: 2, // Cross stick → snare
  39: 3, // Clap
  42: 6, // Hi-hat closed
  44: 6, // Hi-hat pedal
  46: 7, // Hi-hat open
  49: 10, // Crash 1
  57: 10, // Crash 2
  51: 11, // Ride
  59: 11, // Ride edge
  47: 4, // Low-mid tom
  48: 4, // High-mid tom
  45: 4, // Low tom
  41: 4, // Low floor tom
  43: 5, // High floor tom
  50: 5, // High tom
  54: 9, // Tambourine → perc
  56: 8, // Cowbell → perc
  70: 9, // Maracas
  75: 9, // Claves
};

// ─── Load helpers ──────────────────────────────────────────────────────────────

function loadToBass(steps: boolean[], notes: number[], velocities: number[], patternLength: number, transpose: number) {
  const chromaSteps: BassStep[] = steps.map((on, i) => ({
    active: on,
    note: on ? Math.max(0, Math.min(127, (notes[i] ?? 60) + transpose)) : 0,
    octave: 0,
    accent: false,
    velocity: on ? (velocities[i] ?? 0.8) : 0.8,
    slide: false,
    tie: false,
  }));
  useBassStore.getState().loadBassPattern({
    steps: chromaSteps.slice(0, patternLength),
    length: patternLength,
    params: { ...DEFAULT_BASS_PARAMS },
    rootNote: 0,
    rootName: "C",
    scaleName: "Chromatic",
  });
}

function loadToChords(steps: boolean[], notes: number[], velocities: number[], patternLength: number, transpose: number) {
  const chromaSteps: ChordsStep[] = steps.map((on, i) => ({
    active: on,
    note: on ? Math.max(0, Math.min(127, (notes[i] ?? 60) + transpose)) : 0,
    chordType: "maj",
    octave: 0,
    accent: false,
    velocity: on ? (velocities[i] ?? 0.8) : 0.8,
    tie: false,
  }));
  useChordsStore.getState().loadChordsPattern({
    steps: chromaSteps.slice(0, patternLength),
    length: patternLength,
    params: { ...DEFAULT_CHORDS_PARAMS },
    rootNote: 0,
    rootName: "C",
    scaleName: "Chromatic",
  });
}

function loadToMelody(steps: boolean[], notes: number[], velocities: number[], patternLength: number, transpose: number) {
  const chromaSteps: MelodyStep[] = steps.map((on, i) => ({
    active: on,
    note: on ? Math.max(0, Math.min(127, (notes[i] ?? 60) + transpose)) : 0,
    octave: 0,
    accent: false,
    velocity: on ? (velocities[i] ?? 0.8) : 0.8,
    slide: false,
    tie: false,
  }));
  useMelodyStore.getState().loadMelodyPattern({
    steps: chromaSteps.slice(0, patternLength),
    length: patternLength,
    params: { ...DEFAULT_MELODY_PARAMS },
    rootNote: 0,
    rootName: "C",
    scaleName: "Chromatic",
  });
}

function loadToDrums(steps: boolean[], notes: number[], velocities: number[], patternLength: number) {
  const drumState = useDrumStore.getState();
  const pattern = structuredClone(drumState.pattern);

  // Clear existing steps across all 12 tracks (up to patternLength)
  for (let t = 0; t < 12; t++) {
    for (let s = 0; s < patternLength; s++) {
      if (pattern.tracks[t]?.steps[s]) {
        pattern.tracks[t]!.steps[s]!.active = false;
      }
    }
  }

  // Set new steps from MIDI drum notes
  for (let i = 0; i < patternLength; i++) {
    if (!steps[i]) continue;
    const midiNote = notes[i] ?? 36;
    const voice = GM_DRUM_MAP[midiNote] ?? 0;
    if (pattern.tracks[voice]?.steps[i]) {
      pattern.tracks[voice]!.steps[i]!.active = true;
      pattern.tracks[voice]!.steps[i]!.velocity = Math.round((velocities[i] ?? 0.8) * 127);
    }
  }

  pattern.length = patternLength;
  useDrumStore.setState({ pattern });
}

function loadToSampler(steps: boolean[], velocities: number[], patternLength: number) {
  const { selectedPad } = useSamplerStore.getState();
  // Load into selected pad's step row
  const newSteps = useSamplerStore.getState().steps.map((row, padIdx) => {
    if (padIdx !== selectedPad) return row;
    return row.map((_, stepIdx) => (stepIdx < patternLength ? (steps[stepIdx] ?? false) : false));
  });
  const newVelocities = useSamplerStore.getState().velocities.map((row, padIdx) => {
    if (padIdx !== selectedPad) return row;
    return row.map((_, stepIdx) => (stepIdx < patternLength ? (velocities[stepIdx] ?? 0.8) : 0.8));
  });
  useSamplerStore.setState({ steps: newSteps, velocities: newVelocities });
}

// ─── Pattern Row ───────────────────────────────────────────────────────────────

function PatternRow({
  pattern,
  packColor,
  onLoad,
  isLoading,
}: {
  pattern: MidiLibraryPattern;
  packColor: string;
  onLoad: (pattern: MidiLibraryPattern) => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 group">
      {/* Instrument name */}
      <div className="flex-1 min-w-0">
        <span className="text-xs text-white/80 truncate block leading-tight">
          {pattern.instrument}
        </span>
        <span className="text-[10px] text-white/40 leading-tight">
          {pattern.key} {pattern.scale} · {pattern.bars}B · V{String(pattern.variation).padStart(2, "0")}
        </span>
      </div>

      {/* BPM badge */}
      <span
        className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{ background: packColor + "22", color: packColor }}
      >
        {pattern.bpm}
      </span>

      {/* Load button */}
      <button
        onClick={() => onLoad(pattern)}
        disabled={isLoading}
        className="shrink-0 text-[10px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: packColor + "33", color: packColor, border: `1px solid ${packColor}55` }}
      >
        {isLoading ? "…" : "LOAD →"}
      </button>
    </div>
  );
}

// ─── Load Modal ────────────────────────────────────────────────────────────────

function LoadModal({
  pattern,
  packColor,
  onConfirm,
  onClose,
}: {
  pattern: MidiLibraryPattern;
  packColor: string;
  onConfirm: (target: LoadTarget, transpose: number, syncBpm: boolean) => void;
  onClose: () => void;
}) {
  const suggestedTarget = CONTENT_TYPE_TARGET[
    pattern.category === "drums" ? "drums"
    : pattern.category === "bass" ? "bass"
    : pattern.category === "chords" || pattern.category === "pads" ? "chords"
    : "melody"
  ] ?? "melody";

  const [target, setTarget] = useState<LoadTarget>(suggestedTarget);
  const [transpose, setTranspose] = useState(0);
  const [syncBpm, setSyncBpm] = useState(true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-4 w-80 space-y-3"
        style={{ background: "#1a1a2e", border: `1px solid ${packColor}44` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <div className="text-xs font-bold" style={{ color: packColor }}>{pattern.instrument}</div>
          <div className="text-[10px] text-white/40">
            {pattern.key} {pattern.scale} · {pattern.bpm} BPM · {pattern.bars} bars
          </div>
        </div>

        {/* Target selection */}
        <div>
          <div className="text-[10px] text-white/40 mb-1.5">LOAD INTO</div>
          <div className="flex flex-wrap gap-1.5">
            {TARGET_LABELS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTarget(t.id)}
                className="text-[10px] px-2 py-1 rounded transition-all"
                style={
                  target === t.id
                    ? { background: t.color + "33", color: t.color, border: `1px solid ${t.color}88` }
                    : { background: "transparent", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.15)" }
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Transpose */}
        {target !== "drums" && (
          <div>
            <div className="text-[10px] text-white/40 mb-1">
              TRANSPOSE: {transpose > 0 ? `+${transpose}` : transpose} st
            </div>
            <input
              type="range"
              min={-24}
              max={24}
              value={transpose}
              onChange={(e) => setTranspose(parseInt(e.target.value, 10))}
              className="w-full h-1 rounded appearance-none"
              style={{ accentColor: packColor }}
            />
            <div className="flex justify-between text-[9px] text-white/20 mt-0.5">
              <span>-24</span>
              <button
                className="text-white/30 hover:text-white/60"
                onClick={() => setTranspose(0)}
              >
                reset
              </button>
              <span>+24</span>
            </div>
          </div>
        )}

        {/* BPM sync */}
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            className="w-7 h-4 rounded-full relative transition-all"
            style={{ background: syncBpm ? packColor + "88" : "rgba(255,255,255,0.1)" }}
            onClick={() => setSyncBpm(!syncBpm)}
          >
            <div
              className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
              style={{ left: syncBpm ? "calc(100% - 14px)" : "2px" }}
            />
          </div>
          <span className="text-[10px] text-white/60">Sync BPM to {pattern.bpm}</span>
        </label>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded text-xs text-white/40 hover:text-white/60 transition-colors"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(target, transpose, syncBpm)}
            className="flex-1 py-1.5 rounded text-xs font-bold transition-all"
            style={{ background: packColor + "33", color: packColor, border: `1px solid ${packColor}66` }}
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function StockLibrary() {
  const [index, setIndex] = useState<MidiLibraryIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activePack, setActivePack] = useState<string>("AMB");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"instrument" | "bpm" | "key">("instrument");

  const [modalPattern, setModalPattern] = useState<MidiLibraryPattern | null>(null);
  const [loadingPatternId, setLoadingPatternId] = useState<string | null>(null);
  const [loadedPatternId, setLoadedPatternId] = useState<string | null>(null);
  const loadedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load index on mount
  useEffect(() => {
    loadMidiLibraryIndex()
      .then((idx) => {
        setIndex(idx);
        if (idx.packs[0]) setActivePack(idx.packs[0].id);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentPack = index?.packs.find((p) => p.id === activePack) ?? null;
  const packColor = currentPack?.color ?? "#4A9EBA";

  // Filter patterns
  const filteredPatterns = (index?.patterns ?? []).filter((p) => {
    if (p.pack !== activePack) return false;
    if (activeCategory !== "all" && p.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.instrument.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort
  const sortedPatterns = [...filteredPatterns].sort((a, b) => {
    if (sortBy === "bpm") return a.bpm - b.bpm;
    if (sortBy === "key") return a.key.localeCompare(b.key);
    return a.instrument.localeCompare(b.instrument);
  });

  const handleOpenModal = useCallback((pattern: MidiLibraryPattern) => {
    setModalPattern(pattern);
  }, []);

  const handleConfirmLoad = useCallback(
    async (target: LoadTarget, transpose: number, syncBpm: boolean) => {
      if (!modalPattern) return;
      setModalPattern(null);
      setLoadingPatternId(modalPattern.id);

      try {
        const parsed = await fetchAndParseMidi(modalPattern.path);
        const pattern = midiToStepPattern(parsed, 0, parsed.bpm, 0, modalPattern.bars);

        switch (target) {
          case "bass":
            loadToBass(pattern.steps, pattern.notes, pattern.velocities, pattern.patternLength, transpose);
            break;
          case "chords":
            loadToChords(pattern.steps, pattern.notes, pattern.velocities, pattern.patternLength, transpose);
            break;
          case "melody":
            loadToMelody(pattern.steps, pattern.notes, pattern.velocities, pattern.patternLength, transpose);
            break;
          case "drums":
            loadToDrums(pattern.steps, pattern.notes, pattern.velocities, pattern.patternLength);
            break;
          case "sampler":
            loadToSampler(pattern.steps, pattern.velocities, pattern.patternLength);
            break;
        }

        if (syncBpm) {
          useDrumStore.getState().setBpm(modalPattern.bpm);
        }

        setLoadedPatternId(modalPattern.id);
        if (loadedTimer.current) clearTimeout(loadedTimer.current);
        loadedTimer.current = setTimeout(() => setLoadedPatternId(null), 1500);
      } catch (e) {
        console.error("Failed to load MIDI pattern:", e);
      } finally {
        setLoadingPatternId(null);
      }
    },
    [modalPattern]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-white/40 text-sm">
        Loading library…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
        <div className="text-white/40 text-xs">MIDI library not found</div>
        <div className="text-white/25 text-[10px] font-mono bg-black/30 px-3 py-1.5 rounded">
          node scripts/build-midi-library.cjs
        </div>
        <div className="text-white/20 text-[10px]">{error}</div>
      </div>
    );
  }

  const categories = currentPack?.categories ?? [];

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Pack tabs */}
      <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-white/5 overflow-x-auto">
        {(index?.packs ?? []).map((pack) => (
          <button
            key={pack.id}
            onClick={() => {
              setActivePack(pack.id);
              setActiveCategory("all");
            }}
            className="shrink-0 text-[10px] font-bold px-3 py-1 rounded transition-all"
            style={
              activePack === pack.id
                ? { background: pack.color + "33", color: pack.color, border: `1px solid ${pack.color}88` }
                : { background: "transparent", color: "rgba(255,255,255,0.35)", border: "1px solid transparent" }
            }
          >
            {pack.id}
            <span className="ml-1 opacity-50 font-normal">{pack.patternCount}</span>
          </button>
        ))}
      </div>

      {/* Pack name + category filters */}
      <div className="px-3 py-1.5 border-b border-white/5">
        <div className="text-[10px] text-white/30 mb-1.5" style={{ color: packColor + "99" }}>
          {currentPack?.name ?? activePack}
        </div>
        <div className="flex gap-1 flex-wrap">
          {/* "All" chip */}
          <button
            onClick={() => setActiveCategory("all")}
            className="text-[10px] px-2 py-0.5 rounded transition-all"
            style={
              activeCategory === "all"
                ? { background: packColor + "33", color: packColor, border: `1px solid ${packColor}55` }
                : { color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.1)" }
            }
          >
            All <span className="opacity-60">{filteredPatterns.length || (index?.patterns ?? []).filter(p => p.pack === activePack).length}</span>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="text-[10px] px-2 py-0.5 rounded transition-all"
              style={
                activeCategory === cat.id
                  ? { background: packColor + "33", color: packColor, border: `1px solid ${packColor}55` }
                  : { color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.1)" }
              }
            >
              {CAT_LABELS[cat.id] ?? cat.name} <span className="opacity-60">{cat.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex gap-2 px-3 py-1.5 border-b border-white/5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 bg-white/5 rounded px-2 py-1 text-xs text-white/70 placeholder-white/20 outline-none"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="bg-white/5 rounded px-2 py-1 text-[10px] text-white/50 outline-none"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <option value="instrument">Name</option>
          <option value="bpm">BPM</option>
          <option value="key">Key</option>
        </select>
      </div>

      {/* Pattern list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {sortedPatterns.length === 0 && (
          <div className="text-center text-white/30 text-xs py-8">No patterns found</div>
        )}
        {sortedPatterns.map((pattern) => (
          <div
            key={pattern.id}
            style={
              loadedPatternId === pattern.id
                ? { background: packColor + "22", borderRadius: 6 }
                : undefined
            }
          >
            <PatternRow
              pattern={pattern}
              packColor={packColor}
              onLoad={handleOpenModal}
              isLoading={loadingPatternId === pattern.id}
            />
          </div>
        ))}
      </div>

      {/* Load modal */}
      {modalPattern && (
        <LoadModal
          pattern={modalPattern}
          packColor={packColor}
          onConfirm={handleConfirmLoad}
          onClose={() => setModalPattern(null)}
        />
      )}
    </div>
  );
}
