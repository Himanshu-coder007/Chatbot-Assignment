// client.js
const logEl = (t) => {
  document.getElementById("log").innerText += t + "\n";
};
const ws = new WebSocket(
  (location.protocol === "https:" ? "wss" : "ws") +
    "://" +
    location.host +
    "/ws"
);

let audioCtx;
let mediaStream;
let recorder; // ScriptProcessor or AudioWorklet
let isRecording = false;
let node;
let sampleRate = 16000; // API expects 16k
let bufferQueue = []; // incoming model audio queued for playback
let playing = false;

// helper to convert Float32 -> Int16 PCM
function floatTo16BitPCM(float32Array) {
  const l = float32Array.length;
  const buf = new ArrayBuffer(l * 2);
  const view = new DataView(buf);
  let offset = 0;
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Int16Array(buf);
}

ws.onopen = () => logEl("ws open");
ws.onerror = (e) => logEl("ws err " + e.message);
ws.onmessage = (ev) => {
  const message = JSON.parse(ev.data);
  if (message.type === "connected") logEl("server connected");
  if (message.type === "live_message") {
    const m = message.payload;
    // the structure from server includes model_turn.parts with inline audio
    // To keep things robust, scan parts for inline audio base64 blobs:
    try {
      if (
        m.serverContent &&
        m.serverContent.model_turn &&
        m.serverContent.model_turn.parts
      ) {
        const parts = m.serverContent.model_turn.parts;
        for (const p of parts) {
          if (p.inline_data && p.inline_data.data) {
            // base64-encoded PCM16@24000 per docs (native audio output uses 24000)
            // push to queue then play
            bufferQueue.push({
              mime: p.inline_data.mime_type,
              data: p.inline_data.data,
            });
            drainPlaybackQueue();
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
};

async function drainPlaybackQueue() {
  if (playing) return;
  if (bufferQueue.length === 0) return;
  playing = true;
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 24000,
    });
  while (bufferQueue.length > 0) {
    const item = bufferQueue.shift();
    // decode audio: API sends raw PCM base64 or wav. In the server code earlier we forwarded as base64 PCM16.
    // If it's PCM16 (raw), we need to create AudioBuffer from int16.
    try {
      const raw = atob(item.data);
      // We'll treat it as 16-bit PCM little-endian 24000Hz mono (per docs)
      const len = raw.length / 2;
      const float32 = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const lo = raw.charCodeAt(i * 2);
        const hi = raw.charCodeAt(i * 2 + 1);
        let val = (hi << 8) | lo;
        if (val & 0x8000) val = val - 0x10000;
        float32[i] = val / 32768;
      }
      const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      const src = audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(audioCtx.destination);
      src.start();
      await new Promise((res) => {
        src.onended = res;
      });
    } catch (e) {
      console.error("Playback decode error", e);
    }
  }
  playing = false;
}

// Very simple mic capture using AudioContext + ScriptProcessor
async function startRecording() {
  if (isRecording) {
    stopRecording();
    return;
  }
  audioCtx =
    audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  node = audioCtx.createScriptProcessor(4096, 1, 1);
  const source = audioCtx.createMediaStreamSource(mediaStream);
  source.connect(node);
  node.connect(audioCtx.destination); // for monitoring if you want; remove to avoid feedback

  node.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0);
    // downsample to 16000:
    const desiredRate = 16000;
    const currRate = audioCtx.sampleRate;
    // simple downsample: naive linear
    const factor = currRate / desiredRate;
    let out = new Float32Array(Math.floor(float32.length / factor));
    for (let i = 0; i < out.length; i++) {
      out[i] = float32[Math.floor(i * factor)];
    }
    const int16 = floatTo16BitPCM(out);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
    // send to server
    ws.send(JSON.stringify({ type: "audio_chunk", data: base64 }));
    // notify server/client that user started speaking to interrupt playback
    if (playing) {
      // immediate local interrupt
      bufferQueue = []; // clear any queued model audio
      playing = false;
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
  };

  isRecording = true;
  logEl("Recording started");
}

function stopRecording() {
  if (!isRecording) return;
  node.disconnect();
  mediaStream.getTracks().forEach((t) => t.stop());
  isRecording = false;
  logEl("Recording stopped");
}

document.getElementById("recordBtn").addEventListener("click", () => {
  startRecording();
});

document.getElementById("speakBtn").addEventListener("click", () => {
  const text = prompt("Text to send to assistant:");
  if (text) {
    ws.send(JSON.stringify({ type: "text", text }));
  }
});
