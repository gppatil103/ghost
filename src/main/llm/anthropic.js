const { readSSE } = require('./sse');
const { httpError, networkError } = require('./errors');

// Fast/cheap vs "Smart" model, per Ghost's Smart toggle. Either can be
// overridden per-provider in Settings.
const DEFAULT_MODELS = { fast: 'claude-haiku-4-5-20251001', smart: 'claude-sonnet-5' };

function buildContent(userText, image) {
  const content = [];
  if (image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
    });
  }
  content.push({ type: 'text', text: userText });
  return content;
}

// Pure request builder (no network) — exported for tests.
function buildRequest({ model, smart, systemPrompt, history = [], userText, image }) {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    body: {
      model,
      max_tokens: smart ? 1536 : 700,
      system: systemPrompt,
      stream: true,
      messages: [
        ...history.map((t) => ({ role: t.role, content: t.text })),
        { role: 'user', content: buildContent(userText, image) },
      ],
    },
  };
}

async function streamChat({ apiKey, signal, ...args }, onChunk) {
  const { url, body } = buildRequest(args);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw networkError('anthropic', err);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError('anthropic', res.status, text);
  }

  let full = '';
  const usage = {};
  try {
    await readSSE(res, ({ event, data }) => {
      if (event === 'message_start' || event === 'message_delta' || event === 'content_block_delta') {
        let evt;
        try { evt = JSON.parse(data); } catch { return; }
        if (event === 'message_start') usage.inputTokens = evt.message?.usage?.input_tokens;
        else if (event === 'message_delta') usage.outputTokens = evt.usage?.output_tokens;
        else if (evt.delta?.type === 'text_delta') {
          full += evt.delta.text;
          onChunk(evt.delta.text);
        }
      } else if (event === 'error') {
        let evt;
        try { evt = JSON.parse(data); } catch { evt = {}; }
        throw new Error(evt.error?.message || 'Anthropic stream error');
      }
    });
  } catch (err) {
    throw networkError('anthropic', err);
  }

  return { fullText: full, usage };
}

// Anthropic's Messages API does not accept raw audio input, so Ghost falls
// back to OpenAI or Gemini for transcription even when Anthropic is the
// selected chat provider. See actions.js for the fallback logic.

module.exports = { DEFAULT_MODELS, buildRequest, streamChat };
