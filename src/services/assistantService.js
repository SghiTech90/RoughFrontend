const OpenAI = require('openai');
const Answer = require('../models/Answer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHAME_KEYWORDS = [
  'random girl',
  'wasting time on',
  'you are useless',
  'you will never',
  'pathetic',
];

const DEFAULT_MIRA = {
  wakeTime: '04:00',
  sleepTime: '22:30',
  questionsTarget: 100,
  questionsDeadline: '10:00',
  primaryGoal: 'get_job_within_60_days',
  coachMode: 'strict_coach',
};

function parseTimeOnToday(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function formatHHmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function daysLeftFromDeadline(deadline) {
  if (!deadline) return 60;
  const end = new Date(deadline);
  const now = new Date();
  return Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
}

async function getMorningProgress(userId, deadline = '10:00', target = 100) {
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = parseTimeOnToday(deadline);
  const now = new Date();
  const countEnd = now < windowEnd ? now : windowEnd;

  const questionsAnswered = await Answer.countDocuments({
    userId,
    createdAt: { $gte: windowStart, $lte: countEnd },
  });

  return {
    questionsAnswered,
    questionsAnsweredBeforeDeadline: questionsAnswered,
    questionsTarget: target,
    questionsDeadline: deadline,
    morningBlockPassed: now >= windowEnd,
    morningBlockMet: questionsAnswered >= target,
    minutesLeftInWindow: now < windowEnd ? Math.max(0, Math.floor((windowEnd - now) / 60000)) : 0,
    remaining: Math.max(0, target - questionsAnswered),
  };
}

async function buildContextSnapshot(user, localContext = {}) {
  const mira = { ...DEFAULT_MIRA, ...(user.mira || {}) };
  const progress = await getMorningProgress(
    user._id,
    mira.questionsDeadline,
    mira.questionsTarget
  );

  const now = new Date();
  const localTime = localContext.localTime || formatHHmm(now);

  return {
    localTime,
    date: (localContext.date || now.toISOString().split('T')[0]),
    timezone: localContext.timezone || 'Asia/Kolkata',
    wakeCompleted: !!localContext.wakeCompleted,
    wakeScheduledTime: localContext.wakeScheduledTime || mira.wakeTime,
    yogaCompleted: !!localContext.yogaCompleted,
    meditationCompleted: !!localContext.meditationCompleted,
    questionsAnsweredToday: progress.questionsAnswered,
    questionsAnsweredBeforeDeadline: progress.questionsAnsweredBeforeDeadline,
    questionsTarget: mira.questionsTarget,
    questionsDeadline: mira.questionsDeadline,
    morningBlockPassed: progress.morningBlockPassed,
    morningBlockMet: progress.morningBlockMet,
    primaryGoal: mira.primaryGoal,
    primaryGoalDaysLeft: daysLeftFromDeadline(mira.primaryGoalDeadline),
    sleepScheduledTime: localContext.sleepScheduledTime || mira.sleepTime,
    pendingTasks: Array.isArray(localContext.pendingTasks) ? localContext.pendingTasks : [],
    blockedAppsViolationsToday: localContext.blockedAppsViolationsToday || 0,
    streakDays: user.streak?.current || 0,
    userMood: localContext.userMood || 'unknown',
    userName: user.name,
    minutesLeftInMorningBlock: progress.minutesLeftInWindow,
  };
}

function quickIntentFromTranscript(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;

  if (/\b(yes|yeah|yep|ok|okay|done|ready|sure|go|completed|finished)\b/.test(t) && t.length < 40) {
    return { intent: 'report_completion', confidence: 0.95, entities: {} };
  }
  if (/\b(no|nope|snooze|later|wait|not now|five minutes|5 minutes)\b/.test(t) && t.length < 50) {
    return { intent: 'snooze_task', confidence: 0.95, entities: {} };
  }
  if (/\b(how am i|status|progress|update me)\b/.test(t)) {
    return { intent: 'ask_status', confidence: 0.9, entities: {} };
  }
  return null;
}

function buildSystemPrompt(user, context) {
  const mira = { ...DEFAULT_MIRA, ...(user.mira || {}) };
  return `You are Mira, ${user.name}'s personal discipline coach for DisciplineOS + Revision AI.

GOALS:
- Wake ${mira.wakeTime}, sleep by ${mira.sleepTime}
- ${mira.questionsTarget} Revision AI questions by ${mira.questionsDeadline} daily
- ${mira.primaryGoal} (${context.primaryGoalDaysLeft} days left)
- Coach mode: ${mira.coachMode}

PERSONALITY: Direct, caring, Indian English. Never shame or insult relationships. Max 3 sentences in message.spoken.

PRIORITY (higher wins): health/emergency > morning study block > job prep > chores > social > entertainment

RULES:
1. If questionsAnsweredBeforeDeadline < questionsTarget AND morning block not passed → protect study time
2. If morning block missed → suggest evening catch-up before entertainment
3. sick/stressed userMood → compassion_reset
4. confidence < 0.7 in input → decision clarify with one question
5. Output ONLY valid JSON with keys: decision, reasonCode, message (spoken, display, tone), schedulePatch (array), metrics, followUp (optional), choices (optional)

reasonCode one of: MORNING_BLOCK_SAFE, MORNING_BLOCK_AT_RISK, MORNING_BLOCK_MISSED, CHORE_DEADLINE_CONFLICT, JOB_PREP_PROTECTED, GOAL_ESCALATION, PATTERN_WARNING, COMPASSION_RESET, STREAK_CELEBRATION, LOW_CONFIDENCE, EMERGENCY_OVERRIDE, SLEEP_PROTECTION, DISTRACTION_BLOCKED

decision one of: allow, conditional_allow, deny, defer, clarify, celebrate, compassion_reset`;
}

function validatePlannerResponse(raw, context) {
  const spoken = String(raw?.message?.spoken || '').trim();
  const sentences = spoken.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  if (sentences.length > 4 || spoken.length > 500) {
    return buildFallbackResponse(context, 'Let me keep this simple. Check your morning question count and do the next highest-priority task now.');
  }

  const lower = spoken.toLowerCase();
  if (SHAME_KEYWORDS.some((k) => lower.includes(k))) {
    return buildFallbackResponse(context, `You're at ${context.questionsAnsweredBeforeDeadline} of ${context.questionsTarget} questions today. Focus on the next task that moves your job goal forward.`);
  }

  const atRisk =
    !context.morningBlockPassed &&
    context.questionsAnsweredBeforeDeadline < context.questionsTarget;

  if (atRisk && raw?.decision === 'allow' && raw?.reasonCode === 'MORNING_BLOCK_SAFE') {
    return buildFallbackResponse(
      context,
      `You're at ${context.questionsAnsweredBeforeDeadline} of ${context.questionsTarget} with ${context.questionsTarget - context.questionsAnsweredBeforeDeadline} to go before ${context.questionsDeadline}. Start Revision AI now.`
    );
  }

  return {
    decision: raw.decision || 'allow',
    reasonCode: raw.reasonCode || 'MORNING_BLOCK_SAFE',
    message: {
      spoken: spoken || buildStatusLine(context),
      display: raw?.message?.display || spoken,
      tone: raw?.message?.tone || 'firm',
    },
    schedulePatch: Array.isArray(raw.schedulePatch) ? raw.schedulePatch : [],
    metrics: {
      questionsToday: context.questionsAnsweredToday,
      questionsBeforeDeadline: context.questionsAnsweredBeforeDeadline,
      questionsNeededByDeadline: Math.max(0, context.questionsTarget - context.questionsAnsweredBeforeDeadline),
      minutesLeftInMorningBlock: context.minutesLeftInMorningBlock ?? 0,
      riskLevel: raw?.metrics?.riskLevel || (atRisk ? 'high' : 'low'),
    },
    followUp: raw.followUp || null,
    choices: raw.choices || null,
  };
}

function buildStatusLine(context) {
  if (context.morningBlockMet) {
    return `Morning block done — ${context.questionsAnsweredBeforeDeadline} questions. ${context.primaryGoalDaysLeft} days to your job goal. What's next on your list?`;
  }
  if (!context.morningBlockPassed) {
    const left = context.questionsTarget - context.questionsAnsweredBeforeDeadline;
    return `You're at ${context.questionsAnsweredBeforeDeadline} of ${context.questionsTarget} — ${left} left before ${context.questionsDeadline}. Open Revision AI now.`;
  }
  return `Morning target missed. Schedule a catch-up block before any entertainment tonight.`;
}

function buildFallbackResponse(context, spoken) {
  return {
    decision: 'allow',
    reasonCode: context.morningBlockMet ? 'MORNING_BLOCK_SAFE' : 'MORNING_BLOCK_AT_RISK',
    message: { spoken, display: spoken, tone: 'firm' },
    schedulePatch: [],
    metrics: {
      questionsToday: context.questionsAnsweredToday,
      questionsBeforeDeadline: context.questionsAnsweredBeforeDeadline,
      questionsNeededByDeadline: Math.max(0, context.questionsTarget - context.questionsAnsweredBeforeDeadline),
      minutesLeftInMorningBlock: 0,
      riskLevel: context.morningBlockMet ? 'low' : 'high',
    },
    followUp: null,
    choices: null,
  };
}

function buildLocalPlannerResponse(intent, context) {
  if (intent.intent === 'ask_status') {
    return {
      decision: context.morningBlockMet ? 'allow' : 'conditional_allow',
      reasonCode: context.morningBlockMet ? 'MORNING_BLOCK_SAFE' : 'MORNING_BLOCK_AT_RISK',
      message: {
        spoken: buildStatusLine(context),
        display: buildStatusLine(context),
        tone: context.morningBlockMet ? 'warm' : 'firm',
      },
      schedulePatch: [],
      metrics: {
        questionsToday: context.questionsAnsweredToday,
        questionsBeforeDeadline: context.questionsAnsweredBeforeDeadline,
        questionsNeededByDeadline: Math.max(0, context.questionsTarget - context.questionsAnsweredBeforeDeadline),
        riskLevel: context.morningBlockMet ? 'low' : 'high',
      },
    };
  }
  return null;
}

async function planWithOpenAI(user, context, rawTranscript, parsed) {
  const payload = {
    life_event: {
      type: 'life_event',
      version: '1.0',
      rawTranscript,
      parsed,
      source: 'voice',
    },
    contextSnapshot: context,
  };

  const response = await openai.chat.completions.create({
    model: process.env.MIRA_MODEL || 'gpt-4o-mini',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(user, context) },
      {
        role: 'user',
        content: `Analyze and respond with planner JSON only:\n${JSON.stringify(payload)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty planner response');
  return JSON.parse(content);
}

async function parseIntentWithOpenAI(rawTranscript) {
  const response = await openai.chat.completions.create({
    model: process.env.MIRA_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Extract intent from user speech for a discipline coach app.
Return JSON: { "intent": "<enum>", "entities": {}, "confidence": 0-1 }
intents: schedule_chore, schedule_social, schedule_study, schedule_work, report_completion, report_distraction, report_delay, ask_status, ask_plan, snooze_task, reschedule_day, set_goal, emergency_override, unknown`,
      },
      { role: 'user', content: rawTranscript },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return { intent: 'unknown', entities: {}, confidence: 0.3 };
  return JSON.parse(content);
}

async function planLifeEvent(user, { rawTranscript, localContext = {}, parsed: clientParsed }) {
  const context = await buildContextSnapshot(user, localContext);
  const transcript = String(rawTranscript || '').trim();

  if (!transcript) {
    return { success: true, planner: buildFallbackResponse(context, buildStatusLine(context)), contextSnapshot: context };
  }

  const quick = quickIntentFromTranscript(transcript);
  if (quick && (quick.intent === 'ask_status')) {
    return { success: true, planner: buildLocalPlannerResponse(quick, context), contextSnapshot: context, parsed: quick };
  }

  // Pass-through intents handled on device (yes/snooze during task alarm)
  if (quick && (quick.intent === 'report_completion' || quick.intent === 'snooze_task')) {
    return { success: true, planner: null, parsed: quick, contextSnapshot: context, deviceAction: quick.intent };
  }

  let parsed = clientParsed || quick;
  if (!parsed || parsed.confidence < 0.6) {
    try {
      parsed = await parseIntentWithOpenAI(transcript);
    } catch (err) {
      console.error('Intent parse error:', err.message);
      parsed = { intent: 'unknown', entities: {}, confidence: 0.3 };
    }
  }

  const local = buildLocalPlannerResponse(parsed, context);
  if (local) {
    return { success: true, planner: local, contextSnapshot: context, parsed };
  }

  try {
    const rawPlanner = await planWithOpenAI(user, context, transcript, parsed);
    const planner = validatePlannerResponse(rawPlanner, context);
    return { success: true, planner, contextSnapshot: context, parsed };
  } catch (err) {
    console.error('Planner error:', err.message);
    return {
      success: true,
      planner: buildFallbackResponse(context, buildStatusLine(context)),
      contextSnapshot: context,
      parsed,
      fallback: true,
    };
  }
}

module.exports = {
  planLifeEvent,
  buildContextSnapshot,
  getMorningProgress,
  validatePlannerResponse,
  buildStatusLine,
};
