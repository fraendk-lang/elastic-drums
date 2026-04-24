import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";

const LABELS = ["KCK", "SNR", "CLP", "TL", "TM", "TH", "HHC", "HHO", "CYM", "RDE", "P1", "P2", "BAS", "CHD", "LED"];
const COLORS = [
  "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b",
  "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#8b5cf6", "#8b5cf6",
  "#10b981", "#a78bfa", "#f472b6",
];

interface MixerStripProps {
  onOpenMixer: () => void;
}

export function MixerStrip({ onOpenMixer }: MixerStripProps) {
  // Stats throttled to ~5 Hz (not 60 Hz) — React re-renders only for numbers that change slowly
  const [stats, setStats] = useState({ active: 0, hot: 0, masterDb: -Infinity });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const masterCanvasRef = useRef<HTMLCanvasElement>(null);

  // Meter painter runs at 60 Hz on canvas directly — NO React re-renders
  useEffect(() => {
    const channelCanvas = canvasRef.current;
    const masterCanvas = masterCanvasRef.current;
    if (!channelCanvas || !masterCanvas) return;

    const ctx = channelCanvas.getContext("2d");
    const mctx = masterCanvas.getContext("2d");
    if (!ctx || !mctx) return;

    // Device-pixel-ratio-aware sizing (sharp on retina)
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      for (const c of [channelCanvas, masterCanvas]) {
        const rect = c.getBoundingClientRect();
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(channelCanvas);
    ro.observe(masterCanvas);

    let raf = 0;
    let statsFrame = 0;

    const levels = new Float32Array(16);
    const _gateBuf = new Float32Array(256); // reuse to avoid GC pressure

    const draw = () => {
      for (let i = 0; i < 16; i++) {
        // Noise-floor gate: if analyser has no real signal, return 0 immediately
        // (avoids stale peak-hold values from meteringEngine showing on silent channels)
        const an = audioEngine.getChannelAnalyser(i);
        if (an) {
          const buf = _gateBuf.length >= an.fftSize ? _gateBuf : new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(buf);
          let pk = 0;
          for (let s = 0; s < an.fftSize; s++) pk = Math.max(pk, Math.abs(buf[s]!));
          if (pk < 1e-6) { levels[i] = 0; continue; }
        }
        levels[i] = audioEngine.getChannelLevel(i);
      }
      const masterLvl = audioEngine.getMasterLevel();

      // ─── Channel meters canvas ───
      const cw = channelCanvas.width;
      const ch = channelCanvas.height;
      ctx.clearRect(0, 0, cw, ch);

      const barCount = 16;
      const gap = 3 * dpr;
      const barW = (cw - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        const lvl = levels[i] ?? 0;
        const x = i * (barW + gap);
        // Background track
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(x, 0, barW, ch);
        // Level bar (bottom-anchored)
        const h = Math.min(lvl, 1) * ch;
        const color = COLORS[i] ?? "#ffffff";
        if (lvl > 0.85) {
          ctx.fillStyle = "#dc2626";
        } else if (lvl > 0.5) {
          ctx.fillStyle = color;
        } else {
          ctx.fillStyle = color + "88";
        }
        ctx.fillRect(x, ch - h, barW, h);
        // Hot indicator (top red cap)
        if (lvl > 0.75) {
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(x, 0, barW, 2 * dpr);
        }
      }

      // ─── Master meter canvas ───
      const mw = masterCanvas.width;
      const mh = masterCanvas.height;
      mctx.clearRect(0, 0, mw, mh);
      mctx.fillStyle = "rgba(255,255,255,0.03)";
      mctx.fillRect(0, 0, mw, mh);
      const mHeight = Math.min(masterLvl, 1) * mw; // horizontal
      mctx.fillStyle = masterLvl > 0.9 ? "#dc2626" : masterLvl > 0.5 ? "#10b981" : "#10b98188";
      mctx.fillRect(0, 0, mHeight, mh);

      // Throttled stats update (every ~12 frames = 5 Hz)
      statsFrame++;
      if (statsFrame >= 12) {
        statsFrame = 0;
        let active = 0;
        let hot = 0;
        for (let i = 0; i < 15; i++) {
          const v = levels[i] ?? 0;
          if (v > 0.02) active++;
          if (v > 0.75) hot++;
        }
        const db = masterLvl > 0.001 ? 20 * Math.log10(masterLvl) : -Infinity;
        setStats((prev) =>
          prev.active === active && prev.hot === hot && prev.masterDb === db
            ? prev
            : { active, hot, masterDb: db },
        );
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const activeCount = stats.active;
  const hotCount = stats.hot;
  const masterDb = stats.masterDb;

  return (
    <div className="flex flex-col h-full gap-2 rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,19,24,0.98),rgba(8,9,12,0.98))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_40px_rgba(0,0,0,0.35)]">
      <div className="rounded-[14px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-black tracking-[0.24em] text-white/75">MIX BUS</div>
            <div className="mt-1 text-[7px] font-bold tracking-[0.16em] text-white/28">CONSOLE OVERVIEW</div>
          </div>
          <button
            onClick={onOpenMixer}
            className="rounded-full border border-[var(--ed-accent-orange)]/25 bg-[var(--ed-accent-orange)]/10 px-2.5 py-1 text-[8px] font-black tracking-[0.18em] text-[var(--ed-accent-orange)] transition-all hover:bg-[var(--ed-accent-orange)]/16 hover:text-white"
          >
            OPEN
          </button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <div className="rounded-xl border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="text-[6px] font-bold tracking-[0.18em] text-white/30">ACTIVE</div>
            <div className="mt-1 text-[11px] font-black tracking-[0.12em] text-white/82">{activeCount}</div>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="text-[6px] font-bold tracking-[0.18em] text-white/30">HOT</div>
            <div className="mt-1 text-[11px] font-black tracking-[0.12em] text-amber-300">{hotCount}</div>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="text-[6px] font-bold tracking-[0.18em] text-white/30">MASTER</div>
            <div className="mt-1 text-[11px] font-black tracking-[0.05em] text-[var(--ed-accent-green)]">
              {isFinite(masterDb) ? `${masterDb.toFixed(1)}` : "-∞"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-2 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[7px] font-bold tracking-[0.2em] text-white/30">CHANNEL BRIDGE</span>
          <span className="text-[7px] font-mono text-white/25">-60 / 0 dB</span>
        </div>

      <button
        onClick={onOpenMixer}
        className="mb-2 hidden"
      >
        MIXER &rsaquo;
      </button>

      {/* Canvas-based meters — 60 Hz painter w/o React re-render overhead */}
      <div className="relative flex-1 min-h-[144px]">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      {/* Labels row */}
      <div className="flex gap-[3px] mt-1">
        {LABELS.map((ch, i) => (
          <span
            key={i}
            className="flex-1 text-[6px] font-black tracking-[0.12em] text-center truncate"
            style={{ color: (COLORS[i] ?? "#ffffff") + "8c" }}
          >
            {ch}
          </span>
        ))}
      </div>
      </div>

      <div className="rounded-[14px] border border-[var(--ed-accent-green)]/15 bg-[linear-gradient(180deg,rgba(16,38,23,0.28),rgba(4,10,7,0.7))] px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[7px] font-black tracking-[0.2em] text-[var(--ed-accent-green)]">MASTER BUS</span>
          <span className="text-[7px] font-mono text-white/32">{isFinite(masterDb) ? `${masterDb.toFixed(1)} dB` : "-∞ dB"}</span>
        </div>
        <div className="flex items-center gap-1.5">
        <span className="text-[7px] font-bold text-[var(--ed-accent-green)] tracking-wider">MST</span>
        <div className="relative h-3 flex-1 overflow-hidden rounded-full border border-white/8 bg-black/30">
          {[25, 50, 75].map((pct) => (
            <div key={pct} className="absolute top-0 bottom-0 border-l border-white/6 z-10 pointer-events-none" style={{ left: `${pct}%` }} />
          ))}
          <canvas ref={masterCanvasRef} className="absolute inset-0 w-full h-full rounded-full" />
        </div>
        <span className="w-8 text-right text-[7px] font-mono text-[var(--ed-text-muted)] tabular-nums">
          {isFinite(masterDb) ? `${masterDb.toFixed(0)}` : "-\u221E"}
        </span>
      </div>
      </div>
    </div>
  );
}

