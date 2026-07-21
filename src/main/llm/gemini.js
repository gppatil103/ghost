const { readSSE } = require('./sse');

const FAST_MODEL = 'gemini-3.1-flash-lite';
const SMART_MODEL = 'gemini-3.1-pro-preview';

function pickModel(smart) { return smart ? SMART_MODEL : FAST_MODEL; }

function buildParts(userText, imageBase64) {
  const parts = [{ text: userText }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: 'image/png', data: imageBase64 } });
  }
  return parts;
}

async function streamChat({ apiKey, smart, systemPrompt, userText, imageBase64 }, onChunk) {
  const model = pickModel(smart);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: buildParts(userText, imageBase64) }],
      generationConfig: {
        maxOutputTokens: smart ? 2048 : 1024,
        thinkingConfig: { thinkingLevel: smart ? 'high' : 'low' },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }

  let full = '';
  let sawAnyEvent = false;
  await readSSE(res, ({ data }) => {
    sawAnyEvent = true;
    let evt;
    try { evt = JSON.parse(data); } catch (e) { console.error('[ghost] gemini: failed to parse SSE chunk:', data.slice(0, 200)); return; }
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
  if (!sawAnyEvent) console.error('[ghost] gemini: stream produced zero SSE events');

  return { fullText: full };
}

// Gemini can transcribe/understand audio directly as an inline part —
// used as Ghost's fallback transcription path when no OpenAI key is set.
async function transcribeAudio({ apiKey, audioBuffer, mimeType }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${FAST_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcribe this audio clip verbatim. Return only the transcript text, no commentary.' },
          { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini transcription error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

module.exports = { streamChat, transcribeAudio, pickModel };
