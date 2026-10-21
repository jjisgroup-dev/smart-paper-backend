export const CLASS_10_BOARD_BLUEPRINT = [
  {
    section: 'A',
    title: 'Multiple Choice and Assertion-Reason Questions',
    questions: [
      ...Array.from({ length: 18 }, () => ({ type: 'mcq', questionKind: 'multiple-choice', marks: 1 })),
      ...Array.from({ length: 2 }, () => ({ type: 'mcq', questionKind: 'assertion-reason', marks: 1 })),
    ],
  },
  {
    section: 'B',
    title: 'Very Short Answer Questions',
    questions: Array.from({ length: 5 }, () => ({ type: 'short', questionKind: 'short-answer', marks: 2 })),
  },
  {
    section: 'C',
    title: 'Short Answer Questions',
    questions: Array.from({ length: 6 }, () => ({ type: 'short', questionKind: 'short-answer', marks: 3 })),
  },
  {
    section: 'D',
    title: 'Long Answer Questions',
    questions: Array.from({ length: 4 }, () => ({ type: 'long', questionKind: 'long-answer', marks: 5 })),
  },
  {
    section: 'E',
    title: 'Case-Based Questions',
    questions: Array.from({ length: 3 }, () => ({ type: 'short', questionKind: 'case-study', marks: 4 })),
  },
];

export const compileClass10BoardBlueprint = ({ classLevel, examFormat, totalMarks }) => {
  const isAnnual = /annual|final|board|pre.?board|half.?yearly/i.test(String(examFormat || ''));
  if (String(classLevel) !== '10' || Number(totalMarks) !== 80 || !isAnnual) return null;

  let questionNumber = 1;
  const sections = CLASS_10_BOARD_BLUEPRINT.map((section) => ({
    ...section,
    questions: section.questions.map((question) => ({
      ...question,
      section: section.section,
      questionNumber: questionNumber++,
    })),
  }));

  return {
    sections,
    questionCount: questionNumber - 1,
    totalMarks: sections.flatMap((section) => section.questions).reduce((sum, question) => sum + question.marks, 0),
  };
};

const assertionReasonOptions = [
  'Both Assertion (A) and Reason (R) are true, and R is the correct explanation of A.',
  'Both Assertion (A) and Reason (R) are true, but R is not the correct explanation of A.',
  'Assertion (A) is true, but Reason (R) is false.',
  'Assertion (A) is false, but Reason (R) is true.',
];

const similarityStopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'case', 'correct', 'determine',
  'explain', 'find', 'for', 'from', 'given', 'how', 'in', 'is', 'it', 'of', 'on', 'or',
  'question', 'read', 'the', 'then', 'this', 'to', 'use', 'using', 'value', 'what', 'which',
  'with', 'write',
]);

const tokenize = (text) => String(text || '')
  .toLowerCase()
  .match(/[\p{L}\p{N}]+/gu)
  ?.filter((token) => !similarityStopWords.has(token)) || [];

const cosineSimilarity = (left, right) => {
  const leftCounts = new Map();
  const rightCounts = new Map();
  tokenize(left).forEach((token) => leftCounts.set(token, (leftCounts.get(token) || 0) + 1));
  tokenize(right).forEach((token) => rightCounts.set(token, (rightCounts.get(token) || 0) + 1));
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const count of leftCounts.values()) leftNorm += count * count;
  for (const count of rightCounts.values()) rightNorm += count * count;
  for (const [token, count] of leftCounts) dot += count * (rightCounts.get(token) || 0);
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
};

const subjectLeakTerms = {
  Mathematics: /\b(?:giuseppe\s+mazzini|dandi\s+march|dandi\s+march|salt\s+march|belgian\s+linguistic\s+communities|linguistic\s+communities|civil\s+disobedience\s+movement)\b/i,
};

const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
};

const validateMarkingScheme = (steps, marks, label) => {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error(`${label} must include a step-wise marking scheme.`);
  const total = steps.reduce((sum, step) => {
    if (typeof step.step !== 'string' || !step.step.trim() || !Number.isFinite(step.marks_allocated) || step.marks_allocated <= 0) {
      throw new Error(`${label} has an invalid marking-scheme step.`);
    }
    return sum + step.marks_allocated;
  }, 0);
  if (Math.abs(total - marks) > 0.001) throw new Error(`${label} marking-scheme marks must add up to ${marks}.`);
  return steps;
};

const normalizeQuestion = (candidate, slot, allowedChapters, subject) => {
  const label = `Question ${slot.questionNumber}`;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`${label} is invalid.`);
  const chapter = requireText(candidate.chapter, `${label} chapter`);
  if (!allowedChapters.has(chapter)) throw new Error(`${label} uses a chapter outside the requested ${subject} syllabus: ${chapter}.`);

  const question = {
    id: `cbse-10-${slot.questionNumber}`,
    questionNumber: slot.questionNumber,
    section: slot.section,
    questionKind: slot.questionKind,
    type: slot.type,
    marks: slot.marks,
    chapter,
    bloomLevel: requireText(candidate.bloomLevel, `${label} Bloom level`),
    difficulty: 'medium',
    subject,
    classLevel: '10',
    board: 'CBSE',
  };

  if (candidate.type !== slot.type || Number(candidate.marks) !== slot.marks) {
    throw new Error(`${label} does not match its precompiled type and mark allocation.`);
  }

  if (slot.questionKind === 'assertion-reason') {
    question.assertion = requireText(candidate.assertion, `${label} assertion`);
    question.reason = requireText(candidate.reason, `${label} reason`);
    question.question = `Assertion (A): ${question.assertion}\nReason (R): ${question.reason}`;
    question.options = assertionReasonOptions;
    if (!/^[A-D]$/.test(candidate.correctOption || '')) throw new Error(`${label} must specify a correct option from A to D.`);
    question.correctOption = candidate.correctOption;
    question.answer = assertionReasonOptions[candidate.correctOption.charCodeAt(0) - 65];
  } else if (slot.section === 'A') {
    question.question = requireText(candidate.question, `${label} text`);
    if (!Array.isArray(candidate.options) || candidate.options.length !== 4 || candidate.options.some((option) => typeof option !== 'string' || !option.trim())) {
      throw new Error(`${label} must have exactly four non-empty options.`);
    }
    if (!/^[A-D]$/.test(candidate.correctOption || '')) throw new Error(`${label} must specify a correct option from A to D.`);
    question.options = candidate.options.map((option) => option.trim());
    question.correctOption = candidate.correctOption;
    question.answer = question.options[candidate.correctOption.charCodeAt(0) - 65];
  } else if (slot.questionKind === 'case-study') {
    question.question = requireText(candidate.question, `${label} instruction`);
    question.caseStudy = requireText(candidate.caseStudy, `${label} passage`);
    if (!Array.isArray(candidate.subQuestions) || candidate.subQuestions.length !== 4) {
      throw new Error(`${label} must contain four case-study sub-questions.`);
    }
    question.subQuestions = candidate.subQuestions.map((part, index) => {
      if (Number(part.marks) !== 1) throw new Error(`${label} sub-question ${index + 1} must be worth 1 mark.`);
      return {
        question: requireText(part.question, `${label} sub-question ${index + 1}`),
        marks: 1,
        answer: requireText(part.answer, `${label} sub-question ${index + 1} answer`),
      };
    });
    question.answer = question.subQuestions.map((part, index) => `${index + 1}. ${part.answer}`).join('\n');
  } else {
    question.question = requireText(candidate.question, `${label} text`);
    question.answer = requireText(candidate.answer, `${label} answer`);
  }

  question.stepWiseMarkingScheme = validateMarkingScheme(candidate.stepWiseMarkingScheme, slot.marks, label);
  if (subjectLeakTerms[subject]?.test(`${question.question} ${question.caseStudy || ''} ${question.answer}`)) {
    throw new Error(`${label} contains content associated with a different subject.`);
  }
  return question;
};

export const validateClass10BoardQuestions = (generatedSections, blueprint, chapters, subject) => {
  if (!Array.isArray(generatedSections) || generatedSections.length !== blueprint.sections.length) {
    throw new Error('The generated paper is missing one or more required sections.');
  }
  const allowedChapters = new Set(chapters.map((chapter) => chapter.name));
  if (allowedChapters.size === 0) throw new Error(`No verified ${subject} chapter metadata was available for generation.`);

  const questions = [];
  for (const [sectionIndex, expectedSection] of blueprint.sections.entries()) {
    const generatedSection = generatedSections[sectionIndex];
    if (generatedSection?.section !== expectedSection.section || !Array.isArray(generatedSection.questions)
      || generatedSection.questions.length !== expectedSection.questions.length) {
      throw new Error(`Section ${expectedSection.section} does not match the required CBSE question count.`);
    }
    expectedSection.questions.forEach((slot, questionIndex) => {
      questions.push(normalizeQuestion(generatedSection.questions[questionIndex], slot, allowedChapters, subject));
    });
  }

  for (let left = 0; left < questions.length; left += 1) {
    for (let right = left + 1; right < questions.length; right += 1) {
      const leftText = `${questions[left].question} ${questions[left].caseStudy || ''} ${(questions[left].subQuestions || []).map((part) => part.question).join(' ')}`;
      const rightText = `${questions[right].question} ${questions[right].caseStudy || ''} ${(questions[right].subQuestions || []).map((part) => part.question).join(' ')}`;
      if (cosineSimilarity(leftText, rightText) > 0.82) {
        throw new Error(`Questions ${questions[left].questionNumber} and ${questions[right].questionNumber} are too similar.`);
      }
    }
  }

  const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  if (questions.length !== 38 || totalMarks !== 80) throw new Error('The generated paper does not total 38 questions and 80 marks.');
  return questions;
};
