import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMelodyCRStore, type MelodyCRNote } from "../../store/melodyCRStore";
import { useDrumStore } from "../../store/drumStore";
import { MELODY_PRESETS } from "../../store/melodyStore";
import { callCREngine, responseCREngine } from "../../audio/melodyCREngines";
import { melodyCRCurrentBeatStore } from "./melodyCRScheduler";

// Activate scheduler via side-effect import
import "./melodyCRScheduler";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDI_MIN = 48;  // C3
const MIDI_MAX = 84;  // C6
const ROWS = MIDI_MAX - MIDI_MIN + 1;  // 37
const ROW_H = 14;
const PIANO_W = 40;
const RULER_H = 20;
const CALL_COLOR = "#f472b6";
const RESP_COLOR = "#22c55e";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]); // semitones that are black keys

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

function pitchName(pitch: number): string {
  return NOTE_NAMES[((pitch % 12) + 12) % 12]!;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayNote = MelodyCRNote & { _ghost?: boolean };

// ─── Component ────────────────────────────────────────────────────────────────

export function MelodyCREditor() {
  const {
    barLength, activeVoice,
    callNotes, responseNotes,
    callSynth, responseSynth,
    rootNote,
    setActiveVoice, setBarLength,
    addCallNote, addResponseNote,
    removeCallNote, removeResponseNote,
    updateCallNote, updateResponseNote,
    setCallSynth, setResponseSynth,
    clearCallNotes, clearResponseNotes,
    setRootNote,
  } = useMelodyCRStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);

  // Playhead
  const beatInfo = useSyncExternalStore(
    melodyCRCurrentBeatStore.subscribe,
    melodyCRCurrentBeatStore.getSnapshot,
    () => ({ voice: "call" as const, beat: 0 }),
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const [hoverCell, setHoverCell] = useState<{ pitch: number; beat: number } | null>(null);
  const [gridCursor, setGridCursor] = useState("crosshair");
  const [resizeDrag, setResizeDrag] = useState<{
    id: string;
    voice: "call" | "response";
    startX: number;
    origDur: number;
    beatWidth: number;
  } | null>(null);

  const notes = activeVoice === "call" ? callNotes : responseNotes;
  const noteColor = activeVoice === "call" ? CALL_COLOR : RESP_COLOR;
  const totalBeats = barLength * 4;

  // ─── Beat width in pixels (computed from grid width) ─────────────────────

  const [beatWidth, setBeatWidth] = useState(40);
  useEffect(() => {
    if (!gridRef.current) return;
    const update = () => {
      const w = gridRef.current!.clientWidth - PIANO_W;
      setBeatWidth(w / totalBeats);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [totalBeats]);

  // ─── Refs for stale-closure-free hit testing ──────────────────────────────

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const beatWidthRef = useRef(beatWidth);
  beatWidthRef.current = beatWidth;

  // ─── Hit testing ──────────────────────────────────────────────────────────

  const hitTestNote = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left - PIANO_W;
    const y = clientY - rect.top - RULER_H;
    if (x < 0 || y < 0) return null;

    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) return null;
    const pitch = MIDI_MAX - rowIdx;
    const bw = beatWidthRef.current;
    const beat = x / bw;
    const currentNotes = notesRef.current;

    for (const note of currentNotes) {
      if (note.pitch !== pitch) continue;
      const noteStartX = note.startBeat * bw;
      const noteEndX = (note.startBeat + note.durationBeats) * bw;
      if (x >= noteStartX && x <= noteEndX) {
        const isRightEdge = x >= noteEndX - 6;
        return { note, isRightEdge, pitch, beat };
      }
    }
    return { note: null, isRightEdge: false, pitch, beat };
  }, []); // gridRef, notesRef, beatWidthRef are stable refs

  // ─── Pointer handlers ─────────────────────────────────────────────────────

  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const hit = hitTestNote(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.note && hit.isRightEdge) {
      // Start resize drag
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizeDrag({
        id: hit.note.id,
        voice: activeVoice,
        startX: e.clientX,
        origDur: hit.note.durationBeats,
        beatWidth: beatWidthRef.current,
      });
      return;
    }

    if (!hit.note && e.button === 0) {
      // Add note — snap startBeat to 16th note grid
      const snappedBeat = Math.round(hit.beat * 4) / 4;
      if (snappedBeat < 0 || snappedBeat >= totalBeats) return;
      const newNote: MelodyCRNote = {
        id: crypto.randomUUID(),
        pitch: hit.pitch,
        startBeat: snappedBeat,
        durationBeats: 0.5,  // 8th note default
      };
      if (activeVoice === "call") addCallNote(newNote);
      else addResponseNote(newNote);
    }
  }, [activeVoice, totalBeats, hitTestNote, addCallNote, addResponseNote]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDrag) {
      const deltaPx = e.clientX - resizeDrag.startX;
      const deltaBeat = deltaPx / resizeDrag.beatWidth;
      const newDur = Math.max(0.25, Math.round((resizeDrag.origDur + deltaBeat) * 4) / 4);
      if (resizeDrag.voice === "call") {
        updateCallNote(resizeDrag.id, { durationBeats: newDur });
      } else {
        updateResponseNote(resizeDrag.id, { durationBeats: newDur });
      }
      return;
    }

    // Ghost preview hover + cursor update
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - PIANO_W;
    const y = e.clientY - rect.top - RULER_H;
    if (x < 0 || y < 0) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const pitch = MIDI_MAX - rowIdx;
    const bw = beatWidthRef.current;
    const beat = Math.round((x / bw) * 4) / 4;
    const currentNotes = notesRef.current;
    // Detect right-edge hover for resize cursor
    const onRightEdge = currentNotes.some((n) => {
      if (n.pitch !== pitch) return false;
      const endX = (n.startBeat + n.durationBeats) * bw;
      const startX = n.startBeat * bw;
      return x >= startX && x >= endX - 6 && x <= endX;
    });
    setGridCursor(onRightEdge ? "ew-resize" : "crosshair");
    // Only show ghost if no note at this pitch + beat already
    const hasNote = currentNotes.some(
      (n) => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats
    );
    setHoverCell(hasNote ? null : { pitch, beat });
  }, [resizeDrag, updateCallNote, updateResponseNote]);

  const handleGridPointerUp = useCallback(() => {
    setResizeDrag(null);
  }, []);

  const handleGridContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = hitTestNote(e.clientX, e.clientY);
    if (hit?.note) {
      if (activeVoice === "call") removeCallNote(hit.note.id);
      else removeResponseNote(hit.note.id);
    }
  }, [activeVoice, hitTestNote, removeCallNote, removeResponseNote]);

  // ─── Ghost note ──────────────────────────────────────────────────────────

  const ghostNote = useMemo(() => {
    if (!hoverCell) return null;
    const { pitch, beat } = hoverCell;
    if (beat < 0 || beat >= totalBeats) return null;
    return { pitch, startBeat: beat, durationBeats: 0.5, id: "ghost" };
  }, [hoverCell, totalBeats]);

  // ─── Playhead position ───────────────────────────────────────────────────

  const playheadX = isPlaying && beatInfo.voice === activeVoice
    ? PIANO_W + beatInfo.beat * beatWidth
    : null;

  // ─── Synth panel helpers ─────────────────────────────────────────────────

  const activeSynth = activeVoice === "call" ? callSynth : responseSynth;
  const setActiveSynth = activeVoice === "call" ? setCallSynth : setResponseSynth;

  function applyPreset(index: number) {
    setActiveSynth({ presetIndex: index });
    const engine = activeVoice === "call" ? callCREngine : responseCREngine;
    const preset = MELODY_PRESETS[index];
    if (preset) engine.setParams(preset.params);
  }

  // ─── All display notes (real + ghost) ────────────────────────────────────

  const allDisplayNotes: DisplayNote[] = ghostNote
    ? [...notes, { ...ghostNote, _ghost: true }]
    : notes;

  // ─── Render ──────────────────────────────────────────────────────────────

  const gridHeight = ROWS * ROW_H;

  return (
    <div className="flex flex-col select-none" style={{ fontFamily: "monospace" }}>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        {(["call", "response"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setActiveVoice(v)}
            className="px-2.5 py-1 text-[8px] font-black tracking-[0.15em] rounded border transition-all"
            style={{
              background: activeVoice === v ? (v === "call" ? "#f472b620" : "#22c55e20") : "transparent",
              borderColor: activeVoice === v ? (v === "call" ? "#f472b660" : "#22c55e60") : "#2a2d38",
              color: activeVoice === v ? (v === "call" ? CALL_COLOR : RESP_COLOR) : "#555",
            }}
          >
            {v === "call" ? "▶ CALL" : "RESPONSE"}
          </button>
        ))}

        <div className="flex items-center gap-1 ml-4">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">BARS</span>
          {([1, 2, 4] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBarLength(b)}
              className="w-6 h-5 text-[8px] font-black rounded transition-all"
              style={{
                background: barLength === b ? "#a855f720" : "transparent",
                border: `1px solid ${barLength === b ? "#a855f760" : "#2a2d38"}`,
                color: barLength === b ? "#a855f7" : "#555",
              }}
            >
              {b}
            </button>
          ))}
        </div>

        <button
          onClick={() => { if (activeVoice === "call") clearCallNotes(); else clearResponseNotes(); }}
          className="ml-auto text-[7px] font-bold tracking-[0.1em] text-white/20 hover:text-white/50 px-1.5 py-0.5 rounded border border-white/8"
        >
          CLR
        </button>
      </div>

      {/* Piano Roll Grid */}
      <div
        ref={gridRef}
        className="relative overflow-y-auto overflow-x-hidden"
        style={{ height: Math.min(gridHeight + RULER_H, 180), background: "#0d0f14", cursor: gridCursor }}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={handleGridPointerUp}
        onPointerLeave={() => { setHoverCell(null); if (resizeDrag) setResizeDrag(null); }}
        onContextMenu={handleGridContextMenu}
      >
        {/* Ruler */}
        <div
          className="sticky top-0 z-10 flex"
          style={{ height: RULER_H, background: "#0d0f14", borderBottom: "1px solid #1f2230", paddingLeft: PIANO_W }}
        >
          {Array.from({ length: barLength * 4 }, (_, beat) => (
            <div
              key={beat}
              style={{ flex: 1, borderLeft: "1px solid #1f2230", paddingLeft: 3 }}
            >
              {beat % 4 === 0 && (
                <span style={{ fontSize: 7, color: "#444" }}>{Math.floor(beat / 4) + 1}</span>
              )}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ position: "relative" }}>
          {Array.from({ length: ROWS }, (_, rowIdx) => {
            const pitch = MIDI_MAX - rowIdx;
            const isBlack = isBlackKey(pitch);
            const isRoot = ((pitch % 12) + 12) % 12 === rootNote;
            const name = pitchName(pitch);
            const isC = name === "C";

            return (
              <div
                key={pitch}
                style={{
                  display: "flex",
                  height: ROW_H,
                  background: isRoot
                    ? "rgba(249,115,22,0.10)"
                    : isBlack
                    ? "rgba(0,0,0,0.25)"
                    : "transparent",
                  borderBottom: isC ? "1px solid #222" : "1px solid #181a22",
                }}
              >
                {/* Piano key */}
                <div
                  style={{
                    width: PIANO_W,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 5,
                    fontSize: 6,
                    color: isRoot ? "rgba(249,115,22,0.9)" : isBlack ? "#333" : "#444",
                    background: isBlack ? "#151820" : "#1a1d26",
                    borderRight: "1px solid #222",
                    cursor: "default",
                  }}
                >
                  {isC || isRoot ? name + (Math.floor(pitch / 12) - 1) : ""}
                </div>

                {/* Beat cells — purely visual grid lines */}
                {Array.from({ length: barLength * 4 }, (_, beat) => (
                  <div
                    key={beat}
                    style={{
                      flex: 1,
                      borderLeft: beat % 4 === 0 ? "1px solid #1f2230" : "1px solid #181a22",
                    }}
                  />
                ))}
              </div>
            );
          })}

          {/* Notes (call or response) */}
          {allDisplayNotes.map((note) => {
            const isGhost = note._ghost === true;
            const rowIdx = MIDI_MAX - note.pitch;
            if (rowIdx < 0 || rowIdx >= ROWS) return null;
            const top = rowIdx * ROW_H;
            const left = PIANO_W + note.startBeat * beatWidth;
            const width = Math.max(4, note.durationBeats * beatWidth - 2);

            return (
              <div
                key={note.id}
                style={{
                  position: "absolute",
                  top: top + 2,
                  left,
                  width,
                  height: ROW_H - 3,
                  background: isGhost
                    ? `${noteColor}30`
                    : `${noteColor}70`,
                  border: `1px solid ${isGhost ? noteColor + "40" : noteColor}`,
                  borderRadius: 3,
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
              />
            );
          })}

          {/* Playhead */}
          {playheadX !== null && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: playheadX,
                width: 1,
                height: gridHeight,
                background: "rgba(255,255,255,0.5)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>

      {/* Synth panel */}
      <div className="px-3 py-2 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        style={{ background: "#0d0f14" }}
      >
        {/* Preset */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">PRESET</span>
          <select
            value={activeSynth.presetIndex}
            onChange={(e) => applyPreset(Number(e.target.value))}
            className="text-[8px] bg-black/40 border border-white/8 rounded px-1 py-0.5 text-white/60"
          >
            {MELODY_PRESETS.map((p, i) => (
              <option key={i} value={i}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Octave offset */}
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">OCT</span>
          {([-2, -1, 0, 1, 2] as const).map((o) => (
            <button
              key={o}
              onClick={() => setActiveSynth({ octaveOffset: o })}
              className="w-5 h-5 text-[7px] font-black rounded border transition-all"
              style={{
                background: activeSynth.octaveOffset === o ? `${noteColor}20` : "transparent",
                borderColor: activeSynth.octaveOffset === o ? `${noteColor}60` : "#2a2d38",
                color: activeSynth.octaveOffset === o ? noteColor : "#555",
              }}
            >
              {o > 0 ? `+${o}` : o}
            </button>
          ))}
        </div>

        {/* Cutoff slider */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">CUTOFF</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={activeSynth.cutoff}
            onChange={(e) => setActiveSynth({ cutoff: Number(e.target.value) })}
            className="w-20 h-1 accent-current"
            style={{ accentColor: noteColor }}
          />
        </div>

        {/* Response-only: link to Call */}
        {activeVoice === "response" && (
          <button
            onClick={() => setResponseSynth({ linkToCall: !responseSynth.linkToCall })}
            className="text-[7px] font-black tracking-[0.1em] px-2 py-1 rounded border transition-all"
            style={{
              background: responseSynth.linkToCall ? "#22c55e20" : "transparent",
              borderColor: responseSynth.linkToCall ? "#22c55e60" : "#2a2d38",
              color: responseSynth.linkToCall ? "#22c55e" : "#555",
            }}
          >
            {responseSynth.linkToCall ? "= CALL ✓" : "= CALL"}
          </button>
        )}

        {/* Root note for highlighting */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[7px] text-white/20 tracking-[0.1em]">ROOT</span>
          <select
            value={rootNote}
            onChange={(e) => setRootNote(Number(e.target.value))}
            className="text-[7px] bg-black/30 border border-white/5 rounded px-1 py-0.5 text-white/40"
          >
            {NOTE_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
