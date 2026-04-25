/**
 * StockLibrary — Elastic Sound Pack MIDI browser
 *
 * Pack → Category → Pattern list → inline load buttons (no modal)
 * After loading, auto-switches the SynthSection to the right tab.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadMidiLibraryIndex,
  fetchAndParseMidi,
  midiToStepPattern,
  type MidiLibraryIndex,
  type MidiLibraryPattern,
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

// Category → best default load target
const CAT_TO_TARGET: Record<string, LoadTarget> = {
  chords: "chords",
  pads:   "chords",
  bass:   "bass",
  leads:  "melody",
  keys:   "chords",
  arps:   "melody",
  drums:  "drums",
  oneshots: "sampler",
};

// Load target → SynthSection tab name
const TARGET_TO_TAB: Record<LoadTarget, string> = {
  bass:    "bass",
  chords:  "chords",
  melody:  "melody",
  drums:   "drums",     // no synth tab, stays on library
  sampler: "sampler",
};

// Compact label + color per target
const TARGET_BUTTONS: { id: LoadTarget; label: string; color: string }[] = [
  { id: "bass",    label: "B",  color: "var(--ed-accent-bass)"   },
  { id: "chords",  label: "C",  color: "var(--ed-accent-chords)" },
  { id: "melody",  label: "M",  color: "var(--ed-accent-melody)" },
  { id: "drums",   label: "D",  color: "#f59e0b"                 },
  { id: "sampler", label: "S",  color: "#e879f9"                 },
];

// GM drum note → drum voice index (0-11)
const GM_DRUM_MAP: Record<number, number> = {
  36: 0, 38: 1, 40: 1, 37: 2, 39: 3,
  42: 6, 44: 6, 46: 7,
  49: 10, 57: 10, 51: 11, 59: 11,
  47: 4, 48: 4, 45: 4, 41: 4,
  43: 5, 50: 5,
  54: 9, 56: 8, 70: 9, 75: 9,
};

// ─── Load helpers ──────────────────────────────────────────────────────────────

function loadToBass(steps: boolean[], notes: number[], velocities: number[], len: number, transpose: number) {
  const chromaSteps: BassStep[] = steps.map((on, i) => ({
    active: on,
    note: on ? Math.max(0, Math.min(127, (notes[i] ?? 60) + transpose)) : 0,
    octave: 0, accent: false, velocity: on ? (velocities[i] ?? 0.8) : 0.8, slide: false, tie: false,
  }));
  useBassStore.getState().loadBassPattern({
    steps: chromaSteps.slice(0, len), length: len,
    params: { ...DEFAULT_BASS_PARAMS }, rootNote: 0, rootName: "C", scaleName: "Chromatic",
  });
}

function loadToChords(steps: boolean[], notes: number[], velocities: number[], len: number, transpose: number) {
  const chromaSteps: ChordsStep[] = steps.map((on, i) => ({
    active: on,
    note: on ? Math.max(0, Math.min(127, (notes[i] ?? 60) + transpose)) : 0,
    chordType: "maj", octave: 0, accent: false, velocity: on ? (velocities[i] ?? 0.8) : 0.8, tie: false,
  }));
  useChordsStore.getState().loadChordsPattern({
    steps: chromaSteps.slice(0, len), length: len,
    params: { ...DEFAULT_CHORDS_PARAMS }, rootNote: 0, rootName: "C", scaleName: "Chromatic",
  });
}

function loadToMelody(steps: boolean[], notes: number[], velocities: number[], len: number, transpose: number) {
  const chromaSteps: MelodyStep[] = steps.map((on, i) => ({
    active: on,
    note: on ? Math.max(0, Math.min(127, (notes[i] ?? 60) + transpose)) : 0,
    octave: 0, accent: false, velocity: on ? (velocities[i] ?? 0.8) : 0.8, slide: false, tie: false,
  }));
  useMelodyStore.getState().loadMelodyPattern({
    steps: chromaSteps.slice(0, len), length: len,
    params: { ...DEFAULT_MELODY_PARAMS }, rootNote: 0, rootName: "C", scaleName: "Chromatic",
  });
}

function loadToDrums(steps: boolean[], notes: number[], velocities: number[], len: number) {
  const pattern = structuredClone(useDrumStore.getState().pattern);
  for (let t = 0; t < 12; t++)
    for (let s = 0; s < len; s++)
      if (pattern.tracks[t]?.steps[s]) pattern.tracks[t]!.steps[s]!.active = false;
  for (let i = 0; i < len; i++) {
    if (!steps[i]) continue;
    const voice = GM_DRUM_MAP[notes[i] ?? 36] ?? 0;
    if (pattern.tracks[voice]?.steps[i]) {
      pattern.tracks[voice]!.steps[i]!.active = true;
      pattern.tracks[voice]!.steps[i]!.velocity = Math.round((velocities[i] ?? 0.8) * 127);
    }
  }
  pattern.length = len;
  useDrumStore.setState({ pattern });
}

function loadToSampler(steps: boolean[], velocities: number[], len: number) {
  const { selectedPad, steps: allSteps, velocities: allVels } = useSamplerStore.getState();
  const newSteps = allSteps.map((row, p) =>
    p !== selectedPad ? row : row.map((_, s) => s < len ? (steps[s] ?? false) : false)
  );
  const newVels = allVels.map((row, p) =>
    p !== selectedPad ? row : row.map((_, s) => s < len ? (velocities[s] ?? 0.8) : 0.8)
  );
  useSamplerStore.setState({ steps: newSteps, velocities: newVels });
}

/** Fire the synth-tab-switch event so SynthSection switches to the right tab. */
function switchToTab(target: LoadTarget) {
  const tab = TARGET_TO_TAB[target];
  if (tab && tab !== "drums") {
    window.dispatchEvent(new CustomEvent("synth-tab-switch", { detail: { tab } }));
  }
}

// ─── Pattern Row ───────────────────────────────────────────────────────────────

function PatternRow({
  pattern,
  packColor,
  defaultTarget,
  onLoad,
  loadingId,
  loadedId,
}: {
  pattern: MidiLibraryPattern;
  packColor: string;
  defaultTarget: LoadTarget;
  onLoad: (pattern: MidiLibraryPattern, target: LoadTarget) => void;
  loadingId: string | null;
  loadedId: string | null;
}) {
  const isLoading = loadingId === pattern.id;
  const isLoaded  = loadedId  === pattern.id;

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 rounded group"
      style={isLoaded ? { background: packColor + "18" } : undefined}
    >
      {/* Metadata */}
      <div className="flex-1 min-w-0">
        <span className="text-xs text-white/80 truncate block leading-tight">
          {pattern.instrument}
        </span>
        <span className="text-[10px] text-white/35 leading-tight">
          {pattern.key} {pattern.scale} · {pattern.bars}B · {pattern.bpm} BPM
        </span>
      </div>

      {/* Inline target buttons — always visible on hover, default highlighted */}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {TARGET_BUTTONS.map((t) => (
          <button
            key={t.id}
            disabled={isLoading}
            onClick={() => onLoad(pattern, t.id)}
            title={`Load to ${t.id}`}
            className="w-5 h-5 rounded text-[9px] font-bold transition-all"
            style={
              t.id === defaultTarget
                ? { background: t.color + "44", color: t.color, border: `1px solid ${t.color}88` }
                : { background: "transparent", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.12)" }
            }
          >
            {isLoading && t.id === defaultTarget ? "…" : t.label}
          </button>
        ))}
      </div>

      {/* Loaded checkmark */}
      {isLoaded && (
        <span className="text-[10px] shrink-0" style={{ color: packColor }}>✓</span>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function StockLibrary() {
  const [index, setIndex] = useState<MidiLibraryIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activePack, setActivePack] = useState("AMB");
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"instrument" | "bpm" | "key">("instrument");
  const [transpose, setTranspose] = useState(0);
  const [syncBpm, setSyncBpm] = useState(true);

  const [loadingPatternId, setLoadingPatternId] = useState<string | null>(null);
  const [loadedPatternId, setLoadedPatternId] = useState<string | null>(null);
  const loadedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadMidiLibraryIndex()
      .then((idx) => {
        setIndex(idx);
        if (idx.packs[0]) setActivePack(idx.packs[0].id);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const currentPack = index?.packs.find((p) => p.id === activePack) ?? null;
  const packColor = currentPack?.color ?? "#4A9EBA";

  const filteredPatterns = (index?.patterns ?? []).filter((p) => {
    if (p.pack !== activePack) return false;
    if (activeCategory !== "all" && p.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.instrument.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedPatterns = [...filteredPatterns].sort((a, b) =>
    sortBy === "bpm" ? a.bpm - b.bpm
    : sortBy === "key" ? a.key.localeCompare(b.key)
    : a.instrument.localeCompare(b.instrument)
  );

  const handleLoad = useCallback(
    async (pattern: MidiLibraryPattern, target: LoadTarget) => {
      setLoadingPatternId(pattern.id);
      try {
        const parsed = await fetchAndParseMidi(pattern.path);
        const pat = midiToStepPattern(parsed, 0, parsed.bpm, 0, pattern.bars);

        switch (target) {
          case "bass":    loadToBass   (pat.steps, pat.notes, pat.velocities, pat.patternLength, transpose); break;
          case "chords":  loadToChords (pat.steps, pat.notes, pat.velocities, pat.patternLength, transpose); break;
          case "melody":  loadToMelody (pat.steps, pat.notes, pat.velocities, pat.patternLength, transpose); break;
          case "drums":   loadToDrums  (pat.steps, pat.notes, pat.velocities, pat.patternLength); break;
          case "sampler": loadToSampler(pat.steps,            pat.velocities, pat.patternLength); break;
        }

        if (syncBpm) useDrumStore.getState().setBpm(pattern.bpm);

        // Auto-switch to the correct synth tab
        switchToTab(target);

        setLoadedPatternId(pattern.id);
        if (loadedTimer.current) clearTimeout(loadedTimer.current);
        loadedTimer.current = setTimeout(() => setLoadedPatternId(null), 2000);
      } catch (e) {
        console.error("MIDI load failed:", e);
      } finally {
        setLoadingPatternId(null);
      }
    },
    [transpose, syncBpm]
  );

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-white/40 text-xs">Loading library…</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center px-6">
        <div className="text-white/40 text-xs">MIDI library not built yet</div>
        <code className="text-white/25 text-[10px] bg-black/30 px-3 py-1 rounded">
          npm run build:midi-library
        </code>
        <div className="text-white/20 text-[9px]">{error}</div>
      </div>
    );
  }

  const categories = currentPack?.categories ?? [];
  const allCount = (index?.patterns ?? []).filter((p) => p.pack === activePack).length;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>

      {/* ── Pack tabs ──────────────────────────────────────── */}
      <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-white/5 overflow-x-auto">
        {(index?.packs ?? []).map((pack) => (
          <button
            key={pack.id}
            onClick={() => { setActivePack(pack.id); setActiveCategory("all"); }}
            className="shrink-0 text-[10px] font-bold px-3 py-1 rounded transition-all"
            style={
              activePack === pack.id
                ? { background: pack.color + "33", color: pack.color, border: `1px solid ${pack.color}66` }
                : { background: "transparent", color: "rgba(255,255,255,0.3)", border: "1px solid transparent" }
            }
          >
            {pack.id}
            <span className="ml-1 opacity-40 font-normal text-[9px]">{pack.patternCount}</span>
          </button>
        ))}
      </div>

      {/* ── Category chips ──────────────────────────────────── */}
      <div className="px-3 py-1.5 border-b border-white/5">
        <div className="text-[10px] mb-1" style={{ color: packColor + "99" }}>
          {currentPack?.name}
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setActiveCategory("all")}
            className="text-[10px] px-2 py-0.5 rounded transition-all"
            style={
              activeCategory === "all"
                ? { background: packColor + "33", color: packColor, border: `1px solid ${packColor}55` }
                : { color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.1)" }
            }
          >
            All <span className="opacity-50">{allCount}</span>
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
              {CAT_LABELS[cat.id] ?? cat.id} <span className="opacity-50">{cat.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Controls: search + sort + transpose + BPM sync ─── */}
      <div className="px-3 py-1.5 border-b border-white/5 space-y-1.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen…"
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

        {/* Transpose + BPM sync row */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-[10px] text-white/35 shrink-0">
              Transpose {transpose > 0 ? `+${transpose}` : transpose}st
            </span>
            <input
              type="range" min={-24} max={24} value={transpose}
              onChange={(e) => setTranspose(parseInt(e.target.value, 10))}
              className="flex-1 h-1 rounded appearance-none"
              style={{ accentColor: packColor }}
            />
            {transpose !== 0 && (
              <button
                onClick={() => setTranspose(0)}
                className="text-[9px] text-white/30 hover:text-white/60"
              >✕</button>
            )}
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
            <div
              className="w-6 h-3.5 rounded-full relative transition-all"
              style={{ background: syncBpm ? packColor + "88" : "rgba(255,255,255,0.1)" }}
              onClick={() => setSyncBpm(!syncBpm)}
            >
              <div
                className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all"
                style={{ left: syncBpm ? "calc(100% - 12px)" : "1px" }}
              />
            </div>
            <span className="text-[10px] text-white/40">BPM sync</span>
          </label>
        </div>
      </div>

      {/* ── Pattern list ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {/* Column header */}
        <div className="flex items-center gap-2 px-2 py-0.5 mb-0.5">
          <span className="flex-1 text-[9px] text-white/20 uppercase tracking-wide">Pattern</span>
          <span className="text-[9px] text-white/20 opacity-0 group-hover:opacity-100">B C M D S</span>
        </div>

        {sortedPatterns.length === 0 && (
          <div className="text-center text-white/30 text-xs py-8">Keine Patterns gefunden</div>
        )}

        {sortedPatterns.map((pattern) => (
          <PatternRow
            key={pattern.id}
            pattern={pattern}
            packColor={packColor}
            defaultTarget={CAT_TO_TARGET[pattern.category] ?? "melody"}
            onLoad={handleLoad}
            loadingId={loadingPatternId}
            loadedId={loadedPatternId}
          />
        ))}
      </div>
    </div>
  );
}
