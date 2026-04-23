/**
 * Elastic Drum — MP3 Export Server
 * Receives a WAV blob, converts to MP3 via ffmpeg, returns the MP3.
 *
 * Deploy on Railway. Requires ffmpeg (installed via Dockerfile).
 */

import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const app = express();
const PORT = process.env.PORT || 3001;

// Allow all origins — tighten in production if needed
app.use(
  cors({
    origin: "*",
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Accept raw WAV body (up to 100 MB)
app.use(
  express.raw({
    type: ["audio/wav", "audio/wave", "application/octet-stream", "*/*"],
    limit: "100mb",
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "elastic-drum-mp3-export" });
});

app.post("/mp3", (req, res) => {
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "Empty or invalid WAV body" });
  }

  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = join(tmpdir(), `ed-${ts}.wav`);
  const tmpOut = join(tmpdir(), `ed-${ts}.mp3`);

  try {
    writeFileSync(tmpIn, req.body);
  } catch (writeErr) {
    return res.status(500).json({ error: `Write failed: ${writeErr.message}` });
  }

  // -q:a 2 = ~190 kbps VBR (high quality), fast
  execFile(
    "ffmpeg",
    ["-y", "-i", tmpIn, "-acodec", "libmp3lame", "-q:a", "2", tmpOut],
    { timeout: 60_000 },
    (err, _stdout, stderr) => {
      // Clean up input regardless
      try { unlinkSync(tmpIn); } catch { /* ignore */ }

      if (err) {
        try { if (existsSync(tmpOut)) unlinkSync(tmpOut); } catch { /* ignore */ }
        console.error("ffmpeg error:", stderr);
        return res.status(500).json({ error: `ffmpeg failed: ${stderr.slice(-300)}` });
      }

      let mp3;
      try {
        mp3 = readFileSync(tmpOut);
        unlinkSync(tmpOut);
      } catch (readErr) {
        return res.status(500).json({ error: `Read failed: ${readErr.message}` });
      }

      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Disposition", 'attachment; filename="export.mp3"');
      res.set("Content-Length", mp3.length.toString());
      res.send(mp3);
    }
  );
});

app.listen(PORT, () => {
  console.log(`Elastic Drum MP3 export server running on port ${PORT}`);
});
