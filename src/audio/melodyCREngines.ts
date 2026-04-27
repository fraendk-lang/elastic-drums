/**
 * Melody C&R engine instances.
 *
 * callCREngine  = the existing melodyEngine singleton (reused for Call voice).
 * responseCREngine = a separate MelodyEngine instance for Response voice.
 *
 * Both are initialized in App.tsx and connected to Channel 14 (shared melody strip).
 * The existing melody step scheduler is disabled when C&R is enabled (guard in melodyStore.ts).
 */
import { melodyEngine, MelodyEngine } from "./MelodyEngine";

export const callCREngine = melodyEngine;
export const responseCREngine = new MelodyEngine();
