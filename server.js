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

// System instructions
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
3. Keep responses concise (1-2 sentences) for voice interaction
4. Maintain professional and helpful tone in all languages

If asked about other topics, politely respond that you specialize only in Revolt Motors.
`;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Route for the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Store conversation history
const conversationHistory = new Map();

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
              text: "Understood. I will provide concise information about Revolt Motors in the requested language.",
            },
          ],
        },
        ...history,
      ],
      generationConfig: {
        maxOutputTokens: 150,
      },
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
      language,
    });
  } catch (error) {
    console.error("Error processing audio:", error);
    res.status(500).json({
      error: "Error processing audio",
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
