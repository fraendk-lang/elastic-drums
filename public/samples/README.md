# Drum Sample Kits

This directory contains user-provided drum sample kits for Elastic Drum.

## Directory Structure

```
public/samples/
├── {kit-name}/
│   ├── kick.wav
│   ├── snare.wav
│   ├── clap.wav
│   ├── tom-lo.wav
│   ├── tom-mid.wav
│   ├── tom-hi.wav
│   ├── hh-closed.wav
│   ├── hh-open.wav
│   ├── cymbal.wav
│   ├── ride.wav
│   ├── perc1.wav
│   └── perc2.wav
```

## Voice Names

Each kit must provide samples for the following voice names:

- **kick** — Bass drum / Kick sample
- **snare** — Snare drum
- **clap** — Clap or snap
- **tom-lo** — Low tom
- **tom-mid** — Mid tom
- **tom-hi** — High tom
- **hh-closed** — Closed hi-hat
- **hh-open** — Open hi-hat
- **cymbal** — Cymbal / crash
- **ride** — Ride cymbal
- **perc1** — Percussion voice 1 (optional orchestral perc)
- **perc2** — Percussion voice 2 (optional orchestral perc)

## Supported Formats

- **WAV** (preferred) — 16-bit or 24-bit WAV files
- **MP3** — As fallback if WAV not found
- **OGG** — Not currently supported

## Adding a New Kit

1. Create a new folder under `public/samples/` with your kit name:
   ```
   public/samples/my-808-kit/
   ```

2. Place samples for each voice with the exact filenames listed above.

3. Update `src/audio/SampleKitLoader.ts` to register your kit:
   ```ts
   export const SAMPLE_KITS: SampleKit[] = [
     { id: "my-808-kit", name: "My 808 Kit", path: "/samples/my-808-kit" },
   ];
   ```

4. The drum sequencer will now show your kit in the kit selector.

## Sample Guidelines

- **Sample rate:** 44.1 kHz or 48 kHz (will be resampled to 48 kHz)
- **Bit depth:** 16-bit or 24-bit
- **Length:** Keep samples short (under 2 seconds) for responsive playback
- **Normalization:** Ensure samples are properly normalized to avoid clipping
- **Silence:** Trim leading/trailing silence for tighter playback timing

## Notes

- Users provide their own samples — no samples are bundled with Elastic Drum
- Missing samples will be silently skipped (no error)
- Each kit is independent and can have its own sample quality/character
- Kits can be switched in real-time during playback
