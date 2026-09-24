import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Initialize Groq client
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || 'dummy_key',
  baseURL: 'https://api.groq.com/openai/v1',
});

// Load syllabus catalog
const catalogPath = join(__dirname, 'data', 'cbse.json');
let allChapters = [];
try {
  allChapters = JSON.parse(readFileSync(catalogPath, 'utf-8')).CBSE || [];
} catch (err) {
  console.warn('Could not load cbse.json, using empty catalog.');
}

// Root Route
app.get('/', (req, res) => {
  res.json({ status: 'healthy', service: 'smart-paper-backend' });
});

// Textbook Catalog Endpoint
app.get('/textbook-catalog', (req, res) => {
  const { board = 'CBSE', classLevel, subject } = req.query;
  let filtered = allChapters;

  if (classLevel) {
    const raw = classLevel.toString().trim().toLowerCase();
    filtered = filtered.filter(item => 
      item.classLevel?.toString().trim().toLowerCase() === raw ||
      item.classLevel?.toString().replace(/[^0-9]/g, '') === raw.replace(/[^0-9]/g, '')
    );
  }

  if (subject) {
    const rawSub = subject.toString().trim().toLowerCase();
    filtered = filtered.filter(item => item.subject?.toLowerCase() === rawSub);
  }

  const cleaned = filtered.map(({ classLevel: _, ...rest }) => rest);
  res.json({
    board: board.toUpperCase(),
    updatedAt: new Date().toISOString(),
    chapters: cleaned
  });
});

// AI Generation Gateway Route - accepts all common endpoints used by Vite
app.post(['/api/generate-paper', '/v1/chat/completions', '/chat/completions'], async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY is missing on Render backend environment.' });
    }

    const { messages, classLevel, subject, chapter, difficulty, examFormat, totalMarks = 25 } = req.body;

    // Handle standard chat completions payload from client
    if (messages && Array.isArray(messages)) {
      const completion = await groq.chat.completions.create({
        model: process.env.VITE_AI_MODEL || 'llama-3.1-8b-instant',
        messages: messages,
        response_format: { type: 'json_object' }
      });
      return res.json(completion);
    }

    // Direct structured generation fallback
    const systemPrompt = `You are an expert CBSE teacher. Generate a balanced, authentic question paper adhering strictly to the NCERT curriculum. Return ONLY valid JSON with keys "title", "meta", and "questions" (each having "number", "text", "marks", "type", "options", "answer").`;
    const userPrompt = `Create a ${difficulty || 'medium'} difficulty question paper for Class ${classLevel || '8'}, Subject: ${subject || 'English'}, Topic: ${chapter || 'All Chapters'}, Exam: ${examFormat || 'Annual examination'}, Total Marks: ${totalMarks}.`;

    const completion = await groq.chat.completions.create({
      model: process.env.VITE_AI_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    return res.json(parsed);

  } catch (error) {
    console.error('Generation failure:', error);
    // Always return valid JSON so the frontend doesn't throw "Unexpected end of JSON"
    return res.status(500).json({
      error: 'Generation failed',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
