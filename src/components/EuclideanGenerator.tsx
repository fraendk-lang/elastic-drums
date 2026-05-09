/**
 * Euclidean Generator — evenly-distributed rhythmic patterns with
 * an optional second pattern used as an accent overlay.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useDrumStore, generateEuclidean, drumCurrentStepStore, getDrumCurrentStep } from "../store/drumStore";
import { HintPopover } from "./Hints";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useMelodyLayerStore, LAYER_COLORS } from "../store/melodyLayerStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L", "TOM M", "TOM H",
  "HH CL", "HH OP", "CYM", "RIDE", "PRC1", "PRC2",
];

// ── Kit Fill — base patterns per voice (at density 1.0) ──────────────────────
// Index matches VOICE_LABELS. rotation = step offset for musical placement.
const KIT_FILL_BASE: { pulses: number; steps: number; rotation: number }[] = [
  { pulses: 4, steps: 16, rotation: 0  }, // KICK  — four-on-floor
  { pulses: 2, steps: 16, rotation: 4  }, // SNARE — beats 2 & 4
  { pulses: 2, steps: 16, rotation: 4  }, // CLAP  — beats 2 & 4
  { pulses: 1, steps: 16, rotation: 3  }, // TOM L — sparse
  { pulses: 1, steps: 16, rotation: 7  }, // TOM M — sparse offset
  { pulses: 1, steps: 16, rotation: 11 }, // TOM H — sparse offset
  { pulses: 8, steps: 16, rotation: 0  }, // HH CL — 8th notes
  { pulses: 2, steps: 16, rotation: 2  }, // HH OP — offbeats
  { pulses: 1, steps: 16, rotation: 0  }, // CYM   — downbeat
  { pulses: 4, steps: 16, rotation: 1  }, // RIDE  — slight offset
  { pulses: 3, steps: 16, rotation: 2  }, // PRC1
  { pulses: 3, steps: 16, rotation: 5  }, // PRC2
];

// ── Groove Styles — multi-voice presets ──────────────────────────────────────
interface VoicePat { p: number; s: number; r: number }
interface GrooveStyle {
  name: string;
  hint: string;
  emoji: string;
  voices: Partial<Record<number, VoicePat>>; // voice index → E(p,s,r)
}

const GROOVE_STYLES: GrooveStyle[] = [
  {
    name: "House",   emoji: "🏠", hint: "Four-on-floor, offbeat open HH, snare on 2&4",
    voices: {
      0: { p: 4, s: 16, r: 0  }, // KICK
      1: { p: 2, s: 16, r: 4  }, // SNARE
      2: { p: 2, s: 16, r: 4  }, // CLAP
      6: { p: 8, s: 16, r: 0  }, // HH CL
      7: { p: 4, s: 16, r: 2  }, // HH OP
      9: { p: 4, s: 16, r: 1  }, // RIDE
    },
  },
  {
    name: "Techno",  emoji: "⚙️", hint: "Driving kick, 16th HH, sparse accents",
    voices: {
      0: { p: 4,  s: 16, r: 0 }, // KICK
      1: { p: 2,  s: 16, r: 4 }, // SNARE
      2: { p: 1,  s: 16, r: 4 }, // CLAP
      6: { p: 16, s: 16, r: 0 }, // HH CL — 16th notes
      7: { p: 3,  s: 16, r: 2 }, // HH OP
      8: { p: 2,  s: 16, r: 0 }, // CYM
      9: { p: 4,  s: 16, r: 1 }, // RIDE
    },
  },
  {
    name: "Trap",    emoji: "🔫", hint: "Sparse kick, hi-hat rolls, snare on 3",
    voices: {
      0: { p: 3,  s: 16, r: 0 }, // KICK — sparse
      1: { p: 1,  s: 16, r: 8 }, // SNARE — beat 3
      2: { p: 2,  s: 16, r: 4 }, // CLAP
      6: { p: 16, s: 16, r: 0 }, // HH CL — every step
      7: { p: 4,  s: 16, r: 3 }, // HH OP
      9: { p: 8,  s: 16, r: 1 }, // RIDE
     10: { p: 5,  s: 16, r: 2 }, // PRC1
    },
  },
  {
    name: "Afrobeat", emoji: "🌍", hint: "Cuban clave feel, layered percussion",
    voices: {
      0: { p: 3, s: 16, r: 0 }, // KICK — tresillo
      1: { p: 2, s: 16, r: 3 }, // SNARE
      2: { p: 5, s: 16, r: 1 }, // CLAP — cinquillo
      3: { p: 3, s: 16, r: 2 }, // TOM L
      4: { p: 5, s: 16, r: 4 }, // TOM M
      6: { p: 7, s: 16, r: 0 }, // HH CL — Bulgarian-ish
      7: { p: 3, s: 16, r: 4 }, // HH OP
     10: { p: 5, s:  8, r: 0 }, // PRC1 — dense clave
     11: { p: 3, s:  8, r: 1 }, // PRC2
    },
  },
  {
    name: "Jazz",    emoji: "🎷", hint: "Loose ride, brush snare, sparse kick",
    voices: {
      0: { p: 2, s: 16, r: 0 }, // KICK — sparse
      1: { p: 3, s: 16, r: 2 }, // SNARE — brush feel
      6: { p: 5, s: 16, r: 0 }, // HH CL — swing-like
      7: { p: 2, s: 16, r: 6 }, // HH OP
      8: { p: 2, s: 16, r: 8 }, // CYM
      9: { p: 8, s: 16, r: 1 }, // RIDE — ride pattern
    },
  },
  {
    name: "Samba",   emoji: "🇧🇷", hint: "Layered surdo, tamborim, agogô feel",
    voices: {
      0: { p: 3, s: 16, r: 0 }, // KICK — surdo
      1: { p: 5, s: 16, r: 1 }, // SNARE — caixa
      2: { p: 3, s:  8, r: 0 }, // CLAP  — palma
      3: { p: 5, s: 16, r: 2 }, // TOM L — surdo 2
      4: { p: 3, s: 16, r: 4 }, // TOM M
      6: { p: 8, s: 16, r: 0 }, // HH CL
      7: { p: 2, s: 16, r: 3 }, // HH OP
     10: { p: 5, s: 16, r: 3 }, // PRC1 — tamborim
     11: { p: 7, s: 16, r: 2 }, // PRC2 — agogô
    },
  },
  {
    name: "DnB",     emoji: "⚡", hint: "Amen-inspired breakbeat, syncopated",
    voices: {
      0: { p: 3, s: 16, r: 0 }, // KICK
      1: { p: 5, s: 16, r: 2 }, // SNARE — syncopated
      2: { p: 2, s: 16, r: 5 }, // CLAP
      6: { p: 13,s: 16, r: 0 }, // HH CL — busy
      7: { p: 4, s: 16, r: 1 }, // HH OP
      8: { p: 3, s: 16, r: 3 }, // CYM
      9: { p: 5, s: 16, r: 2 }, // RIDE
    },
  },
  {
    name: "Reggae",  emoji: "🌿", hint: "One-drop kick, skank rhythm, sparse",
    voices: {
      0: { p: 2, s: 16, r: 8 }, // KICK — one drop (beat 3)
      1: { p: 2, s: 16, r: 4 }, // SNARE
      2: { p: 4, s: 16, r: 2 }, // CLAP — skank offbeats
      6: { p: 4, s: 16, r: 0 }, // HH CL
      7: { p: 4, s: 16, r: 2 }, // HH OP — upbeat skank
      9: { p: 4, s: 16, r: 2 }, // RIDE
    },
  },

  // ─── Polyrhythmic styles — voices use DIFFERENT step counts ─────────────
  // The drum pattern length stays at 16 (the global cycle), but each voice
  // loops its own shorter cycle. Voice with s=12 over a 16-step pattern
  // creates 3-against-4 polyrhythm. Sounds nothing like static 16-step grids.
  {
    name: "3:4 Cross", emoji: "🔀", hint: "Hi-hat in 3, kick in 4 — Steve Reich vibe",
    voices: {
      0: { p: 4,  s: 16, r: 0 }, // KICK on 4
      1: { p: 2,  s: 16, r: 4 }, // SNARE 2/4
      6: { p: 3,  s: 12, r: 0 }, // HH CL — 3 in 12 steps over kick's 16 → poly
      9: { p: 3,  s: 12, r: 1 }, // RIDE — same length but offset
      10:{ p: 2,  s: 7,  r: 0 }, // PERC1 — 2 in 7, very off-grid
    },
  },
  {
    name: "African 12/8", emoji: "🥁", hint: "Triplet-based bell + drum dialogue",
    voices: {
      0: { p: 3,  s: 12, r: 0 },  // KICK — three pulses across the bar
      1: { p: 2,  s: 12, r: 6 },  // SNARE — 2-pulse off-set
      6: { p: 12, s: 12, r: 0 },  // HH CL — every 8th note
      9: { p: 5,  s: 12, r: 0 },  // RIDE — bell pattern (3+3+2+2+2 feel)
      10:{ p: 7,  s: 12, r: 1 },  // PERC1 — busy counter-rhythm
    },
  },
  {
    name: "Glitch Cross", emoji: "⚡", hint: "5/13/7 polymeter — IDM rhythmic chaos",
    voices: {
      0: { p: 3,  s: 5,  r: 0 }, // KICK — 3 in 5
      1: { p: 1,  s: 7,  r: 3 }, // SNARE — 1 in 7
      6: { p: 7,  s: 13, r: 0 }, // HH CL — 7 in 13
      10:{ p: 4,  s: 11, r: 2 }, // PERC1 — 4 in 11
      11:{ p: 5,  s: 9,  r: 4 }, // PERC2 — 5 in 9
    },
  },
];

const NOTE_MODES = [
  { id: "root",       label: "Root" },
  { id: "ascending",  label: "Ascend" },
  { id: "contour",    label: "Contour" },
  { id: "walk",       label: "Walk" },
  { id: "alternate",  label: "1 ↔ 5" },
  { id: "pentatonic", label: "Pentatonic" },
  { id: "random",     label: "Random" },
];

const GATE_MODES: { id: "stac"|"med"|"leg"|"tie"; label: string; hint: string }[] = [
  { id: "stac", label: "STAC", hint: "Staccato — 1 step gate (default)" },
  { id: "med",  label: "MED",  hint: "Medium — half distance to next hit" },
  { id: "leg",  label: "LEG",  hint: "Legato — fills to next hit" },
  { id: "tie",  label: "TIE",  hint: "Tied — legato + no re-trigger" },
];

type Target = "drums" | "bass" | "chords" | "melody" | "layers";

const TARGETS: { id: Target; label: string; color: string }[] = [
  { id: "drums",  label: "DRUMS",  color: "var(--ed-accent-orange)" },
  { id: "bass",   label: "BASS",   color: "var(--ed-accent-bass)" },
  { id: "chords", label: "CHORDS", color: "var(--ed-accent-chords)" },
  { id: "melody", label: "MELODY", color: "var(--ed-accent-melody)" },
  { id: "layers", label: "LAYERS", color: "#a78bfa" },
];

// ── User Style persistence ──────────────────────────────────────────────────
// User-saved styles live alongside factory ones. Stored in localStorage so
// they survive across sessions; not synced anywhere else.
const USER_STYLES_KEY = "eg-euclid-user-styles";

function loadUserStyles(): GrooveStyle[] {
  try {
    const raw = localStorage.getItem(USER_STYLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s === "object" && typeof s.name === "string" && s.voices);
  } catch { return []; }
}

function saveUserStyles(styles: GrooveStyle[]): void {
  try { localStorage.setItem(USER_STYLES_KEY, JSON.stringify(styles)); }
  catch { /* private mode — silently no-op */ }
}

// Presets including world-music rhythms
interface EuclidPreset { label: string; p: number; s: number; r?: number; hint?: string }
const PRESETS: EuclidPreset[] = [
  { label: "4/16",   p: 4,  s: 16, hint: "Four on floor" },
  { label: "3/8",    p: 3,  s: 8,  hint: "Cuban tresillo" },
  { label: "5/8",    p: 5,  s: 8,  hint: "Cuban cinquillo" },
  { label: "3/16",   p: 3,  s: 16, hint: "Sparse" },
  { label: "5/16",   p: 5,  s: 16, hint: "Bossa / Son" },
  { label: "7/16",   p: 7,  s: 16, hint: "Bulgarian" },
  { label: "9/16",   p: 9,  s: 16, hint: "Aksak" },
  { label: "11/24",  p: 11, s: 24, hint: "Arab Wawuli" },
  { label: "13/16",  p: 13, s: 16, hint: "Busy / Glitch" },
  { label: "2/5",    p: 2,  s: 5,  hint: "Thai / Korean" },
  { label: "4/11",   p: 4,  s: 11, hint: "Frank Zappa vibe" },
  { label: "5/12",   p: 5,  s: 12, hint: "West-African" },
];

interface EuclideanGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EuclideanGenerator({ isOpen, onClose }: EuclideanGeneratorProps) {
  const { selectedVoice, applyEuclidean: applyDrumEuclidean } = useDrumStore();
  const { applyEuclidean: applyBassEuclidean } = useBassStore();
  const { applyEuclidean: applyChordsEuclidean } = useChordsStore();
  const { applyEuclidean: applyMelodyEuclidean, scaleName: melodyScale, rootNote: melodyRoot } = useMelodyStore();
  const { applyLayerEuclidean, setEnabled: setLayersEnabled, layers, activeLayerId } = useMelodyLayerStore();
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const activeLayerColor = activeLayer ? LAYER_COLORS[activeLayer.colorIndex] : "#a78bfa";

  const [target, setTarget] = useState<Target>("drums");
  const [pulses, setPulses] = useState(4);
  const [steps, setSteps] = useState(16);
  const [rotation, setRotation] = useState(0);
  const [accentPulses, setAccentPulses] = useState(0);
  const [accentRotation, setAccentRotation] = useState(0);
  const [noteMode, setNoteMode] = useState("root");
  const [gateMode, setGateMode] = useState<"stac"|"med"|"leg"|"tie">("stac");
  const [octaveRange, setOctaveRange] = useState<1|2|3>(1);
  const [kitDensity, setKitDensity] = useState(0.5);  // 0 = sparse … 1 = dense
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  // Per-voice custom step count — when enabled, each voice loops its own
  // s value, creating a polyrhythmic kit (different cycle lengths run
  // simultaneously). Default 16 keeps current behaviour unchanged.
  const [voiceStepsExpanded, setVoiceStepsExpanded] = useState(false);
  const [voiceSteps, setVoiceSteps] = useState<number[]>(() => Array(12).fill(16));

  // User-saved styles — captured from current per-voice kit state
  const [userStyles, setUserStyles] = useState<GrooveStyle[]>(() => loadUserStyles());
  // Bass FOLLOW mode: when set, bass takes its rhythm from the named drum
  // track instead of running the Euclidean math. Lets you lock bass to kick
  // (track 0) for tight unison or to snare (track 1) for off-beat phrasing.
  const [bassFollowTrack, setBassFollowTrack] = useState<number | null>(null);
  // DRIFT mode — when on, the pattern auto-mutates every `driftBars` bars
  // while the transport is playing. Slow evolution without the user clicking.
  const [driftEnabled, setDriftEnabled] = useState(false);
  const [driftBars, setDriftBars] = useState<2|4|8>(4);

  // MORPH — two snapshot slots (A and B) and a 0..100 slider that linearly
  // interpolates between them. Each snapshot captures p/s/r/accent state.
  // Live-applies on every slider change so you hear the morph in real time.
  interface PatternSnap { p: number; s: number; r: number; ap: number; ar: number }
  const [snapA, setSnapA] = useState<PatternSnap | null>(null);
  const [snapB, setSnapB] = useState<PatternSnap | null>(null);
  const [morphPct, setMorphPct] = useState(0); // 0..100

  // Hint anchors — point at the rows where the feature lives so first-time
  // users can find them.
  const morphRowRef = useRef<HTMLDivElement>(null);
  const driftRowRef = useRef<HTMLDivElement>(null);
  const followRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const rhythm = useMemo(() => generateEuclidean(pulses, steps, rotation), [pulses, steps, rotation]);
  const accent = useMemo(
    () => (accentPulses > 0 ? generateEuclidean(accentPulses, steps, accentRotation) : null),
    [accentPulses, steps, accentRotation],
  );

  // For LAYERS target, reflect the active layer's color in the UI
  const targetsWithLayerColor = TARGETS.map((t) =>
    t.id === "layers" ? { ...t, color: activeLayerColor } : t
  );
  const activeTarget = targetsWithLayerColor.find((t) => t.id === target)!;
  const accentColor = activeTarget.color;
  const isSynth = target !== "drums";

  // Apply current settings to the active target. Does NOT close the dialog —
  // used by MUTATE / preset clicks for instant audible feedback.
  const applyToTarget = useCallback((p: number, s: number, r: number, ap: number, ar: number) => {
    switch (target) {
      case "drums":
        applyDrumEuclidean(selectedVoice, p, s, r, ap, ar);
        break;
      case "bass":
        applyBassEuclidean(p, s, r, noteMode, ap, ar, gateMode, octaveRange, bassFollowTrack ?? undefined);
        break;
      case "chords":
        applyChordsEuclidean(p, s, r, noteMode, ap, ar, gateMode, octaveRange);
        break;
      case "melody":
        applyMelodyEuclidean(p, s, r, noteMode, ap, ar, gateMode, octaveRange);
        break;
      case "layers":
        applyLayerEuclidean(p, s, r, noteMode, melodyScale, melodyRoot, ap, ar);
        setLayersEnabled(true);
        break;
    }
  }, [target, selectedVoice, noteMode, gateMode, octaveRange, bassFollowTrack,
      applyDrumEuclidean, applyBassEuclidean, applyChordsEuclidean, applyMelodyEuclidean,
      applyLayerEuclidean, setLayersEnabled, melodyScale, melodyRoot]);

  const handleApply = useCallback(() => {
    applyToTarget(pulses, steps, rotation, accentPulses, accentRotation);
    onClose();
  }, [applyToTarget, pulses, steps, rotation, accentPulses, accentRotation, onClose]);

  const mutate = useCallback(() => {
    // Compute mutated values, then update state AND apply in one shot so the
    // user hears the result immediately. Old behaviour just changed state and
    // required a separate APPLY click.
    let nextPulses = pulses;
    let nextRotation = rotation;
    let nextAccentPulses = accentPulses;
    let nextAccentRotation = accentRotation;

    const roll = Math.random();
    if (roll < 0.35) {
      nextRotation = (rotation + 1 + Math.floor(Math.random() * (steps - 1))) % steps;
    } else if (roll < 0.6 && pulses < steps) {
      nextPulses = Math.min(steps, pulses + 1);
    } else if (roll < 0.8 && pulses > 1) {
      nextPulses = Math.max(1, pulses - 1);
    } else if (accentPulses > 0) {
      nextAccentRotation = (accentRotation + 1) % steps;
    } else {
      nextAccentPulses = Math.max(1, Math.floor(pulses / 2));
    }

    setPulses(nextPulses);
    setRotation(nextRotation);
    setAccentPulses(nextAccentPulses);
    setAccentRotation(nextAccentRotation);

    applyToTarget(nextPulses, steps, nextRotation, nextAccentPulses, nextAccentRotation);
  }, [steps, pulses, rotation, accentPulses, accentRotation, applyToTarget]);

  // ── MORPH ────────────────────────────────────────────────────────────────
  const captureSnap = useCallback((): PatternSnap => ({
    p: pulses, s: steps, r: rotation, ap: accentPulses, ar: accentRotation,
  }), [pulses, steps, rotation, accentPulses, accentRotation]);

  const handleSnapA = useCallback(() => { setSnapA(captureSnap()); }, [captureSnap]);
  const handleSnapB = useCallback(() => { setSnapB(captureSnap()); }, [captureSnap]);

  const handleMorph = useCallback((pct: number) => {
    setMorphPct(pct);
    if (!snapA || !snapB) return;
    const t = pct / 100;
    // Linear interpolate; round to ints. Steps takes max so the longer cycle
    // dominates and sub-step rotations still make sense.
    const morphedSteps = Math.max(2, Math.round(snapA.s + (snapB.s - snapA.s) * t));
    const morphedPulses = Math.max(0, Math.min(morphedSteps, Math.round(snapA.p + (snapB.p - snapA.p) * t)));
    // Rotate via shortest direction on the modular ring
    const rotDelta = ((snapB.r - snapA.r + morphedSteps) % morphedSteps);
    const rotShort = rotDelta > morphedSteps / 2 ? rotDelta - morphedSteps : rotDelta;
    const morphedRotation = ((snapA.r + rotShort * t) % morphedSteps + morphedSteps) % morphedSteps;
    const morphedAccentPulses = Math.max(0, Math.round(snapA.ap + (snapB.ap - snapA.ap) * t));
    const morphedAccentRotation = Math.round(snapA.ar + (snapB.ar - snapA.ar) * t);

    // Update local state and live-apply
    setPulses(morphedPulses);
    setSteps(morphedSteps);
    setRotation(Math.round(morphedRotation));
    setAccentPulses(morphedAccentPulses);
    setAccentRotation(morphedAccentRotation);
    applyToTarget(morphedPulses, morphedSteps, Math.round(morphedRotation), morphedAccentPulses, morphedAccentRotation);
  }, [snapA, snapB, applyToTarget]);

  // ── DRIFT: auto-mutate every `driftBars` bars while transport is playing ──
  // Subscribes to the drum-step external store. Each time we cross step 0
  // (start of a new bar in 16-step land), increment a bar counter; when it
  // reaches the threshold, fire mutate() and reset.
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const lastSeenStepRef = useRef(getDrumCurrentStep());
  const barCounterRef = useRef(0);
  useEffect(() => {
    if (!driftEnabled || !isOpen) return;
    const unsubscribe = drumCurrentStepStore.subscribe(() => {
      const step = getDrumCurrentStep();
      const prev = lastSeenStepRef.current;
      lastSeenStepRef.current = step;
      // Bar boundary = wrap from end-of-bar back to step 0
      // Detect via "step decreased" (e.g., 15 → 0) or "step jumped backwards"
      if (step < prev || (step === 0 && prev !== 0)) {
        barCounterRef.current += 1;
        if (barCounterRef.current >= driftBars) {
          barCounterRef.current = 0;
          mutateRef.current();
        }
      }
    });
    return unsubscribe;
  }, [driftEnabled, driftBars, isOpen]);

  const invert = useCallback(() => {
    // Logical inverse: complement pulses within steps
    const newPulses = steps - pulses;
    setPulses(newPulses);
  }, [steps, pulses]);

  const reset = useCallback(() => {
    setPulses(4);
    setSteps(16);
    setRotation(0);
    setAccentPulses(0);
    setAccentRotation(0);
  }, []);

  // ── Kit Fill: apply scaled base patterns to all 12 drum voices ──
  const handleFillKit = useCallback(() => {
    // density 0 → ~25 % of base pulses, density 1 → ~175 % (clamped to steps)
    const scale = 0.25 + kitDensity * 1.5;
    KIT_FILL_BASE.forEach((base, voiceIdx) => {
      // Use per-voice override if expanded panel is active, else default base.steps
      const steps = voiceStepsExpanded ? (voiceSteps[voiceIdx] ?? base.steps) : base.steps;
      // Re-scale pulses proportionally if user changed step count
      const ratio = steps / base.steps;
      const scaledPulses = Math.max(1, Math.min(steps, Math.round(base.pulses * scale * ratio)));
      applyDrumEuclidean(voiceIdx, scaledPulses, steps, base.rotation);
    });
    setActiveStyle(null);
  }, [kitDensity, voiceSteps, voiceStepsExpanded, applyDrumEuclidean]);

  const cycleVoiceSteps = useCallback((voiceIdx: number) => {
    // Cycle through musical step counts: 12 (triplet) → 16 (default) → 24 → 32 → 12
    const CYCLE = [12, 16, 24, 32];
    setVoiceSteps((prev) => {
      const next = [...prev];
      const cur = next[voiceIdx] ?? 16;
      const i = CYCLE.indexOf(cur);
      next[voiceIdx] = CYCLE[(i + 1) % CYCLE.length] ?? 16;
      return next;
    });
  }, []);

  // ── Groove Style: apply one style's voice map ──
  const handleApplyStyle = useCallback((style: GrooveStyle) => {
    // Apply defined voices; voices not in the map are left untouched
    Object.entries(style.voices).forEach(([idxStr, pat]) => {
      if (!pat) return;
      applyDrumEuclidean(Number(idxStr), pat.p, pat.s, pat.r);
    });
    setActiveStyle(style.name);
  }, [applyDrumEuclidean]);

  // ── Save current per-voice kit state as a User Style ──
  const handleSaveUserStyle = useCallback(() => {
    const name = window.prompt("Style name?", `My Groove ${userStyles.length + 1}`);
    if (!name?.trim()) return;
    // Snapshot the current drum pattern as a GrooveStyle: read each voice's
    // current state from drumStore. We capture pulses (count of active steps),
    // the track's length as `s`, and use rotation 0 (we don't reverse-engineer
    // rotation — saving the rhythm pattern's first-pulse alignment is good enough
    // for re-applying).
    const drumPattern = useDrumStore.getState().pattern;
    const voices: Partial<Record<number, VoicePat>> = {};
    drumPattern.tracks.forEach((track, idx) => {
      if (!track) return;
      const activeCount = track.steps.slice(0, track.length).filter((st) => st.active).length;
      if (activeCount === 0) return; // skip silent voices
      voices[idx] = { p: activeCount, s: track.length, r: 0 };
    });
    if (Object.keys(voices).length === 0) {
      window.alert("No active drum voices to save.");
      return;
    }
    const newStyle: GrooveStyle = {
      name: name.trim(),
      hint: "User saved",
      emoji: "💾",
      voices,
    };
    const updated = [...userStyles, newStyle];
    setUserStyles(updated);
    saveUserStyles(updated);
  }, [userStyles]);

  const handleDeleteUserStyle = useCallback((styleName: string) => {
    if (!window.confirm(`Delete "${styleName}"?`)) return;
    const updated = userStyles.filter((s) => s.name !== styleName);
    setUserStyles(updated);
    saveUserStyles(updated);
  }, [userStyles]);

  if (!isOpen) return null;

  // ── Polygon Visualizer ──
  const polygonSize = 228;
  const cx = polygonSize / 2;
  const cy = polygonSize / 2;
  const r = polygonSize / 2 - 18;

  // ── Drag-to-rotate the wheel ────────────────────────────────────────────
  // Convert pointer position relative to the SVG center into an angle, then
  // angle → step index → rotation. Touch-friendly; works the same on mouse.
  const wheelRef = useRef<SVGSVGElement | null>(null);
  const dragRotationRef = useRef<{ startAngle: number; startRotation: number } | null>(null);

  const angleToStep = useCallback((clientX: number, clientY: number): number => {
    const svg = wheelRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    // atan2 returns -π..π; offset by π/2 because step 0 is at 12 o'clock
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    // Normalize to 0..2π
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.round((normalized / (Math.PI * 2)) * steps) % steps;
  }, [steps]);

  const handleWheelPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRotationRef.current = {
      startAngle: angleToStep(e.clientX, e.clientY),
      startRotation: rotation,
    };
  }, [rotation, angleToStep]);

  const handleWheelPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRotationRef.current;
    if (!drag) return;
    const currentAngle = angleToStep(e.clientX, e.clientY);
    const delta = currentAngle - drag.startAngle;
    const next = ((drag.startRotation + delta) % steps + steps) % steps;
    setRotation(next);
    // Live-apply during drag — instant audible feedback
    applyToTarget(pulses, steps, next, accentPulses, accentRotation);
  }, [steps, pulses, accentPulses, accentRotation, applyToTarget, angleToStep]);

  const handleWheelPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRotationRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);
  const activeIndices = rhythm.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  const polygonPoints = activeIndices.map((i) => {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  }).join(" ");
  // Quarter-note markers: every steps/4 position (only when steps divisible by 4)
  const quarterPositions = steps % 4 === 0
    ? [0, steps/4, steps/2, 3*steps/4].map((i) => {
        const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
        return { x1: cx + Math.cos(angle) * (r - 10), y1: cy + Math.sin(angle) * (r - 10),
                 x2: cx + Math.cos(angle) * (r + 4),  y2: cy + Math.sin(angle) * (r + 4) };
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
              EUCLIDEAN GENERATOR
            </h2>
            <p className="text-[9px] text-[var(--ed-text-muted)] mt-0.5">
              E({pulses},{steps},{rotation}){accentPulses > 0 ? ` · A(${accentPulses},${steps},${accentRotation})` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg px-1">&times;</button>
        </div>

        {/* Target toggle */}
        <div className="flex gap-1 mb-4">
          {targetsWithLayerColor.map((t) => (
            <button
              key={t.id}
              onClick={() => setTarget(t.id)}
              className="flex-1 py-1.5 text-[9px] font-bold tracking-wider rounded-md transition-all border"
              style={{
                backgroundColor: target === t.id
                  ? `color-mix(in srgb, ${t.color} 18%, transparent)`
                  : "var(--ed-bg-surface)",
                color: target === t.id ? t.color : "var(--ed-text-muted)",
                borderColor: target === t.id
                  ? `color-mix(in srgb, ${t.color} 40%, transparent)`
                  : "transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Target info */}
        {!isSynth ? (
          <div className="text-[10px] text-[var(--ed-text-secondary)] mb-3">
            Apply to: <span className="font-bold" style={{ color: accentColor }}>{VOICE_LABELS[selectedVoice]}</span>
          </div>
        ) : target === "layers" ? (
          <div className="mb-3">
            <div className="text-[10px] text-[var(--ed-text-secondary)] mb-2">
              Active layer: <span className="font-bold" style={{ color: activeLayerColor }}>
                L{(layers.findIndex(l => l.id === activeLayerId) + 1)} · {activeLayer?.barLength ?? 2} bars
              </span>
              <span className="ml-2 opacity-60">· Scale: {melodyScale}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--ed-text-secondary)]">Note mode:</span>
              <div className="flex gap-1 flex-wrap">
                {NOTE_MODES.map((m) => (
                  <button key={m.id} onClick={() => setNoteMode(m.id)}
                    className="px-2 py-0.5 text-[9px] font-medium rounded-md transition-all"
                    style={{
                      backgroundColor: noteMode === m.id
                        ? `color-mix(in srgb, ${activeLayerColor} 18%, transparent)`
                        : "var(--ed-bg-surface)",
                      color: noteMode === m.id ? activeLayerColor : "var(--ed-text-muted)",
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[10px] text-[var(--ed-text-secondary)]">Note mode:</span>
              <div className="flex gap-1 flex-wrap">
                {NOTE_MODES.map((m) => (
                  <button key={m.id} onClick={() => setNoteMode(m.id)}
                    className="px-2 py-0.5 text-[9px] font-medium rounded-md transition-all"
                    style={{
                      backgroundColor: noteMode === m.id
                        ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
                        : "var(--ed-bg-surface)",
                      color: noteMode === m.id ? accentColor : "var(--ed-text-muted)",
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* FOLLOW Mode: only for bass — derive rhythm from a drum track */}
            {target === "bass" && (
              <div ref={followRowRef} className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[10px] text-[var(--ed-text-secondary)]">Follow:</span>
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => setBassFollowTrack(null)}
                    className="px-2 py-0.5 text-[9px] font-medium rounded-md transition-all"
                    style={{
                      backgroundColor: bassFollowTrack === null
                        ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
                        : "var(--ed-bg-surface)",
                      color: bassFollowTrack === null ? accentColor : "var(--ed-text-muted)",
                    }}
                    title="Generate via Euclidean math (default)"
                  >
                    EUCLID
                  </button>
                  {[0, 1, 6].map((idx) => (
                    <button
                      key={idx}
                      onClick={() => setBassFollowTrack(idx)}
                      className="px-2 py-0.5 text-[9px] font-medium rounded-md transition-all"
                      style={{
                        backgroundColor: bassFollowTrack === idx
                          ? `color-mix(in srgb, ${accentColor} 30%, transparent)`
                          : "var(--ed-bg-surface)",
                        color: bassFollowTrack === idx ? accentColor : "var(--ed-text-muted)",
                      }}
                      title={`Bass triggers on ${VOICE_LABELS[idx]} steps`}
                    >
                      {VOICE_LABELS[idx]}
                    </button>
                  ))}
                </div>
                {bassFollowTrack !== null && (
                  <span className="text-[8px] text-[var(--ed-text-muted)]">
                    Pulses/Rotation ignored — rhythm = drum track
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {/* Main: circular viz + sliders */}
        <div className="flex gap-4 mb-4">
          {/* Polygon viz */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            {/* Prominent pattern label */}
            <div className="text-[11px] font-mono font-bold tracking-tight" style={{ color: accentColor }}>
              E({pulses},{steps},{rotation}){accentPulses > 0 ? ` A(${accentPulses})` : ""}
            </div>
            <svg
              ref={wheelRef}
              width={polygonSize}
              height={polygonSize}
              viewBox={`0 0 ${polygonSize} ${polygonSize}`}
              onPointerDown={handleWheelPointerDown}
              onPointerMove={handleWheelPointerMove}
              onPointerUp={handleWheelPointerUp}
              onPointerCancel={handleWheelPointerUp}
              style={{ touchAction: "none", cursor: dragRotationRef.current ? "grabbing" : "grab" }}
            >
              {/* Outer ring */}
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ed-border-subtle)" strokeWidth="1" />
              {/* Quarter-note tick marks */}
              {quarterPositions.map((q, qi) => (
                <line key={qi} x1={q.x1} y1={q.y1} x2={q.x2} y2={q.y2}
                  stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeLinecap="round" />
              ))}
              {/* Polygon connecting active hits */}
              {activeIndices.length >= 2 && (
                <polygon
                  points={polygonPoints}
                  fill={accentColor}
                  fillOpacity="0.09"
                  stroke={accentColor}
                  strokeOpacity="0.5"
                  strokeWidth="1"
                />
              )}
              {/* Step dots */}
              {Array.from({ length: steps }, (_, i) => {
                const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
                const x = cx + Math.cos(angle) * r;
                const y = cy + Math.sin(angle) * r;
                const on = rhythm[i];
                const acc = accent?.[i];
                return (
                  <circle
                    key={i}
                    cx={x} cy={y}
                    r={on ? (acc ? 6 : 4) : 1.5}
                    fill={on ? accentColor : "var(--ed-border-subtle)"}
                    opacity={on ? (acc ? 1 : 0.75) : 0.5}
                    stroke={acc ? "white" : "none"}
                    strokeWidth={acc ? 1.5 : 0}
                  />
                );
              })}
              {/* Rotation marker at step 0 */}
              <circle cx={cx} cy={cy - r - 10} r={3} fill="var(--ed-accent-blue)" />
            </svg>
          </div>

          {/* Sliders */}
          <div className="flex-1 flex flex-col gap-3">
            {/* Pulses */}
            <SliderRow
              label="Pulses"
              value={pulses}
              min={0}
              max={steps}
              color={accentColor}
              onChange={setPulses}
            />
            {/* Steps */}
            <SliderRow
              label="Steps"
              value={steps}
              min={2}
              max={32}
              color="var(--ed-accent-blue)"
              onChange={(v) => {
                setSteps(v);
                if (pulses > v) setPulses(v);
                if (rotation >= v) setRotation(0);
                if (accentRotation >= v) setAccentRotation(0);
                if (accentPulses > v) setAccentPulses(v);
              }}
            />
            {/* Rotation */}
            <SliderRow
              label="Rotate"
              value={rotation}
              min={0}
              max={Math.max(0, steps - 1)}
              color="var(--ed-pad-hybrid)"
              onChange={setRotation}
            />
          </div>
        </div>

        {/* Linear step preview */}
        <div className="grid gap-1 mb-4" style={{ gridTemplateColumns: `repeat(${Math.min(16, steps)}, minmax(0, 1fr))` }}>
          {rhythm.slice(0, 32).map((on, i) => {
            const acc = accent?.[i];
            return (
              <div
                key={i}
                className="relative h-6 rounded-sm flex items-center justify-center text-[8px] font-mono"
                style={{
                  backgroundColor: on
                    ? accentColor
                    : "var(--ed-bg-surface)",
                  color: on ? "#000" : "var(--ed-text-muted)",
                  fontWeight: on ? 700 : 400,
                  boxShadow: acc ? "inset 0 0 0 1.5px white" : "none",
                }}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Accent section — for all targets (drums: velocity hi/lo, synths: accent flag) */}
        <div className="mb-4 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold tracking-wider" style={{ color: accentColor }}>
              ACCENT PATTERN
            </span>
            <span className="text-[8px] text-[var(--ed-text-muted)]">
              {target === "drums" ? "Hi velocity (110) vs Lo velocity (68)" : "Second Euclidean marking velocity-accent steps"}
            </span>
          </div>
          <div className="flex gap-3">
            <SliderRow
              label="Pulses"
              value={accentPulses}
              min={0}
              max={steps}
              color={accentColor}
              onChange={setAccentPulses}
            />
            <SliderRow
              label="Rotate"
              value={accentRotation}
              min={0}
              max={Math.max(0, steps - 1)}
              color="var(--ed-pad-hybrid)"
              onChange={setAccentRotation}
            />
          </div>
        </div>

        {/* Gate Mode — only for synth targets */}
        {isSynth && (
          <div className="mb-4 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold tracking-wider" style={{ color: accentColor }}>
                GATE
              </span>
              <span className="text-[8px] text-[var(--ed-text-muted)]">
                {GATE_MODES.find((g) => g.id === gateMode)?.hint ?? ""}
              </span>
            </div>
            <div className="flex gap-1">
              {GATE_MODES.map((g) => {
                const active = gateMode === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setGateMode(g.id)}
                    className="flex-1 py-1 rounded text-[10px] font-bold tracking-wider border transition-all"
                    style={{
                      background: active
                        ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
                        : "var(--ed-bg-surface)",
                      borderColor: active
                        ? `color-mix(in srgb, ${accentColor} 50%, transparent)`
                        : "var(--ed-border-subtle)",
                      color: active ? accentColor : "var(--ed-text-secondary)",
                    }}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Octave Range — only for synth targets */}
        {isSynth && (
          <div className="mb-4 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold tracking-wider" style={{ color: accentColor }}>
                RANGE
              </span>
              <span className="text-[8px] text-[var(--ed-text-muted)]">
                {octaveRange === 1 ? "All notes in one octave" : octaveRange === 2 ? "Spread across 2 octaves" : "Wide spread across 3 octaves"}
              </span>
            </div>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((r) => {
                const active = octaveRange === r;
                return (
                  <button
                    key={r}
                    onClick={() => setOctaveRange(r)}
                    className="flex-1 py-1 rounded text-[10px] font-bold tracking-wider border transition-all"
                    style={{
                      background: active
                        ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
                        : "var(--ed-bg-surface)",
                      borderColor: active
                        ? `color-mix(in srgb, ${accentColor} 50%, transparent)`
                        : "var(--ed-border-subtle)",
                      color: active ? accentColor : "var(--ed-text-secondary)",
                    }}
                  >
                    {r} OCT
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Groove Styles (drums only) ── */}
        <div className="mb-3 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold tracking-wider" style={{ color: "var(--ed-accent-orange)" }}>
              GROOVE STYLES
            </span>
            <span className="text-[7px] text-[var(--ed-text-muted)]">Fills all drum voices at once</span>
          </div>
          <div className="grid grid-cols-4 gap-1 mb-2">
            {GROOVE_STYLES.map((style) => {
              const isActive = activeStyle === style.name;
              return (
                <button
                  key={style.name}
                  onClick={() => handleApplyStyle(style)}
                  title={style.hint}
                  className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg transition-all border"
                  style={{
                    background:   isActive ? "color-mix(in srgb, var(--ed-accent-orange) 15%, transparent)" : "var(--ed-bg-surface)",
                    borderColor:  isActive ? "color-mix(in srgb, var(--ed-accent-orange) 40%, transparent)" : "var(--ed-border-subtle)",
                    color:        isActive ? "var(--ed-accent-orange)" : "var(--ed-text-secondary)",
                  }}
                >
                  <span className="text-[11px] leading-none">{style.emoji}</span>
                  <span className="text-[7px] font-bold tracking-wide">{style.name.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
          {activeStyle && (
            <div className="text-[8px] text-center" style={{ color: "var(--ed-accent-orange)" }}>
              ✓ {activeStyle} applied — tweak individual voices or hit RESET to clear
            </div>
          )}
        </div>

        {/* ── User Styles ── (only shown for drum target) */}
        {target === "drums" && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-bold text-[var(--ed-text-muted)] tracking-wider">
                YOUR STYLES {userStyles.length > 0 && <span className="text-white/30">· {userStyles.length}</span>}
              </span>
              <button
                onClick={handleSaveUserStyle}
                className="px-2 py-0.5 text-[8px] font-bold rounded bg-[var(--ed-accent-green)]/15 text-[var(--ed-accent-green)] hover:bg-[var(--ed-accent-green)]/25 border border-[var(--ed-accent-green)]/30 transition-all"
                title="Save current drum kit pattern as a reusable style"
              >
                + SAVE
              </button>
            </div>
            {userStyles.length === 0 ? (
              <div className="text-[8px] text-white/25 italic px-1 py-2">
                Build a groove, hit SAVE — it'll appear here for one-tap recall.
              </div>
            ) : (
              <div className="flex gap-1 flex-wrap">
                {userStyles.map((style) => (
                  <div key={style.name} className="group/userstyle relative">
                    <button
                      onClick={() => handleApplyStyle(style)}
                      className="px-2 py-1 text-[9px] rounded-md border bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors flex items-center gap-1"
                      style={{ borderColor: "var(--ed-border-subtle)" }}
                      title={`Apply: ${Object.keys(style.voices).length} voices`}
                    >
                      <span>💾</span>
                      <span>{style.name}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteUserStyle(style.name)}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500/80 text-white text-[8px] leading-none opacity-0 group-hover/userstyle:opacity-100 transition-opacity flex items-center justify-center"
                      title="Delete style"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Kit Fill ── */}
        <div className="mb-3 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold tracking-wider" style={{ color: "var(--ed-accent-orange)" }}>
              KIT FILL
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVoiceStepsExpanded((v) => !v)}
                className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition-all ${
                  voiceStepsExpanded
                    ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)]"
                    : "text-white/35 hover:text-white/65"
                }`}
                title="Per-voice step count: tap a voice to cycle 12 → 16 → 24 → 32 (polyrhythmic kit)"
              >
                {voiceStepsExpanded ? "● POLY" : "○ POLY"}
              </button>
              <span className="text-[7px] text-[var(--ed-text-muted)]">Scale all voices by density</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[7px] font-bold text-[var(--ed-text-muted)] w-12">SPARSE</span>
              <input
                type="range" min={0} max={100} value={Math.round(kitDensity * 100)}
                onChange={(e) => setKitDensity(Number(e.target.value) / 100)}
                className="flex-1 h-1.5"
                style={{ accentColor: "var(--ed-accent-orange)" }}
              />
              <span className="text-[7px] font-bold text-[var(--ed-text-muted)] w-12 text-right">DENSE</span>
            </div>
            <button
              onClick={handleFillKit}
              className="shrink-0 px-3 py-1.5 text-[9px] font-bold rounded-lg transition-all border"
              style={{
                background:   "color-mix(in srgb, var(--ed-accent-orange) 15%, transparent)",
                borderColor:  "color-mix(in srgb, var(--ed-accent-orange) 35%, transparent)",
                color:        "var(--ed-accent-orange)",
              }}
            >
              FILL KIT
            </button>
          </div>
          {/* Mini density preview — shows pulse counts; clickable in POLY mode */}
          <div className="flex gap-0.5 mt-2 flex-wrap">
            {KIT_FILL_BASE.map((base, i) => {
              const scale = 0.25 + kitDensity * 1.5;
              const stepsForVoice = voiceStepsExpanded ? (voiceSteps[i] ?? base.steps) : base.steps;
              const ratio = stepsForVoice / base.steps;
              const scaled = Math.max(1, Math.min(stepsForVoice, Math.round(base.pulses * scale * ratio)));
              const isCustom = voiceStepsExpanded && stepsForVoice !== 16;
              return (
                <div key={i} className="flex flex-col items-center gap-0.5 flex-1 min-w-[32px]">
                  <div className="text-[5px] font-bold text-white/25">{VOICE_LABELS[i]}</div>
                  <div className="text-[8px] font-bold tabular-nums" style={{ color: "var(--ed-accent-orange)" }}>
                    {scaled}
                  </div>
                  {voiceStepsExpanded && (
                    <button
                      onClick={() => cycleVoiceSteps(i)}
                      className={`text-[7px] font-mono px-1 py-px rounded transition-all ${
                        isCustom
                          ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)] border border-[var(--ed-accent-orange)]/40"
                          : "text-white/35 hover:text-white/65 border border-transparent"
                      }`}
                      title={`Step count for ${VOICE_LABELS[i]} — tap to cycle 12 → 16 → 24 → 32`}
                    >
                      /{stepsForVoice}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Presets */}
        <div className="mb-3">
          <div className="text-[8px] font-bold text-[var(--ed-text-muted)] tracking-wider mb-1">SINGLE-VOICE PRESETS</div>
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => { setPulses(preset.p); setSteps(preset.s); setRotation(preset.r ?? 0); }}
                title={preset.hint}
                className="px-2 py-1 text-[9px] rounded bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
              >
                E({preset.label})
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={mutate}
            className="flex-1 py-1.5 text-[10px] rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            title="Randomly rotate / add / remove a pulse"
          >
            🎲 MUTATE
          </button>
          <button
            onClick={invert}
            className="flex-1 py-1.5 text-[10px] rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            title="Invert: swap hits and rests"
          >
            ⇋ INVERT
          </button>
          <button
            onClick={reset}
            className="flex-1 py-1.5 text-[10px] rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            title="Reset to E(4,16)"
          >
            ↺ RESET
          </button>
        </div>

        {/* MORPH — A/B snapshots + interpolation slider */}
        <div ref={morphRowRef} className="flex items-center gap-2 mb-2 px-1">
          <span className="text-[9px] text-[var(--ed-text-muted)] font-bold">MORPH</span>
          <button
            onClick={handleSnapA}
            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${
              snapA
                ? "bg-[var(--ed-accent-blue)]/25 text-[var(--ed-accent-blue)] border border-[var(--ed-accent-blue)]/40"
                : "bg-white/5 text-white/40 border border-white/10 hover:text-white/70"
            }`}
            title={snapA ? `Snapshot A: E(${snapA.p},${snapA.s},${snapA.r})` : "Save current pattern as A"}
          >
            A {snapA ? "●" : ""}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={morphPct}
            onChange={(e) => handleMorph(Number(e.target.value))}
            disabled={!snapA || !snapB}
            className="flex-1 h-3 accent-[var(--ed-accent-orange)] disabled:opacity-30"
            title={snapA && snapB ? `Morph A → B (${morphPct}%)` : "Save both A and B to morph between them"}
          />
          <button
            onClick={handleSnapB}
            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${
              snapB
                ? "bg-[var(--ed-accent-melody)]/25 text-[var(--ed-accent-melody)] border border-[var(--ed-accent-melody)]/40"
                : "bg-white/5 text-white/40 border border-white/10 hover:text-white/70"
            }`}
            title={snapB ? `Snapshot B: E(${snapB.p},${snapB.s},${snapB.r})` : "Save current pattern as B"}
          >
            B {snapB ? "●" : ""}
          </button>
        </div>

        {/* DRIFT — auto-mutate while playing */}
        <div ref={driftRowRef} className="flex items-center gap-2 mb-3 px-1">
          <button
            onClick={() => setDriftEnabled((d) => !d)}
            className={`px-2.5 py-1 text-[10px] rounded-md font-bold transition-all ${
              driftEnabled
                ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)] border border-[var(--ed-accent-orange)]/40"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] border border-transparent hover:text-[var(--ed-text-secondary)]"
            }`}
            title="Auto-mutate the pattern every N bars while the transport is playing"
          >
            {driftEnabled ? "● DRIFT" : "○ DRIFT"}
          </button>
          {driftEnabled && (
            <>
              <span className="text-[9px] text-[var(--ed-text-muted)]">every</span>
              <div className="flex gap-0.5">
                {[2, 4, 8].map((b) => (
                  <button
                    key={b}
                    onClick={() => setDriftBars(b as 2 | 4 | 8)}
                    className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all ${
                      driftBars === b
                        ? "bg-[var(--ed-accent-orange)]/20 text-[var(--ed-accent-orange)]"
                        : "text-white/35 hover:text-white/65"
                    }`}
                  >
                    {b}B
                  </button>
                ))}
              </div>
              <span className="text-[8px] text-[var(--ed-text-muted)] ml-auto">
                pattern evolves on its own
              </span>
            </>
          )}
        </div>

        {/* Apply */}
        <button onClick={handleApply}
          className="w-full py-2 text-sm font-bold text-black rounded-lg hover:brightness-110 transition-all"
          style={{ backgroundColor: accentColor }}>
          APPLY TO {!isSynth ? VOICE_LABELS[selectedVoice] : activeTarget.label}
        </button>
      </div>

      {/* Contextual hints — show once, dismissable */}
      <HintPopover
        id="euclid-morph"
        anchor={morphRowRef.current}
        position="top"
        title="MORPH between patterns"
        body="Save snapshot A, change params, save B, then drag the slider to morph live between them."
        triggered={!!(snapA && snapB && morphPct > 0 && morphPct < 100)}
      />
      <HintPopover
        id="euclid-drift"
        anchor={driftRowRef.current}
        position="top"
        title="DRIFT — pattern evolves"
        body="Turn on DRIFT and the pattern auto-mutates every N bars while transport is playing. No babysitting."
        triggered={driftEnabled}
      />
      <HintPopover
        id="euclid-follow"
        anchor={followRowRef.current}
        position="bottom"
        title="FOLLOW — bass locked to drums"
        body="Pick KICK to make the bass trigger on the kick steps — instant tight unison without editing the bass pattern."
        enabled={target === "bass"}
        triggered={bassFollowTrack !== null}
      />
    </div>
  );
}

function SliderRow({ label, value, min, max, color, onChange }: {
  label: string; value: number; min: number; max: number; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-bold text-[var(--ed-text-muted)] tracking-wider w-12">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5"
        style={{ accentColor: color }}
      />
      <span className="text-[11px] font-mono min-w-[1.5rem] text-right" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
