/**
 * Melody Layers engine instances.
 *
 * 4 MelodyEngine instances — one per layer slot (index matches layer order).
 * Engine 0 reuses the existing melodyEngine singleton (already on Channel 14).
 * Engines 1–3 are initialized and connected to Channel 14 in App.tsx.
 */
import { melodyEngine, MelodyEngine } from "./MelodyEngine";

export const melodyLayerEngines: [MelodyEngine, MelodyEngine, MelodyEngine, MelodyEngine] = [
  melodyEngine,
  new MelodyEngine(),
  new MelodyEngine(),
  new MelodyEngine(),
];
