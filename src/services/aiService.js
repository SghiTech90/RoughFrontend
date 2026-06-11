const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EVAL_FAST_MODEL = process.env.EVAL_FAST_MODEL || 'gpt-4o-mini';
const EVAL_DEEP_MODEL = process.env.EVAL_DEEP_MODEL || 'gpt-5-mini';
const NOTES_CONTEXT_LIMIT = 1000;
const TRANSCRIPT_LIMIT = 2500;

const isTimeoutError = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'ECONNABORTED' || msg.includes('timeout') || msg.includes('timed out');
};

const truncateText = (text, limit, suffix = '…') => {
  const value = String(text || '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - suffix.length)}${suffix}`;
};

async function createChatCompletionWithRetry(payload, options = {}) {
  const {
    retries = 1,
    retryOnTimeout = true,
    timeoutMs = 45000,
    label = 'chat',
  } = typeof options === 'number' ? { retries: options } : options;

  let lastError;
  const maxAttempts = retries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptStart = Date.now();
    try {
      const response = await openai.chat.completions.create(payload, { timeout: timeoutMs });
      const elapsed = Date.now() - attemptStart;
      console.log(`[AI] ${label} attempt ${attempt + 1}/${maxAttempts} ok in ${elapsed}ms (model=${payload.model})`);
      return response;
    } catch (error) {
      lastError = error;
      const elapsed = Date.now() - attemptStart;
      console.warn(
        `[AI] ${label} attempt ${attempt + 1}/${maxAttempts} failed in ${elapsed}ms:`,
        error.message
      );
      if (attempt === retries) break;
      if (!retryOnTimeout && isTimeoutError(error)) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
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

const buildEvaluationPrompt = ({
  questionText,
  userTranscript,
  expectedConcepts,
  topicTitle,
  difficulty,
  notes,
  isDeepEval,
}) => {
  const difficultyContext = {
    easy: 'Beginner-level — do not expect advanced details.',
    medium: 'Intermediate — expect core concepts, not every edge case.',
    hard: 'Advanced — expect solid depth on main concepts.',
  }[difficulty] || '';

  const concepts = (expectedConcepts || []).slice(0, 6);
  const notesSnippet = truncateText(notes, NOTES_CONTEXT_LIMIT) || '(Use your knowledge of the topic)';
  const answerSnippet = truncateText(userTranscript, TRANSCRIPT_LIMIT);

  const jsonShape = `{
  "score": <1-10>,
  "correctPoints": ["max 3"],
  "incorrectStatements": [{ "whatYouSaid": "", "issue": "", "correction": "" }],
  "missingConcepts": ["max 3"],
  "suggestions": ["max 3"],
  "overallFeedback": "1-2 sentences",
  "interviewFeedback": "${isDeepEval ? '1 sentence verdict' : '""'}",
  "correctExplanation": "2-3 sentences",
  "keyPoints": ["max 3"],
  "followUpQuestion": "one question",
  "conceptCoverage": [{ "concept": "from list", "status": "covered|partial|missing|contradicted" }]
}`;

  return `Evaluate this CS revision answer. Return ONLY valid JSON matching the schema.

Topic: ${topicTitle}
Notes (excerpt): ${notesSnippet}
Question: "${questionText}"
Core concepts: ${concepts.map((c, i) => `${i + 1}. ${c}`).join(' ')}
Difficulty: ${difficulty}. ${difficultyContext}
Answer: "${answerSnippet}"

Rules:
- missingConcepts = omissions only; incorrectStatements = wrong/misleading claims only.
- Max 3 items per array. Keep strings concise.
- If score ≤ 6, include ≥1 incorrectStatements unless every claim is accurate.
- Cap score at 6 if a core concept is contradicted.
- conceptCoverage: one entry per core concept listed.

${jsonShape}`;
};

/**
 * Evaluate a user's answer against expected concepts.
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
  const { questionType = 'concept', difficultyLevel = null } = options;
  const evalStart = Date.now();

  const isDeepEval =
    difficulty === 'hard' ||
    questionType === 'interview' ||
    (typeof difficultyLevel === 'number' && difficultyLevel >= 5);

  const model = isDeepEval ? EVAL_DEEP_MODEL : EVAL_FAST_MODEL;
  const prompt = buildEvaluationPrompt({
    questionText,
    userTranscript,
    expectedConcepts,
    topicTitle,
    difficulty,
    notes,
    isDeepEval,
  });

  const requestPayload = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a concise CS tutor. Return compact JSON only. Be strict on factual errors.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: isDeepEval ? 1400 : 900,
  };

  try {
    const response = await createChatCompletionWithRetry(requestPayload, {
      retries: 0,
      retryOnTimeout: false,
      timeoutMs: isDeepEval ? 40000 : 25000,
      label: `evaluateAnswer:${isDeepEval ? 'deep' : 'fast'}`,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[evaluateAnswer] empty AI content');
      return normalizeEvaluation({ score: 0, overallFeedback: 'Failed to evaluate answer. Please try again.' });
    }

    const result = normalizeEvaluation(JSON.parse(content));
    console.log(
      `[evaluateAnswer] done in ${Date.now() - evalStart}ms model=${model} deep=${isDeepEval} score=${result.score}`
    );
    return result;
  } catch (err) {
    console.error(`[evaluateAnswer] failed in ${Date.now() - evalStart}ms:`, err.message);

    // One fast fallback if the primary deep model stalls
    if (isDeepEval && model !== EVAL_FAST_MODEL) {
      try {
        console.log('[evaluateAnswer] retrying with fast model fallback');
        const fallbackStart = Date.now();
        const fallback = await createChatCompletionWithRetry(
          { ...requestPayload, model: EVAL_FAST_MODEL, max_tokens: 900 },
          { retries: 0, retryOnTimeout: false, timeoutMs: 25000, label: 'evaluateAnswer:fallback' }
        );
        const content = fallback.choices[0]?.message?.content;
        if (content) {
          const result = normalizeEvaluation(JSON.parse(content));
          console.log(`[evaluateAnswer] fallback ok in ${Date.now() - fallbackStart}ms score=${result.score}`);
          return result;
        }
      } catch (fallbackErr) {
        console.error('[evaluateAnswer] fallback failed:', fallbackErr.message);
      }
    }

    return normalizeEvaluation({ score: 5, overallFeedback: 'Partially analyzed. Technical connection issue.' });
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
