/**
 * MIDI Player Panel — DAW-style import and transport window.
 * Pairs file ingest, track inspection, and quick actions with a bridge into the piano roll editor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { midiPlayer, type MidiFileInfo } from "../audio/MidiPlayer";
import { useDrumStore } from "../store/drumStore";
import { bassEngine } from "../audio/BassEngine";
import { chordsEngine } from "../audio/ChordsEngine";
import { melodyEngine } from "../audio/MelodyEngine";
import { audioEngine } from "../audio/AudioEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";

interface MidiPlayerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenEditor: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTrackRole(channel: number, index: number, trackName: string): string {
  const lower = trackName.toLowerCase();
  if (channel === 9 || lower.includes("drum") || lower.includes("perc")) return "Drums";
  if (channel === 0 || index === 0) return "Bass";
  if (channel === 1 || index === 1) return "Chords";
  return "Melody";
}

export function MidiPlayerPanel({ isOpen, onClose, onOpenEditor }: MidiPlayerPanelProps) {
  const { setBpm } = useDrumStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileInfo, setFileInfo] = useState<MidiFileInfo | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ position: 0, duration: 0 });

  const releaseAllVoices = useCallback(() => {
    const now = audioEngine.currentTime + 0.005;
    bassEngine.releaseNote(now);
    chordsEngine.releaseChord(now);
    melodyEngine.releaseNote(now);
    bassEngine.panic(now + 0.01);
    chordsEngine.panic(now + 0.01);
    melodyEngine.panic(now + 0.01);
    soundFontEngine.stopAll("bass");
    soundFontEngine.stopAll("chords");
    soundFontEngine.stopAll("melody");
  }, []);

  useEffect(() => {
    // Register stop callback to release all voices when MIDI player stops internally (loop restart, end)
    midiPlayer.setOnStop(() => {
      const now = audioEngine.currentTime + 0.005;
      bassEngine.releaseNote(now);
      chordsEngine.releaseChord(now);
      melodyEngine.releaseNote(now);
      soundFontEngine.stopAll("bass");
      soundFontEngine.stopAll("chords");
      soundFontEngine.stopAll("melody");
    });

    midiPlayer.setCallbacks({
      onDrum: (voice) => {
        audioEngine.triggerVoice(voice);
      },
      onBass: (note, _velocity, duration) => {
        const t = audioEngine.currentTime + 0.01;
        bassEngine.releaseNote(t); // Release previous note
        bassEngine.triggerNote(note, t, false, false, false);
        bassEngine.releaseNote(t + Math.max(0.08, duration));
      },
      onChord: (notes, _velocity, duration) => {
        const t = audioEngine.currentTime + 0.01;
        chordsEngine.releaseChord(t); // Release previous chord
        chordsEngine.triggerChord(notes, t, false, false);
        chordsEngine.releaseChord(t + Math.max(0.12, duration));
      },
      onMelody: (note, _velocity, duration) => {
        const t = audioEngine.currentTime + 0.01;
        melodyEngine.releaseNote(t); // Release previous note
        melodyEngine.triggerNote(note, t, false, false, false);
        melodyEngine.releaseNote(t + Math.max(0.08, duration));
      },
      onProgress: (position, duration) => {
        setProgress({ position, duration });
        if (position >= duration && !midiPlayer.isPlaying) {
          setPlaying(false);
        }
      },
    });
  }, []);

  const handleFileLoad = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const info = await midiPlayer.loadFile(buffer);
      setFileInfo(info);
      setProgress({ position: 0, duration: info.duration });
      setPlaying(false);
    } catch (err) {
      console.error("Failed to load MIDI file:", err);
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file) handleFileLoad(file);
  }, [handleFileLoad]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(mid|midi)$/i.test(file.name)) {
      handleFileLoad(file);
    }
  }, [handleFileLoad]);

  const handlePlay = useCallback(() => {
    if (!fileInfo || playing) return;
    audioEngine.resume().then(() => {
      midiPlayer.play(isLooping);
      setPlaying(true);
    });
  }, [fileInfo, isLooping, playing]);

  const handleStop = useCallback(() => {
    midiPlayer.stop();
    releaseAllVoices();
    setPlaying(false);
    setProgress((prev) => ({ position: 0, duration: prev.duration }));
  }, [releaseAllVoices]);

  const handleClose = useCallback(() => {
    midiPlayer.stop();
    releaseAllVoices();
    setPlaying(false);
    onClose();
  }, [onClose, releaseAllVoices]);

  const handleSetBpmFromFile = useCallback(() => {
    if (fileInfo) setBpm(fileInfo.bpm);
  }, [fileInfo, setBpm]);

  const handleOpenEditor = useCallback(() => {
    midiPlayer.stop();
    releaseAllVoices();
    setPlaying(false);
    onClose();
    onOpenEditor();
  }, [onClose, onOpenEditor, releaseAllVoices]);

  const transportProgress = progress.duration > 0
    ? Math.min(100, (progress.position / progress.duration) * 100)
    : 0;

  const trackSummary = useMemo(() => {
    if (!fileInfo) return [];
    const maxNotes = Math.max(...fileInfo.tracks.map((track) => track.noteCount), 1);
    return fileInfo.tracks.map((track, index) => ({
      ...track,
      role: formatTrackRole(track.channel, index, track.name),
      width: `${Math.max(12, (track.noteCount / maxNotes) * 100)}%`,
    }));
  }, [fileInfo]);

  const totalNotes = useMemo(
    () => fileInfo?.tracks.reduce((sum, track) => sum + track.noteCount, 0) ?? 0,
    [fileInfo]
  );

  const roleCounts = useMemo(() => {
    const counts = { drums: 0, tonal: 0 };
    for (const track of trackSummary) {
      if (track.role === "Drums") counts.drums += 1;
      else counts.tonal += 1;
    }
    return counts;
  }, [trackSummary]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-start justify-end p-3 md:p-6">
      <div className="pointer-events-auto relative w-full max-w-6xl h-[min(84vh,820px)] bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-2xl overflow-hidden shadow-[0_20px_120px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ed-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--ed-accent-orange)]/10 border border-[var(--ed-accent-orange)]/30 flex items-center justify-center text-[var(--ed-accent-orange)] text-sm font-black">
              MIDI
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-black tracking-[0.24em] text-[var(--ed-text-primary)]">
                MIDI ARRANGER
              </div>
              <div className="text-[10px] text-[var(--ed-text-muted)] truncate">
                Import, inspect, route and open the piano roll editor
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenEditor}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-[0.18em] text-[var(--ed-accent-orange)] border border-[var(--ed-accent-orange)]/25 hover:bg-[var(--ed-accent-orange)]/10 transition-colors"
            >
              OPEN EDITOR
            </button>
            <button
              onClick={handleClose}
              aria-label="Close MIDI arranger"
              className="w-8 h-8 rounded-lg text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-white/5 transition-colors"
            >
              ×
            </button>
          </div>
        </div>

        <div className="grid h-[calc(100%-65px)] lg:grid-cols-[320px,minmax(0,1fr)]">
          <aside className="border-r border-[var(--ed-border)]/80 p-4 md:p-5 overflow-y-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed p-5 transition-all ${
                dragOver
                  ? "border-[var(--ed-accent-orange)] bg-[var(--ed-accent-orange)]/8 shadow-[0_0_40px_rgba(245,158,11,0.12)]"
                  : "border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/45"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mid,.midi"
                onChange={handleFileInput}
                className="hidden"
              />
              <div className="text-[10px] font-bold tracking-[0.24em] text-[var(--ed-text-secondary)] mb-3">
                SOURCE
              </div>
              <div className="text-[22px] font-black leading-none text-[var(--ed-text-primary)] mb-2">
                {fileInfo ? "Swap MIDI File" : "Drop A MIDI File"}
              </div>
              <div className="text-[12px] leading-5 text-[var(--ed-text-muted)] mb-5">
                Drag a `.mid` file here or browse locally. Imported tracks route into drums, bass, chords and melody so you can audition before editing.
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl px-4 py-3 bg-[var(--ed-accent-orange)] text-black text-[11px] font-black tracking-[0.18em] hover:opacity-90 transition-opacity"
              >
                {fileInfo ? "CHOOSE ANOTHER FILE" : "BROWSE MIDI FILES"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-3">
                <div className="text-[9px] font-bold tracking-[0.18em] text-[var(--ed-text-muted)] mb-1">TEMPO</div>
                <div className="text-[22px] font-black text-[var(--ed-text-primary)]">
                  {fileInfo ? Math.round(fileInfo.bpm) : "--"}
                </div>
                <div className="text-[10px] text-[var(--ed-text-muted)]">Detected BPM</div>
              </div>
              <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-3">
                <div className="text-[9px] font-bold tracking-[0.18em] text-[var(--ed-text-muted)] mb-1">NOTES</div>
                <div className="text-[22px] font-black text-[var(--ed-text-primary)]">
                  {fileInfo ? totalNotes : "--"}
                </div>
                <div className="text-[10px] text-[var(--ed-text-muted)]">Across all tracks</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)]">
                  QUICK ACTIONS
                </div>
                {fileInfo && (
                  <span className="text-[10px] text-[var(--ed-text-muted)]">{formatTime(fileInfo.duration)}</span>
                )}
              </div>

              <button
                onClick={handlePlay}
                disabled={!fileInfo || playing}
                className={`w-full rounded-xl px-4 py-3 text-[11px] font-black tracking-[0.18em] transition-colors ${
                  fileInfo && !playing
                    ? "bg-[var(--ed-accent-green)] text-black hover:opacity-90"
                    : "bg-[var(--ed-bg-elevated)] text-[var(--ed-text-muted)]"
                }`}
              >
                {playing ? "PLAYING" : "AUDITION ROUTING"}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleStop}
                  disabled={!fileInfo}
                  className="rounded-xl px-3 py-2.5 text-[10px] font-bold tracking-[0.16em] border border-[var(--ed-border)] bg-[var(--ed-bg-elevated)] text-[var(--ed-text-primary)] hover:bg-white/5 disabled:opacity-40 transition-colors"
                >
                  STOP
                </button>
                <button
                  onClick={() => setIsLooping((prev) => !prev)}
                  disabled={!fileInfo}
                  className={`rounded-xl px-3 py-2.5 text-[10px] font-bold tracking-[0.16em] border transition-colors disabled:opacity-40 ${
                    isLooping
                      ? "bg-[var(--ed-accent-blue)]/18 border-[var(--ed-accent-blue)]/35 text-[var(--ed-accent-blue)]"
                      : "bg-[var(--ed-bg-elevated)] border-[var(--ed-border)] text-[var(--ed-text-primary)] hover:bg-white/5"
                  }`}
                >
                  {isLooping ? "LOOP ON" : "LOOP OFF"}
                </button>
              </div>

              <button
                onClick={handleSetBpmFromFile}
                disabled={!fileInfo}
                className="w-full rounded-xl px-3 py-2.5 text-[10px] font-bold tracking-[0.16em] border border-[var(--ed-border)] bg-[var(--ed-bg-elevated)] text-[var(--ed-text-secondary)] hover:text-[var(--ed-text-primary)] hover:bg-white/5 disabled:opacity-40 transition-colors"
              >
                SYNC PROJECT TEMPO TO FILE
              </button>
            </div>
          </aside>

          <section className="flex flex-col min-w-0">
            <div className="p-4 md:p-5 border-b border-[var(--ed-border)]/70">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold tracking-[0.22em] text-[var(--ed-text-secondary)] mb-2">
                    ARRANGEMENT OVERVIEW
                  </div>
                  <div className="text-[24px] md:text-[28px] font-black leading-none text-[var(--ed-text-primary)] truncate">
                    {fileInfo?.name ?? "No MIDI File Loaded"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-[var(--ed-text-secondary)]">
                      {fileInfo ? `${fileInfo.trackCount} tracks` : "Waiting for file"}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-[var(--ed-text-secondary)]">
                      {fileInfo ? `${roleCounts.drums} drum lanes` : "Drum routing ready"}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-[var(--ed-text-secondary)]">
                      {fileInfo ? `${roleCounts.tonal} tonal lanes` : "Bass / chords / melody ready"}
                    </span>
                  </div>
                </div>

                <div className="min-w-[240px] rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 px-4 py-3">
                  <div className="flex items-center justify-between text-[10px] text-[var(--ed-text-muted)] mb-2">
                    <span>Transport</span>
                    <span>{formatTime(progress.position)} / {formatTime(progress.duration)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/30 overflow-hidden border border-white/5">
                    <div
                      className="h-full bg-[linear-gradient(90deg,var(--ed-accent-orange),#fbbf24)] transition-all"
                      style={{ width: `${transportProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
              <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)]">
                    ROUTING MAP
                  </div>
                  <div className="text-[10px] text-[var(--ed-text-muted)]">
                    DAW-style lane overview
                  </div>
                </div>

                {fileInfo ? (
                  <div className="space-y-2.5">
                    {trackSummary.map((track, index) => {
                      const roleAccent =
                        track.role === "Drums"
                          ? "var(--ed-accent-orange)"
                          : track.role === "Bass"
                            ? "var(--ed-accent-green)"
                            : track.role === "Chords"
                              ? "var(--ed-accent-chords)"
                              : "var(--ed-accent-melody)";

                      return (
                        <div key={`${track.name}-${index}`} className="grid grid-cols-[minmax(0,1.6fr),110px,70px] gap-3 items-center rounded-xl border border-white/5 bg-black/15 px-3 py-2.5">
                          <div className="min-w-0">
                            <div className="text-[12px] font-bold text-[var(--ed-text-primary)] truncate">{track.name}</div>
                            <div className="mt-1 h-1.5 rounded-full bg-black/30 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: track.width, backgroundColor: roleAccent }}
                              />
                            </div>
                          </div>
                          <div className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: roleAccent }}>
                            {track.role}
                          </div>
                          <div className="text-right text-[10px] text-[var(--ed-text-muted)]">
                            {track.noteCount} notes
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--ed-border)] p-8 text-center text-[12px] text-[var(--ed-text-muted)]">
                    Import a MIDI file to inspect its lanes, note density and routing.
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/30 p-4">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)] mb-3">
                    SESSION READINESS
                  </div>
                  <div className="space-y-2.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ed-text-muted)]">Audio context</span>
                      <span className="text-[var(--ed-accent-green)] font-bold">Ready</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ed-text-muted)]">File loaded</span>
                      <span className={fileInfo ? "text-[var(--ed-accent-green)] font-bold" : "text-[var(--ed-text-muted)]"}>
                        {fileInfo ? "Loaded" : "Waiting"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ed-text-muted)]">Editor bridge</span>
                      <span className="text-[var(--ed-accent-orange)] font-bold">Piano Roll</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/30 p-4">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)] mb-3">
                    NEXT STEP
                  </div>
                  <div className="text-[12px] leading-5 text-[var(--ed-text-muted)] mb-4">
                    Use this window to audition and inspect the arrangement, then jump into the piano roll to rewrite phrasing, timing and velocity like a proper DAW workflow.
                  </div>
                  <button
                    onClick={handleOpenEditor}
                    className="w-full rounded-xl px-4 py-3 bg-white/5 border border-white/8 text-[var(--ed-text-primary)] text-[11px] font-black tracking-[0.16em] hover:bg-white/8 transition-colors"
                  >
                    OPEN PIANO ROLL EDITOR
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
