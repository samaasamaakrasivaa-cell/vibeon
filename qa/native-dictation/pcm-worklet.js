class SyntheticPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data !== "flush") return;
      this.send();
      this.port.postMessage("flushed");
    };
  }

  send() {
    if (this.count === 0) return;
    const chunk = this.samples.slice(0, this.count);
    this.count = 0;
    this.port.postMessage(chunk, [chunk.buffer]);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.samples[this.count++] = sample;
      if (this.count === this.samples.length) this.send();
    }
    return true;
  }
}
registerProcessor("qa-pcm", SyntheticPcm);
