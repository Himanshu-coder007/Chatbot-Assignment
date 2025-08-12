require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bodyParser = require("body-parser");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const upload = multer();
const port = process.env.PORT || 3000;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelName = "gemini-1.5-flash-latest";

// System instructions to focus on Revolt Motors
const SYSTEM_INSTRUCTIONS = `
You are an expert assistant specialized in Revolt Motors, the Indian electric motorcycle company. 
Your responses should be exclusively about Revolt Motors and its products. 

Key points to focus on:
- Revolt Motors is India's first AI-enabled electric motorcycle company
- Current models: RV400, RV300
- Battery specifications and range
- Charging options and infrastructure
- Pricing and variants
- Company history and vision
- Comparison with other electric two-wheelers in India
- Government incentives for electric vehicles in India

If asked about other topics, politely respond that you specialize only in Revolt Motors and can't discuss other subjects.
`;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static("public"));

// Route for the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
    console.log("Received audio file:", req.file);
    if (!req.file) {
      console.error("No audio file in request");
      return res.status(400).json({ error: "No audio file provided" });
    }

    const conversationId = req.body.conversationId || generateConversationId();
    const audioFile = req.file;

    console.log("Processing audio file:", {
      size: audioFile.size,
      mimeType: audioFile.mimetype,
      conversationId,
    });

    // Get conversation history or initialize
    const history = conversationHistory.get(conversationId) || [];

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: modelName });

    // Start chat with history and system instructions
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: SYSTEM_INSTRUCTIONS }],
        },
        {
          role: "model",
          parts: [
            {
              text: "Understood. I will focus exclusively on providing information about Revolt Motors, their electric motorcycles, and related topics.",
            },
          ],
        },
        ...history,
      ],
    });

    // Send message with audio
    const startTime = Date.now();
    const result = await chat.sendMessage([
      {
        inlineData: {
          mimeType: audioFile.mimetype,
          data: audioFile.buffer.toString("base64"),
        },
      },
    ]);
    const endTime = Date.now();

    console.log(`Response time: ${endTime - startTime}ms`);

    // Get response
    const response = await result.response;
    const text = response.text();

    // Update conversation history
    conversationHistory.set(conversationId, await chat.getHistory());

    // Send response
    res.json({
      conversationId,
      text,
      responseTime: endTime - startTime,
    });
  } catch (error) {
    console.error("Error processing audio:", error);
    res.status(500).json({
      error: "Error processing audio",
      details: error.message,
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

    const model = genAI.getGenerativeModel({ model: modelName });

    // Start chat with history and system instructions
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: SYSTEM_INSTRUCTIONS }],
        },
        {
          role: "model",
          parts: [
            {
              text: "Understood. I will focus exclusively on providing information about Revolt Motors, their electric motorcycles, and related topics.",
            },
          ],
        },
        ...history,
      ],
    });

    const startTime = Date.now();
    const result = await chat.sendMessage(text);
    const endTime = Date.now();

    console.log(`Response time: ${endTime - startTime}ms`);

    const response = await result.response;
    const responseText = response.text();

    conversationHistory.set(id, await chat.getHistory());

    res.json({
      conversationId: id,
      text: responseText,
      responseTime: endTime - startTime,
    });
  } catch (error) {
    console.error("Error processing text:", error);
    res.status(500).json({
      error: "Error processing text",
      details: error.message,
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
