// capture-worklet.js
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0]; // Float32Array, engine-owned (reused) — copy it
      const frame = new Float32Array(channel.length);
      frame.set(channel);
      let sumSquares = 0;
      for (let i = 0; i < frame.length; i++) {
        sumSquares += frame[i] * frame[i];
      }
      const rms = Math.sqrt(sumSquares / frame.length);
      this.port.postMessage({ frame, rms }, [frame.buffer]);
    }
    return true; // keep processor alive
  }
}
registerProcessor("capture-processor", CaptureProcessor);
