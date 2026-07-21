(function () {
  const $ = (sel) => document.querySelector(sel);

  const statusDot = $('#status-dot');
  const responseEl = $('#response');
  const smartToggle = $('#smart-toggle');
  const btnMic = $('#btn-mic');
  const btnMeeting = $('#btn-meeting');
  const btnScreen = $('#btn-screen');
  const captureHint = $('#capture-hint');
  const askForm = $('#ask-form');
  const askInput = $('#ask-input');

  let settings = null;
  let pendingScreenshotB64 = null; // set by "Screen" pill, consumed by next action
  let reqCounter = 0;

  // ---------- boot ----------
  async function boot() {
    settings = await window.ghost.getSettings();
    smartToggle.checked = !!settings.smartMode;
    if (!settings.onboardingComplete) window.ghostTutorial.start();
  }
  boot();

  window.ghost.onShowTutorial(() => window.ghostTutorial.start());

  // ---------- header controls ----------
  $('#btn-minimize').addEventListener('click', () => window.ghost.hidePanel());
  $('#btn-close').addEventListener('click', () => window.ghost.quitApp());

  smartToggle.addEventListener('change', () => {
    settings.smartMode = smartToggle.checked;
    window.ghost.setSettings({ smartMode: settings.smartMode });
  });
  window.ghost.onToggleSmart(() => {
    smartToggle.checked = !smartToggle.checked;
    smartToggle.dispatchEvent(new Event('change'));
  });

  // ---------- capture pills ----------
  btnScreen.addEventListener('click', async () => {
    try {
      setStatus('busy');
      captureHint.textContent = 'Grabbing a screenshot…';
      pendingScreenshotB64 = await window.ghostCapture.captureScreenshot();
      captureHint.textContent = 'Screenshot captured — it\'ll be used on your next action.';
      btnScreen.classList.add('on');
      setStatus('active');
    } catch (err) {
      captureHint.textContent = 'Screenshot cancelled or blocked.';
      setStatus('idle');
    } finally {
      setTimeout(() => btnScreen.classList.remove('on'), 1500);
    }
  });

  btnMic.addEventListener('click', async () => {
    if (window.ghostCapture.isMicOn()) {
      window.ghostCapture.stopMic();
      btnMic.classList.remove('on');
      captureHint.textContent = 'Mic stopped.';
      return;
    }
    try {
      await window.ghostCapture.startMic(() => setStatus('active', true));
      btnMic.classList.add('on');
      captureHint.textContent = 'Listening to your mic — click again to stop.';
      setStatus('active');
    } catch {
      captureHint.textContent = 'Mic permission was denied.';
    }
  });

  btnMeeting.addEventListener('click', async () => {
    if (window.ghostCapture.isMeetingOn()) {
      window.ghostCapture.stopMeeting();
      btnMeeting.classList.remove('on');
      captureHint.textContent = 'Meeting audio stopped.';
      return;
    }
    try {
      await window.ghostCapture.startMeeting(() => setStatus('active', true));
      btnMeeting.classList.add('on');
      captureHint.textContent = 'Listening to meeting/system audio — click again to stop. See Settings for the Zoom note.';
      setStatus('active');
    } catch {
      captureHint.textContent = 'Meeting-audio capture was cancelled or blocked.';
    }
  });

  function setStatus(mode) {
    statusDot.className = 'dot' + (mode === 'busy' ? ' busy' : mode === 'active' ? ' active' : '');
  }

  // ---------- actions ----------
  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => runAction(btn.dataset.action));
  });

  askForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = askInput.value.trim();
    if (!q) return;
    askInput.value = '';
    runAction('ask_anything', q);
  });

  window.ghost.onTriggerAction((actionId) => {
    if (actionId === 'ask_anything') { askInput.focus(); return; }
    runAction(actionId);
  });

  async function runAction(actionId, typedQuestion) {
    clearEmptyState();
    const requestId = `req_${++reqCounter}`;
    const entry = createEntry(actionId, requestId);

    const payload = {
      requestId,
      action: actionId,
      provider: settings.provider,
      transcript: window.ghostCapture.getCombinedTranscript(),
      userQuestion: typedQuestion || '',
      imageBase64: pendingScreenshotB64 || undefined,
    };

    // "Solve coding problem" always wants a fresh screenshot if we don't
    // already have one queued, since it's meaningless without the screen.
    if (actionId === 'solve_code' && !payload.imageBase64) {
      try {
        setStatus('busy');
        payload.imageBase64 = await window.ghostCapture.captureScreenshot();
      } catch {
        appendToEntry(entry, '\n\n_Couldn\'t capture the screen — screen-share permission was blocked or cancelled._');
        setStatus('idle');
        return;
      }
    }

    pendingScreenshotB64 = null; // consume

    setStatus('busy');
    const chunkHandler = (data) => { if (data.requestId === requestId) appendToEntry(entry, data.text); };
    const doneHandler = (data) => { if (data.requestId === requestId) { setStatus('active'); finalizeEntry(entry, data.meta); } };
    const errHandler = (data) => { if (data.requestId === requestId) { setStatus('idle'); appendError(entry, data.message); } };

    window.ghost.onStreamChunk(chunkHandler);
    window.ghost.onStreamDone(doneHandler);
    window.ghost.onStreamError(errHandler);

    await window.ghost.runAction(payload);
  }

  // ---------- response rendering ----------
  function clearEmptyState() {
    const empty = responseEl.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  const ACTION_LABELS = {
    assist: 'Assist', what_to_say: 'What to say', follow_up: 'Follow-ups',
    recap: 'Recap', ask_anything: 'Ask anything', solve_code: 'Solve coding problem',
  };

  function createEntry(actionId) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `<span class="tag">${ACTION_LABELS[actionId] || actionId}</span><div class="body"><span class="cursor-blink"></span></div>`;
    responseEl.appendChild(div);
    responseEl.scrollTop = responseEl.scrollHeight;
    return div;
  }

  function appendToEntry(entry, text) {
    if (!text) return;
    const body = entry.querySelector('.body');
    const cursor = body.querySelector('.cursor-blink');
    const textNode = document.createTextNode(text);
    if (cursor) body.insertBefore(textNode, cursor);
    else body.appendChild(textNode);
    responseEl.scrollTop = responseEl.scrollHeight;
  }

  function finalizeEntry(entry) {
    const cursor = entry.querySelector('.cursor-blink');
    if (cursor) cursor.remove();
  }

  function appendError(entry, message) {
    finalizeEntry(entry);
    const body = entry.querySelector('.body');
    const span = document.createElement('div');
    span.className = 'err';
    span.textContent = `⚠ ${message}`;
    body.appendChild(span);
  }

  // ---------- settings sheet ----------
  const settingsOverlay = $('#settings-overlay');
  const providerSelect = $('#provider-select');
  const keyInput = $('#key-input');
  const keyStatus = $('#key-status');
  const hideFromCapture = $('#hide-from-capture');

  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => settingsOverlay.classList.add('hidden'));

  async function openSettings() {
    settingsOverlay.classList.remove('hidden');
    providerSelect.value = settings.provider;
    hideFromCapture.checked = !!settings.hideFromCapture;
    await refreshKeyStatus();
  }

  providerSelect.addEventListener('change', async () => {
    settings.provider = providerSelect.value;
    await window.ghost.setSettings({ provider: settings.provider });
    keyInput.value = '';
    await refreshKeyStatus();
  });

  async function refreshKeyStatus() {
    const has = await window.ghost.hasApiKey(providerSelect.value);
    keyStatus.textContent = has ? '✓ Key saved for this provider.' : 'No key saved yet.';
    keyStatus.style.color = has ? 'var(--ok)' : 'var(--text-dim)';
  }

  $('#key-save').addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) return;
    try {
      await window.ghost.saveApiKey(providerSelect.value, key);
      keyInput.value = '';
      await refreshKeyStatus();
    } catch (err) {
      keyStatus.textContent = `⚠ ${err.message || err}`;
      keyStatus.style.color = 'var(--danger)';
    }
  });

  $('#key-clear').addEventListener('click', async () => {
    await window.ghost.clearApiKey(providerSelect.value);
    await refreshKeyStatus();
  });

  hideFromCapture.addEventListener('change', () => {
    window.ghost.setSettings({ hideFromCapture: hideFromCapture.checked });
  });

  $('#rerun-tutorial').addEventListener('click', () => {
    settingsOverlay.classList.add('hidden');
    window.ghostTutorial.start();
  });
})();
