/**
 * Reverb IR Worker
 * Computes algorithmic reverb impulse-response samples off the main thread.
 * Returns two Float32Array channels (stereo) as transferable objects.
 */

interface ReverbRequest {
  id: number;
  sampleRate: number;
  duration: number;
  decay: number;
  type: string;
}

interface ReverbResponse {
  id: number;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

function generateIR(
  sampleRate: number,
  duration: number,
  decay: number,
  type: string,
): { left: Float32Array; right: Float32Array } {
  const length = Math.ceil(sampleRate * duration);

  const profiles: Record<string, { preDelayMs: number; earlyDensity: number; earlySpread: number; tailDecayMul: number; brightness: number }> = {
    room:    { preDelayMs:  5, earlyDensity: 8, earlySpread:  2, tailDecayMul: 1.0, brightness: 0.7 },
    hall:    { preDelayMs: 15, earlyDensity: 6, earlySpread:  5, tailDecayMul: 1.0, brightness: 0.5 },
    plate:   { preDelayMs:  1, earlyDensity: 0, earlySpread:  1, tailDecayMul: 0.8, brightness: 0.9 },
    ambient: { preDelayMs: 25, earlyDensity: 4, earlySpread: 10, tailDecayMul: 1.5, brightness: 0.3 },
  };
  const p = profiles[type] ?? profiles["hall"]!;
  const preDelay = Math.ceil(sampleRate * p.preDelayMs / 1000);

  // Early reflections
  const earlyTaps: { time: number; gain: number }[] = [];
  for (let i = 0; i < p.earlyDensity; i++) {
    earlyTaps.push({
      time: 0.012 + (i + 1) * 0.008 * (1 + Math.random() * 0.3),
      gain: 0.7 * Math.exp(-i * 0.35),
    });
  }

  const left  = new Float32Array(length);
  const right = new Float32Array(length);

  for (let ch = 0; ch < 2; ch++) {
    const data = ch === 0 ? left : right;

    // Early reflections (discrete taps with stereo offset)
    for (const tap of earlyTaps) {
      const offset = ch === 0 ? 0 : Math.ceil(sampleRate * p.earlySpread / 1000);
      const idx = preDelay + Math.ceil(sampleRate * tap.time) + offset;
      if (idx < length) {
        const burstLen = Math.ceil(sampleRate * 0.004);
        for (let j = 0; j < burstLen; j++) {
          if (idx + j < length) {
            data[idx + j] = (data[idx + j] ?? 0) + (Math.random() * 2 - 1) * tap.gain * Math.exp(-j / (sampleRate * 0.002));
          }
        }
      }
    }

    // Late diffuse tail
    const tailStart = preDelay + Math.ceil(sampleRate * (type === "plate" ? 0.005 : 0.08));
    for (let i = tailStart; i < length; i++) {
      const t = (i - tailStart) / sampleRate;
      const envelope = Math.exp(-t * 6 / (decay * p.tailDecayMul));
      const warmth = Math.exp(-t * (1 + p.brightness * 4));
      data[i] = (data[i] ?? 0) + (Math.random() * 2 - 1) * envelope * (p.brightness + warmth * (1 - p.brightness));
    }
  }

  return { left, right };
}

self.onmessage = (e: MessageEvent<ReverbRequest>) => {
  const { id, sampleRate, duration, decay, type } = e.data;
  const { left, right } = generateIR(sampleRate, duration, decay, type);
  const response: ReverbResponse = { id, left, right, sampleRate };
  // Transfer ownership of the Float32Arrays — zero-copy
  (self as unknown as Worker).postMessage(response, [left.buffer, right.buffer]);
};
