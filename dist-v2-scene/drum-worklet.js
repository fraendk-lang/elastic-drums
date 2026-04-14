/**
 * Elastic Drums AudioWorklet Processor
 *
 * Runs the C++ DSP core (compiled to WASM) in the audio thread.
 * Communication with main thread via MessagePort.
 *
 * Signal flow:
 *   UI Thread → MessagePort commands → Worklet → WASM DSP → Audio Output
 */

class ElasticDrumsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasm = null;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.ready = false;

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(data) {
    if (data.type === "wasm-binary") {
      this.initWasm(data.binary);
      return;
    }

    if (!this.wasm) return;

    switch (data.type) {
      case "trigger":
        this.wasm._ed_trigger(data.voice, data.velocity);
        break;

      case "setParam":
        this.wasm._ed_set_param(data.voice, data.param, data.value);
        break;

      case "setBpm":
        this.wasm._ed_set_bpm(data.bpm);
        break;

      case "setPlaying":
        this.wasm._ed_set_playing(data.playing ? 1 : 0);
        break;

      case "setStep":
        this.wasm._ed_set_step(
          data.track, data.step, data.active ? 1 : 0,
          data.velocity, data.ratchet || 1
        );
        break;

      case "setPatternLength":
        this.wasm._ed_set_pattern_length(data.length);
        break;

      case "setSwing":
        this.wasm._ed_set_swing(data.swing);
        break;

      case "syncPattern":
        // Bulk sync entire pattern from UI
        if (data.tracks) {
          this.wasm._ed_set_pattern_length(data.length || 16);
          this.wasm._ed_set_swing(data.swing || 50);
          for (let t = 0; t < data.tracks.length; t++) {
            const track = data.tracks[t];
            if (!track) continue;
            for (let s = 0; s < track.steps.length; s++) {
              const step = track.steps[s];
              if (!step) continue;
              this.wasm._ed_set_step(
                t, s, step.active ? 1 : 0,
                step.velocity || 100, step.ratchetCount || 1
              );
            }
          }
        }
        break;
    }
  }

  async initWasm(binary) {
    try {
      const module = await WebAssembly.compile(binary);
      const instance = await WebAssembly.instantiate(module, {
        env: {
          memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
        },
        wasi_snapshot_preview1: {
          // Stubs for WASM imports that Emscripten might need
          proc_exit: () => {},
          fd_write: () => 0,
          fd_seek: () => 0,
          fd_close: () => 0,
        },
      });

      this.wasm = instance.exports;

      // Initialize DSP
      this.wasm._ed_init(sampleRate, 128);

      // Allocate stereo output buffers in WASM memory
      this.leftPtr = this.wasm._ed_alloc_buffer(128);
      this.rightPtr = this.wasm._ed_alloc_buffer(128);

      this.ready = true;
      this.port.postMessage({ type: "ready" });

    } catch (err) {
      this.port.postMessage({ type: "error", message: String(err) });
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.ready || !this.wasm) return true;

    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const left = output[0];
    const right = output[1];
    const numSamples = left.length;

    // Run C++ DSP
    this.wasm._ed_process(this.leftPtr, this.rightPtr, numSamples);

    // Copy from WASM heap to output
    const heap = new Float32Array(this.wasm.memory.buffer);
    const lOff = this.leftPtr / 4;
    const rOff = this.rightPtr / 4;

    left.set(heap.subarray(lOff, lOff + numSamples));
    right.set(heap.subarray(rOff, rOff + numSamples));

    // Report current step back to UI for playhead
    const step = this.wasm._ed_get_current_step();
    const playing = this.wasm._ed_is_playing();
    if (playing) {
      this.port.postMessage({ type: "step", step });
    }

    return true;
  }
}

registerProcessor("elastic-drums-processor", ElasticDrumsProcessor);
