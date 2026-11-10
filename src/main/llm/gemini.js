const { readSSE } = require('./sse');
const { httpError, networkError } = require('./errors');

const DEFAULT_MODELS = { fast: 'gemini-3.1-flash-lite', smart: 'gemini-3.1-pro-preview' };

function buildParts(userText, image) {
  const parts = [{ text: userText }];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  return parts;
}

// Pure request builder (no network) — exported for tests.
function buildRequest({ model, smart, systemPrompt, history = [], userText, image }) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    body: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        // Gemini calls the assistant role "model".
        ...history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
        { role: 'user', parts: buildParts(userText, image) },
      ],
      generationConfig: {
        maxOutputTokens: smart ? 2048 : 1024,
        thinkingConfig: { thinkingLevel: smart ? 'high' : 'low' },
      },
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
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw networkError('gemini', err);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError('gemini', res.status, text);
  }

  let full = '';
  const usage = {};
  let sawAnyEvent = false;
  try {
    await readSSE(res, ({ data }) => {
      sawAnyEvent = true;
      let evt;
      try { evt = JSON.parse(data); } catch { console.error('[ghost] gemini: failed to parse SSE chunk:', data.slice(0, 200)); return; }
      if (evt.usageMetadata) {
        usage.inputTokens = evt.usageMetadata.promptTokenCount;
        usage.outputTokens = (evt.usageMetadata.candidatesTokenCount || 0) + (evt.usageMetadata.thoughtsTokenCount || 0);
      }
      const finishReason = evt.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') console.log('[ghost] gemini finishReason:', finishReason);
      const parts = evt.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.thought) continue; // internal reasoning, not the answer
        if (typeof p.text === 'string' && p.text) {
          full += p.text;
          onChunk(p.text);
        }
      }
    });
  } catch (err) {
    throw networkError('gemini', err);
  }
  if (!sawAnyEvent) console.error('[ghost] gemini: stream produced zero SSE events');

  return { fullText: full, usage };
}

// Gemini can transcribe/understand audio directly as an inline part —
// used as Ghost's fallback transcription path when no OpenAI key is set.
async function transcribeAudio({ apiKey, audioBuffer, mimeType, signal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.fast}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this audio clip verbatim. Return only the transcript text, no commentary. If there is no speech, return nothing.' },
            { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } },
          ],
        }],
      }),
    });
  } catch (err) {
    throw networkError('gemini', err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError('gemini', res.status, text);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

module.exports = { DEFAULT_MODELS, buildRequest, streamChat, transcribeAudio };
