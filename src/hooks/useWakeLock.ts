/**
 * useWakeLock — keep the screen awake while transport is playing.
 *
 * Why: iPad / Android phone screens sleep after ~30s. If you're jamming
 * a loop on a stand and the screen blacks out, the AudioContext gets
 * suspended and the music dies. The Screen Wake Lock API tells the OS
 * "don't sleep while this page is visible."
 *
 * The lock is automatically released when:
 *   - the user pauses (we explicitly release)
 *   - the tab is hidden (browser releases on its own)
 *   - the device is locked
 *
 * On hidden→visible we re-acquire if `active` is still true. This is the
 * standard pattern from the WICG spec — the lock doesn't survive a
 * visibility change so we have to re-request.
 *
 * No-op on browsers without the API (Safari < 16.4, Firefox desktop).
 */

import { useEffect, useRef } from "react";

// Minimal type — TS lib.dom doesn't always include this yet.
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(event: "release", cb: () => void): void;
}

interface NavigatorWithWakeLock {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
}

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) return; // unsupported

    let cancelled = false;

    async function acquire() {
      if (sentinelRef.current && !sentinelRef.current.released) return;
      try {
        const sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          // OS released us (visibility change, low battery). Clear ref so
          // visibility-back handler will re-acquire.
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // User denied / not allowed in this context — silent fail.
      }
    }

    function release() {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) s.release().catch(() => {});
    }

    function onVisibility() {
      if (document.visibilityState === "visible" && active) {
        acquire();
      }
    }

    if (active) {
      acquire();
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [active]);
}
