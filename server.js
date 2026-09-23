import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Load the complete CBSE dataset
const catalogPath = join(__dirname, 'data', 'cbse.json');
let allChapters = [];

try {
  const fileContent = JSON.parse(readFileSync(catalogPath, 'utf-8'));
  allChapters = fileContent.CBSE || [];
} catch (error) {
  console.error('Failed to load data/cbse.json:', error);
}

// Root Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'smart-paper-textbook-api',
    totalChapters: allChapters.length
  });
});

// Helper to normalize grade level comparisons
function normalizeGrade(val) {
  if (!val) return '';
  const s = val.toString().trim().toLowerCase();
  if (s.includes('lkg') || s.includes('jr') || s.includes('junior')) return 'lkg';
  if (s.includes('ukg') || s.includes('sr') || s.includes('senior')) return 'ukg';
  return s.replace(/[^0-9]/g, '');
}

// Catalog Endpoint expected by Vite
app.get('/textbook-catalog', (req, res) => {
  const { board = 'CBSE', classLevel, subject } = req.query;

  let filtered = allChapters;

  if (classLevel) {
    const targetGrade = normalizeGrade(classLevel);
    filtered = filtered.filter(item => normalizeGrade(item.classLevel) === targetGrade);
  }

  if (subject) {
    const targetSub = subject.toString().trim().toLowerCase();
    filtered = filtered.filter(
      item => item.subject.trim().toLowerCase() === targetSub
    );
  }

  // Remove internal classLevel key to match QuestionPaper Studio specification
  const cleanedChapters = filtered.map(({ classLevel: _, ...rest }) => rest);

  res.json({
    board: board.toUpperCase(),
    updatedAt: new Date().toISOString(),
    chapters: cleanedChapters
  });
});

app.listen(PORT, () => {
  console.log(`Textbook API running on port ${PORT}`);
});