const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate questions from topic notes
 */
const generateQuestions = async (title, notes, category) => {
  const prompt = `You are an expert technical educator creating practice questions for: "${title}" (Category: ${category}).
  
  The notes provided below are likely structured with headers, bullet points, and fragments (common in Notion or Obsidian). Your task is to extract the core technical concepts, even if they're concise.

  NOTES:
  ${notes}

  Based on these notes, generate 8 diverse practice questions. Include a mix of:
  - Deep concept definitions (e.g., "What is the primary role of X?")
  - Architectural "How-it-works" (e.g., "Explain how Y interacts with Z")
  - Challenging scenarios (e.g., "If condition W arises, how would you handle it?")
  - Practical technical logic (e.g., "What is the result of using pattern V in this context?")

  Return a JSON object with a "questions" array containing exactly this structure:
  {
    "questions": [
      {
        "questionText": "The question text",
        "type": "concept" | "explanation" | "scenario" | "practical",
        "difficulty": "easy" | "medium" | "hard",
        "expectedConcepts": ["concept1", "concept2", "concept3"]
      }
    ]
  }

  Rules:
  - Generate exactly 8 questions.
  - Cover the breadth of all key technical points in the notes.
  - Make questions interesting and technically deep.
  - Expected concepts are the key terms or mechanisms a correct answer MUST include.
  - Return ONLY the JSON object, no other text.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5-mini', // Fast & smart for structured generation
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

/**
 * Evaluate a user's answer against expected concepts (Interview Mode)
 * @param {string} questionText - The question asked
 * @param {string} userTranscript - The candidate's spoken answer
 * @param {string[]} expectedConcepts - Core concepts the question is about
 * @param {string} topicTitle - Topic name (e.g., "HTML", "React")
 * @param {string} difficulty - "easy" | "medium" | "hard"
 */
const evaluateAnswer = async (questionText, userTranscript, expectedConcepts, topicTitle, difficulty = 'medium') => {
  const difficultyContext = {
    easy: 'This is a beginner-level question. Evaluate accordingly — do not expect advanced or optional details.',
    medium: 'This is an intermediate-level question. Expect core concept coverage without requiring advanced edge cases.',
    hard: 'This is an advanced question. Expect the candidate to cover the main concepts with some depth.',
  }[difficulty] || '';

  const prompt = `You are a senior technical interviewer evaluating a job candidate's answer during a real tech interview.

TOPIC: ${topicTitle}
DIFFICULTY: ${difficulty}
QUESTION: "${questionText}"

CORE CONCEPTS (the answer should mention these — do NOT require all of them for a good score):
${expectedConcepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CANDIDATE'S ANSWER:
"${userTranscript}"

IMPORTANT INSTRUCTIONS:
- ${difficultyContext}
- You are NOT a documentation generator. Do NOT list every possible attribute, property, or edge case.
- A concise, correct answer that covers the main concepts deserves a 7–9 score.
- Only flag something as "missing" if it is CORE to a correct interview answer — not optional/advanced details.
- MAXIMUM 3 items in missingConcepts. Pick only the most important ones.
- MAXIMUM 3 items in suggestions. Keep them brief and actionable.
- correctPoints should highlight what the candidate got RIGHT — be generous and specific.
- interviewFeedback is a short, human interviewer-style comment (1-2 sentences, e.g. "Good concise answer. You could briefly mention X next time.").
- Do NOT penalize for not mentioning optional/security/performance/advanced attributes unless the question specifically asks for them.
- If the candidate's answer is correct and covers the key idea, score it 7 or above.

Evaluate and return ONLY this exact JSON structure, no other text:
{
  "score": <number 1-10>,
  "correctPoints": ["specific thing they said correctly", "another correct point"],
  "missingConcepts": ["most important missing concept (max 3 total)"],
  "incorrectConcepts": ["only if they said something factually wrong"],
  "suggestions": ["short actionable improvement tip (max 3 total)"],
  "overallFeedback": "1-2 sentence honest interview feedback",
  "interviewFeedback": "1 sentence — would you move this candidate forward? e.g. Good answer, suitable for this level."
}

Scoring guide (interview standard, NOT textbook standard):
- 9-10: Strong, confident answer — covers all key ideas clearly
- 7-8: Good answer — covers the main concepts, minor gaps are acceptable
- 5-6: Partial — got the basics but missed important core ideas
- 3-4: Weak — shows some awareness but significant gaps
- 1-2: Incorrect or very minimal understanding`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5-mini', // Cost-effective & smart evaluation
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in evaluateAnswer');
      return { score: 0, overallFeedback: 'Failed to evaluate answer. Please try again.' };
    }

    return JSON.parse(content);
  } catch (err) {
    console.error('❌ Answer Evaluation Error:', err.message);
    return { score: 5, overallFeedback: 'Partially analyzed. Technical connection issue.' };
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
    const response = await openai.chat.completions.create({
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
    const response = await openai.chat.completions.create({
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
  generateInsights,
  analyzeNotes,
  transcribeAudio,
};
