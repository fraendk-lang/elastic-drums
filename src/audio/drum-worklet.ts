/**
 * Elastic Drums AudioWorklet Processor
 *
 * Runs the WASM DSP core in the audio thread.
 * Communication with main thread via MessagePort.
 *
 * Architecture (from PDF analysis):
 * - UI Thread (Main): Sequencer editing, pattern browser, UI rendering
 * - Audio Thread (AudioWorkletGlobalScope): Real-time DSP, event consumption
 * - Communication: MessagePort commands (+ SharedArrayBuffer for parameters later)
 */

interface WasmExports {
  ed_init(sampleRate: number, blockSize: number): void;
  ed_process(leftPtr: number, rightPtr: number, numSamples: number): void;
  ed_trigger(voice: number, velocity: number): void;
  ed_set_param(voice: number, param: number, value: number): void;
  ed_get_param(voice: number, param: number): number;
  ed_set_bpm(bpm: number): void;
  memory: WebAssembly.Memory;
  _malloc(size: number): number;
  _free(ptr: number): void;
}

type Command =
  | { type: "trigger"; voice: number; velocity: number }
  | { type: "setParam"; voice: number; param: number; value: number }
  | { type: "setBpm"; bpm: number };

class ElasticDrumsProcessor extends AudioWorkletProcessor {
  private wasm: WasmExports | null = null;
  private leftPtr = 0;
  private rightPtr = 0;
  private blockSize = 128;
  private initialized = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
  }

  private handleMessage(data: { type: string; [key: string]: unknown }) {
    if (data.type === "init" && data.wasmModule) {
      this.initWasm(data.wasmModule as WebAssembly.Module);
    } else if (this.wasm) {
      const cmd = data as Command;
      switch (cmd.type) {
        case "trigger":
          this.wasm.ed_trigger(cmd.voice, cmd.velocity);
          break;
        case "setParam":
          this.wasm.ed_set_param(cmd.voice, cmd.param, cmd.value);
          break;
        case "setBpm":
          this.wasm.ed_set_bpm(cmd.bpm);
          break;
      }
    }
  }

  private async initWasm(module: WebAssembly.Module) {
    // Instantiate WASM module
    const instance = await WebAssembly.instantiate(module);
    this.wasm = instance.exports as unknown as WasmExports;

    this.blockSize = 128;
    this.wasm.ed_init(sampleRate, this.blockSize);

    // Allocate stereo output buffers in WASM memory
    this.leftPtr = this.wasm._malloc(this.blockSize * 4);
    this.rightPtr = this.wasm._malloc(this.blockSize * 4);

    this.initialized = true;
    this.port.postMessage({ type: "ready" });
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    if (!this.initialized || !this.wasm) return true;

    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const left = output[0]!;
    const right = output[1]!;
    const numSamples = left.length;

    // Run DSP
    this.wasm.ed_process(this.leftPtr, this.rightPtr, numSamples);

    // Copy from WASM memory to output
    const wasmMemory = new Float32Array(this.wasm.memory.buffer);
    const leftOffset = this.leftPtr / 4;
    const rightOffset = this.rightPtr / 4;

    left.set(wasmMemory.subarray(leftOffset, leftOffset + numSamples));
    right.set(wasmMemory.subarray(rightOffset, rightOffset + numSamples));

    return true;
  }
}

registerProcessor("elastic-drums-processor", ElasticDrumsProcessor);
