# Elastic Groove — 45 s Produktvideo (Remotion)

Erzeugt das finale MP4 aus Frank's QuickTime-Captures + WAV-Soundtrack.

## Workflow

### 1. Bildschirm-Captures aufnehmen

Im Dev-Server der Elastic-Drum-App (`npm run dev` im Root):

```
http://localhost:5173/?demo=record&hideChrome=1&song=2&bars=20
```

- Recording-Orchestrator startet automatisch.
- QuickTime Player → Neue Bildschirmaufnahme → Fenster wählen → Aufnahme.
- Performance läuft ~40 s, stoppt selbst.
- Aus dem QuickTime-Export 5 Clips schneiden und ablegen als:
  - `public/assets/drums.mp4`         (Bar 0 – 5)
  - `public/assets/bass-melody.mp4`   (Bar 4 – 11)
  - `public/assets/performance-fx.mp4`(Bar 12 – 16)
  - `public/assets/scenes.mp4`        (Bar 16 – 20)

### 2. Soundtrack-WAV aufnehmen

```
http://localhost:5173/?demo=record&audio=1&song=2&bars=20
```

- Pille unten in der Mitte sichtbar: **„Export Soundtrack"** klicken.
- Nach ~45 s wird `elastic-groove-soundtrack.wav` heruntergeladen.
- Datei nach `public/soundtrack.wav` verschieben.

### 3. Remotion Studio Preview

```bash
cd video
npm install
npm start    # → Browser auf http://localhost:3000
```

Live-Preview aller 6 Szenen mit Audio. Hier können Captions / Timings nachjustiert werden.

### 4. Finaler Render

```bash
npm run build           # CRF 18, hohe Qualität (~30 MB)
npm run build:fast      # CRF 22, kleiner für Quick-Iterate
```

Ergebnis: `out/elastic-groove-45s.mp4` — 1920×1080 H.264 30 fps mit AAC-Audio.

## Architektur

```
src/
├─ index.ts                Entry: registerRoot
├─ Root.tsx                Composition-Registry
├─ ElasticGrooveVideo.tsx  Master 45 s composition
├─ scenes/
│  ├─ IntroCard.tsx        0:00 – 0:04 (logo + claim, kein App-Footage)
│  ├─ DrumScene.tsx        0:04 – 0:14 (drums.mp4 + caption)
│  ├─ BassMelodyScene.tsx  0:14 – 0:25 (bass-melody.mp4 + caption)
│  ├─ PerformanceScene.tsx 0:25 – 0:35 (performance-fx.mp4 + caption)
│  ├─ ScenesArrangScene.tsx 0:35 – 0:42 (scenes.mp4 + caption)
│  └─ OutroCard.tsx        0:42 – 0:45 (URL + CTA, kein App-Footage)
└─ components/
   ├─ Caption.tsx          Reusable kinetic typography block
   └─ AppFootage.tsx       Reusable Video + vignette wrapper
```

Frame-Budget (30 fps):

| From | To   | Frames | Scene            |
|------|------|--------|------------------|
|    0 |  120 |    120 | Intro            |
|  120 |  420 |    300 | Drums            |
|  420 |  750 |    330 | Bass + Melody    |
|  750 | 1050 |    300 | Performance + FX |
| 1050 | 1260 |    210 | Scenes / Arrange |
| 1260 | 1350 |     90 | Outro            |
| Total: 1350 frames = 45 s @ 30 fps                 |
