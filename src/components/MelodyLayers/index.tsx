// src/components/MelodyLayers/index.tsx
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMelodyLayerStore, type MelodyLayerNote, LAYER_COLORS } from "../../store/melodyLayerStore";
import { useDrumStore } from "../../store/drumStore";
import { MELODY_PRESETS } from "../../store/melodyStore";
import { melodyLayerEngines } from "../../audio/melodyLayerEngines";
import { melodyLayerBeatStore } from "./melodyLayerScheduler";

// Activate scheduler via side-effect import
import "./melodyLayerScheduler";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDI_MIN = 48;  // C3
const MIDI_MAX = 84;  // C6
const ROWS = MIDI_MAX - MIDI_MIN + 1;  // 37
const ROW_H = 14;
const PIANO_W = 40;
const RULER_H = 20;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

function pitchName(pitch: number): string {
  return NOTE_NAMES[((pitch % 12) + 12) % 12]!;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayNote = MelodyLayerNote & { _ghost?: boolean };

type ResizeDrag = {
  layerId: string;
  noteId: string;
  startX: number;
  origDur: number;
  beatWidth: number;
};

type MoveDrag = {
  layerId: string;
  noteId: string;
  startX: number;
  startY: number;
  origStartBeat: number;
  origPitch: number;
  beatWidth: number;
  hasMoved: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function MelodyLayersEditor() {
  const {
    layers, activeLayerId,
    setActiveLayer, addLayer, removeLayer,
    updateLayer, addNote, removeNote, updateNote,
    setSynth, clearNotes,
  } = useMelodyLayerStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const beatInfo = useSyncExternalStore(
    melodyLayerBeatStore.subscribe,
    melodyLayerBeatStore.getSnapshot,
    () => ({ beat: 0 }),
  );

  // Active layer — fall back to layers[0] if id is stale
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0]!;
  const activeLayerIdx = layers.findIndex((l) => l.id === activeLayer.id);
  const layerColor = LAYER_COLORS[activeLayer.colorIndex];
  const notes = activeLayer.notes;
  const totalBeats = activeLayer.barLength * 4;

  const gridRef = useRef<HTMLDivElement>(null);
  const [hoverCell, setHoverCell] = useState<{ pitch: number; beat: number } | null>(null);
  const [gridCursor, setGridCursor] = useState("crosshair");
  const resizeDragRef = useRef<ResizeDrag | null>(null);
  const moveDragRef = useRef<MoveDrag | null>(null);

  // ─── Beat width ─────────────────────────────────────────────────────────────

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

  // ─── Stable refs (stale-closure prevention) ──────────────────────────────────

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const beatWidthRef = useRef(beatWidth);
  beatWidthRef.current = beatWidth;
  const activeLayerIdRef = useRef(activeLayer.id);
  activeLayerIdRef.current = activeLayer.id;
  const activeLayerIdxRef = useRef(activeLayerIdx);
  activeLayerIdxRef.current = activeLayerIdx;
  const totalBeatsRef = useRef(totalBeats);
  totalBeatsRef.current = totalBeats;

  // ─── Hit testing ─────────────────────────────────────────────────────────────

  const hitTestNote = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left - PIANO_W;
    // scrollTop: ruler is sticky so viewport offset doesn't shift, but note positions
    // are relative to scrollable content — must add scrollTop for correct hit testing.
    const y = clientY - rect.top - RULER_H + gridRef.current.scrollTop;
    if (x < 0 || y < 0) return null;
    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) return null;
    const pitch = MIDI_MAX - rowIdx;
    const bw = beatWidthRef.current;
    const beat = x / bw;
    for (const note of notesRef.current) {
      if (note.pitch !== pitch) continue;
      const noteStartX = note.startBeat * bw;
      const noteEndX = (note.startBeat + note.durationBeats) * bw;
      if (x >= noteStartX && x <= noteEndX) {
        return { note, isRightEdge: x >= noteEndX - 6, pitch, beat };
      }
    }
    return { note: null, isRightEdge: false, pitch, beat };
  }, []);

  // ─── Pointer handlers ────────────────────────────────────────────────────────

  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const hit = hitTestNote(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.note && hit.isRightEdge) {
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeDragRef.current = {
        layerId: activeLayerIdRef.current,
        noteId: hit.note.id,
        startX: e.clientX,
        origDur: hit.note.durationBeats,
        beatWidth: beatWidthRef.current,
      };
      return;
    }

    // Left-click on note body = start move drag (click without move = delete)
    if (hit.note && !hit.isRightEdge && e.button === 0) {
      e.currentTarget.setPointerCapture(e.pointerId);
      moveDragRef.current = {
        layerId: activeLayerIdRef.current,
        noteId: hit.note.id,
        startX: e.clientX,
        startY: e.clientY,
        origStartBeat: hit.note.startBeat,
        origPitch: hit.note.pitch,
        beatWidth: beatWidthRef.current,
        hasMoved: false,
      };
      return;
    }

    if (!hit.note && e.button === 0) {
      const snappedBeat = Math.round(hit.beat * 4) / 4;
      if (snappedBeat < 0 || snappedBeat >= totalBeatsRef.current) return;
      // Guard: don't add if any existing note covers this beat+pitch
      const collision = notesRef.current.some(
        (n) => n.pitch === hit.pitch && snappedBeat >= n.startBeat && snappedBeat < n.startBeat + n.durationBeats
      );
      if (collision) return;
      const newNote: MelodyLayerNote = {
        id: crypto.randomUUID(),
        pitch: hit.pitch,
        startBeat: snappedBeat,
        durationBeats: 0.5,
      };
      addNote(activeLayerIdRef.current, newNote);
    }
  }, [hitTestNote, addNote]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeDragRef.current;
    if (resize) {
      const deltaPx = e.clientX - resize.startX;
      const deltaBeat = deltaPx / resize.beatWidth;
      const newDur = Math.max(0.25, Math.round((resize.origDur + deltaBeat) * 4) / 4);
      updateNote(resize.layerId, resize.noteId, { durationBeats: newDur });
      return;
    }

    const move = moveDragRef.current;
    if (move) {
      const dx = e.clientX - move.startX;
      const dy = e.clientY - move.startY;
      if (!move.hasMoved && Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      move.hasMoved = true;
      setGridCursor("grabbing");
      const newStartBeat = Math.max(0, Math.min(
        totalBeatsRef.current - 0.25,
        Math.round((move.origStartBeat + dx / move.beatWidth) * 4) / 4,
      ));
      const deltaRows = Math.round(dy / ROW_H);
      const newPitch = Math.max(MIDI_MIN, Math.min(MIDI_MAX, move.origPitch - deltaRows));
      updateNote(move.layerId, move.noteId, { startBeat: newStartBeat, pitch: newPitch });
      return;
    }

    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - PIANO_W;
    const y = e.clientY - rect.top - RULER_H + gridRef.current.scrollTop;
    if (x < 0 || y < 0) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const pitch = MIDI_MAX - rowIdx;
    const bw = beatWidthRef.current;
    const beat = Math.round((x / bw) * 4) / 4;
    const onRightEdge = notesRef.current.some((n) => {
      if (n.pitch !== pitch) return false;
      const endX = (n.startBeat + n.durationBeats) * bw;
      return x >= n.startBeat * bw && x >= endX - 6 && x <= endX;
    });
    const onNoteBody = !onRightEdge && notesRef.current.some((n) => {
      if (n.pitch !== pitch) return false;
      return x >= n.startBeat * bw && x <= (n.startBeat + n.durationBeats) * bw;
    });
    setGridCursor(onRightEdge ? "ew-resize" : onNoteBody ? "grab" : "crosshair");
    const hasNote = notesRef.current.some(
      (n) => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats
    );
    setHoverCell(hasNote ? null : { pitch, beat });
  }, [updateNote]);

  const handleGridPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      resizeDragRef.current = null;
      return;
    }
    if (moveDragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (!moveDragRef.current.hasMoved) {
        // Pure click = delete
        removeNote(moveDragRef.current.layerId, moveDragRef.current.noteId);
      }
      moveDragRef.current = null;
    }
  }, [removeNote]);

  const handleGridContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = hitTestNote(e.clientX, e.clientY);
    if (hit?.note) removeNote(activeLayerIdRef.current, hit.note.id);
  }, [hitTestNote, removeNote]);

  // ─── Ghost note ──────────────────────────────────────────────────────────────

  const ghostNote = useMemo(() => {
    if (!hoverCell) return null;
    const { pitch, beat } = hoverCell;
    if (beat < 0 || beat >= totalBeats) return null;
    return { pitch, startBeat: beat, durationBeats: 0.5, id: "ghost" };
  }, [hoverCell, totalBeats]);

  const allDisplayNotes = useMemo<DisplayNote[]>(
    () => ghostNote ? [...notes, { ...ghostNote, _ghost: true }] : notes,
    [notes, ghostNote]
  );

  // ─── Playhead ────────────────────────────────────────────────────────────────

  const playheadX = isPlaying ? PIANO_W + beatInfo.beat * beatWidth : null;

  // ─── Synth preset helper ─────────────────────────────────────────────────────

  const applyPreset = useCallback((index: number) => {
    setSynth(activeLayerIdRef.current, { presetIndex: index });
    const engine = melodyLayerEngines[activeLayerIdxRef.current];
    const preset = MELODY_PRESETS[index];
    if (engine && preset) engine.setParams(preset.params);
  }, [setSynth]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const gridHeight = ROWS * ROW_H;

  return (
    <div className="flex flex-col select-none" style={{ fontFamily: "monospace" }}>

      {/* ── Mini layer strip ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/5">
        {layers.map((layer, idx) => {
          const color = LAYER_COLORS[layer.colorIndex];
          const isActive = layer.id === activeLayer.id;
          return (
            <button
              key={layer.id}
              onClick={() => setActiveLayer(layer.id)}
              onContextMenu={(e) => { e.preventDefault(); removeLayer(layer.id); }}
              className="px-2 py-1 text-[7px] font-black tracking-[0.12em] rounded border transition-all"
              style={{
                background: isActive ? `${color}20` : "transparent",
                borderColor: isActive ? `${color}60` : "#2a2d38",
                color: isActive ? color : "#555",
              }}
              title="Right-click to remove"
            >
              L{idx + 1}
              {layer.muted ? " M" : ""}
            </button>
          );
        })}

        {layers.length < 4 && (
          <button
            onClick={() => addLayer()}
            className="px-2 py-1 text-[7px] font-black rounded border border-dashed border-white/15 text-white/25 hover:text-white/50 hover:border-white/30 transition-all"
          >
            +
          </button>
        )}

        {/* Bar length for active layer */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[7px] text-white/25 tracking-[0.1em]">BARS</span>
          {([1, 2, 4, 8] as const).map((b) => (
            <button
              key={b}
              onClick={() => updateLayer(activeLayer.id, { barLength: b })}
              className="w-5 h-5 text-[7px] font-black rounded transition-all"
              style={{
                background: activeLayer.barLength === b ? `${layerColor}20` : "transparent",
                border: `1px solid ${activeLayer.barLength === b ? `${layerColor}60` : "#2a2d38"}`,
                color: activeLayer.barLength === b ? layerColor : "#555",
              }}
            >
              {b}
            </button>
          ))}
        </div>

        {/* Mute / Solo */}
        <button
          onClick={() => updateLayer(activeLayer.id, { muted: !activeLayer.muted })}
          className="w-6 h-5 text-[6px] font-black rounded border transition-all ml-1"
          style={{
            background: activeLayer.muted ? "#f9731620" : "transparent",
            borderColor: activeLayer.muted ? "#f9731660" : "#2a2d38",
            color: activeLayer.muted ? "#f97316" : "#555",
          }}
        >
          M
        </button>
        <button
          onClick={() => updateLayer(activeLayer.id, { soloed: !activeLayer.soloed })}
          className="w-6 h-5 text-[6px] font-black rounded border transition-all"
          style={{
            background: activeLayer.soloed ? `${layerColor}20` : "transparent",
            borderColor: activeLayer.soloed ? `${layerColor}60` : "#2a2d38",
            color: activeLayer.soloed ? layerColor : "#555",
          }}
        >
          S
        </button>

        {/* Clear active layer */}
        <button
          onClick={() => clearNotes(activeLayer.id)}
          className="ml-1 text-[7px] font-bold tracking-[0.1em] text-white/20 hover:text-white/50 px-1.5 py-0.5 rounded border border-white/8"
        >
          CLR
        </button>
      </div>

      {/* ── Piano Roll Grid ── */}
      <div
        ref={gridRef}
        className="relative overflow-y-auto overflow-x-hidden"
        style={{ height: Math.min(gridHeight + RULER_H, 180), background: "#0d0f14", cursor: gridCursor }}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={handleGridPointerUp}
        onPointerLeave={(e) => {
          setHoverCell(null);
          if (resizeDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            resizeDragRef.current = null;
          }
          if (moveDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            moveDragRef.current = null;
          }
        }}
        onContextMenu={handleGridContextMenu}
      >
        {/* Ruler */}
        <div
          className="sticky top-0 z-10 flex"
          style={{ height: RULER_H, background: "#0d0f14", borderBottom: "1px solid #1f2230", paddingLeft: PIANO_W }}
        >
          {Array.from({ length: totalBeats }, (_, beat) => (
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
            const name = pitchName(pitch);
            const isC = name === "C";

            return (
              <div
                key={pitch}
                style={{
                  display: "flex",
                  height: ROW_H,
                  background: isBlack ? "rgba(0,0,0,0.25)" : "transparent",
                  borderBottom: isC ? "1px solid #222" : "1px solid #181a22",
                }}
              >
                {/* Piano key label */}
                <div
                  style={{
                    width: PIANO_W,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 5,
                    fontSize: 6,
                    color: isBlack ? "#333" : "#444",
                    background: isBlack ? "#151820" : "#1a1d26",
                    borderRight: "1px solid #222",
                    cursor: "default",
                  }}
                >
                  {isC ? name + (Math.floor(pitch / 12) - 1) : ""}
                </div>

                {/* Beat cells — grid lines only */}
                {Array.from({ length: totalBeats }, (_, beat) => (
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

          {/* Notes */}
          {allDisplayNotes.map((note) => {
            const isGhost = note._ghost === true;
            const rowIdx = MIDI_MAX - note.pitch;
            if (rowIdx < 0 || rowIdx >= ROWS) return null;
            return (
              <div
                key={note.id}
                style={{
                  position: "absolute",
                  top: rowIdx * ROW_H + 2,
                  left: PIANO_W + note.startBeat * beatWidth,
                  width: Math.max(4, note.durationBeats * beatWidth - 2),
                  height: ROW_H - 3,
                  background: isGhost ? `${layerColor}30` : `${layerColor}70`,
                  border: `1px solid ${isGhost ? layerColor + "40" : layerColor}`,
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

      {/* ── Synth panel ── */}
      <div
        className="px-3 py-2 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        style={{ background: "#0d0f14" }}
      >
        {/* Preset */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">PRESET</span>
          <select
            value={activeLayer.synth.presetIndex}
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
              onClick={() => setSynth(activeLayer.id, { octaveOffset: o })}
              className="w-5 h-5 text-[7px] font-black rounded border transition-all"
              style={{
                background: activeLayer.synth.octaveOffset === o ? `${layerColor}20` : "transparent",
                borderColor: activeLayer.synth.octaveOffset === o ? `${layerColor}60` : "#2a2d38",
                color: activeLayer.synth.octaveOffset === o ? layerColor : "#555",
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
            value={activeLayer.synth.cutoff}
            onChange={(e) => setSynth(activeLayer.id, { cutoff: Number(e.target.value) })}
            className="w-20 h-1 accent-current"
            style={{ accentColor: layerColor }}
          />
        </div>
      </div>
    </div>
  );
}
