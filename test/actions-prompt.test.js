// System-prompt assembly for built-in and user-defined ("custom:<id>") actions.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { buildSystemPrompt, ACTIONS } = require('../src/main/actions.js');

describe('buildSystemPrompt', () => {
  it('uses the built-in task text for built-in actions', () => {
    expect(buildSystemPrompt(ACTIONS.RECAP)).toMatch(/Task: recap\./);
    expect(buildSystemPrompt('nonsense')).toMatch(/Task: general assist\./); // falls back to assist
  });

  it('injects the user prompt for a custom action', () => {
    const prompt = buildSystemPrompt('custom:sql', [
      { id: 'sql', name: 'Write SQL', prompt: 'Write the SQL query for what is on screen.' },
    ]);
    expect(prompt).toMatch(/Task \("Write SQL", defined by the user\): Write the SQL query/);
    expect(prompt).toMatch(/You are Ghost/); // base rules still apply
  });

  it('refuses a custom action that no longer exists', () => {
    expect(() => buildSystemPrompt('custom:gone', [])).toThrow(/"\/gone" action no longer exists/);
    expect(() => buildSystemPrompt('custom:gone')).toThrow(/no longer exists/);
  });
});
