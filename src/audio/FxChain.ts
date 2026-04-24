/**
 * FX Chain — per-channel insert FX rack.
 *
 * Each channel has its own FxChain instance. The chain manages a list of
 * ordered FxSlot nodes that can be added, removed, and reordered. FX types
 * are implemented as small factories that build a Web Audio sub-graph with
 * a single input and output node.
 *
 * Types supported:
 *   - bitcrusher   (sample-rate/bit depth reducer, ScriptProcessor-free via WaveShaper)
 *   - ringmod      (ring modulator via OscillatorNode + Gain multiplication)
 *   - tremolo      (LFO → gain)
 *   - widener      (mid/side stereo widener)
 *   - autofilter   (LFO → filter cutoff)
 */

export type FxType = "bitcrusher" | "ringmod" | "tremolo" | "widener" | "autofilter";

export interface FxMeta {
  type: FxType;
  label: string;
  params: { id: string; label: string; min: number; max: number; default: number; unit?: string }[];
}

export const FX_CATALOG: FxMeta[] = [
  {
    type: "bitcrusher",
    label: "BITCRUSH",
    params: [
      { id: "bits", label: "Bits", min: 1, max: 16, default: 8 },
      { id: "mix", label: "Mix", min: 0, max: 1, default: 1 },
    ],
  },
  {
    type: "ringmod",
    label: "RING",
    params: [
      { id: "freq", label: "Freq", min: 1, max: 5000, default: 220, unit: "Hz" },
      { id: "mix", label: "Mix", min: 0, max: 1, default: 0.5 },
    ],
  },
  {
    type: "tremolo",
    label: "TREM",
    params: [
      { id: "rate",  label: "Rate",  min: 0.1, max: 20, default: 4, unit: "Hz" },
      { id: "depth", label: "Depth", min: 0,   max: 1,  default: 0.5 },
      { id: "wave",  label: "Wave",  min: 0,   max: 2,  default: 0 }, // 0=sine 1=square 2=triangle
    ],
  },
  {
    type: "widener",
    label: "WIDE",
    params: [
      { id: "width", label: "Width", min: 0, max: 2, default: 1.3 },
    ],
  },
  {
    type: "autofilter",
    label: "AUTO",
    params: [
      { id: "rate",   label: "Rate",  min: 0.02, max: 12,   default: 0.5,  unit: "Hz" },
      { id: "center", label: "Freq",  min: 80,   max: 9000, default: 1200, unit: "Hz" },
      { id: "depth",  label: "Depth", min: 0,    max: 1,    default: 0.6 },
      { id: "res",    label: "Res",   min: 0.5,  max: 20,   default: 5.5 },
    ],
  },
];

export interface FxSlot {
  id: string;          // unique id for reactive UI
  type: FxType;
  input: AudioNode;    // connect to this
  output: AudioNode;   // connect from this
  params: Record<string, number>;
  setParam: (id: string, value: number) => void;
  dispose: () => void;
}

function uid(): string {
  return `fx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Bitcrusher via waveshaper curve ────────────────────────────
function applyBitcrushCurve(shaper: WaveShaperNode, bits: number): void {
  const steps = Math.max(2, Math.pow(2, Math.max(1, Math.floor(bits))));
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  // Seeded PRNG for deterministic TPDF dither (same curve on re-render)
  let seed = 0x5a3c;
  const drand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
  const dither = 0.38 / steps; // Triangular dither amplitude
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const d = (drand() - drand()) * dither; // TPDF: two uniform → triangular distribution
    curve[i] = Math.max(-1, Math.min(1, Math.round((x + d) * steps) / steps));
  }
  shaper.curve = curve;
}

function createBitcrusher(ctx: AudioContext): FxSlot {
  const input = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const output = ctx.createGain();

  const params = { bits: 8, mix: 1 };
  applyBitcrushCurve(shaper, params.bits);
  wet.gain.value = params.mix;
  dry.gain.value = 1 - params.mix;

  input.connect(shaper);
  shaper.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  return {
    id: uid(),
    type: "bitcrusher",
    input, output,
    params,
    setParam: (id, v) => {
      params[id as keyof typeof params] = v;
      if (id === "bits") applyBitcrushCurve(shaper, v);
      if (id === "mix") {
        wet.gain.value = v;
        dry.gain.value = 1 - v;
      }
    },
    dispose: () => {
      input.disconnect(); shaper.disconnect(); wet.disconnect(); dry.disconnect(); output.disconnect();
    },
  };
}

// ─── Ring Modulator ─────────────────────────────────────────────
function createRingMod(ctx: AudioContext): FxSlot {
  const input = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const output = ctx.createGain();

  // Ring mod: input * carrier
  const multiplier = ctx.createGain();
  multiplier.gain.value = 0;
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = 220;
  carrier.connect(multiplier.gain);
  carrier.start();

  const params = { freq: 220, mix: 0.5 };
  wet.gain.value = params.mix;
  dry.gain.value = 1 - params.mix;

  input.connect(multiplier);
  multiplier.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  return {
    id: uid(),
    type: "ringmod",
    input, output,
    params,
    setParam: (id, v) => {
      params[id as keyof typeof params] = v;
      if (id === "freq") carrier.frequency.value = v;
      if (id === "mix") {
        wet.gain.value = v;
        dry.gain.value = 1 - v;
      }
    },
    dispose: () => {
      try { carrier.stop(); } catch { /* */ }
      input.disconnect(); wet.disconnect(); dry.disconnect(); multiplier.disconnect(); output.disconnect();
    },
  };
}

// ─── Tremolo (LFO → gain) ───────────────────────────────────────
function createTremolo(ctx: AudioContext): FxSlot {
  const input = ctx.createGain();
  const vca = ctx.createGain();
  const output = ctx.createGain();

  vca.gain.value = 1;

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 4;
  const depthGain = ctx.createGain();
  depthGain.gain.value = 0.5;
  // LFO output is -1..1. We scale by depth and add to gain (value=1).
  // So effective gain ranges from (1-depth) to (1+depth).
  const offset = ctx.createConstantSource();
  offset.offset.value = 1;
  offset.start();
  lfo.connect(depthGain);
  offset.connect(vca.gain);
  depthGain.connect(vca.gain);
  lfo.start();

  input.connect(vca);
  vca.connect(output);

  const params = { rate: 4, depth: 0.5, wave: 0 };
  return {
    id: uid(),
    type: "tremolo",
    input, output,
    params,
    setParam: (id, v) => {
      params[id as keyof typeof params] = v;
      if (id === "rate") lfo.frequency.value = v;
      if (id === "depth") depthGain.gain.value = v;
      if (id === "wave") {
        const types: OscillatorType[] = ["sine", "square", "triangle"];
        lfo.type = types[Math.round(v)] ?? "sine";
      }
    },
    dispose: () => {
      try { lfo.stop(); offset.stop(); } catch { /* */ }
      input.disconnect(); vca.disconnect(); output.disconnect(); depthGain.disconnect();
    },
  };
}

// ─── Stereo Widener (mid/side) ─────────────────────────────────
function createWidener(ctx: AudioContext): FxSlot {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);

  // L + R → mid, L - R → side, then recombine with scaled side
  const midGain = ctx.createGain(); midGain.gain.value = 0.5;
  const sideGainL = ctx.createGain(); sideGainL.gain.value = 0.5;
  const sideGainR = ctx.createGain(); sideGainR.gain.value = -0.5;
  const widthGain = ctx.createGain(); widthGain.gain.value = 1.3;

  input.connect(splitter);

  // mid = 0.5*(L+R)
  splitter.connect(midGain, 0);
  splitter.connect(midGain, 1);

  // side = 0.5*(L-R) → widthGain
  splitter.connect(sideGainL, 0);
  splitter.connect(sideGainR, 1);
  sideGainL.connect(widthGain);
  sideGainR.connect(widthGain);

  // L_out = mid + side*width, R_out = mid - side*width
  const outL = ctx.createGain();
  const outR = ctx.createGain(); outR.gain.value = 1;
  const sideNeg = ctx.createGain(); sideNeg.gain.value = -1;
  midGain.connect(outL);
  midGain.connect(outR);
  widthGain.connect(outL);
  widthGain.connect(sideNeg);
  sideNeg.connect(outR);

  outL.connect(merger, 0, 0);
  outR.connect(merger, 0, 1);
  merger.connect(output);

  const params = { width: 1.3 };
  return {
    id: uid(),
    type: "widener",
    input, output,
    params,
    setParam: (id, v) => {
      params[id as keyof typeof params] = v;
      if (id === "width") widthGain.gain.value = v;
    },
    dispose: () => {
      input.disconnect(); splitter.disconnect(); merger.disconnect(); output.disconnect();
      midGain.disconnect(); sideGainL.disconnect(); sideGainR.disconnect();
      widthGain.disconnect(); outL.disconnect(); outR.disconnect(); sideNeg.disconnect();
    },
  };
}

// ─── Autofilter (LFO → filter cutoff) ──────────────────────────
function createAutofilter(ctx: AudioContext): FxSlot {
  const input = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1000;
  filter.Q.value = 4;
  const output = ctx.createGain();

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.5;
  const depthGain = ctx.createGain();
  depthGain.gain.value = Math.pow(0.6, 1.6) * 4000; // Default depth=0.6 exponential
  lfo.connect(depthGain);
  depthGain.connect(filter.frequency);
  lfo.start();

  input.connect(filter);
  filter.connect(output);

  const params = { rate: 0.5, center: 1000, depth: 0.7, res: 4 };
  return {
    id: uid(),
    type: "autofilter",
    input, output,
    params,
    setParam: (id, v) => {
      params[id as keyof typeof params] = v;
      if (id === "rate") lfo.frequency.value = v;
      if (id === "center") {
        filter.frequency.value = v;
        // Recompute depth scale relative to new center
        depthGain.gain.value = Math.pow(params.depth, 1.6) * 4000;
      }
      if (id === "depth") {
        // Exponential depth: subtle at low values, dramatic at high
        depthGain.gain.value = Math.pow(v, 1.6) * 4000;
      }
      if (id === "res") filter.Q.value = v;
    },
    dispose: () => {
      try { lfo.stop(); } catch { /* */ }
      input.disconnect(); filter.disconnect(); depthGain.disconnect(); output.disconnect();
    },
  };
}

export function createFxSlot(ctx: AudioContext, type: FxType): FxSlot {
  switch (type) {
    case "bitcrusher": return createBitcrusher(ctx);
    case "ringmod": return createRingMod(ctx);
    case "tremolo": return createTremolo(ctx);
    case "widener": return createWidener(ctx);
    case "autofilter": return createAutofilter(ctx);
  }
}

/**
 * FxChain manages an ordered list of FX slots between a fixed input and output node.
 * When slots change, the internal graph is rewired:
 *   input → [slot1 → slot2 → ... → slotN] → output
 * If empty: input → output (bypass).
 */
export class FxChain {
  private ctx: AudioContext;
  readonly input: GainNode;
  readonly output: GainNode;
  private slots: FxSlot[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output); // bypass
  }

  getSlots(): ReadonlyArray<FxSlot> { return this.slots; }

  addSlot(type: FxType): FxSlot {
    const slot = createFxSlot(this.ctx, type);
    this.slots.push(slot);
    this.rewire();
    return slot;
  }

  removeSlot(id: string): void {
    const idx = this.slots.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const [slot] = this.slots.splice(idx, 1);
    slot?.dispose();
    this.rewire();
  }

  moveSlot(fromIdx: number, toIdx: number): void {
    if (fromIdx === toIdx) return;
    const from = Math.max(0, Math.min(fromIdx, this.slots.length - 1));
    const to = Math.max(0, Math.min(toIdx, this.slots.length - 1));
    const [slot] = this.slots.splice(from, 1);
    if (slot) this.slots.splice(to, 0, slot);
    this.rewire();
  }

  clear(): void {
    for (const s of this.slots) s.dispose();
    this.slots = [];
    this.rewire();
  }

  private rewire(): void {
    // Disconnect everything
    try { this.input.disconnect(); } catch { /* */ }
    for (const s of this.slots) {
      try { s.output.disconnect(); } catch { /* */ }
    }
    // Rebuild: input → slot[0] → slot[1] → ... → output
    if (this.slots.length === 0) {
      this.input.connect(this.output);
      return;
    }
    this.input.connect(this.slots[0]!.input);
    for (let i = 0; i < this.slots.length - 1; i++) {
      this.slots[i]!.output.connect(this.slots[i + 1]!.input);
    }
    this.slots[this.slots.length - 1]!.output.connect(this.output);
  }
}
