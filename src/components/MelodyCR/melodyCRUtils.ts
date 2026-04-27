/**
 * Pure helpers for Melody C&R scheduling logic.
 * No side effects — easily unit-tested.
 */

export function fullCycleSteps(barLength: 1 | 2 | 4): number {
  return barLength * 8 * 4;
}

export function callSectionSteps(barLength: 1 | 2 | 4): number {
  return barLength * 4 * 4;
}

export function getActiveVoice(
  stepCounter: number,
  barLength: 1 | 2 | 4
): "call" | "response" {
  const cs = callSectionSteps(barLength);
  const fs = fullCycleSteps(barLength);
  return stepCounter % fs < cs ? "call" : "response";
}

export function getLocalStep(
  stepCounter: number,
  barLength: 1 | 2 | 4
): number {
  const cs = callSectionSteps(barLength);
  const fs = fullCycleSteps(barLength);
  const wrapped = stepCounter % fs;
  return wrapped < cs ? wrapped : wrapped - cs;
}

export function stepToBeat(localStep: number): number {
  return localStep / 4;
}

export function notesOnStep(
  notes: { startBeat: number; durationBeats: number; pitch: number; id: string }[],
  localStep: number,
  totalBeats: number
): typeof notes {
  const totalSteps = totalBeats * 4;
  return notes.filter((n) => {
    const noteStep = Math.round(n.startBeat * 4) % totalSteps;
    return noteStep === localStep % totalSteps;
  });
}
