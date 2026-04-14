# Elastic Groove — MIDI Editor Specification

## Design Philosophy
> The editor must feel like an instrument, not a technical tool.

Every interaction should be immediate. Visual feedback should be constant.
The editor should make musical decisions easy and technical decisions invisible.

---

## 1. CORE INTERACTION MODEL

### Note Placement (Single Click)
- Click on grid = place note at snapped position
- Note duration = current grid resolution (1/16, 1/8, etc.)
- Note immediately plays preview (250ms)
- Visual: note appears instantly with subtle scale-in animation

### Note Selection
- Click note = select (deselect others)
- Shift+Click = toggle add/remove from selection
- Ctrl+A = select all
- Double-click note = select all notes at same pitch
- Rubber-band: drag on empty space = selection rectangle

### Note Movement (Keyboard-First)
- Arrow ← → = move 1 grid step
- Arrow ↑ ↓ = move 1 semitone (or scale degree if Scale mode)
- Shift + Arrow ← → = move 1 beat
- Shift + Arrow ↑ ↓ = move 1 octave
- Hold Alt + drag = duplicate notes while moving

### Note Resize
- Drag right edge = change duration
- Shift + ← → on selected notes = resize duration by grid step
- Double-click right edge = snap to next grid line

### Note Delete
- Right-click = delete single note
- Delete/Backspace = delete selected notes
- Ctrl+Z = undo (future)

---

## 2. GRID & TIMING

### Grid Resolution
- Selectable: 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar
- Triplet mode: 1/16T, 1/8T, 1/4T
- Dotted mode: 1/16D, 1/8D
- Grid resolves all placement, movement, and resize

### Snap Modes
- **Hard Snap**: everything quantizes to grid (default)
- **Soft Snap**: slight magnetic pull, allows off-grid placement
- **Off**: free placement

### Swing/Groove
- Swing amount slider (50-75%)
- Applied to playback, not note positions
- Visual: swung beats show offset markers

---

## 3. VISUAL DESIGN

### Grid Appearance
- Background: dark (#0a0a0e)
- Bar lines: bright (20% white, 2px)
- Beat lines: medium (10% white, 1px)
- Subdivision lines: subtle (4% white, 0.5px)
- Black key rows: warm tint (#1a1816)
- Scale-highlighted rows: green tint when Scale mode on

### Piano Keys (Left Panel)
- Width: 64px
- White keys: gradient (#2a2a30 → #222228)
- Black keys: darker (#0d0d10), indented
- C notes: brighter, labeled "C2", "C3", etc.
- All white keys: show letter name
- Playing notes: glow effect on key

### Notes
- Rounded corners (3px)
- Colored by track (melody=pink, bass=green, chords=purple, drums=orange)
- Opacity = velocity (50% base + 50% × velocity)
- Note name shown if width > 24px
- Velocity bar at bottom (3px, track-colored)
- Selected: white 1px outline
- Playing: bright glow pulse

### Playhead
- 1.5px wide, track-colored
- Gradient glow
- Beat number label at top

---

## 4. VELOCITY EDITING

### Velocity Lane (Bottom Panel, 80px)
- Vertical bars per note
- Height = velocity (0-100%)
- Color = track color
- Click bar = set velocity
- Drag bar = adjust velocity
- Draw mode: drag across multiple bars to "paint" velocity curve

### Quick Velocity
- Select notes → type number 1-9 = set velocity (10%-90%)
- Select notes → 0 = set velocity 100%

---

## 5. SCALE & HARMONY TOOLS

### Scale Mode
- Toggle "SCALE" button
- Highlights valid scale rows (subtle green tint)
- Dims non-scale rows
- New notes snap to nearest scale degree
- Arrow ↑↓ moves by scale degree, not semitone

### Harmony Generator (HARMONY Menu)
- **Fix to Scale**: snaps all selected notes to nearest scale tone
- **Scale Run ↑/↓**: generates ascending/descending scale
- **Chord Progressions**: I-IV-V-I, I-vi-IV-V, ii-V-I, I-V-vi-IV
- **Harmonize +3rds/+5ths**: adds intervals above selected notes
- **Arpeggios ↑/↓**: broken chord patterns

### Chord Recognition
- When multiple notes are selected, show chord name (e.g., "Cm7")

---

## 6. MULTI-TRACK

### Track Assignment
- Each note has a track: MELODY, CHORDS, BASS, DRUMS
- Toolbar selector sets track for NEW notes
- Notes colored by their track
- Overlapping notes on different tracks allowed

### Track Routing
- MELODY → MelodyEngine (channel 14)
- CHORDS → ChordsEngine (channel 13)
- BASS → BassEngine (channel 12)
- DRUMS → DrumEngine (voices 0-11)

---

## 7. PLAYBACK

### Transport Integration
- Playback synced to drum sequencer transport
- Piano Roll has own step counter (independent loop length)
- Loop length matches drum pattern (auto-sync)
- Playhead visible and animating during playback

### Note Triggering
- Notes trigger through their assigned track engine
- Soundfont instruments supported (if loaded)
- Release scheduled at note end
- Notes persist when panel is closed (module-level state)

---

## 8. ADVANCED TOOLS (Future)

### Generative Patterns
- Random melody generator (scale-aware)
- Euclidean rhythm generator for note patterns
- Markov chain melody generator
- AI-assisted chord suggestion

### Modulation Lanes
- CC lanes below velocity lane
- Mod wheel, pitch bend, expression
- Draw automation curves

### MIDI Import/Export
- Drag & drop .mid files into piano roll
- Export piano roll as .mid file
- Copy notes between piano roll and step sequencers

### Undo/Redo
- Full undo history for all note operations
- Ctrl+Z / Ctrl+Shift+Z
