/**
 * AudioWake — centralized handler for AudioContext suspend/resume edge cases.
 *
 * Browsers suspend the AudioContext (or aggressively throttle the main thread
 * that schedulers run on) when:
 *   - Tab loses focus / visibility
 *   - Window is backgrounded for too long
 *   - System sleeps then wakes
 *   - iOS Safari aggressively suspends without warning
 *
 * When the context wakes back up, three things can go wrong:
 *   1. AudioContext is still in "suspended" state and needs explicit .resume()
 *   2. Schedulers' nextStepTime is far behind ctx.currentTime → catch-up while
 *      loop fires a burst of stale notes all at once
 *   3. Voices that were triggered before the suspend may have lost their
 *      release events → ghost notes
 *
 * This module centralizes the wake-up: a single global focus / visibility
 * listener calls `wake()`, which:
 *   - Calls audioEngine.resume() (no-op if already running)
 *   - Calls each registered "wake-up handler" so individual schedulers can
 *     clamp their nextStepTime forward and clean up stale state
 *
 * Schedulers register via `registerWakeHandler()`, return an unsubscribe.
 */

import { audioEngine } from "./AudioEngine";
import { bassEngine } from "./BassEngine";
import { melodyEngine } from "./MelodyEngine";
import { chordsEngine } from "./ChordsEngine";

type WakeHandler = () => void;
const wakeHandlers = new Set<WakeHandler>();

/**
 * Panic: release every voice across every engine. Called when we detect a
 * long suspend (>2s gap in real time). Catches ghost notes whose release
 * events were lost during the suspend.
 */
function panicReleaseAll(): void {
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  try { audioEngine.stopAllLoops(); } catch { /* */ }
  try { bassEngine.releaseNote(t); } catch { /* */ }
  try { bassEngine.stopAllPoly(t); } catch { /* */ }
  try { chordsEngine.releaseChord(t); } catch { /* */ }
  try { melodyEngine.releaseNote(t); } catch { /* */ }
}

let _lastWakeAt = 0;
let _lastVisibleAt = performance.now();

/**
 * Register a handler to be called whenever the page regains focus / visibility.
 * Returns an unsubscribe function.
 *
 * Use this in any module that schedules audio events ahead of time so the
 * scheduler can recover from a long suspend cleanly.
 */
export function registerWakeHandler(fn: WakeHandler): () => void {
  wakeHandlers.add(fn);
  return () => { wakeHandlers.delete(fn); };
}

/**
 * Manually trigger a wake — useful after returning from a sleep / system idle.
 * Normally fires automatically on focus + visibilitychange + pageshow.
 *
 * If the page was hidden / unfocused for more than 2 seconds, also panic-
 * release all engine voices. Catches ghost notes whose release events were
 * lost during the suspend (e.g., a chord held when the user Cmd+Tabs away).
 */
export function wake(): void {
  const now = performance.now();
  const gap = now - _lastVisibleAt;
  _lastWakeAt = now;
  _lastVisibleAt = now;

  // Resume the audio context if it was suspended. Returns a Promise but
  // we don't need to await it — handlers will see ctx.state update lazily.
  audioEngine.resume();

  // Long suspend → also kill any stuck voices across every engine
  if (gap > 2000) {
    panicReleaseAll();
  }

  // Notify every registered handler so they can clamp nextStepTime + release
  // stale voices etc.
  for (const h of wakeHandlers) {
    try { h(); } catch (err) { console.warn("[AudioWake] handler threw:", err); }
  }
}

/** Track when the page was last visible so wake() can detect long suspends. */
function noteStillVisible(): void {
  _lastVisibleAt = performance.now();
}

/**
 * Install global listeners. Call once at app startup. Idempotent.
 */
let _installed = false;
export function installAudioWakeListeners(): void {
  if (_installed || typeof window === "undefined") return;
  _installed = true;

  // Window regains focus from another window (e.g., Cmd+Tab back)
  window.addEventListener("focus", wake);

  // Tab visibility — covers tab-switch and most browser-internal backgrounding.
  // Stamp `_lastVisibleAt` when going INTO hidden too, so wake() can compute
  // the actual hidden duration for the panic-release threshold.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
    else noteStillVisible(); // record entry-to-hidden timestamp
  });

  // Pageshow fires after restore-from-bfcache (back/forward navigation)
  window.addEventListener("pageshow", () => wake());

  // Periodic heartbeat (every 5s) updates _lastVisibleAt while the page is
  // active. If the gap suddenly jumps to >2s, we know we lost time (system
  // sleep, gc pause) even without an explicit visibility event.
  setInterval(() => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      const now = performance.now();
      const gap = now - _lastVisibleAt;
      if (gap > 2000 && _lastWakeAt < _lastVisibleAt) {
        // Time jumped without a focus / visibility event — system probably slept
        wake();
      } else {
        noteStillVisible();
      }
    }
  }, 5000);

  // After system sleep + wake, performance.now() may have jumped — listen for
  // that too via storage or a tick. Browser fires "focus" anyway, so we rely
  // on it for now.
}
