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

// System instructions to focus on Revolt Motors with multilingual support
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

Important:
1. Respond in the same language the question is asked in
2. If the language cannot be determined, default to English
3. For technical specifications, you may include English terms in parentheses
4. Maintain professional and helpful tone in all languages

If asked about other topics, politely respond that you specialize only in Revolt Motors.
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
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const conversationId = req.body.conversationId || generateConversationId();
    const audioFile = req.file;

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
              text: "Understood. I will provide information about Revolt Motors in the requested language.",
            },
          ],
        },
        ...history,
      ],
    });

    // Send message with audio
    const result = await chat.sendMessage([
      {
        inlineData: {
          mimeType: audioFile.mimetype,
          data: audioFile.buffer.toString("base64"),
        },
      },
    ]);

    // Get response
    const response = await result.response;
    const text = response.text();

    // Detect language (simple check for Hindi)
    const isHindi = /[\u0900-\u097F]/.test(text);
    const language = isHindi ? "hi-IN" : "en-US";

    // Update conversation history
    conversationHistory.set(conversationId, await chat.getHistory());

    // Send response with language info
    res.json({
      conversationId,
      text,
      language, // Send detected language to frontend
    });
  } catch (error) {
    console.error("Error processing audio:", error);
    res.status(500).json({
      error: "Error processing audio",
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
              text: "Understood. I will provide information about Revolt Motors in the requested language.",
            },
          ],
        },
        ...history,
      ],
    });

    const result = await chat.sendMessage(text);
    const response = await result.response;
    const responseText = response.text();

    // Detect language
    const isHindi = /[\u0900-\u097F]/.test(responseText);
    const language = isHindi ? "hi-IN" : "en-US";

    conversationHistory.set(id, await chat.getHistory());

    res.json({
      conversationId: id,
      text: responseText,
      language,
    });
  } catch (error) {
    console.error("Error processing text:", error);
    res.status(500).json({
      error: "Error processing text",
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
