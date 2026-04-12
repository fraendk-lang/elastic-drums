/**
 * Elastic Drums Audio Engine
 *
 * Browser audio management:
 * - Creates AudioContext (requires user gesture for autoplay policy)
 * - Loads WASM module and registers AudioWorklet
 * - Provides high-level API for triggering voices and setting parameters
 *
 * Timing strategy (from PDF analysis):
 * - Look-ahead scheduler: 25ms timer, 50ms ahead into audio buffer
 * - Uses audioContext.currentTime as master clock
 * - Sequencer runs in WASM inside the AudioWorklet for sample-accurate timing
 */

export class AudioEngine {
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private initialized = false;

  async init(): Promise<void> {
    // AudioContext must be created/resumed in a user gesture
    this.context = new AudioContext({ sampleRate: 44100 });

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    // Register the worklet processor
    await this.context.audioWorklet.addModule("/src/audio/drum-worklet.ts");

    // Create worklet node
    this.workletNode = new AudioWorkletNode(
      this.context,
      "elastic-drums-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      },
    );

    this.workletNode.connect(this.context.destination);

    // Wait for WASM init
    return new Promise((resolve) => {
      this.workletNode!.port.onmessage = (e) => {
        if (e.data.type === "ready") {
          this.initialized = true;
          resolve();
        }
      };

      // Load and send WASM module
      this.loadWasm();
    });
  }

  private async loadWasm(): Promise<void> {
    try {
      const response = await fetch("/wasm/elastic-drums-wasm.wasm");
      const buffer = await response.arrayBuffer();
      const module = await WebAssembly.compile(buffer);

      this.workletNode!.port.postMessage({
        type: "init",
        wasmModule: module,
      });
    } catch {
      console.warn(
        "WASM not found — running in UI-only mode (no audio). Build WASM with: npm run build:wasm",
      );
    }
  }

  triggerVoice(voice: number, velocity = 1.0): void {
    this.workletNode?.port.postMessage({
      type: "trigger",
      voice,
      velocity,
    });
  }

  setParam(voice: number, param: number, value: number): void {
    this.workletNode?.port.postMessage({
      type: "setParam",
      voice,
      param,
      value,
    });
  }

  setBpm(bpm: number): void {
    this.workletNode?.port.postMessage({
      type: "setBpm",
      bpm,
    });
  }

  async resume(): Promise<void> {
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }
}

// Singleton
export const audioEngine = new AudioEngine();
