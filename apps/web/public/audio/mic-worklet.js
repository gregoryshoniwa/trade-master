// PCM capture worklet — runs in the audio rendering thread.
//
// getUserMedia delivers Float32 frames at the device's native rate
// (typically 48 kHz on macOS / Chrome). Gemini Live expects 16-bit PCM
// at 16 kHz mono. We downsample by integer decimation (4× from 48k,
// 3× from 44.1k → 14.7k which Gemini still accepts but isn't ideal)
// and convert to little-endian int16.
//
// Simple decimation aliases above 8 kHz but voice content is fine; a
// future iteration can swap in a polyphase FIR if quality matters.

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sampleRate = (options && options.processorOptions && options.processorOptions.sampleRate) || 48000;
    this.factor = Math.max(1, Math.round(sampleRate / 16000));
    // Buffer ~100ms worth of 16k samples (1600) so we don't flood the
    // main thread with tiny messages.
    this.buf = new Int16Array(1600);
    this.idx = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0]; // mono — Chrome gives us a single channel
    if (!ch0) return true;

    // Compute RMS for the level meter while we're walking the frame.
    let sumSq = 0;
    for (let i = 0; i < ch0.length; i += this.factor) {
      const s = ch0[i];
      sumSq += s * s;
      let v = Math.max(-1, Math.min(1, s));
      this.buf[this.idx++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.idx >= this.buf.length) {
        // Transfer the underlying ArrayBuffer to the main thread for
        // zero-copy posting.
        const out = this.buf;
        this.buf = new Int16Array(1600);
        this.idx = 0;
        this.port.postMessage({ pcm: out.buffer }, [out.buffer]);
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(1, ch0.length / this.factor));
    this.port.postMessage({ level: rms });
    return true;
  }
}

registerProcessor("mic-capture", MicCaptureProcessor);
