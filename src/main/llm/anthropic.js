const { readSSE } = require('./sse');

// Fast/cheap vs "Smart" model, per Ghost's Smart toggle.
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const SMART_MODEL = 'claude-sonnet-5';

function pickModel(smart) { return smart ? SMART_MODEL : FAST_MODEL; }

function buildContent(userText, imageBase64) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
    });
  }
  content.push({ type: 'text', text: userText });
  return content;
}

async function streamChat({ apiKey, smart, systemPrompt, userText, imageBase64 }, onChunk) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: pickModel(smart),
      max_tokens: smart ? 1536 : 700,
      system: systemPrompt,
      stream: true,
      messages: [{ role: 'user', content: buildContent(userText, imageBase64) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic error ${res.status}: ${body.slice(0, 300)}`);
  }

  let full = '';
  await readSSE(res, ({ event, data }) => {
    if (event === 'content_block_delta') {
      let evt;
      try { evt = JSON.parse(data); } catch { return; }
      if (evt.delta?.type === 'text_delta') {
        full += evt.delta.text;
        onChunk(evt.delta.text);
      }
    } else if (event === 'error') {
      let evt;
      try { evt = JSON.parse(data); } catch { evt = {}; }
      throw new Error(evt.error?.message || 'Anthropic stream error');
    }
  });

  return { fullText: full };
}

// Anthropic's Messages API does not accept raw audio input, so Ghost falls
// back to OpenAI or Gemini for transcription even when Anthropic is the
// selected chat provider. See actions.js for the fallback logic.

module.exports = { streamChat, pickModel };
