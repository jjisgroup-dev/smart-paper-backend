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

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json());

// Initialize Groq client
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || 'dummy_key',
  baseURL: 'https://api.groq.com/openai/v1',
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'smart-paper-backend' });
});

app.get('/health', (req, res) => {
  res.status(process.env.GROQ_API_KEY ? 200 : 503).json({
    status: process.env.GROQ_API_KEY ? 'ok' : 'missing GROQ_API_KEY',
  });
});

// Load syllabus
const catalogPath = join(__dirname, 'data', 'cbse.json');
let allChapters = [];
try {
  allChapters = JSON.parse(readFileSync(catalogPath, 'utf-8')).CBSE || [];
} catch (err) {
  console.warn('Could not load cbse.json, using empty catalog.');
}

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
    const { classLevel, subject, chapter, difficulty, examFormat, totalMarks = 25 } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'The AI service is not configured. Add GROQ_API_KEY in Render environment variables.' });
    }
    if (!classLevel || !subject || !examFormat) {
      return res.status(400).json({ error: 'classLevel, subject, and examFormat are required.' });
    }

    // Direct structured generation fallback
    const systemPrompt = `You are an expert CBSE teacher. Generate a balanced, authentic question paper adhering strictly to the NCERT curriculum. Return ONLY valid JSON with keys "title", "meta", and "questions" (each having "number", "text", "marks", "type", "options", "answer").`;
    const userPrompt = `Create a ${difficulty || 'medium'} difficulty question paper for Class ${classLevel || '8'}, Subject: ${subject || 'English'}, Topic: ${chapter || 'All Chapters'}, Exam: ${examFormat || 'Annual examination'}, Total Marks: ${totalMarks}.`;

    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || process.env.VITE_AI_MODEL || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Groq returned an empty response.');
    const jsonContent = content.match(/\{[\s\S]*\}/)?.[0] || content;
    const generated = JSON.parse(jsonContent);
    const parsedPaper = {
      id: generated.id || `ai-${Date.now()}`,
      title: generated.title || `${subject} - ${examFormat}`,
      class: classLevel,
      subject,
      examType: generated.examType || 'annual',
      difficulty: difficulty || 'medium',
      totalMarks: generated.totalMarks || totalMarks,
      duration: generated.duration || '3 Hours',
      instructions: generated.instructions || ['Read all questions carefully before answering.'],
      board: 'CBSE',
      questions: Array.isArray(generated.questions) ? generated.questions.map((question, index) => ({
        id: question.id || `ai-${Date.now()}-${index}`,
        question: question.question || question.text || '',
        answer: question.answer || '',
        options: question.options,
        marks: question.marks || 1,
        type: question.type || 'short',
        difficulty: question.difficulty || difficulty || 'medium',
        chapter: question.chapter || chapter || 'All Chapters',
        subject,
        classLevel,
        board: 'CBSE',
      })) : [],
    };
    if (parsedPaper.questions.length === 0) throw new Error('Groq returned a paper without questions.');
    res.json(parsedPaper);
  } catch (error) {
    console.error('Generation failed:', error);
    res.status(502).json({ error: 'Failed to generate paper', details: error instanceof Error ? error.message : 'Unknown AI service error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
