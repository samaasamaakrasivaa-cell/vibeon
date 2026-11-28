"use strict";

// QA fixture. No application credentials or real lesson data.
const lang = new URLSearchParams(location.search).get("lang");
const text = document.querySelector("textarea");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const status = document.querySelector("#status");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

start.onclick = async () => {
  let model, input, context, recording, recognizer;
  start.disabled = true;
  try {
    model = await verifiedModel(lang);
    input = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    context = new AudioContext({ sampleRate: 16000 });
    await context.resume();
    await context.audioWorklet.addModule("/pcm-worklet.js");
    recognizer = new model.KaldiRecognizer(context.sampleRate);
    const phrases = [];
    recognizer.on("result", message => {
      const phrase = message.result.text?.trim();
      if (phrase) phrases.push(phrase);
    });
    recording = new AudioWorkletNode(context, "qa-pcm");
    const source = context.createMediaStreamSource(input);
    source.connect(recording).connect(context.destination);
    let flush;
    recording.port.onmessage = ({ data }) => {
      if (data === "flushed") flush?.();
      else recognizer.acceptWaveformFloat(data, context.sampleRate);
    };
    stop.disabled = false;
    status.textContent = "Recording";
    stop.onclick = async () => {
      stop.disabled = true;
      status.textContent = "Finishing";
      source.disconnect();
      const flushed = new Promise(resolve => { flush = resolve; });
      recording.port.postMessage("flush");
      await Promise.race([flushed, delay(3000)]);
      input.getTracks().forEach(track => track.stop());
      recognizer.retrieveFinalResult();
      await delay(1200);
      if (phrases.length) text.value += " " + phrases.join(" ");
      status.textContent = "Ready";
      recording.disconnect();
      recognizer.remove();
      model.terminate();
      await context.close();
    };
  } catch (error) {
    status.textContent = "Failed: " + error.message;
    input?.getTracks().forEach(track => track.stop());
    recording?.disconnect();
    recognizer?.remove();
    model?.terminate();
    await context?.close();
  }
};
