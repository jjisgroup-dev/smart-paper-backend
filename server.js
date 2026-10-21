import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { compileClass10BoardBlueprint, validateClass10BoardQuestions } from './paperBlueprint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Allowed origins for CORS (Hostinger production + local testing + Capacitor mobile app)
const allowedOrigins = [
  'https://smart-paper.astroapps.fun',
  'https://astroapps.fun',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_ORIGIN
].filter(Boolean);

// CORS configuration middleware
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// Explicit preflight handling
app.options('*', cors());

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
    const {
      classLevel,
      subject,
      chapter,
      chapters = [],
      difficulty,
      examFormat,
      format,
      aiEngine = 'paperclip-standard-ai',
      distribution = 'chapter-wise',
      totalMarks = 25,
      textbookContext = []
    } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'The AI service is not configured. Add GROQ_API_KEY in Render environment variables.' });
    }
    if (!classLevel || !subject || (!examFormat && !distribution)) {
      return res.status(400).json({ error: 'classLevel, subject, and examFormat/distribution are required.' });
    }

    // Direct structured generation with Engine-specific tuning
    const syllabus = Array.isArray(textbookContext) ? textbookContext : [];
    const activeChapters = Array.isArray(chapters) && chapters.length > 0 ? chapters.join(', ') : (chapter || 'Entire syllabus');

    const blueprint = compileClass10BoardBlueprint({ classLevel, examFormat, totalMarks });
    if (blueprint) {
      const matchesClass = (value) => String(value ?? '').replace(/[^0-9]/g, '') === '10';
      const localChapters = allChapters.filter((item) =>
        matchesClass(item.classLevel) && item.subject === subject && (!item.board || item.board === 'CBSE')
      );
      const suppliedChapters = syllabus.filter((item) =>
        item && item.subject === subject && matchesClass(item.classLevel) && (!item.board || item.board === 'CBSE')
      );
      const availableChapters = localChapters.length > 0 ? localChapters : suppliedChapters;
      const chapterScope = Array.isArray(chapters) && chapters.length > 0 ? chapters : (chapter ? [chapter] : []);
      const requestedNames = chapterScope
        .filter((name) => name && !/^entire syllabus$/i.test(String(name).trim()))
        .map(String);
      const retrievedChapters = availableChapters
        .filter((item) => requestedNames.length === 0 || requestedNames.includes(item.name))
        .map((item) => ({
          name: item.name,
          subject: item.subject,
          classLevel: '10',
          sections: Array.isArray(item.sections) ? item.sections : [],
          concepts: Array.isArray(item.concepts) ? item.concepts : [],
          learningOutcomes: Array.isArray(item.learningOutcomes) ? item.learningOutcomes : [],
        }));
      if (retrievedChapters.length === 0) {
        throw new Error(`No verified Class 10 ${subject} chapter metadata matched the requested scope.`);
      }

      const generatedSections = [];
      for (const section of blueprint.sections) {
        const sectionSystemPrompt = `You are writing only CBSE Class 10 ${subject} examination questions. Generate one section only and return a JSON object with "section" and "questions". Use exclusively the supplied Class 10 ${subject} chapter metadata. Do not introduce any other subject, class, chapter, or unsupported facts. Do not repeat or paraphrase another question within this section. Follow every requested slot exactly; do not change question counts, kinds, or marks. Every question must include "chapter", "type", "marks", "bloomLevel", and "stepWiseMarkingScheme" (an array of {"step","marks_allocated"} whose marks add up exactly to the question marks). For ordinary questions include "question" and "answer". For MCQs include exactly four "options" and "correctOption" (A-D). For assertion-reason questions include separate "assertion", "reason", and "correctOption" (A-D); do not produce a true/false question. For case studies include "question", "caseStudy", exactly four "subQuestions" each with "question", "marks":1 and "answer". Return valid JSON only.`;
        const slots = section.questions.map(({ questionNumber, type, questionKind, marks }) => ({
          questionNumber,
          type,
          questionKind,
          marks,
        }));
        const sectionPrompt = `Create Section ${section.section}: ${section.title} for Class 10 ${subject}, difficulty ${difficulty || 'medium'}. Produce exactly ${section.questions.length} questions matching these ordered slots: ${JSON.stringify(slots)}. Chapter scope: ${requestedNames.length ? requestedNames.join(', ') : 'all retrieved chapters'}. Class- and subject-filtered NCERT curriculum metadata: ${JSON.stringify(retrievedChapters)}. For assertion-reason questions use standard CBSE options in A-D order. Every case-study sub-question is worth one mark.`;
        const completion = await groq.chat.completions.create({
          model: process.env.GROQ_MODEL || process.env.VITE_AI_MODEL || 'openai/gpt-oss-20b',
          messages: [
            { role: 'system', content: sectionSystemPrompt },
            { role: 'user', content: sectionPrompt },
          ],
          max_completion_tokens: 8192,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) throw new Error(`The AI service returned an empty Section ${section.section}.`);
        const generatedSection = JSON.parse(content);
        if (generatedSection.section !== section.section || !Array.isArray(generatedSection.questions)
          || generatedSection.questions.length !== section.questions.length) {
          throw new Error(`The AI service returned an invalid Section ${section.section} structure.`);
        }
        generatedSections.push(generatedSection);
      }

      const verifiedQuestions = validateClass10BoardQuestions(generatedSections, blueprint, retrievedChapters, subject);
      return res.json({
        id: `cbse-${Date.now()}`,
        title: `${subject} - ${examFormat || 'Annual Board Examination'}`,
        class: '10',
        subject,
        examType: 'annual',
        difficulty: difficulty || 'medium',
        totalMarks: 80,
        duration: '3 Hours',
        instructions: [
          'This paper contains 38 questions across five compulsory sections.',
          'Section A: 20 questions × 1 mark (18 MCQs and 2 Assertion-Reason questions).',
          'Section B: 5 very short answer questions × 2 marks.',
          'Section C: 6 short answer questions × 3 marks.',
          'Section D: 4 long answer questions × 5 marks.',
          'Section E: 3 case-based questions × 4 marks.',
          'All questions are compulsory. Marks for each question are indicated.',
        ],
        board: 'CBSE',
        questions: verifiedQuestions,
      });
    }

    let engineInstruction = '';
    let targetDuration = '1-2 Hours';
    let targetTemperature = 0.3;

    if (aiEngine === 'smart-curriculum-ai') {
      engineInstruction = `Engine: SMART CURRICULUM AI. Emphasize Bloom's Taxonomy in question distribution: 30% Recall/Knowledge, 40% Application & Problem Solving, and 30% Higher Order Thinking Skills (HOTS) / Analytical synthesis. Tag or include challenging application scenarios appropriate to Class ${classLevel}.`;
      targetTemperature = 0.5;
    } else if (aiEngine === 'express-quick-ai') {
      engineInstruction = `Engine: EXPRESS QUICK AI. Generate a concise 15-30 minute diagnostic speed test. Questions should be crisp, high-yield conceptual checks that can be answered rapidly without long tedious derivations. Target duration: 25 Minutes.`;
      targetDuration = '25 Minutes';
      targetTemperature = 0.2;
    } else if (aiEngine === 'custom-pattern-ai') {
      const formatStr = format ? JSON.stringify(format) : 'Standard distribution';
      engineInstruction = `Engine: CUSTOM PATTERN AI. Strictly adhere to the requested blueprint question counts: ${formatStr}. Allocate sections and marks precisely matching this format.`;
      targetTemperature = 0.3;
    } else {
      // Default: paperclip-standard-ai
      engineInstruction = `Engine: PAPERCLIP STANDARD AI. Generate a balanced, standard curriculum-aligned test paper adhering to official NCERT/CBSE blueprint weightages and grading difficulty.`;
      targetTemperature = 0.3;
    }

    const systemPrompt = `You are an expert CBSE teacher and NCERT textbook specialist. Generate authentic, subject-specific questions for the requested class and subject.
${engineInstruction}
Use only the supplied NCERT chapter names, concepts, sections, and learning outcomes as grounding. Do not write generic study-skills questions, placeholders, or questions from another subject. Every question must test a concrete NCERT fact, concept, example, process, calculation, grammar point, or interpretation appropriate to the class. Every answer must directly and correctly answer its question.
Return ONLY valid JSON with keys "title", "questions", "instructions", "duration", and "totalMarks". Each question must have "question", "marks", "type" (one of "mcq", "short", "long", "fill-blank", "true-false"), "answer", and optionally "options" (for mcqs) and "chapter".`;

    const userPrompt = `Create a ${difficulty || 'medium'} difficulty question paper for Class ${classLevel}, Subject: ${subject}, Scope: ${activeChapters}, Distribution Mode: ${distribution}, Target Marks: ${totalMarks}.
${format ? `Target format breakdown: ${JSON.stringify(format)}.` : ''}
Include clear answers for every question and use exact subject terminology. NCERT syllabus grounding: ${JSON.stringify(syllabus)}`;

    const createCompletion = () => groq.chat.completions.create({
      model: process.env.GROQ_MODEL || process.env.VITE_AI_MODEL || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 4096,
      temperature: targetTemperature,
      response_format: { type: 'json_object' },
    });

    let completion = await createCompletion();
    let content = completion.choices[0]?.message?.content;
    if (!content) {
      completion = await createCompletion();
      content = completion.choices[0]?.message?.content;
    }
    if (!content) throw new Error('Groq returned an empty response.');
    const jsonContent = content.match(/\{[\s\S]*\}/)?.[0] || content;
    const generated = JSON.parse(jsonrepair(jsonContent));

    let parsedInstructions = [
      'Read all questions carefully before answering.',
      'Answer all questions in the provided answer booklet.',
      'Marks are indicated against each question.',
    ];
    if (Array.isArray(generated.instructions)) {
      parsedInstructions = generated.instructions.map(String).filter(Boolean);
    } else if (typeof generated.instructions === 'string' && generated.instructions.trim()) {
      const split = generated.instructions.split(/\n+|\.\s+/).map((s) => s.trim()).filter((s) => s.length > 2);
      parsedInstructions = split.length > 0 ? split : [generated.instructions.trim()];
    }

    const parsedPaper = {
      id: generated.id || `ai-${Date.now()}`,
      title: generated.title || `${subject} - ${examFormat || 'Examination'}`,
      class: classLevel,
      subject,
      examType: generated.examType || 'annual',
      difficulty: difficulty || 'medium',
      totalMarks: generated.totalMarks || totalMarks,
      duration: generated.duration || '3 Hours',
      instructions: parsedInstructions,
      board: 'CBSE',
      questions: Array.isArray(generated.questions) ? generated.questions.map((question, index) => {
        const rawType = String(question.type || '').toLowerCase().replace(/[\s_-]+/g, '');
        let type = 'short';
        if (rawType.includes('mcq') || rawType.includes('choice') || rawType.includes('objective')) {
          type = 'mcq';
        } else if (rawType.includes('fill') || rawType.includes('blank')) {
          type = 'fill-blank';
        } else if (rawType.includes('true') || rawType.includes('false')) {
          type = 'true-false';
        } else if (rawType.includes('long') || rawType.includes('essay')) {
          type = 'long';
        } else if (rawType.includes('match')) {
          type = 'match';
        } else {
          type = (Number(question.marks) || 1) >= 4 ? 'long' : 'short';
        }

        return {
          id: question.id || `ai-${Date.now()}-${index}`,
          question: question.question || question.text || '',
          answer: question.answer || '',
          options: Array.isArray(question.options) ? question.options.map(String) : undefined,
          marks: Number(question.marks) || (type === 'mcq' || type === 'fill-blank' ? 1 : type === 'long' ? 5 : 3),
          type,
          difficulty: question.difficulty || difficulty || 'medium',
          chapter: question.chapter || chapter || 'All Chapters',
          subject,
          classLevel,
          board: 'CBSE',
        };
      }) : [],
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