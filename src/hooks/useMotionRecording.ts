/**
 * Motion Recording
 *
 * Records parameter changes in real-time during playback and writes them
 * as P-Locks to the current pattern. Like Korg Motion Sequence or
 * Elektron's "record + tweak" workflow.
 *
 * Usage:
 * 1. Start playback
 * 2. Enable motion recording (REC button)
 * 3. Select a voice and move sliders
 * 4. Each slider change at each step becomes a P-Lock
 * 5. Stop recording — P-Locks are saved in the pattern
 */

import { useCallback, useRef } from "react";
import { useDrumStore, getDrumCurrentStep } from "../store/drumStore";

export function useMotionRecording() {
  const isRecording = useRef(false);
  const lastRecordedStep = useRef(-1);

  const startRecording = useCallback(() => {
    isRecording.current = true;
    lastRecordedStep.current = -1;
    console.log("Motion Recording: STARTED");
  }, []);

  const stopRecording = useCallback(() => {
    isRecording.current = false;
    lastRecordedStep.current = -1;
    console.log("Motion Recording: STOPPED");
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording.current) stopRecording();
    else startRecording();
    return !isRecording.current;
  }, [startRecording, stopRecording]);

  /**
   * Called from VoiceEditor when a parameter changes during recording.
   * Records the value as a P-Lock on the current step.
   */
  const recordParam = useCallback((voice: number, paramId: string, value: number) => {
    if (!isRecording.current) return;

    const { isPlaying, pattern } = useDrumStore.getState();
    if (!isPlaying) return;

    // Only record once per step (avoid flooding with intermediate values)
    const currentStep = getDrumCurrentStep();
    if (currentStep === lastRecordedStep.current) return;
    lastRecordedStep.current = currentStep;

    // Write P-Lock to the current step
    const step = currentStep % pattern.length;
    useDrumStore.getState().setParamLock(voice, step, paramId, value);
  }, []);

  return {
    isRecording: () => isRecording.current,
    startRecording,
    stopRecording,
    toggleRecording,
    recordParam,
  };
}
