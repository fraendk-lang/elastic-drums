/**
 * audioClipEngine — fires free audio clips at their scheduled bar positions.
 *
 * Subscribes to drumCurrentStepStore (same source as arrangementScheduler).
 * Every 16 steps = 1 arrangement bar. On each bar boundary, any clip whose
 * startBar matches is started via AudioBufferSourceNode scheduled precisely
 * to the bar's AudioContext timestamp.
 *
 * Import once from App.tsx for side-effects.
 */

import { audioEngine }            from "./AudioEngine";
import { drumCurrentStepStore, getDrumTransportStartTime, useDrumStore }
                                   from "../store/drumStore";
import { useAudioClipStore, type AudioClip } from "../store/audioClipStore";

// ─── Module state ─────────────────────────────────────────────────────────────

/** Currently-playing sources keyed by clip id. */
const _playing = new Map<string, AudioBufferSourceNode>();

// -1 so the first increment on play-start yields 0, firing the bar-0 clip check.
let _stepsElapsed = -1;
let _subscribed   = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function secondsPerBar(bpm: number): number {
  return (60.0 / bpm) * 4; // 4/4 time
}

function startClip(clip: AudioClip, extraOffsetSec: number, startAtTime: number): void {
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return;

  stopClip(clip.id);

  const src  = ctx.createBufferSource();
  src.buffer = clip.buffer;

  const gain = ctx.createGain();
  src.connect(gain);
  gain.connect(ctx.destination);

  // Total audible duration after trim, minus any mid-clip offset
  const playDuration = clip.sampleEndSec - clip.sampleStartSec - extraOffsetSec;
  if (playDuration <= 0) return;

  const when        = Math.max(ctx.currentTime, startAtTime);
  const offsetInBuf = clip.sampleStartSec + extraOffsetSec;

  // Fade in — only when playing from the start of the clip
  if (clip.fadeInSec > 0 && extraOffsetSec === 0) {
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(clip.volume, when + clip.fadeInSec);
  } else {
    gain.gain.setValueAtTime(clip.volume, when);
  }

  // Fade out
  if (clip.fadeOutSec > 0 && clip.fadeOutSec < playDuration) {
    const fadeOutStart = when + playDuration - clip.fadeOutSec;
    gain.gain.setValueAtTime(clip.volume, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, when + playDuration);
  }

  src.start(when, offsetInBuf);
  src.stop(when + playDuration);

  src.onended = () => { _playing.delete(clip.id); };
  _playing.set(clip.id, src);
}

function stopClip(id: string): void {
  const src = _playing.get(id);
  if (src) {
    try { src.stop(); } catch { /* already stopped */ }
    _playing.delete(id);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function stopAllAudioClips(): void {
  for (const id of _playing.keys()) stopClip(id);
}

/** Called when the transport seeks to a specific bar (e.g. click on ruler). */
export function seekAudioClips(bar: number): void {
  stopAllAudioClips();
  // Set so the next bar-boundary check fires at bar N+1 (seek already plays mid-clip at bar N).
  _stepsElapsed = bar * 16 - 1;

  const { bpm }          = useDrumStore.getState();
  const spb              = secondsPerBar(bpm);
  const transportStart   = getDrumTransportStartTime();
  const ctx              = audioEngine.getAudioContext();
  if (!ctx) return;

  const clips = useAudioClipStore.getState().clips;
  for (const clip of clips) {
    const clipStartSec = clip.startBar * spb;
    const clipEndSec   = clipStartSec + (clip.sampleEndSec - clip.sampleStartSec);
    const nowSec       = bar * spb;

    if (nowSec >= clipStartSec && nowSec < clipEndSec) {
      const extraOffset = nowSec - clipStartSec;
      const scheduleAt  = transportStart + clipStartSec;
      startClip(clip, extraOffset, scheduleAt);
    }
  }
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export function initAudioClipEngine(): void {
  if (_subscribed) return;
  _subscribed = true;

  drumCurrentStepStore.subscribe(() => {
    const { isPlaying, bpm } = useDrumStore.getState();

    if (!isPlaying) {
      stopAllAudioClips();
      _stepsElapsed = -1;
      return;
    }

    _stepsElapsed++;

    // Only act on bar boundaries (every 16 steps)
    if (_stepsElapsed % 16 !== 0) return;

    const currentBar   = Math.floor(_stepsElapsed / 16);
    const spb          = secondsPerBar(bpm);
    const transportStart = getDrumTransportStartTime();

    // Schedule time for the START of this bar
    const barStartTime = transportStart + currentBar * spb;

    const clips = useAudioClipStore.getState().clips;
    for (const clip of clips) {
      if (clip.startBar === currentBar) {
        startClip(clip, 0, barStartTime);
      }
    }
  });
}
