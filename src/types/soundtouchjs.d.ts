declare module "soundtouchjs" {
  export class SoundTouch {
    constructor(sampleRate?: number);
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
  }

  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, pipe: SoundTouch);
    /** Extract up to `numFrames` interleaved stereo frames into `target`. Returns frames read. */
    extract(target: Float32Array, numFrames: number): number;
    sourcePosition: number;
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    position: number;
  }
}
