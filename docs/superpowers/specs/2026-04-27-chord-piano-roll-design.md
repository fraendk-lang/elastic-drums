# Chord Piano Roll — Design Spec

**Datum:** 2026-04-27  
**Status:** Approved

---

## Überblick

Ein Vollbild-Overlay Piano Roll speziell für Akkorde, mit **Chord Snap**: ein Klick setzt automatisch den vollständigen Akkord nach dem aktiven Chord Set. Einzelne Noten bleiben danach frei editierbar. Das bestehende Step-Grid (ChordsSequencer) bleibt unverändert erhalten.

---

## Platzierung

- **Einstieg:** Button `🎹 PIANO ROLL ↗` im bestehenden `ChordsSequencer` (Toolbar, rechts)
- **Darstellung:** Vollbild-Overlay, lazy-geladen, konsistent mit dem Melody `PianoRoll`-Overlay
- **Mount-Punkt:** `App.tsx`, neben den anderen Overlays
- **Schließen:** `Esc` oder ×-Button

---

## Neue Dateien

| Datei | Zweck |
|---|---|
| `src/components/ChordPianoRoll/index.tsx` | Hauptkomponente: State, Render, Keyboard-Shortcuts |
| `src/components/ChordPianoRoll/ChordSets.ts` | 9 Factory Chord Sets (Voicing-Regeln) |
| `src/components/ChordPianoRoll/chordSnap.ts` | Pure Funktion: pitch + scale + set → ChordNote[] |
| `src/store/chordPianoStore.ts` | Zustand-Store für ChordNote-Array |

---

## Datenmodell

```typescript
// src/store/chordPianoStore.ts

interface ChordNote {
  id: string;            // nanoid
  pitch: number;         // MIDI 0–127
  startBeat: number;     // in Beats (float), 0-indexed
  durationBeats: number; // Mindestens 0.25 (1/16-Note)
  velocity: number;      // 0–127, Default 90
  chordGroup: string;    // z.B. "Am9" — visuelles Gruppieren + gemeinsames Drag
}

interface ChordPianoState {
  notes: ChordNote[];
  activeChordSet: ChordSetId;
  snapEnabled: boolean;
  snapResolution: 0.25 | 0.5 | 1;  // in Beats (1/16, 1/8, 1/4)
  loopStart: number;     // in Beats
  loopEnd: number;       // in Beats
  totalBeats: number;    // Default 16 (1 Bar × 16 Beats at 1/4-resolution)
  // Actions:
  addNotes: (notes: ChordNote[]) => void;
  removeNote: (id: string) => void;
  updateNote: (id: string, patch: Partial<ChordNote>) => void;
  updateGroup: (chordGroup: string, patch: Partial<ChordNote>) => void;
  setActiveChordSet: (id: ChordSetId) => void;
  setSnapEnabled: (v: boolean) => void;
  clear: () => void;
}
```

**Speicherung:** Notes werden im `sceneStore` (pro Scene) mitgespeichert — gleiche Persistenz wie Bass- und Melody-Steps.

**Audio:** Der bestehende `ChordsEngine` spielt beide Quellen: Step-Grid-Akkorde UND ChordPiano-Notes. Ein Flag `chordsSource: "grid" | "piano" | "both"` im `chordPianoStore` steuert welche aktiv ist. Default: `"both"`.

---

## Chord Sets

```typescript
type ChordSetId =
  | "neo-soul-7ths"
  | "pop-triads"
  | "jazz-voicings"
  | "spread-voicings"
  | "power-chords"
  | "shell-voicings"
  | "trip-hop"
  | "deep-house"
  | "custom";

// Voicing-Regel: pro Skalenstufe (0-6) → Halbton-Offsets vom Root
type ChordSetVoicing = Record<number, number[]>;
// Beispiel Neo Soul 7ths, Stufe 0 (i): [0, 3, 7, 10, 14] → min9
```

| Set | Stufe i | Stufe IV | Stufe V | Stil |
|---|---|---|---|---|
| Neo Soul 7ths | min9 | maj9 | dom9 | warm, reich |
| Pop Triads | min | maj | maj | klar, simpel |
| Jazz Voicings | min11 | maj13 | 7alt | komplex |
| Spread Voicings | min9 (2 Okt.) | maj9 (2 Okt.) | dom9 (2 Okt.) | luftig |
| Power Chords | 1+5 | 1+5 | 1+5 | hart, dicht |
| Shell Voicings | 1+m3+m7 | 1+M3+M7 | 1+M3+m7 | Jazz-minimal |
| Trip Hop | min7 / dim7 | maj7♭5 | sus4 | dunkel, Bristol |
| Deep House | min11 | maj9 | dom7sus4 / add9 | schwebend, Chicago |
| Custom | frei | frei | frei | — |

---

## Chord Snap

```typescript
// src/components/ChordPianoRoll/chordSnap.ts

function chordSnap(
  clickedPitch: number,
  rootNote: number,         // aus chordsStore
  scale: ScaleMode,         // aus chordsStore
  chordSet: ChordSetId,
  startBeat: number,
  durationBeats: number,
  velocity: number,
): ChordNote[]
```

**Ablauf:**
1. Berechne Skalenstufe: `degree = scaleStep(clickedPitch, rootNote, scale)` — nächste Stufe wenn Note außerhalb der Skala
2. Schlage Voicing-Offsets aus dem Chord Set nach
3. Erzeuge `ChordNote[]` mit gleichem `startBeat`, `durationBeats`, `velocity` und gemeinsamem `chordGroup`-Label
4. Rückgabe: Array aller Noten des Akkords

Bei `snapEnabled = false`: gibt nur die einzelne geklickte Note zurück (normaler Piano Roll Modus).

---

## UI-Komponenten

### Toolbar (oben)
- `CHORDS` Label + Tonart/Scale-Anzeige (read-only, aus chordsStore)
- Draw/Select Toggle (`B`/`S`)
- **Chord Snap Toggle** (⚡ ON / OFF)
- Snap-Auflösung: 1/16 · 1/8 · 1/4
- Zoom (Ctrl+Scroll)
- CLR · × (Schließen)

### Chord Set Leiste (unter Toolbar)
- Horizontale Chip-Reihe: alle 9 Sets als klickbare Pills
- Aktives Set hervorgehoben (lila Border)
- Rechts: Details des aktiven Sets (z.B. "min9 · maj9 · dom9 · min11 — 5-Ton-Voicings")

### Piano Roll (Hauptbereich)
- **Piano-Tasten** links: Skalentöne leicht lila hinterlegt, Root orange markiert
- **Ruler** oben: Bar.Beat-Labels, draggbarer Loop-Brace (wie Melody Piano Roll)
- **Grid:** vertikale Bar/Beat-Linien, horizontale Notenzeilen
- **Noten-Blöcke:** nach `chordGroup` eingefärbt (gleiche Akkord-Gruppe = gleiche Farbe), Akkord-Name auf dem untersten Block
- **Ghost-Vorschau:** beim Hover über leere Fläche zeigt transparente Vorschau den Akkord der platziert würde + Tooltip mit Akkordname
- **Playhead:** animierte weiße Linie, läuft mit Transport

### Detail Panel (unten)
- Zeigt alle Noten des selektierten Akkords als Pills (z.B. `A3 root` · `C4 m3` · `E4 5th`)
- Velocity-Slider für die ganze Gruppe
- Strum-Delay (0–80ms, verteilt Noten zeitlich)
- `+ Note` Button für manuelles Hinzufügen

---

## Interaktionen

| Aktion | Verhalten |
|---|---|
| Klick auf leere Fläche (Snap ON) | Akkord-Gruppe platzieren |
| Klick auf leere Fläche (Snap OFF) | Einzelne Note platzieren |
| Klick auf Note | Akkord-Gruppe selektieren |
| Rechts-Drag auf Note-Rand | Länge ändern (gesamte Gruppe) |
| Alt+Drag | Akkord-Gruppe duplizieren |
| Doppelklick auf Note | Note aus Gruppe lösen (einzeln editierbar) |
| Rechtsklick | Kontextmenü (Delete, Duplicate, Snap neu anwenden, Velocity) |
| `B` | Draw Mode |
| `S` | Select Mode |
| `Del` | Selektierte Notes/Gruppen löschen |
| `⌘A` | Alle selektieren |
| `⌘C` / `⌘V` | Kopieren / Einfügen |
| `⌘Z` / `⌘Shift+Z` | Undo / Redo |
| `←→` | Gruppe verschieben (Shift = 1 Beat) |
| `↑↓` | Transponieren ±1 Halbton (Shift = ±Oktave) |
| `Ctrl+Scroll` | Horizontal Zoom |
| `Esc` | Overlay schließen |

---

## Audio-Integration

- `ChordsEngine.scheduleNote(pitch, startTime, duration, velocity)` — bereits vorhanden
- ChordPiano-Notes werden im selben Scheduler wie Step-Grid-Akkorde geplant
- `chordsSource` Flag: `"grid"` (nur Step-Grid) · `"piano"` (nur Piano Roll) · `"both"` (beide gleichzeitig)
- BPM-Änderungen: alle geplanten Noten werden neu berechnet (gleiche Logik wie Melody Piano Roll)

---

## Testing

Reine Unit-Tests für Pure Functions:

```typescript
// chordSnap.test.ts
describe("chordSnap", () => {
  it("returns min9 voicing for root in Neo Soul 7ths", ...)
  it("returns 5 notes for spread voicing", ...)
  it("returns single note when snapEnabled = false", ...)
  it("handles out-of-scale clicks by snapping to nearest degree", ...)
  it("clamps pitches to MIDI range 0–127", ...)
})

// ChordSets.test.ts
describe("ChordSets", () => {
  it("all sets define voicings for all 7 scale degrees", ...)
  it("Trip Hop degree 0 includes diminished interval", ...)
  it("Deep House degree 4 includes sus4 interval", ...)
})
```

---

## Out of Scope

- Custom Chord Set Editor (UI zum Definieren eigener Voicings) — Custom-Slot reserviert, Editor kommt später
- MIDI-Import in den Chord Piano Roll
- Quantisierung bestehender Noten

---

## Nächster Schritt: Melody Call & Response

Zweite Melody-Einheit als "Antwort" auf die erste — Call & Response Kompositionstechnik. Separater Track mit eigenem Sequencer, läuft parallel oder alternierend zur ersten Melodie.
