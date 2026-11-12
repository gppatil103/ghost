import { createRequire } from 'node:module';
import { describe, it, expect, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { transcribeClip, transcriberOrder } = require('../src/main/actions.js');
const openai = require('../src/main/llm/openai.js');
const gemini = require('../src/main/llm/gemini.js');

const realOpenai = openai.transcribeAudio;
const realGemini = gemini.transcribeAudio;
afterEach(() => {
  openai.transcribeAudio = realOpenai;
  gemini.transcribeAudio = realGemini;
});

const clip = { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm' };

describe('transcriberOrder', () => {
  it('tries the selected chat provider first', () => {
    expect(transcriberOrder('gemini')).toEqual(['gemini', 'openai']);
    expect(transcriberOrder('openai')).toEqual(['openai', 'gemini']);
  });

  it('falls back to the default order for providers without audio input', () => {
    expect(transcriberOrder('anthropic')).toEqual(['openai', 'gemini']);
  });
});

describe('transcribeClip', () => {
  it('uses the selected provider even when another key is also saved', async () => {
    const used = [];
    openai.transcribeAudio = async () => (used.push('openai'), 'from openai');
    gemini.transcribeAudio = async () => (used.push('gemini'), 'from gemini');
    await expect(transcribeClip(clip, { openai: 'k1', gemini: 'k2' }, 'gemini')).resolves.toBe('from gemini');
    expect(used).toEqual(['gemini']);
  });

  it('falls back to the other provider when the first one fails (e.g. a bad key)', async () => {
    openai.transcribeAudio = async () => {
      throw new Error('OpenAI rejected your API key.');
    };
    gemini.transcribeAudio = async ({ apiKey }) => `gemini with ${apiKey}`;
    await expect(transcribeClip(clip, { openai: 'bad', gemini: 'good' }, 'openai')).resolves.toBe(
      'gemini with good',
    );
  });

  it('skips providers that have no key', async () => {
    openai.transcribeAudio = async () => {
      throw new Error('should not be called');
    };
    gemini.transcribeAudio = async () => 'ok';
    await expect(transcribeClip(clip, { gemini: 'k' }, 'openai')).resolves.toBe('ok');
  });

  it('throws the last error when every provider fails', async () => {
    openai.transcribeAudio = async () => {
      throw new Error('openai down');
    };
    gemini.transcribeAudio = async () => {
      throw new Error('gemini down');
    };
    await expect(transcribeClip(clip, { openai: 'a', gemini: 'b' }, 'openai')).rejects.toThrow('gemini down');
  });

  it('explains which keys are needed when none are saved', async () => {
    await expect(transcribeClip(clip, {}, 'anthropic')).rejects.toThrow(/OpenAI or Gemini key/);
  });
});
