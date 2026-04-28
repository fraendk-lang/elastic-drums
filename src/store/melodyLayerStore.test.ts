// src/store/melodyLayerStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useMelodyLayerStore, DEFAULT_SYNTH } from "./melodyLayerStore";

function resetStore() {
  useMelodyLayerStore.setState({
    enabled: false,
    layers: [
      { id: "l0", colorIndex: 0, barLength: 2, notes: [], synth: { ...DEFAULT_SYNTH }, muted: false, soloed: false }
    ],
    activeLayerId: "l0",
  });
}

describe("melodyLayerStore — addLayer", () => {
  beforeEach(resetStore);
  it("adds a second layer with colorIndex 1", () => {
    useMelodyLayerStore.getState().addLayer();
    const { layers } = useMelodyLayerStore.getState();
    expect(layers).toHaveLength(2);
    expect(layers[1]!.colorIndex).toBe(1);
  });
  it("does not add beyond 3 layers (engines 1–3 reserved for layers)", () => {
    for (let i = 0; i < 5; i++) useMelodyLayerStore.getState().addLayer();
    expect(useMelodyLayerStore.getState().layers).toHaveLength(3);
  });
});

describe("melodyLayerStore — removeLayer", () => {
  beforeEach(resetStore);
  it("cannot remove the last layer", () => {
    useMelodyLayerStore.getState().removeLayer("l0");
    expect(useMelodyLayerStore.getState().layers).toHaveLength(1);
  });
  it("removes layer and activates remaining layer", () => {
    useMelodyLayerStore.getState().addLayer();
    const l1id = useMelodyLayerStore.getState().layers[1]!.id;
    useMelodyLayerStore.getState().removeLayer(l1id);
    expect(useMelodyLayerStore.getState().layers).toHaveLength(1);
    expect(useMelodyLayerStore.getState().activeLayerId).toBe("l0");
  });
  it("removes the active layer and activates last remaining", () => {
    useMelodyLayerStore.getState().addLayer();
    const l1id = useMelodyLayerStore.getState().layers[1]!.id;
    // Make L1 the active layer, then remove it
    useMelodyLayerStore.getState().setActiveLayer(l1id);
    useMelodyLayerStore.getState().removeLayer(l1id);
    expect(useMelodyLayerStore.getState().layers).toHaveLength(1);
    expect(useMelodyLayerStore.getState().activeLayerId).toBe("l0");
  });
});

describe("melodyLayerStore — note operations", () => {
  const note = { id: "n1", startBeat: 0, durationBeats: 0.5, pitch: 60 };
  beforeEach(resetStore);
  it("addNote adds note to the correct layer", () => {
    useMelodyLayerStore.getState().addNote("l0", note);
    expect(useMelodyLayerStore.getState().layers[0]!.notes).toHaveLength(1);
    expect(useMelodyLayerStore.getState().layers[0]!.notes[0]!.id).toBe("n1");
  });
  it("removeNote removes note by id", () => {
    useMelodyLayerStore.getState().addNote("l0", note);
    useMelodyLayerStore.getState().removeNote("l0", "n1");
    expect(useMelodyLayerStore.getState().layers[0]!.notes).toHaveLength(0);
  });
  it("updateNote patches note fields", () => {
    useMelodyLayerStore.getState().addNote("l0", note);
    useMelodyLayerStore.getState().updateNote("l0", "n1", { durationBeats: 1 });
    expect(useMelodyLayerStore.getState().layers[0]!.notes[0]!.durationBeats).toBe(1);
  });
});

describe("melodyLayerStore — setSynth", () => {
  beforeEach(resetStore);
  it("patches synth fields", () => {
    useMelodyLayerStore.getState().setSynth("l0", { cutoff: 0.8 });
    expect(useMelodyLayerStore.getState().layers[0]!.synth.cutoff).toBe(0.8);
    expect(useMelodyLayerStore.getState().layers[0]!.synth.presetIndex).toBe(0); // unchanged
  });
  it("setSynthFull replaces entire synth object", () => {
    const full = { ...DEFAULT_SYNTH, presetIndex: 3, octaveOffset: 1, cutoff: 0.3 };
    useMelodyLayerStore.getState().setSynthFull("l0", full);
    expect(useMelodyLayerStore.getState().layers[0]!.synth).toEqual(full);
  });
});

describe("melodyLayerStore — updateLayer", () => {
  beforeEach(resetStore);
  it("patches barLength on the correct layer without affecting others", () => {
    useMelodyLayerStore.getState().addLayer();
    useMelodyLayerStore.getState().updateLayer("l0", { barLength: 4 });
    expect(useMelodyLayerStore.getState().layers[0]!.barLength).toBe(4);
    // l1 is untouched
    expect(useMelodyLayerStore.getState().layers[1]!.barLength).toBe(2);
  });
  it("patches muted flag on a layer", () => {
    useMelodyLayerStore.getState().updateLayer("l0", { muted: true });
    expect(useMelodyLayerStore.getState().layers[0]!.muted).toBe(true);
  });
});
