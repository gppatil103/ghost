const { readSSE } = require('./sse');

const FAST_MODEL = 'gpt-5.6-luna';
const SMART_MODEL = 'gpt-5.6-sol';

function pickModel(smart) { return smart ? SMART_MODEL : FAST_MODEL; }

// content: { text, imageBase64? } -> Responses API "input" array
function buildInput(systemPrompt, userText, imageBase64) {
  const userContent = [{ type: 'input_text', text: userText }];
  if (imageBase64) {
    userContent.push({ type: 'input_image', image_url: `data:image/png;base64,${imageBase64}` });
  }
  return [
    { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
    { role: 'user', content: userContent },
  ];
}

async function streamChat({ apiKey, smart, systemPrompt, userText, imageBase64 }, onChunk) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: pickModel(smart),
      input: buildInput(systemPrompt, userText, imageBase64),
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${body.slice(0, 300)}`);
  }

  let full = '';
  let sawAnyEvent = false;
  await readSSE(res, ({ data }) => {
    if (data === '[DONE]') return;
    sawAnyEvent = true;
    let evt;
    try { evt = JSON.parse(data); } catch (e) { console.error('[ghost] openai: failed to parse SSE chunk:', data.slice(0, 200)); return; }
    if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
      full += evt.delta;
      onChunk(evt.delta);
    } else if (evt.type === 'response.error' || evt.type === 'error') {
      throw new Error(evt.error?.message || 'OpenAI stream error');
    }
  });
  if (!sawAnyEvent) console.error('[ghost] openai: stream produced zero SSE events');

  return { fullText: full };
}

// Transcribe a short audio buffer using OpenAI's transcription endpoint.
async function transcribeAudio({ apiKey, audioBuffer, mimeType }) {
  const form = new FormData();
  const ext = mimeType.includes('webm') ? 'webm' : 'wav';
  form.append('file', new Blob([audioBuffer], { type: mimeType }), `clip.${ext}`);
  form.append('model', 'gpt-4o-mini-transcribe');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI transcription error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.text || '';
}

module.exports = { streamChat, transcribeAudio, pickModel };
