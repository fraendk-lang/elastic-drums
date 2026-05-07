/**
 * OnboardingModal — shown once on first visit to orient new users.
 *
 * Checks localStorage("eg-onboarded"). If absent, renders the modal.
 * Dismissed via "Start Making Beats" → sets the flag, never shown again.
 */

import { useState } from "react";

const STORAGE_KEY = "eg-onboarded";

function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // Private mode or error — don't block
  }
}

function markOnboarded(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Ignore
  }
}

interface Step {
  emoji: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    emoji: "🥁",
    title: "Four Engines, One Groove",
    body: "Drums, Bass (303), Chords and Melody each have their own 16-step sequencer. All four play in sync — just hit Space to start.",
  },
  {
    emoji: "⚡",
    title: "Start in Seconds",
    body: "Press 1–9 to load a preset pattern. Hit the Euclidean Generator (EUCLID) to fill Bass/Chords/Melody automatically. Your first loop is ready in under a minute.",
  },
  {
    emoji: "🎛️",
    title: "Go Deep When You're Ready",
    body: "Parameter Locks, Conditional Trigs, Piano Roll, Automation Lanes, Mod Matrix, Scenes, Arrangement — all waiting for when you want to go further.",
  },
  {
    emoji: "💾",
    title: "Everything Auto-Saves",
    body: "Your work saves automatically to IndexedDB. Use EXPORT to download WAV, MIDI or stems, or Share URL to send your pattern to someone else.",
  },
];

export function OnboardingModal() {
  const [visible, setVisible] = useState(() => !hasOnboarded());
  const [page, setPage] = useState(0);

  if (!visible) return null;

  const isLast = page === STEPS.length - 1;
  const step = STEPS[page]!;

  function dismiss() {
    markOnboarded();
    setVisible(false);
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={dismiss}
    >
      <div
        className="relative bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] uppercase">
              Welcome to Elastic Groove
            </div>
            <button
              onClick={dismiss}
              className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg leading-none px-1"
              aria-label="Skip intro"
            >
              ×
            </button>
          </div>
          {/* Progress dots */}
          <div className="flex gap-1.5 mt-2">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`h-1 rounded-full transition-all ${
                  i === page
                    ? "w-6 bg-[var(--ed-accent-orange)]"
                    : i < page
                    ? "w-1.5 bg-[var(--ed-accent-orange)]/40"
                    : "w-1.5 bg-white/15"
                }`}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 min-h-[160px] flex flex-col justify-center">
          <div className="text-4xl mb-4">{step.emoji}</div>
          <h2 className="text-base font-black tracking-wide text-[var(--ed-text-primary)] mb-2">
            {step.title}
          </h2>
          <p className="text-[12px] leading-relaxed text-[var(--ed-text-secondary)]">
            {step.body}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          {!isLast && (
            <>
              <button
                onClick={() => setPage((p) => p + 1)}
                className="flex-1 py-2.5 rounded-lg text-[11px] font-black tracking-wider bg-[var(--ed-accent-orange)] text-black hover:brightness-110 transition-all"
              >
                NEXT →
              </button>
              <button
                onClick={dismiss}
                className="px-4 py-2.5 rounded-lg text-[11px] font-bold tracking-wide text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-white/5 transition-all"
              >
                Skip
              </button>
            </>
          )}
          {isLast && (
            <button
              onClick={dismiss}
              className="flex-1 py-2.5 rounded-lg text-[11px] font-black tracking-wider bg-[var(--ed-accent-orange)] text-black hover:brightness-110 transition-all"
            >
              START MAKING BEATS
            </button>
          )}
        </div>

        {/* Keyboard hint */}
        <div className="px-6 pb-4 text-center">
          <span className="text-[9px] text-[var(--ed-text-muted)]">
            Press <kbd className="px-1 py-0.5 rounded border border-[var(--ed-border)] text-[9px] font-mono">?</kbd> anytime to see all keyboard shortcuts
          </span>
        </div>
      </div>
    </div>
  );
}
