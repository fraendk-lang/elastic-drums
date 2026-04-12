/**
 * Mini Waveform Display
 *
 * Shows a real-time oscilloscope of a voice channel's audio output.
 * Renders into a small canvas on each pad.
 */

import { useEffect, useRef, memo } from "react";
import { audioEngine } from "../audio/AudioEngine";

interface WaveformPreviewProps {
  voiceIndex: number;
  width: number;
  height: number;
  color: string;
  active: boolean;
}

export const WaveformPreview = memo(function WaveformPreview({
  voiceIndex, width, height, color, active,
}: WaveformPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const meter = audioEngine.getChannelMeter(voiceIndex);
      const analyser = audioEngine.getChannelAnalyser(voiceIndex);

      ctx.clearRect(0, 0, width, height);

      if (!analyser || meter.rmsDb < -50) {
        // Silent — draw flat line
        ctx.strokeStyle = color + "30";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Get waveform data
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);

      // Draw waveform
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const step = Math.max(1, Math.floor(data.length / width));
      for (let i = 0; i < width; i++) {
        const sample = data[i * step] ?? 0;
        const y = (1 - sample) * height / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i, y);
      }
      ctx.stroke();

      // Glow effect when loud
      if (meter.rmsDb > -20) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [voiceIndex, width, height, color, active]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none opacity-60"
      style={{ imageRendering: "pixelated" }}
    />
  );
});
