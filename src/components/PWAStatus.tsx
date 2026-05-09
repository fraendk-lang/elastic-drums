/**
 * PWAStatus — bottom-right pill that surfaces three PWA states:
 *
 *  1. "Update available" — Service Worker has fetched a new version. Click to
 *     reload and pick it up. (Until clicked, the user keeps running the old
 *     bundle — no surprise refreshes mid-jam.)
 *  2. "Install" — Chrome/Edge/Android fired beforeinstallprompt. Click to
 *     show the OS-native install dialog.
 *  3. "Add to Home Screen" hint — iOS Safari (no install API). Tells the user
 *     the Share → Add to Home Screen path. One-shot, dismissable.
 *
 * All three are dismissable and persist their dismissal in localStorage so
 * the pill doesn't nag every reload.
 */

import { useEffect, useState } from "react";

const DISMISS_INSTALL = "eg-pwa-install-dismissed";
const DISMISS_IOS = "eg-pwa-ios-hint-dismissed";

// ─── beforeinstallprompt typing ────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS-specific
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
}

function readDismissed(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return true; }
}

function writeDismissed(key: string): void {
  try { localStorage.setItem(key, "1"); } catch { /* private mode */ }
}

export function PWAStatus() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  // ── beforeinstallprompt (Chrome / Edge / Android) ──────────────────────
  useEffect(() => {
    if (isStandalone() || readDismissed(DISMISS_INSTALL)) return;
    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => {
      setInstallEvent(null);
      writeDismissed(DISMISS_INSTALL);
    });
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // ── iOS Safari add-to-home hint ────────────────────────────────────────
  useEffect(() => {
    if (isStandalone() || readDismissed(DISMISS_IOS)) return;
    if (!isIOS()) return;
    // Wait a bit so it doesn't fight onboarding
    const t = window.setTimeout(() => setShowIOSHint(true), 8000);
    return () => window.clearTimeout(t);
  }, []);

  // ── service-worker update-available ────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      registration = reg;
      // Already a waiting SW means an update was downloaded earlier
      if (reg.waiting) setUpdateReady(true);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        });
      });
    });

    // When the new SW takes control, reload once so the page matches.
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      void registration; // silence unused
    };
  }, []);

  function handleInstall() {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.finally(() => setInstallEvent(null));
  }

  function handleUpdate() {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    });
  }

  function dismissInstall() {
    writeDismissed(DISMISS_INSTALL);
    setInstallEvent(null);
  }

  function dismissIOS() {
    writeDismissed(DISMISS_IOS);
    setShowIOSHint(false);
  }

  // ── Render — at most one pill at a time, update wins over install ──
  if (updateReady) {
    return (
      <PillBase>
        <button onClick={handleUpdate} className="font-bold text-[var(--ed-accent-orange)] hover:brightness-110">
          ↻ New version available — Reload
        </button>
      </PillBase>
    );
  }

  if (installEvent) {
    return (
      <PillBase>
        <button onClick={handleInstall} className="font-bold text-[var(--ed-accent-orange)] hover:brightness-110">
          ⤓ Install Elastic Groove
        </button>
        <DismissButton onClick={dismissInstall} />
      </PillBase>
    );
  }

  if (showIOSHint) {
    return (
      <PillBase>
        <span className="text-white/80">
          Tap <span className="text-[var(--ed-accent-orange)]">Share</span> → <b>Add to Home Screen</b> for full-screen mode
        </span>
        <DismissButton onClick={dismissIOS} />
      </PillBase>
    );
  }

  return null;
}

function PillBase({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[150] max-w-[320px] rounded-full border border-[var(--ed-accent-orange)]/40 bg-[#0d0d12]/95 backdrop-blur-md shadow-2xl px-4 py-2 text-[11px] flex items-center gap-3"
      style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.6)" }}
    >
      {children}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Dismiss"
      className="text-white/40 hover:text-white/80 text-sm leading-none px-1"
    >
      ×
    </button>
  );
}
