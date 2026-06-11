const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EVAL_NOTES_MAX = 1200;
const EVAL_TRANSCRIPT_MAX = 4000;
const EVAL_CONCEPTS_MAX = 6;
const FAST_EVAL_MODEL = 'gpt-4o-mini';
const DEEP_EVAL_MODEL = 'gpt-5-mini';

const isTimeoutError = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return (
    error?.code === 'ECONNABORTED' ||
    error?.type === 'request-timeout' ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
};

async function callChatCompletion(payload, { timeoutMs = 45000, label = 'chat' } = {}) {
  const started = Date.now();
  try {
    const response = await openai.chat.completions.create(payload, { timeout: timeoutMs });
    console.log(`[AI] ${label} OK ${Date.now() - started}ms model=${payload.model}`);
    return response;
  } catch (error) {
    console.error(`[AI] ${label} FAIL ${Date.now() - started}ms model=${payload.model}: ${error.message}`);
    throw error;
  }
}

async function createChatCompletionWithRetry(payload, retries = 1, timeoutMs = 45000) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callChatCompletion(payload, {
        timeoutMs,
        label: `chat attempt ${attempt + 1}`,
      });
    } catch (error) {
      lastError = error;
      if (attempt === retries || isTimeoutError(error)) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function truncateForEval(text, max, suffix = '...[truncated]') {
  if (!text || text.length <= max) return text || '';
  return `${text.substring(0, max)}${suffix}`;
}

function isDeepEvaluation({ sessionMode, questionType, difficulty }) {
  return (
    sessionMode === 'interview' ||
    questionType === 'interview' ||
    (difficulty === 'hard' && questionType === 'interview')
  );
}

/**
 * Generate questions from topic notes
 */
const generateQuestions = async (title, notes, category) => {
  const prompt = `You are an expert computer science tutor creating practice questions for: "${title}" (Category: ${category}).

User Notes:
${notes}

Generate exactly 5 questions following this strict difficulty ladder:

Level 1 — Basic: A simple definition or factual question about the topic.
Level 2 — Conceptual: A question testing understanding of the core idea.
Level 3 — Scenario: A real-world application or scenario-based question.
Level 4 — Application: Where or how this concept is used in practice.
Level 5 — Interview: A system design or deeper reasoning question (interview-level).

Even if notes are limited, use your internal knowledge to generate high-quality questions for the topic.

Return ONLY a valid JSON object:
{
  "questions": [
    {
      "questionText": "The question text",
      "type": "concept" | "explanation" | "scenario" | "practical" | "interview",
      "difficulty": "easy" | "medium" | "hard",
      "difficultyLevel": 1 | 2 | 3 | 4 | 5,
      "expectedConcepts": ["key concept 1", "key concept 2"]
    }
  ]
}

Rules:
- Generate exactly 5 questions, one per level.
- Level 1-2 should have difficulty "easy", Level 3 "medium", Level 4-5 "hard".
- Level 5 should be an interview-style system design question.
- Return ONLY the JSON, no other text.`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in generateQuestions');
      return [];
    }
    
    console.log('--- AI RAW CONTENT STRING ---');
    console.log(content);

    const parsed = JSON.parse(content);
    console.log('--- AI PARSED OBJECT PARAMS ---');
    console.log(Object.keys(parsed));
    
    // Handle both array and object with array
    if (Array.isArray(parsed)) return parsed;
    if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
    
    // Try to find an array in the response
    const arrays = Object.values(parsed).filter(v => Array.isArray(v));
    if (arrays.length > 0) return arrays[0];
    
    return [];
  } catch (err) {
    console.error('❌ Question Generation Error:', err.message);
    return [];
  }
};

const COVERAGE_STATUSES = ['covered', 'partial', 'missing', 'contradicted'];

/**
 * Normalize raw AI evaluation JSON into a consistent shape for API/DB.
 */
const normalizeEvaluation = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return { score: 0, overallFeedback: 'Failed to evaluate answer. Please try again.' };
  }

  const incorrectStatements = [];
  const seen = new Set();

  const pushStatement = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const whatYouSaid = String(entry.whatYouSaid || entry.claim || '').trim();
    const issue = String(entry.issue || entry.whyWrong || '').trim();
    const correction = String(entry.correction || entry.correct || '').trim();
    if (!whatYouSaid && !issue && !correction) return;
    const key = `${whatYouSaid}|${issue}|${correction}`;
    if (seen.has(key)) return;
    seen.add(key);
    incorrectStatements.push({ whatYouSaid, issue, correction });
  };

  const statementSources = [
    raw.incorrectStatements,
    raw.incorrect_statements,
    raw.wrongStatements,
    raw.factualErrors,
    raw.errors,
  ];
  statementSources.forEach((arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      if (typeof item === 'string') {
        const text = String(item).trim();
        if (text) pushStatement({ whatYouSaid: text, issue: '', correction: '' });
      } else {
        pushStatement(item);
      }
    });
  });

  const incorrectConcepts = [];
  const legacyIncorrect = raw.incorrectConcepts || raw.incorrectPoints || raw.wrongPoints || [];
  if (Array.isArray(legacyIncorrect)) {
    legacyIncorrect.forEach((item) => {
      const text = String(item || '').trim();
      if (!text) return;
      incorrectConcepts.push(text);
      pushStatement({ whatYouSaid: text, issue: '', correction: '' });
    });
  }

  const conceptCoverage = [];
  if (Array.isArray(raw.conceptCoverage)) {
    raw.conceptCoverage.forEach((row) => {
      const concept = String(row?.concept || row?.name || '').trim();
      const status = String(row?.status || row?.state || '').toLowerCase();
      if (!concept || !COVERAGE_STATUSES.includes(status)) return;
      conceptCoverage.push({ concept, status });
    });
  }

  conceptCoverage
    .filter((row) => row.status === 'contradicted')
    .forEach((row) => {
      pushStatement({
        whatYouSaid: `Your explanation of "${row.concept}"`,
        issue: 'This core concept was contradicted or stated incorrectly in your answer.',
        correction: `Review the correct understanding of: ${row.concept}`,
      });
    });

  const derivedIncorrectConcepts =
    incorrectConcepts.length > 0
      ? incorrectConcepts.slice(0, 3)
      : incorrectStatements.slice(0, 3).map((s) => {
          const parts = [];
          if (s.whatYouSaid) parts.push(`You said: "${s.whatYouSaid}"`);
          if (s.issue) parts.push(s.issue);
          if (s.correction) parts.push(`Correct: ${s.correction}`);
          return parts.join(' — ');
        });

  const rawScore = Number(raw.score);
  const score = Number.isFinite(rawScore)
    ? Math.min(10, Math.max(0, Math.round(rawScore)))
    : 5;

  return {
    score,
    correctPoints: (raw.correctPoints || []).slice(0, 3).map(String),
    missingConcepts: (raw.missingConcepts || []).slice(0, 3).map(String),
    incorrectConcepts: derivedIncorrectConcepts,
    incorrectStatements: incorrectStatements.slice(0, 3),
    suggestions: (raw.suggestions || []).slice(0, 3).map(String),
    overallFeedback: String(raw.overallFeedback || ''),
    interviewFeedback: String(raw.interviewFeedback || ''),
    correctExplanation: String(raw.correctExplanation || ''),
    keyPoints: (raw.keyPoints || []).slice(0, 3).map(String),
    followUpQuestion: String(raw.followUpQuestion || ''),
    conceptCoverage: conceptCoverage.slice(0, 8),
  };
};

function buildEvaluationPrompt({
  questionText,
  userTranscript,
  expectedConcepts,
  topicTitle,
  difficulty,
  notes,
  deep,
}) {
  const concepts = (expectedConcepts || []).slice(0, EVAL_CONCEPTS_MAX);
  const conceptsBlock = concepts.length
    ? concepts.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(none listed)';

  const notesBlock = truncateForEval(notes, EVAL_NOTES_MAX) || '(use your knowledge of the topic)';
  const answerBlock = truncateForEval(userTranscript, EVAL_TRANSCRIPT_MAX);

  const jsonShape = `{
  "score": <number 1-10>,
  "correctPoints": ["max 2 items"],
  "incorrectStatements": [{ "whatYouSaid": "", "issue": "", "correction": "" }],
  "missingConcepts": ["max 2 items"],
  "suggestions": ["max 2 items"],
  "overallFeedback": "1-2 sentences",
  "interviewFeedback": ${deep ? '"1 sentence interviewer verdict"' : '""'},
  "correctExplanation": "2-3 sentences",
  "keyPoints": ["max 2 items"],
  "followUpQuestion": "one question",
  "conceptCoverage": [{ "concept": "from list", "status": "covered|partial|missing|contradicted" }]
}`;

  if (!deep) {
    return `Evaluate this ${difficulty} revision answer. Be concise.

Topic: ${topicTitle}
Notes (summary): ${notesBlock}
Question: "${questionText}"
Core concepts:
${conceptsBlock}
Answer: "${answerBlock}"

Rules: score 1-10; missingConcepts = omissions; incorrectStatements = wrong claims (use [] only if fully accurate); max 2 items per list; cap score at 6 if a core concept is contradicted.

Return ONLY JSON:
${jsonShape}`;
  }

  return `You are an expert computer science tutor evaluating an interview-level answer.

Topic: ${topicTitle}
Notes: ${notesBlock}
Question: "${questionText}"
Core concepts:
${conceptsBlock}
Answer: "${answerBlock}"
Difficulty: ${difficulty}

Rules:
- Scan for factual errors and misconceptions.
- missingConcepts = omissions; incorrectStatements = wrong claims.
- Max 3 items per list. interviewFeedback required.
- conceptCoverage: one entry per core concept.

Return ONLY JSON:
${jsonShape}`;
}

async function runEvaluationCompletion({ model, prompt, deep, timeoutMs, label }) {
  return callChatCompletion(
    {
      model,
      messages: [
        {
          role: 'system',
          content: deep
            ? 'You evaluate student answers strictly. Populate incorrectStatements for any factual error. JSON only.'
            : 'You evaluate revision answers quickly and fairly. Be concise. JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: deep ? 1100 : 750,
    },
    { timeoutMs, label }
  );
}

/**
 * Evaluate a user's answer against expected concepts.
 * Uses gpt-4o-mini for revision (fast); gpt-5-mini for interview/deep evaluation.
 */
const evaluateAnswer = async (
  questionText,
  userTranscript,
  expectedConcepts,
  topicTitle,
  difficulty = 'medium',
  notes = '',
  options = {}
) => {
  const evalStarted = Date.now();
  const { sessionMode = 'revision', questionType = 'concept' } = options;
  const deep = isDeepEvaluation({ sessionMode, questionType, difficulty });
  const prompt = buildEvaluationPrompt({
    questionText,
    userTranscript,
    expectedConcepts,
    topicTitle,
    difficulty,
    notes,
    deep,
  });

  const primaryModel = deep ? DEEP_EVAL_MODEL : FAST_EVAL_MODEL;
  const primaryTimeout = deep ? 35000 : 25000;
  const fallbackModel = FAST_EVAL_MODEL;
  const fallbackTimeout = 20000;

  const runAttempt = async (model, attemptPrompt, attemptDeep, timeoutMs, label) => {
    const response = await runEvaluationCompletion({
      model,
      prompt: attemptPrompt,
      deep: attemptDeep,
      timeoutMs,
      label,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response content');
    console.log(`[AI] evaluateAnswer total ${Date.now() - evalStarted}ms model=${model} deep=${attemptDeep}`);
    return normalizeEvaluation(JSON.parse(content));
  };

  try {
    return await runAttempt(primaryModel, prompt, deep, primaryTimeout, `evaluateAnswer primary (${primaryModel})`);
  } catch (primaryErr) {
    if (primaryModel === fallbackModel) {
      console.error(`❌ Answer Evaluation Error after ${Date.now() - evalStarted}ms:`, primaryErr.message);
      return normalizeEvaluation({ score: 5, overallFeedback: 'Partially analyzed. Technical connection issue.' });
    }

    console.warn(
      `[AI] evaluateAnswer primary failed (${isTimeoutError(primaryErr) ? 'timeout' : primaryErr.message}) — trying ${fallbackModel}`
    );

    try {
      const compactPrompt = buildEvaluationPrompt({
        questionText,
        userTranscript,
        expectedConcepts,
        topicTitle,
        difficulty,
        notes,
        deep: false,
      });
      return await runAttempt(
        fallbackModel,
        compactPrompt,
        false,
        fallbackTimeout,
        `evaluateAnswer fallback (${fallbackModel})`
      );
    } catch (fallbackErr) {
      console.error(`❌ Answer Evaluation Error after ${Date.now() - evalStarted}ms:`, fallbackErr.message);
      return normalizeEvaluation({ score: 5, overallFeedback: 'Partially analyzed. Technical connection issue.' });
    }
  }
};


/**
 * Generate a weekly learning insights report
 */
const generateInsights = async (userId, weeklyData) => {
  const prompt = `You are a learning analytics AI. Based on this week's learning data, generate personalized insights.

WEEKLY DATA:
- Total questions answered: ${weeklyData.totalAnswered}
- Average score: ${weeklyData.averageScore}/10
- Topics studied: ${weeklyData.topics.join(', ')}
- Strongest topic: ${weeklyData.strongestTopic} (${weeklyData.strongestScore}/10 avg)
- Weakest topic: ${weeklyData.weakestTopic} (${weeklyData.weakestScore}/10 avg)
- Study streak: ${weeklyData.streak} days

Generate insights in this JSON format:
{
  "summary": "2-3 sentence overview of the week",
  "strengths": ["strength 1", "strength 2"],
  "areasToImprove": ["area 1", "area 2", "area 3"],
  "recommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"],
  "motivationalMessage": "A personalized motivational message",
  "nextWeekFocus": ["topic or concept to focus on next week"]
}

Return ONLY the JSON object.`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in generateInsights');
      return { summary: 'No insights available right now.', strengths: [], areasToImprove: [] };
    }

    return JSON.parse(content);
  } catch (err) {
    console.error('❌ Insights Generation Error:', err.message);
    return { summary: 'Error analyzing weekly data.', strengths: [], areasToImprove: [] };
  }
};

/**
 * Analyze raw notes to suggest a title and category
 */
const analyzeNotes = async (notes) => {
  const prompt = `Analyze the following raw technical notes and suggest a title and category.
  
  CATEGORIES: [JavaScript, React, Node.js, SQL, MongoDB, CSS, HTML, System Design, Backend, Other]

  NOTES:
  ${notes.substring(0, 3000)}

  Return ONLY a valid JSON object:
  {
    "suggestedTitle": "Title",
    "suggestedCategory": "Category"
  }`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { suggestedTitle: 'New Topic', suggestedCategory: 'Other' };

    const parsed = JSON.parse(content);
    return {
      suggestedTitle: parsed.suggestedTitle || 'New Topic',
      suggestedCategory: parsed.suggestedCategory || 'Other',
    };
  } catch (error) {
    console.error('❌ Analyze Notes Error:', error.message);
    return { suggestedTitle: 'My New Topic', suggestedCategory: 'Other' };
  }
};

/**
 * Transcribe audio using OpenAI Whisper
 */
const transcribeAudio = async (audioBuffer, mimeType = 'audio/m4a') => {
  try {
    const { toFile } = require('openai');
    const response = await openai.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'recording.m4a'),
      model: 'whisper-1',
      language: 'en',  // Strictly enforce English — prevents Marathi/Hindi transcription
    });
    return response.text;
  } catch (error) {
    console.error('❌ Whisper Transcription Error:', error.message);
    throw new Error('Failed to transcribe audio.');
  }
};

module.exports = {
  generateQuestions,
  evaluateAnswer,
  normalizeEvaluation,
  generateInsights,
  analyzeNotes,
  transcribeAudio,
};
