import { describe, it, expect } from "vitest";
import { SCENE_COLORS, getEntryColor, getEntryLabel, hexAlpha } from "./arrangementColors";
import type { SongChainEntry } from "../store/drumStore";

describe("arrangementColors", () => {
  it("SCENE_COLORS has 8 entries", () => {
    expect(SCENE_COLORS).toHaveLength(8);
  });

  it("getEntryColor returns entry.color when set", () => {
    const entry: SongChainEntry = { sceneIndex: 0, repeats: 1, color: "#ff0000" };
    expect(getEntryColor(entry)).toBe("#ff0000");
  });

  it("getEntryColor returns palette color based on sceneIndex when entry.color undefined", () => {
    const entry: SongChainEntry = { sceneIndex: 2, repeats: 1 };
    expect(getEntryColor(entry)).toBe(SCENE_COLORS[2]);
  });

  it("getEntryColor cycles palette for sceneIndex >= 8", () => {
    const entry: SongChainEntry = { sceneIndex: 10, repeats: 1 };
    expect(getEntryColor(entry)).toBe(SCENE_COLORS[10 % 8]);
  });

  it("getEntryLabel returns entry.label when set", () => {
    const entry: SongChainEntry = { sceneIndex: 0, repeats: 1, label: "Drop" };
    expect(getEntryLabel(entry)).toBe("Drop");
  });

  it("getEntryLabel returns 'Scene N' (1-indexed) when label undefined", () => {
    const entry: SongChainEntry = { sceneIndex: 4, repeats: 1 };
    expect(getEntryLabel(entry)).toBe("Scene 5");
  });

  it("hexAlpha converts 7-char hex to rgba with alpha", () => {
    expect(hexAlpha("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
  });

  it("hexAlpha expands 4-char shorthand #abc", () => {
    expect(hexAlpha("#abc", 1)).toBe("rgba(170,187,204,1)");
  });

  it("hexAlpha returns fallback for invalid input", () => {
    expect(hexAlpha("", 0.5)).toBe("rgba(0,0,0,0.5)");
    expect(hexAlpha("red", 1)).toBe("rgba(0,0,0,1)");
  });
});
