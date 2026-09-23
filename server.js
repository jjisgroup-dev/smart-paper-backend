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

// Initialize Groq via OpenAI client compatibility with crash prevention
const groqApiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || 'placeholder_key_to_prevent_startup_crash';

const groq = new OpenAI({
  apiKey: groqApiKey,
  baseURL: 'https://api.groq.com/openai/v1',
});
// Load syllabus
const catalogPath = join(__dirname, 'data', 'cbse.json');
let allChapters = [];
try {
  allChapters = JSON.parse(readFileSync(catalogPath, 'utf-8')).CBSE || [];
} catch (e) {
  console.error(e);
}

// 1. Textbook Catalog Endpoint
app.get('/textbook-catalog', (req, res) => {
  const { board = 'CBSE', classLevel, subject } = req.query;
  let filtered = allChapters;
  if (classLevel) {
    const cleanLvl = classLevel.toString().replace(/[^0-9]/g, '');
    filtered = filtered.filter(c => c.classLevel?.toString().replace(/[^0-9]/g, '') === cleanLvl);
  }
  if (subject) {
    filtered = filtered.filter(c => c.subject?.toLowerCase() === subject.toString().toLowerCase());
  }
  const chapters = filtered.map(({ classLevel: _, ...rest }) => rest);
  res.json({ board: board.toUpperCase(), updatedAt: new Date().toISOString(), chapters });
});

// 2. AI Question Paper Generation Gateway
app.post('/api/generate-paper', async (req, res) => {
  try {
    const { classLevel, subject, chapter, difficulty, examFormat, totalMarks = 25 } = req.body;

    const systemPrompt = `You are an expert CBSE school teacher. Generate a balanced, authentic question paper adhering strictly to the NCERT curriculum. Return ONLY valid raw JSON matching this schema:
    {
      "title": "${subject} - ${examFormat}",
      "meta": "Class ${classLevel} ${subject} • ${totalMarks} Marks",
      "questions": [
        {
          "number": 1,
          "text": "Question text here?",
          "marks": 1,
          "type": "mcq",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "answer": "Option A"
        },
        {
          "number": 2,
          "text": "Short descriptive question?",
          "marks": 2,
          "type": "short",
          "answer": "Model answer points here."
        }
      ]
    }`;

    const userPrompt = `Create a ${difficulty || 'medium'} difficulty question paper for Class ${classLevel}, Subject: ${subject}, Topic/Chapter: ${chapter || 'All Chapters'}. Total Marks: ${totalMarks}. Ensure real subject content, authentic questions, and accurate answers.`;

    const completion = await groq.chat.completions.create({
      model: process.env.VITE_AI_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    const parsedPaper = JSON.parse(completion.choices[0].message.content);
    res.json(parsedPaper);
  } catch (error) {
    console.error('Generation failed:', error);
    res.status(500).json({ error: 'Failed to generate paper', details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
