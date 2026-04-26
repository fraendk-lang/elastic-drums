# Arrangement View Redesign — Design Spec

## Goal

Vollständige Überarbeitung des Arrangement Views zu einem DAW-grade Multi-Lane Sequencer mit professionellem Editing-Modell (Drag/Copy/Resize/Multi-Select) und visueller Anreicherung durch Scene-Farben, Waveform-Minivorschau und Loop-Spur.

---

## Problem

Der bestehende Arrangement View (`ArrangementView.tsx`, 637 Zeilen) hat:
- Eine einzelne "SECTIONS"-Zeile + eine "SCENE LANE" — keine dedizierten Spuren pro Instrument
- Editing nur über +/− Buttons und kleine Action-Icons (DUP, →, ×) — keine Drag-Interaktionen
- Keine visuellen Unterschiede zwischen Scenes — alle Clips sehen gleich aus
- Die Loop Player Slots sind im Arrangement vollständig unsichtbar
- Keine Scene-Namen/Farben

---

## Design

### Layout — DAW Multi-Lane

```
┌─────────────────────────────────────────────────────────────────────┐
│ ARRANGEMENT  [4 CLIPS]  [8 BARS]  [MIDI 2B]  [▶ SONG PLAY]   128BPM │  ← Status Bar
├────────┬────────────────────────────────────────────────────────────┤
│        │  1    2    3    4    5    6    7    8                       │  ← Ruler (Bar-Nummern)
│        │ INTRO      VERSE      DROP                                 │     (+ optionale Section-Labels)
├────────┼────────────────────────────────────────────────────────────┤
│ DRUMS  │ [Scene 1 ×2~~~~] [Scene 2 ×2~~~~] [Scene 3 — Drop ×4~~~~] │  ← Track Row
├────────┼────────────────────────────────────────────────────────────┤
│ BASS   │ [D-Minor Sub   ] [Bb Dorian     ] [Drop Bass ×4          ]│
├────────┼────────────────────────────────────────────────────────────┤
│ CHORDS │ [Organ Stab    ] [Jazz Comp     ] [Supersaw Stab ×4      ]│
├────────┼────────────────────────────────────────────────────────────┤
│ MELODY │ [Hook A        ] [Hook B] [—    ] [Lead Rise ×4          ]│
├────────┼────────────────────────────────────────────────────────────┤
│ LOOPS  │ [● Amen Break  ] [● Deep + Vinyl] [● Amen + Reese + FX   ]│  ← Loop Lane (teal)
├────────┴────────────────────────────────────────────────────────────┤
│ Scene 3 — Drop  ◼ ●●●●●●●●  ×4 bars  [−][+]  🎨 Farbe  ✏ Name    │  ← Detail Panel
└─────────────────────────────────────────────────────────────────────┘
```

**5 Track-Zeilen:**
- DRUMS, BASS, CHORDS, MELODY — je eine Zeile pro Instrument
- LOOPS — eigene Zeile (teal), zeigt aktive Loop-Slots pro Scene

Alle Clips einer Scene teilen dieselbe Farbe. Clip-Breite ist proportional zur Bar-Anzahl.

---

## Datenmodell

### Änderungen an `SongChainEntry` (in `drumStore.ts`)

Zwei neue optionale Felder:

```typescript
interface SongChainEntry {
  sceneIndex: number;
  repeats: number;
  tempoBpm?: number;
  tempoRamp?: boolean;
  // NEU:
  color?: string;   // hex color, z.B. "#a855f7" — undefined = auto aus Scene-Index
  label?: string;   // Benutzer-Name, z.B. "Drop" — undefined = "Scene N"
}
```

Auto-Farben (wenn `color` undefined) werden aus einem festen Palette-Array anhand des `sceneIndex` berechnet — kein Store-Zustand nötig.

**Alle anderen Stores bleiben unverändert.** Loop-Slots werden aus `useLoopPlayerStore` gelesen (bereits vorhanden, gibt den State pro Slot zurück).

---

## Editing-Modell

### Maus-Interaktionen

| Geste | Aktion |
|---|---|
| Click auf Clip | Selektieren (deselektiert anderen) |
| ⌘/Ctrl + Click | Multi-Select (toggle) |
| Drag auf Clip-Body | Clip verschieben (reorder in `songChain`) |
| Alt + Drag | Clip **kopieren** — neuen Eintrag an Zielposition einfügen |
| Drag auf rechte Kante (⋮) | Resize — `repeats` stufenweise (snap: 1 Bar) |
| Click auf leeren Bereich | Deselektieren |
| Rechtsklick auf Clip | Kontextmenü öffnen |

### Keyboard-Shortcuts (wenn Clip selektiert)

| Key | Aktion |
|---|---|
| `Del` / `Backspace` | Clip(s) löschen |
| `D` | Duplizieren — Kopie direkt dahinter einfügen |
| `⌘C` | Clip in internen Clipboard kopieren |
| `⌘V` | Clipboard-Clip nach selektiertem einfügen |
| `−` | `repeats` −1 (min: 1) |
| `+` | `repeats` +1 (max: 16) |
| `←` | Clip eine Position nach links verschieben |
| `→` | Clip eine Position nach rechts verschieben |
| `C` | Farbwähler öffnen |
| `F2` | Umbenennen (inline Input) |
| `Esc` | Deselektieren / Menü schließen |

### Rechtsklick-Kontextmenü

```
┌─────────────────────────────┐
│ ◼  Scene 3 — Drop · ×4 Bars │  ← Header mit Farbe + Name
├─────────────────────────────┤
│ ⎘  Duplizieren          D   │
│ ⊕  Kopieren           ⌘C   │
│ ⊗  Einfügen danach    ⌘V   │
├─────────────────────────────┤
│ ◀  Bars −1              −   │
│ ▶  Bars +1              +   │
├─────────────────────────────┤
│ 🎨  Farbe wählen…       C   │
│ ✏  Umbenennen…         F2  │
├─────────────────────────────┤
│ ✕  Löschen            Del  │  ← rot
└─────────────────────────────┘
```

---

## Clip-Darstellung

### Farbsystem (F3)

8 vordefinierte Scene-Farben (zyklisch nach sceneIndex):
```
Orange #f97316, Green #22c55e, Purple #a855f7, Pink #ec4899,
Blue #3b82f6, Amber #f59e0b, Teal #22d3ee, Red #ef4444
```

Benutzer kann über Farbwähler (8 Dots im Detail-Panel und im Kontextmenü) eine eigene Farbe setzen → wird als `color` in `SongChainEntry` gespeichert.

### Mini-Waveform (F5)

Nur auf DRUMS- und BASS-Clips. Wird aus dem Step-Pattern des zugehörigen Scene-Snapshots generiert:
- Drums: `active`-Steps erzeugen Balken mit zufälliger, aber deterministischer Höhe (Seed = sceneIndex × stepIndex)
- Bass: `active`-Steps mit note-proportionaler Höhe

Berechnung erfolgt zur Render-Zeit (kein separater State). Balken sind stilisiert (2px breit, abgerundet, 40% opacity).

### Clip-Inhalt

```
┌────────────────────────┐
│ Scene 2                │  ← label oder "Scene N"
│ Bb Dorian              │  ← instrument-spezifische Info (Preset-Name / Scale)
│ ▂▄▇▂▅▃▆▂              │  ← Mini-Waveform (nur DRUMS/BASS)
└──────────────────── ⋮ ─┘  ← rechter Rand = Resize-Handle
```

Instrument-spezifische Info:
- DRUMS: immer leer (kein Preset-Name)
- BASS: `rootName + " " + scaleName` aus Scene-Snapshot
- CHORDS: Preset-Name aus Scene-Snapshot
- MELODY: Preset-Name aus Scene-Snapshot
- LOOPS: Name der aktiven Loop-Slots (kommasepariert, max. 2 + "+N more")

### Loop Lane (F2)

Zeigt pro Clip-Position die aktiven Slots aus `scene.loopSlots` (bereits im Scene-Snapshot gespeichert seit der Scene-Loop Integration). Jeder aktive Slot erscheint als teal Pill mit dem gespeicherten `fileName`. Pulsierende Animation wenn der Song gerade an dieser Position spielt.

---

## Playhead

Weißer vertikaler Strich + Dreieck-Cap läuft über alle 5 Spuren synchron. Position = `songPosition / totalBars * 100%`. Nur sichtbar wenn `songMode === true`.

---

## Detail Panel (unten)

Zeigt Infos zum selektierten Clip:
- Scene-Farbe Swatch + Name (editierbar via F2/Click)
- Bar-Zähler mit −/+ Buttons
- Farbwähler (8 Dots)
- Instrument-Info aller Spuren dieser Scene (BASS: Preset, CHORDS: Preset, etc.)

Kein selektierter Clip → Panel zeigt Arrangement-Gesamtinfo (Total Bars, BPM-Verlauf).

---

## Komponenten-Architektur

```
ArrangementView.tsx          (Haupt-Container, State, Keyboard-Handler)
├── ArrangementStatusBar     (inline, klein — kein eigenes File)
├── ArrangementRuler         (inline)
├── ArrangementTrackRow      (wiederverwendet für alle 5 Spuren)
│   └── ArrangementClip      (ein Clip — Drag, Resize, Select, Rechtsklick)
├── ArrangementLoopLane      (Loop-spezifische Row-Logik)
├── ArrangementContextMenu   (Rechtsklick-Popup)
├── ArrangementDetailPanel   (unteres Info-Panel)
└── ArrangementColorPicker   (8-Dot Picker, wiederverwendet in Menu + Panel)
```

Alle Sub-Komponenten bleiben in `ArrangementView.tsx` (da sie eng gekoppelt sind). Nur wenn eine Komponente >150 Zeilen wird, wird sie in ein eigenes File extrahiert.

---

## Was sich NICHT ändert

- `SongChainEntry`-Kern-Felder (`sceneIndex`, `repeats`, `tempoBpm`, `tempoRamp`) — unverändert
- Store-Actions (`addToSongChain`, `removeFromSongChain`, `updateSongEntryRepeats`, `moveSongEntry`) — unverändert, werden intern von neuem Drag/Edit-Code gerufen
- `sceneStore` und alle anderen Stores — unverändert
- Song-Playback-Logik — unverändert

---

## Out of Scope

- Tempo-Automation-Kurve (eigenes Feature, separater Sprint)
- Section-Labels auf dem Ruler (F4) — Design reserviert Platz, Implementierung später
- Loop-Slot-Editing aus dem Arrangement heraus (Loops werden weiterhin im Loop-Player Tab editiert)
- Undo/Redo für Arrangement-Edits (globales Undo/Redo System bereits vorhanden — wird automatisch funktionieren wenn Store-Mutations korrekt sind)
