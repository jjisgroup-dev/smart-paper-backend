import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so your Vite frontend can fetch data across domains
app.use(cors());
app.use(express.json());

// Load catalog database
const catalogPath = join(__dirname, 'data', 'cbse.json');
let rawData = {};
try {
  rawData = JSON.parse(readFileSync(catalogPath, 'utf-8'));
} catch (error) {
  console.error('Failed to read data/cbse.json:', error);
}

// Health check route
app.get('/', (req, res) => {
  res.json({ status: 'healthy', service: 'smart-paper-textbook-api' });
});

// Textbook Catalog Route matching README specifications
app.get('/textbook-catalog', (req, res) => {
  const { board = 'CBSE', classLevel, subject } = req.query;

  const boardKey = board.toUpperCase();
  const boardData = rawData[boardKey] || [];

  let filteredChapters = boardData;

  if (classLevel) {
    // Normalize format (handles "6", "Class 6", "Class VI", etc.)
    const normalizedClass = classLevel.toString().replace(/[^0-9]/g, '');
    filteredChapters = filteredChapters.filter((item) => {
      const itemClassNum = item.classLevel?.toString().replace(/[^0-9]/g, '');
      return itemClassNum === normalizedClass || item.classLevel === classLevel;
    });
  }

  if (subject) {
    filteredChapters = filteredChapters.filter(
      (item) => item.subject.toLowerCase() === subject.toString().toLowerCase()
    );
  }

  // Remove internal classLevel key before sending, matching exact expected response shape
  const cleanedChapters = filteredChapters.map(({ classLevel: _, ...rest }) => rest);

  res.json({
    board: boardKey,
    updatedAt: new Date().toISOString(),
    chapters: cleanedChapters
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});