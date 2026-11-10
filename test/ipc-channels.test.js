import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { INVOKE, EVENTS } = require('../src/shared/ipc-channels.js');

// The sandboxed preload can't require shared/ipc-channels.js, so it repeats
// the channel strings. This keeps the two in sync.
const preload = readFileSync(new URL('../src/preload/preload.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');

const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
const listened = [...preload.matchAll(/\bon\('([^']+)'/g)].map((m) => m[1]);

describe('IPC channel names', () => {
  it('preload only invokes channels declared in INVOKE', () => {
    expect(new Set(invoked)).toEqual(new Set(Object.values(INVOKE)));
  });

  it('preload only listens to channels declared in EVENTS', () => {
    expect(new Set(listened)).toEqual(new Set(Object.values(EVENTS)));
  });

  it('main registers every INVOKE channel through the sender-checking handle() wrapper', () => {
    for (const key of Object.keys(INVOKE)) expect(mainSrc).toContain(`handle(INVOKE.${key},`);
    expect(mainSrc).not.toMatch(/ipcMain\.handle\('/);
  });

  it('there is no open-external channel', () => {
    expect(preload).not.toContain('open-external');
    expect(mainSrc).not.toContain('openExternal');
  });
});
