const openai = require('./llm/openai');
const anthropic = require('./llm/anthropic');
const gemini = require('./llm/gemini');

const ACTIONS = {
  ASSIST: 'assist',
  WHAT_TO_SAY: 'what_to_say',
  FOLLOW_UP: 'follow_up',
  RECAP: 'recap',
  ASK_ANYTHING: 'ask_anything',
  SOLVE_CODE: 'solve_code',
};

const PROVIDERS = { openai, anthropic, gemini };

const BASE_SYSTEM = `You are Ghost, a private, on-screen AI copilot. You see a
screenshot and/or a rolling transcript of the user's mic and meeting audio
that they've explicitly chosen to share with you for this request. Be
concise, concrete, and skimmable — the user is reading you live, often
mid-conversation or mid-task. Prefer short paragraphs, bullet points, or
brief code blocks over long essays. Never pad with disclaimers. If context
is thin, make your best reasonable attempt and say what you assumed.`;

const ACTION_PROMPTS = {
  [ACTIONS.ASSIST]: `Task: general assist. Look at whatever is on screen and/or
in the transcript and help the user with it directly — answer the question,
unblock the task, or explain what's happening. Get straight to the point.`,

  [ACTIONS.WHAT_TO_SAY]: `Task: suggest what to say next. Based on the
conversation transcript, propose 2-3 short, natural things the user could
say next to move the conversation forward. Write them as ready-to-speak
lines, first person, no stage directions.`,

  [ACTIONS.FOLLOW_UP]: `Task: follow-up questions. Based on the transcript
and/or screen, suggest 3-5 sharp follow-up questions the user could ask to
get more clarity or move the discussion forward. One line each.`,

  [ACTIONS.RECAP]: `Task: recap. Summarize what's happened so far in the
transcript into a tight recap: key points, decisions, and open items. Use
short bullets.`,

  [ACTIONS.ASK_ANYTHING]: `Task: answer the user's specific question below,
using the screenshot/transcript as context if relevant.`,

  [ACTIONS.SOLVE_CODE]: `Task: solve the coding problem visible on screen.
Read the problem statement, constraints, and any starter code from the
screenshot. Then: (1) briefly state your approach, (2) give a clean,
correct, working solution in the same language as the starter code (or the
most idiomatic choice if unclear), (3) note the time/space complexity in
one line. This is meant for personal practice and debugging — keep the
explanation short enough to skim quickly.`,
};

function buildSystemPrompt(actionId) {
  return `${BASE_SYSTEM}\n\n${ACTION_PROMPTS[actionId] || ACTION_PROMPTS[ACTIONS.ASSIST]}`;
}

function buildUserText(payload) {
  const parts = [];
  if (payload.transcript) parts.push(`Transcript so far:\n${payload.transcript}`);
  if (payload.userQuestion) parts.push(`User's message:\n${payload.userQuestion}`);
  if (!payload.transcript && !payload.userQuestion) {
    parts.push('(No transcript or typed question — rely on the screenshot.)');
  }
  return parts.join('\n\n');
}

async function runAction(payload, settings, keys, { onChunk, onDone }) {
  const providerName = payload.provider || settings.provider || 'openai';
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  const apiKey = keys[providerName];
  if (!apiKey) {
    throw new Error(`No ${providerName} API key saved. Add one in Ghost settings.`);
  }

  const systemPrompt = buildSystemPrompt(payload.action);
  const userText = buildUserText(payload);
  const smart = !!settings.smartMode;

  const { fullText } = await provider.streamChat(
    { apiKey, smart, systemPrompt, userText, imageBase64: payload.imageBase64 },
    onChunk
  );

  if (!fullText || !fullText.trim()) {
    throw new Error('Provider returned an empty response (check Ctrl+Shift+I devtools console for the raw stream/log — may be a blocked/safety-filtered reply or a parsing issue).');
  }

  onDone({ provider: providerName, model: provider.pickModel(smart), length: fullText.length });
}

// Picks who transcribes audio: prefer OpenAI's dedicated transcription
// endpoint, fall back to Gemini's audio understanding, else give up
// gracefully (Anthropic has no audio input as of this writing).
async function transcribeClip({ audioBuffer, mimeType }, keys) {
  if (keys.openai) {
    return openai.transcribeAudio({ apiKey: keys.openai, audioBuffer, mimeType });
  }
  if (keys.gemini) {
    return gemini.transcribeAudio({ apiKey: keys.gemini, audioBuffer, mimeType });
  }
  throw new Error('Mic/meeting-audio transcription needs an OpenAI or Gemini key.');
}

module.exports = { ACTIONS, runAction, transcribeClip };
