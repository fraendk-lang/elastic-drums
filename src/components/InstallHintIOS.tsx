/**
 * InstallHintIOS — one-time prompt encouraging iPad/iPhone users to add the
 * app to the Home Screen for a real fullscreen experience.
 *
 * Renders only when:
 *   • The browser is iOS Safari (iPadOS or iOS), AND
 *   • The page is NOT already running in standalone mode (so they haven't
 *     installed it), AND
 *   • The user hasn't dismissed the hint before (localStorage flag).
 *
 * Renders nothing on desktop, Android, or after dismissal — purely additive
 * to the desktop experience.
 */

import { useState } from "react";

const STORAGE_KEY = "eg-ios-install-hint-dismissed";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports as Mac in user-agent; detect via touch points.
  const isIPad = navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
  const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
  const isIPadUA = /iPad/.test(navigator.userAgent);
  return isIPad || isIPhone || isIPadUA;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS sets navigator.standalone when launched from Home Screen
  // Modern browsers expose it via display-mode media query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iosStandalone = (window.navigator as any).standalone === true;
  const matchStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return iosStandalone || matchStandalone;
}

function wasDismissed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return true; }
}

function markDismissed(): void {
  try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* private mode */ }
}

export function InstallHintIOS() {
  const [visible, setVisible] = useState(() => {
    return isIOS() && !isStandalone() && !wasDismissed();
  });

  if (!visible) return null;

  function dismiss() {
    markDismissed();
    setVisible(false);
  }

  return (
    <div
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[150] max-w-[420px] mx-3 rounded-xl border border-[var(--ed-accent-orange)]/30 bg-[#0a0a0e]/95 backdrop-blur-md shadow-2xl px-4 py-3 flex items-start gap-3"
      style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.7)" }}
    >
      <div className="text-2xl leading-none mt-px">🎛</div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold text-[var(--ed-accent-orange)] tracking-wide mb-0.5">
          BEST ON HOME SCREEN
        </div>
        <div className="text-[11px] text-white/75 leading-snug">
          Tap{" "}
          <svg className="inline w-3.5 h-3.5 -mt-0.5 fill-white/75" viewBox="0 0 16 16" aria-hidden>
            <path d="M8 1L5 4h2v6h2V4h2L8 1zm-5 9v3a2 2 0 002 2h6a2 2 0 002-2v-3h-2v3H5v-3H3z" />
          </svg>
          {" "}then{" "}
          <span className="font-semibold text-white/90">Add to Home Screen</span>{" "}
          — runs fullscreen, no browser bars, faster touch response.
        </div>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 text-white/40 hover:text-white/80 text-[18px] leading-none px-2 -mt-1"
        aria-label="Dismiss install hint"
      >
        ×
      </button>
    </div>
  );
}
