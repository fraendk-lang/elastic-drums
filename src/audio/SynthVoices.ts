/**
 * Synthesis Voice Library — ported from Elastic Groove
 * Standalone functions for FM, AM, and Karplus-Strong synthesis.
 * Used by MelodyEngine as alternative synth types.
 */

// MIDI note to frequency
function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export interface SynthEnvelope {
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0-1
  release: number;  // seconds
}

export interface FilterEnvParams {
  on: boolean;
  amount: number;  // Hz range
  attack: number;  // seconds
  decay: number;   // seconds
}

export interface LFOParams {
  on: boolean;
  rate: number;     // Hz
  depth: number;    // 0-1
  target: "pitch" | "volume" | "filter";
}

/**
 * FM SYNTH (2-Operator Frequency Modulation)
 */
export function playFM(
  ctx: AudioContext, dest: AudioNode, time: number,
  note: number, vol: number, duration: number = 0.3,
  harmonicity: number = 3, modIndex: number = 10,
  attack: number = 0.01, decay: number = 0.2,
  sustain: number = 0.3, release: number = 0.1,
) {
  const freq = noteToFreq(note);
  const totalDur = Math.max(duration, attack + decay + 0.1 + release);

  // Modulator oscillator
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * harmonicity;

  // Modulation depth (brightness)
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(freq * harmonicity * modIndex, time);
  modGain.gain.exponentialRampToValueAtTime(Math.max(freq * 0.1, 1), time + decay * 2);

  // Carrier oscillator
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;

  // FM connection: modulator → carrier.frequency
  mod.connect(modGain);
  modGain.connect(carrier.frequency);

  // Amplitude envelope
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vol * 0.4, time + attack);
  g.gain.linearRampToValueAtTime(vol * 0.4 * sustain, time + attack + decay);
  g.gain.setValueAtTime(vol * 0.4 * sustain, time + totalDur - release);
  g.gain.exponentialRampToValueAtTime(0.001, time + totalDur);

  carrier.connect(g);
  g.connect(dest);

  mod.start(time); mod.stop(time + totalDur + 0.05);
  carrier.start(time); carrier.stop(time + totalDur + 0.05);

  // Disconnect nodes after oscillators stop — prevents graph node accumulation
  carrier.onended = () => {
    try { mod.disconnect(); } catch { /* ok */ }
    try { modGain.disconnect(); } catch { /* ok */ }
    try { carrier.disconnect(); } catch { /* ok */ }
    try { g.disconnect(); } catch { /* ok */ }
  };
}

/**
 * AM SYNTH (Amplitude Modulation)
 */
export function playAM(
  ctx: AudioContext, dest: AudioNode, time: number,
  note: number, vol: number, duration: number = 0.3,
  harmonicity: number = 2, modDepth: number = 0.8,
  attack: number = 0.01, decay: number = 0.15,
  sustain: number = 0.5, release: number = 0.1,
) {
  const freq = noteToFreq(note);
  const totalDur = Math.max(duration, attack + decay + 0.1 + release);

  // Carrier oscillator
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;

  // Modulator oscillator (audio-rate AM)
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * harmonicity;

  // AM: modulator controls carrier amplitude
  const modGain = ctx.createGain();
  modGain.gain.value = vol * 0.4 * modDepth;

  const carrierGain = ctx.createGain();
  carrierGain.gain.value = vol * 0.4 * (1 - modDepth * 0.5); // DC offset so sound doesn't cut out completely

  // Envelope
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(1, time + attack);
  env.gain.linearRampToValueAtTime(sustain, time + attack + decay);
  env.gain.setValueAtTime(sustain, time + totalDur - release);
  env.gain.exponentialRampToValueAtTime(0.001, time + totalDur);

  // Connect: mod → modGain → carrierGain.gain (AM)
  mod.connect(modGain);
  modGain.connect(carrierGain.gain);
  carrier.connect(carrierGain);
  carrierGain.connect(env);
  env.connect(dest);

  carrier.start(time); carrier.stop(time + totalDur + 0.05);
  mod.start(time); mod.stop(time + totalDur + 0.05);

  carrier.onended = () => {
    try { mod.disconnect(); } catch { /* ok */ }
    try { modGain.disconnect(); } catch { /* ok */ }
    try { carrier.disconnect(); } catch { /* ok */ }
    try { carrierGain.disconnect(); } catch { /* ok */ }
    try { env.disconnect(); } catch { /* ok */ }
  };
}

/**
 * PLUCK SYNTH (Karplus-Strong Physical Modeling)
 */
export function playPluck(
  ctx: AudioContext, dest: AudioNode, time: number,
  note: number, vol: number,
  dampening: number = 4000, resonance: number = 0.98,
) {
  const freq = noteToFreq(note);
  const delaySamples = Math.round(ctx.sampleRate / freq);
  const duration = 2.0;

  const bufLen = Math.round(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Karplus-Strong: noise burst → delay line with averaging feedback
  const delayLine = new Float32Array(delaySamples);
  for (let i = 0; i < delaySamples; i++) {
    delayLine[i] = (Math.random() * 2 - 1);
  }

  let readPos = 0;
  for (let i = 0; i < bufLen; i++) {
    const sample = delayLine[readPos] ?? 0;
    data[i] = sample;
    const next = delayLine[(readPos + 1) % delaySamples] ?? 0;
    delayLine[readPos] = (sample + next) * 0.5 * resonance;
    readPos = (readPos + 1) % delaySamples;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = vol * 0.5;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = dampening;

  src.connect(lp).connect(g).connect(dest);
  src.start(time);
}
