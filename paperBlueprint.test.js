import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileClass10BoardBlueprint,
  validateClass10BoardQuestions,
} from './paperBlueprint.js';

const makePaperSections = (blueprint) => blueprint.sections.map((section) => ({
  section: section.section,
  questions: section.questions.map((slot) => {
    const question = {
      type: slot.type,
      marks: slot.marks,
      chapter: 'Real Numbers',
      bloomLevel: 'Applying',
      stepWiseMarkingScheme: [{ step: 'Award credit for the correct response', marks_allocated: slot.marks }],
    };
    if (slot.questionKind === 'assertion-reason') {
      question.assertion = `Assertioninteger${slot.questionNumber} primepower${slot.questionNumber} rational${slot.questionNumber}`;
      question.reason = `Reasonfactor${slot.questionNumber} divisibility${slot.questionNumber} quotient${slot.questionNumber}`;
      question.correctOption = 'A';
    } else if (slot.section === 'A') {
      question.question = `Compute integer${slot.questionNumber} primepower${slot.questionNumber} rational${slot.questionNumber}`;
      question.options = ['12', '15', '18', '21'];
      question.correctOption = 'A';
    } else if (slot.questionKind === 'case-study') {
      question.question = `Analyze context${slot.questionNumber} geometricratio${slot.questionNumber}`;
      question.caseStudy = `Scenario${slot.questionNumber} has distinct quantities pattern${slot.questionNumber} ratio${slot.questionNumber} observation${slot.questionNumber}.`;
      question.subQuestions = Array.from({ length: 4 }, (_, index) => ({
        question: `Calculate term${slot.questionNumber}${index + 1} difference${slot.questionNumber}${index + 1}`,
        marks: 1,
        answer: `Result${slot.questionNumber}${index + 1}`,
      }));
    } else {
      question.question = `Solve algebra${slot.questionNumber} polynomial${slot.questionNumber} coefficient${slot.questionNumber} discriminant${slot.questionNumber}`;
      question.answer = `The result is ${slot.questionNumber}`;
    }
    return question;
  }),
}));

test('compiles the 38-question, 80-mark Class 10 annual blueprint', () => {
  const blueprint = compileClass10BoardBlueprint({
    classLevel: '10',
    examFormat: 'Annual examination',
    totalMarks: 80,
  });
  assert.equal(blueprint.questionCount, 38);
  assert.equal(blueprint.totalMarks, 80);
  assert.deepEqual(blueprint.sections.map(({ section, questions }) => [section, questions.length]), [
    ['A', 20], ['B', 5], ['C', 6], ['D', 4], ['E', 3],
  ]);
  assert.equal(blueprint.sections[0].questions.filter((question) => question.questionKind === 'multiple-choice').length, 18);
  assert.equal(blueprint.sections[0].questions.filter((question) => question.questionKind === 'assertion-reason').length, 2);
});

test('does not impose the board blueprint on non-annual or non-Class-10 requests', () => {
  assert.equal(compileClass10BoardBlueprint({ classLevel: '9', examFormat: 'Annual examination', totalMarks: 80 }), null);
  assert.equal(compileClass10BoardBlueprint({ classLevel: '10', examFormat: 'Unit test', totalMarks: 20 }), null);
});

test('validates every generated question against its deterministic slot', () => {
  const blueprint = compileClass10BoardBlueprint({
    classLevel: '10',
    examFormat: 'Annual examination',
    totalMarks: 80,
  });
  const questions = validateClass10BoardQuestions(
    makePaperSections(blueprint),
    blueprint,
    [{ name: 'Real Numbers' }],
    'Mathematics',
  );
  assert.equal(questions.length, 38);
  assert.equal(questions.reduce((sum, question) => sum + question.marks, 0), 80);
  assert.equal(questions[18].questionKind, 'assertion-reason');
  assert.equal(questions[35].subQuestions.length, 4);
});

test('rejects duplicate, cross-subject, and invalid mark allocations', () => {
  const blueprint = compileClass10BoardBlueprint({
    classLevel: '10',
    examFormat: 'Annual examination',
    totalMarks: 80,
  });
  const duplicate = makePaperSections(blueprint);
  duplicate[0].questions[1].question = duplicate[0].questions[0].question;
  assert.throws(
    () => validateClass10BoardQuestions(duplicate, blueprint, [{ name: 'Real Numbers' }], 'Mathematics'),
    /too similar/,
  );

  const crossSubject = makePaperSections(blueprint);
  crossSubject[0].questions[0].question = 'Explain Giuseppe Mazzini and the Dandi March.';
  assert.throws(
    () => validateClass10BoardQuestions(crossSubject, blueprint, [{ name: 'Real Numbers' }], 'Mathematics'),
    /different subject/,
  );

  const invalidMarks = makePaperSections(blueprint);
  invalidMarks[0].questions[0].marks = 4;
  assert.throws(
    () => validateClass10BoardQuestions(invalidMarks, blueprint, [{ name: 'Real Numbers' }], 'Mathematics'),
    /precompiled type and mark allocation/,
  );
});
