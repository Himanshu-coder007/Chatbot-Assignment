let mediaRecorder;
let audioChunks = [];
let conversationId = null;
let synth = window.speechSynthesis;
let utterance = null;
let currentLanguage = "en-US";
let isRecording = false;
let silenceTimer;
let audioContext;
let processor;
let stream;
let lastSoundTime = 0;
let voicesLoaded = false;
let isSpeaking = false;
let shouldInterrupt = false;

// DOM elements
const toggleRecordingBtn = document.getElementById("toggleRecording");
const statusEl = document.getElementById("status");
const conversationEl = document.getElementById("conversation");

// Constants
const SILENCE_THRESHOLD = 1500; // 1.5 seconds of silence to stop recording
const AUDIO_LEVEL_THRESHOLD = 0.02; // Minimum audio level to consider as speech
const INTERRUPTION_THRESHOLD = 0.1; // Higher threshold for interruption detection

// Initialize
window.addEventListener("DOMContentLoaded", () => {
  // Load voices
  loadVoices();

  // Initial greeting
  setTimeout(() => {
    const greeting =
      "Hello! I'm your Revolt Motors assistant. Ask me anything about our electric motorcycles in any language. You can interrupt me anytime by speaking while I'm responding.";
    addMessageToConversation(greeting, false);
    speakText(greeting, "en-US");
  }, 1000);
});

// Toggle recording
toggleRecordingBtn.addEventListener("click", async () => {
  if (isRecording) {
    await stopRecording();
  } else if (isSpeaking) {
    // Pause the speech
    synth.cancel();
    isSpeaking = false;
    toggleRecordingBtn.innerHTML =
      '<span class="mic-icon">🎤</span> Tap to speak';
    statusEl.textContent =
      "Speech paused. Tap to speak or wait for me to continue.";
  } else {
    await startRecording();
  }
});

// Start recording with auto-stop on silence and interruption detection
async function startRecording() {
  try {
    // If we're currently speaking, prepare to interrupt
    if (isSpeaking) {
      shouldInterrupt = true;
      synth.cancel();
    }

    isRecording = true;
    toggleRecordingBtn.innerHTML =
      '<span class="mic-icon pulse">🎤</span> Listening...';
    statusEl.textContent =
      "Listening... (I'll stop automatically when you finish speaking)";

    // Clear any previous recording
    audioChunks = [];

    // Get audio stream
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Set up audio context for silence and interruption detection
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);

    // Create processor for analyzing audio level
    processor = audioContext.createScriptProcessor(1024, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    // Analyze audio level for silence and interruption detection
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;

      for (let i = 0; i < input.length; i++) {
        sum += Math.abs(input[i]);
      }

      const average = sum / input.length;

      if (
        average > (isSpeaking ? INTERRUPTION_THRESHOLD : AUDIO_LEVEL_THRESHOLD)
      ) {
        lastSoundTime = Date.now();
        clearTimeout(silenceTimer);

        // If we're speaking and user starts talking, interrupt immediately
        if (isSpeaking && average > INTERRUPTION_THRESHOLD) {
          shouldInterrupt = true;
          synth.cancel();
          statusEl.textContent = "I heard you, please continue...";
        } else {
          silenceTimer = setTimeout(stopRecording, SILENCE_THRESHOLD);
        }
      }
    };

    // Set up media recorder
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0) {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        await processUserAudio(audioBlob);
      }
    };

    mediaRecorder.start(100); // Collect data every 100ms
  } catch (error) {
    console.error("Error starting recording:", error);
    statusEl.textContent = "Error: " + error.message;
    resetRecordingState();
  }
}

// Stop recording manually
async function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    clearTimeout(silenceTimer);
    mediaRecorder.stop();
    processor?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());

    statusEl.innerHTML =
      '<span class="thinking">Processing</span><div class="dot-flashing"></div>';
    toggleRecordingBtn.disabled = true;
  }
}

// Process recorded audio and get AI response
async function processUserAudio(audioBlob) {
  try {
    // Add user message placeholder
    addMessageToConversation("(Your question about Revolt Motors)", true);

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    if (conversationId) {
      formData.append("conversationId", conversationId);
    }

    const response = await fetch("/api/audio", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log("Received response:", data);

    if (data.text) {
      conversationId = data.conversationId;
      addMessageToConversation(data.text, false, data.language);

      // Speak the response with the detected language
      speakText(data.text, data.language);
    } else {
      throw new Error("No response from the assistant");
    }
  } catch (error) {
    console.error("Error processing audio:", error);
    statusEl.textContent = "Error: " + error.message;
  } finally {
    resetRecordingState();
  }
}

// Reset UI after recording/processing
function resetRecordingState() {
  isRecording = false;
  toggleRecordingBtn.disabled = false;

  // Update button based on whether we're speaking or not
  if (isSpeaking) {
    toggleRecordingBtn.innerHTML = '<span class="pause-icon">⏸</span> Pause';
  } else {
    toggleRecordingBtn.innerHTML =
      '<span class="mic-icon">🎤</span> Tap to speak';
  }

  if (!isSpeaking) {
    statusEl.textContent = "Ready for your next question";
  }
}

// Add message to conversation display
function addMessageToConversation(text, isUser, language) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${isUser ? "user-message" : "bot-message"}`;
  messageDiv.textContent = text;

  if (!isUser && language) {
    messageDiv.dataset.lang = language;
    const langIndicator = document.createElement("span");
    langIndicator.className = "language-indicator";
    langIndicator.textContent = `(${language})`;
    messageDiv.appendChild(langIndicator);
  }

  conversationEl.appendChild(messageDiv);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

// Load available voices
function loadVoices() {
  // Some browsers need this delay to load voices properly
  setTimeout(() => {
    const voices = synth.getVoices();
    console.log("Available voices:", voices);
    voicesLoaded = true;
  }, 1000);
}

// Speak text with proper language settings
function speakText(text, lang) {
  // Wait for voices to be loaded
  if (!voicesLoaded) {
    setTimeout(() => speakText(text, lang), 500);
    return;
  }

  // Cancel any ongoing speech
  synth.cancel();
  shouldInterrupt = false;

  // Create a new utterance
  utterance = new SpeechSynthesisUtterance(text);
  currentLanguage = lang || "en-US";
  utterance.lang = currentLanguage;

  // Configure voice
  const voices = synth.getVoices();
  let voice = voices.find((v) => v.lang === currentLanguage);

  if (!voice) {
    // Try to find a voice with just the language code (without country)
    const langCode = currentLanguage.split("-")[0];
    voice = voices.find((v) => v.lang.startsWith(langCode));
  }

  if (voice) {
    utterance.voice = voice;
    console.log("Using voice:", voice.name, "for language:", currentLanguage);
  } else {
    console.warn(
      "No suitable voice found for language:",
      currentLanguage,
      "using default"
    );
  }

  // Natural sounding speech
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Set speaking state and update UI
  isSpeaking = true;
  toggleRecordingBtn.innerHTML = '<span class="pause-icon">⏸</span> Pause';
  statusEl.textContent = "Speaking response... (you can interrupt by speaking)";

  // Event handlers for the utterance
  utterance.onstart = () => {
    isSpeaking = true;
  };

  utterance.onend = () => {
    isSpeaking = false;
    toggleRecordingBtn.innerHTML =
      '<span class="mic-icon">🎤</span> Tap to speak';
    if (!shouldInterrupt) {
      statusEl.textContent = "Ready for your next question";
    }
  };

  utterance.onerror = (event) => {
    console.error("Speech synthesis error:", event);
    isSpeaking = false;
    toggleRecordingBtn.innerHTML =
      '<span class="mic-icon">🎤</span> Tap to speak';
    if (!shouldInterrupt) {
      statusEl.textContent = "Error speaking response";
    }
  };

  // Speak the text
  synth.speak(utterance);
}

// Some browsers need this event to load voices
speechSynthesis.onvoiceschanged = loadVoices;
