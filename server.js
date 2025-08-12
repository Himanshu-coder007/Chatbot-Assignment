require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const upload = multer();
const port = process.env.PORT || 3000;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const modelName = "gemini-2.5-flash-preview-native-audio-dialog";
// For development/testing, you can switch to:
const modelName = "gemini-2.0-flash-live-001";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Route for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store conversation history
const conversationHistory = new Map();

// Generate unique ID for each conversation
function generateConversationId() {
  return Math.random().toString(36).substring(2, 15);
}

// Audio processing endpoint
app.post("/api/audio", upload.single("audio"), async (req, res) => {
  try {
     console.log("Received audio file:", req.file); // Log incoming file
     if (!req.file) {
       console.error("No audio file in request");
       return res.status(400).json({ error: "No audio file provided" });
     }

     const conversationId = req.body.conversationId || generateConversationId();
     const audioFile = req.file;

     console.log("Audio file details:", {
       size: audioFile.size,
       mimeType: audioFile.mimetype,
     });
    // Get conversation history or initialize
    const history = conversationHistory.get(conversationId) || [];

    // Convert audio file to the required format
    const audioData = {
      mimeType: audioFile.mimetype,
      data: audioFile.buffer.toString("base64"),
    };

    // Get the generative model
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "audio/mpeg",
      },
    });

    // Start chat with history
    const chat = model.startChat({
      history: history,
      enableMultimodal: true,
    });

    // Send message with audio
    const startTime = Date.now();
    const result = await chat.sendMessage([{ inlineData: audioData }]);
    const endTime = Date.now();

    console.log(`Response time: ${endTime - startTime}ms`);

    // Get response as audio
    const response = await result.response;
    const audioResponse = await response.audio();

    // Update conversation history
    conversationHistory.set(conversationId, await chat.getHistory());

    // Send response
    res.json({
      conversationId,
      audio: audioResponse,
      responseTime: endTime - startTime,
    });
  } catch (error) {
    console.error("Full error processing audio:", error);
    res.status(500).json({
      error: "Error processing audio",
      details: error.message,
      stack: error.stack, // Only for development!
    });
  }
});

// Text endpoint for testing
app.post("/api/text", async (req, res) => {
  try {
    const { text, conversationId } = req.body;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const id = conversationId || generateConversationId();
    const history = conversationHistory.get(id) || [];

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "audio/mpeg",
      },
    });

    const chat = model.startChat({
      history: history,
    });

    const startTime = Date.now();
    const result = await chat.sendMessage(text);
    const endTime = Date.now();

    console.log(`Response time: ${endTime - startTime}ms`);

    const response = await result.response;
    const audioResponse = await response.audio();

    conversationHistory.set(id, await chat.getHistory());

    res.json({
      conversationId: id,
      audio: audioResponse,
      responseTime: endTime - startTime,
    });
  } catch (error) {
    console.error("Error processing text:", error);
    res
      .status(500)
      .json({ error: "Error processing text", details: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
