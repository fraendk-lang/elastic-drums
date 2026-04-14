/**
 * MIDI Player Panel — drag & drop .mid files, playback with progress bar.
 * Accessible from the Transport bar via a new MIDI PLAY button.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { midiPlayer, type MidiFileInfo } from "../audio/MidiPlayer";
import { useDrumStore } from "../store/drumStore";
import { bassEngine } from "../audio/BassEngine";
import { chordsEngine } from "../audio/ChordsEngine";
import { melodyEngine } from "../audio/MelodyEngine";
import { audioEngine } from "../audio/AudioEngine";

interface MidiPlayerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MidiPlayerPanel({ isOpen, onClose }: MidiPlayerPanelProps) {
  const { setBpm } = useDrumStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileInfo, setFileInfo] = useState<MidiFileInfo | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [progress, setProgress] = useState({ position: 0, duration: 0 });
  const dragOverRef = useRef(false);

  // Set up MIDI playback callbacks — trigger sounds through the app's engines
  useEffect(() => {
    midiPlayer.setCallbacks({
      onDrum: (voice) => {
        // Trigger drum voice immediately
        audioEngine.triggerVoice(voice);
      },
      onBass: (note, _velocity, duration) => {
        const t = audioEngine.currentTime + 0.01; // Tiny offset for scheduling
        bassEngine.triggerNote(note, t, false, false, false);
        // Auto-release after duration
        const relMs = Math.max(100, duration * 1000);
        setTimeout(() => bassEngine.releaseNote(audioEngine.currentTime), relMs);
      },
      onChord: (notes, _velocity, duration) => {
        const t = audioEngine.currentTime + 0.01;
        chordsEngine.triggerChord(notes, t, false, false);
        const relMs = Math.max(100, duration * 1000);
        setTimeout(() => chordsEngine.releaseChord(audioEngine.currentTime), relMs);
      },
      onMelody: (note, _velocity, duration) => {
        const t = audioEngine.currentTime + 0.01;
        melodyEngine.triggerNote(note, t, false, false, false);
        const relMs = Math.max(100, duration * 1000);
        setTimeout(() => melodyEngine.releaseNote(audioEngine.currentTime), relMs);
      },
      onProgress: (position, duration) => {
        setProgress({ position, duration });
      },
    });
  }, []);

  const handleFileLoad = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const info = await midiPlayer.loadFile(buffer);
      setFileInfo(info);
      setProgress({ position: 0, duration: info.duration });
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
    dragOverRef.current = true;
  }, []);

  const handleDragLeave = useCallback(() => {
    dragOverRef.current = false;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragOverRef.current = false;
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".mid")) {
      handleFileLoad(file);
    }
  }, [handleFileLoad]);

  const handlePlay = useCallback(() => {
    if (fileInfo && !midiPlayer.isPlaying) {
      midiPlayer.play(isLooping);
    }
  }, [fileInfo, isLooping]);

  const handleStop = useCallback(() => {
    midiPlayer.stop();
    setProgress({ position: 0, duration: progress.duration });
  }, [progress.duration]);

  const handleSetBpmFromFile = useCallback(() => {
    if (fileInfo) {
      setBpm(fileInfo.bpm);
    }
  }, [fileInfo, setBpm]);

  const handleToggleLoop = useCallback(() => {
    setIsLooping((prev) => !prev);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-[var(--ed-bg-secondary)] border-t border-[var(--ed-border)] rounded-t-2xl max-h-[70vh] overflow-auto">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ed-border)]/50">
          <span className="text-[10px] font-bold tracking-wider text-[var(--ed-text-secondary)]">MIDI PLAYER</span>
          <button onClick={onClose} aria-label="Close MIDI player" className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-sm px-2">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          {/* File upload drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragOverRef.current
                ? "border-[var(--ed-accent-green)] bg-[var(--ed-accent-green)]/5"
                : "border-[var(--ed-border)]/50 hover:border-[var(--ed-border)]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mid,.midi"
              onChange={handleFileInput}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] font-bold text-[var(--ed-accent-orange)] hover:text-[var(--ed-accent-orange)]/80 transition-colors"
            >
              {fileInfo ? "SELECT DIFFERENT FILE" : "DROP .MID FILE OR CLICK"}
            </button>
          </div>

          {/* File info */}
          {fileInfo && (
            <div className="space-y-2 bg-[var(--ed-bg-surface)]/30 p-3 rounded-lg border border-[var(--ed-border)]/30">
              <div>
                <p className="text-[9px] text-[var(--ed-text-muted)] font-bold">FILE:</p>
                <p className="text-[10px] text-[var(--ed-text-primary)] truncate">{fileInfo.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[9px] text-[var(--ed-text-muted)] font-bold">BPM:</p>
                  <p className="text-[10px] text-[var(--ed-text-primary)]">{fileInfo.bpm}</p>
                </div>
                <div>
                  <p className="text-[9px] text-[var(--ed-text-muted)] font-bold">DURATION:</p>
                  <p className="text-[10px] text-[var(--ed-text-primary)]">{formatTime(fileInfo.duration)}</p>
                </div>
              </div>
              <div>
                <p className="text-[9px] text-[var(--ed-text-muted)] font-bold">TRACKS:</p>
                <div className="text-[9px] text-[var(--ed-text-secondary)] space-y-1 mt-1">
                  {fileInfo.tracks.map((track, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{track.name}</span>
                      <span className="text-[var(--ed-text-muted)]">{track.noteCount} notes</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {fileInfo && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[9px] text-[var(--ed-text-muted)]">
                <span>{formatTime(progress.position)}</span>
                <span>{formatTime(progress.duration)}</span>
              </div>
              <div className="w-full h-2 bg-[var(--ed-bg-surface)]/50 rounded-full overflow-hidden border border-[var(--ed-border)]/30">
                <div
                  className="h-full bg-[var(--ed-accent-orange)] transition-all"
                  style={{ width: `${(progress.position / progress.duration) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Playback controls */}
          {fileInfo && (
            <div className="flex gap-2">
              <button
                onClick={handlePlay}
                disabled={midiPlayer.isPlaying}
                className="flex-1 px-3 py-2 bg-[var(--ed-accent-orange)] hover:bg-[var(--ed-accent-orange)]/80 disabled:opacity-50 text-black text-[10px] font-bold rounded transition-colors"
              >
                {midiPlayer.isPlaying ? "PLAYING" : "PLAY"}
              </button>
              <button
                onClick={handleStop}
                className="flex-1 px-3 py-2 bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-surface)]/80 text-[var(--ed-text-primary)] text-[10px] font-bold rounded border border-[var(--ed-border)]/50 transition-colors"
              >
                STOP
              </button>
              <button
                onClick={handleToggleLoop}
                className={`flex-1 px-3 py-2 text-[10px] font-bold rounded transition-colors ${
                  isLooping
                    ? "bg-[var(--ed-accent-green)]/20 text-[var(--ed-accent-green)] border border-[var(--ed-accent-green)]/50"
                    : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-primary)] border border-[var(--ed-border)]/50 hover:bg-[var(--ed-bg-surface)]/80"
                }`}
              >
                {isLooping ? "LOOP ON" : "LOOP OFF"}
              </button>
            </div>
          )}

          {/* Set BPM from file */}
          {fileInfo && (
            <button
              onClick={handleSetBpmFromFile}
              className="w-full px-3 py-2 bg-[var(--ed-bg-surface)]/50 hover:bg-[var(--ed-bg-surface)]/70 text-[var(--ed-text-secondary)] text-[9px] font-bold rounded border border-[var(--ed-border)]/30 transition-colors"
            >
              SYNC BPM ({fileInfo.bpm})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
