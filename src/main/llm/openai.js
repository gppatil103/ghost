const { readSSE } = require('./sse');
const { httpError, networkError } = require('./errors');

const DEFAULT_MODELS = { fast: 'gpt-5.6-luna', smart: 'gpt-5.6-sol' };
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

function buildTurn(turn) {
  return turn.role === 'assistant'
    ? { role: 'assistant', content: [{ type: 'output_text', text: turn.text }] }
    : { role: 'user', content: [{ type: 'input_text', text: turn.text }] };
}

// Pure request builder (no network) — exported for tests.
function buildRequest({ model, systemPrompt, history = [], userText, image }) {
  const userContent = [{ type: 'input_text', text: userText }];
  if (image) {
    userContent.push({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.base64}` });
  }
  return {
    url: 'https://api.openai.com/v1/responses',
    body: {
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        ...history.map(buildTurn),
        { role: 'user', content: userContent },
      ],
      stream: true,
      store: false, // don't keep Ghost conversations on OpenAI's side
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw networkError('openai', err);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError('openai', res.status, text);
  }

  let full = '';
  const usage = {};
  let sawAnyEvent = false;
  try {
    await readSSE(res, ({ data }) => {
      if (data === '[DONE]') return;
      sawAnyEvent = true;
      let evt;
      try { evt = JSON.parse(data); } catch { console.error('[ghost] openai: failed to parse SSE chunk:', data.slice(0, 200)); return; }
      if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        full += evt.delta;
        onChunk(evt.delta);
      } else if (evt.type === 'response.completed') {
        usage.inputTokens = evt.response?.usage?.input_tokens;
        usage.outputTokens = evt.response?.usage?.output_tokens;
      } else if (evt.type === 'response.error' || evt.type === 'error') {
        throw new Error(evt.error?.message || evt.message || 'OpenAI stream error');
      }
    });
  } catch (err) {
    throw networkError('openai', err);
  }
  if (!sawAnyEvent) console.error('[ghost] openai: stream produced zero SSE events');

  return { fullText: full, usage };
}

// Transcribe a short audio buffer using OpenAI's transcription endpoint.
async function transcribeAudio({ apiKey, audioBuffer, mimeType, signal }) {
  const form = new FormData();
  const ext = mimeType.includes('webm') ? 'webm' : 'wav';
  form.append('file', new Blob([audioBuffer], { type: mimeType }), `clip.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw networkError('openai', err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError('openai', res.status, text);
  }
  const json = await res.json();
  return json.text || '';
}

module.exports = { DEFAULT_MODELS, buildRequest, streamChat, transcribeAudio };
