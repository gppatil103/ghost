(function () {
  const $ = (sel) => document.querySelector(sel);

  const statusDot = $('#status-dot');
  const recBadge = $('#rec-badge');
  const responseEl = $('#response');
  const smartToggle = $('#smart-toggle');
  const btnMic = $('#btn-mic');
  const btnMeeting = $('#btn-meeting');
  const btnScreen = $('#btn-screen');
  const btnTranscript = $('#btn-transcript');
  const transcriptPanel = $('#transcript-panel');
  const transcriptText = $('#transcript-text');
  const captureHint = $('#capture-hint');
  const askForm = $('#ask-form');
  const askInput = $('#ask-input');
  const askSend = $('#ask-send');
  const btnStop = $('#btn-stop');
  const attachmentPreview = $('#attachment-preview');
  const attachmentThumbImg = $('#attachment-thumb-img');
  const attachmentRemove = $('#attachment-remove');

  const MAX_HISTORY_TURNS = 20; // turns sent with each request
  const MAX_STORED_TURNS = 200; // turns kept locally / persisted

  let settings = null;
  let pendingScreenshot = null; // { base64, mimeType } set by "Screen" pill, consumed by next action
  let reqCounter = 0;
  let history = []; // [{ role: 'user' | 'assistant', text }]
  let activeRequestId = null;
  const requests = new Map(); // requestId -> { entry, text, retry }

  const ACTION_LABELS = {
    assist: 'Assist',
    what_to_say: 'What to say',
    follow_up: 'Follow-ups',
    recap: 'Recap',
    ask_anything: 'Ask anything',
    solve_code: 'Solve coding problem',
  };

  // ipcRenderer.invoke wraps main-process errors; show just the message.
  function ipcErrorMessage(err) {
    return String((err && err.message) || err).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      '',
    );
  }

  // ---------- toast (transient status line) ----------
  let toastTimer = null;
  function showToast(text) {
    clearTimeout(toastTimer);
    captureHint.textContent = text;
    captureHint.classList.add('show');
    // Warnings and the consent reminder stay up longer.
    const ms = /⚠|agreed/.test(text) ? 8000 : 4000;
    toastTimer = setTimeout(() => captureHint.classList.remove('show'), ms);
  }

  // ---------- accent ----------
  const ACCENTS = { blue: '#5b8cff', violet: '#9b7bff', green: '#34c77b', orange: '#ff9f43' };
  function applyAccent(id) {
    const key = Object.hasOwn(ACCENTS, id) ? id : 'blue';
    document.documentElement.style.setProperty('--accent', ACCENTS[key] || ACCENTS.blue);
    document.querySelectorAll('.swatch').forEach((s) => {
      s.setAttribute('aria-checked', String(s.dataset.accent === key));
    });
  }

  // ---------- overlays (sheet enter/exit along the same path) ----------
  function openOverlay(el) {
    el.hidden = false;
    void el.offsetWidth; // commit the start state so the transition runs
    el.classList.add('open');
  }

  function closeOverlay(el) {
    if (el.hidden) return;
    el.classList.remove('open');
    const sheet = el.querySelector('.sheet');
    let done = false;
    const finish = () => {
      if (done || el.classList.contains('open')) return;
      done = true;
      el.hidden = true;
    };
    sheet.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400); // fallback if no transition fires
  }
  window.ghostUI = { openOverlay, closeOverlay };

  // ---------- attachment preview ----------
  function showAttachmentPreview(shot) {
    attachmentThumbImg.src = `data:${shot.mimeType};base64,${shot.base64}`;
    attachmentPreview.classList.remove('hidden');
  }

  function hideAttachmentPreview() {
    attachmentPreview.classList.add('hidden');
    attachmentThumbImg.removeAttribute('src');
  }

  attachmentRemove.addEventListener('click', () => {
    pendingScreenshot = null;
    hideAttachmentPreview();
    btnScreen.classList.remove('on');
    showToast('Screenshot removed.');
  });

  // ---------- boot ----------
  async function boot() {
    settings = await window.ghost.getSettings();
    smartToggle.checked = !!settings.smartMode;
    applyAccent(settings.accent);
    syncOpacityControls(settings.panelOpacity);
    if (settings.saveHistory) {
      history = await window.ghost.getHistory().catch(() => []);
      restoreHistory();
    }
    if (!settings.onboardingComplete) window.ghostTutorial.start();
  }
  boot();

  window.ghost.onShowTutorial(() => window.ghostTutorial.start());
  window.ghost.onOpenSettings(() => openSettings());

  // ---------- header controls ----------
  $('#btn-minimize').addEventListener('click', () => window.ghost.hidePanel());
  $('#btn-close').addEventListener('click', () => window.ghost.quitApp());
  $('#btn-new-chat').addEventListener('click', newChat);

  smartToggle.addEventListener('change', () => {
    settings.smartMode = smartToggle.checked;
    window.ghost.setSettings({ smartMode: settings.smartMode });
  });
  window.ghost.onToggleSmart(() => {
    smartToggle.checked = !smartToggle.checked;
    smartToggle.dispatchEvent(new Event('change'));
  });

  function newChat() {
    if (activeRequestId) window.ghost.cancelAction(activeRequestId);
    history = [];
    window.ghost.clearHistory();
    window.ghostCapture.clearTranscript();
    responseEl.replaceChildren(emptyState());
    showToast('New chat — Ghost has forgotten the previous conversation.');
  }

  function emptyState() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.textContent =
      'Ask anything, or pick an action above. Ghost only sees your screen or hears audio when you turn on a capture icon.';
    return div;
  }

  // ---------- capture toggles ----------
  // REC badge and the transcript button only exist while audio is being captured.
  // Any transcript text is sent with every action, so its button stays visible
  // (to view or Clear it) while capture is on or text remains.
  function updateRecBadge() {
    const on = window.ghostCapture.isMicOn() || window.ghostCapture.isMeetingOn();
    const hasText = !!window.ghostCapture.getCombinedTranscript();
    recBadge.classList.toggle('hidden', !on);
    btnTranscript.hidden = !(on || hasText);
    if (btnTranscript.hidden) setTranscriptOpen(false);
  }

  btnScreen.addEventListener('click', async () => {
    try {
      setStatus('busy');
      showToast('Grabbing a screenshot…');
      pendingScreenshot = await window.ghostCapture.captureScreenshot();
      showToast("Screenshot captured — it'll be used on your next action.");
      btnScreen.classList.add('on');
      showAttachmentPreview(pendingScreenshot);
      setStatus('active');
    } catch {
      showToast('Screenshot cancelled or blocked.');
      setStatus('idle');
    } finally {
      setTimeout(() => btnScreen.classList.remove('on'), 1500);
    }
  });

  function onCaptureStopped(source) {
    if (!settings.keepTranscriptAfterStop) window.ghostCapture.clearTranscript(source);
    updateRecBadge();
  }

  btnMic.addEventListener('click', async () => {
    if (window.ghostCapture.isMicOn()) {
      window.ghostCapture.stopMic();
      btnMic.classList.remove('on');
      showToast(
        settings.keepTranscriptAfterStop ? 'Mic stopped.' : 'Mic stopped — its transcript was cleared.',
      );
      onCaptureStopped('mic');
      return;
    }
    try {
      lastTranscribeErrorShown = '';
      await window.ghostCapture.startMic(() => setStatus('active'));
      btnMic.classList.add('on');
      showToast('Listening — speak, then press Enter to ask. Click the mic again to stop.');
      setStatus('active');
      askInput.focus(); // so Enter submits instead of re-pressing the mic button
    } catch {
      showToast('⚠ Mic permission was denied.');
    }
    updateRecBadge();
  });
  window.ghost.onToggleMic(() => btnMic.click());

  // Transcription failures (bad key, quota, …) used to be silent: the REC
  // badge stayed on but nothing was heard. Tell the user, once per message.
  let lastTranscribeErrorShown = '';
  window.ghostCapture.onTranscribeError((err) => {
    const msg = ipcErrorMessage(err);
    if (msg === lastTranscribeErrorShown) return;
    lastTranscribeErrorShown = msg;
    showToast(`⚠ Couldn't transcribe audio: ${msg}`);
  });

  btnMeeting.addEventListener('click', async () => {
    if (window.ghostCapture.isMeetingOn()) {
      window.ghostCapture.stopMeeting();
      btnMeeting.classList.remove('on');
      showToast(
        settings.keepTranscriptAfterStop
          ? 'Meeting audio stopped.'
          : 'Meeting audio stopped — its transcript was cleared.',
      );
      onCaptureStopped('meeting');
      return;
    }
    try {
      await window.ghostCapture.startMeeting(() => setStatus('active'));
      btnMeeting.classList.add('on');
      showToast(
        'Transcribing meeting/system audio — make sure everyone on the call has agreed to this. Click again to stop.',
      );
      setStatus('active');
    } catch {
      showToast('Meeting-audio capture was cancelled or blocked.');
    }
    updateRecBadge();
  });

  // ---------- live transcript viewer ----------
  function renderTranscript() {
    const text = window.ghostCapture.getCombinedTranscript();
    transcriptText.textContent = text || 'Nothing transcribed yet. Turn on Mic or Meeting.';
    transcriptText.scrollTop = transcriptText.scrollHeight;
  }

  function setTranscriptOpen(open) {
    transcriptPanel.classList.toggle('open', open);
    btnTranscript.classList.toggle('on', open);
    if (open) renderTranscript();
  }

  btnTranscript.addEventListener('click', () =>
    setTranscriptOpen(!transcriptPanel.classList.contains('open')),
  );
  $('#transcript-clear').addEventListener('click', () => window.ghostCapture.clearTranscript());
  window.ghostCapture.onTranscriptChange(() => {
    if (transcriptPanel.classList.contains('open')) renderTranscript();
    updateRecBadge();
  });

  // A plain mouse wheel scrolls the horizontal chip row (Chromium only maps
  // Shift+wheel to horizontal scrolling on its own).
  const chips = $('.chips');
  chips.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaX !== 0 || chips.scrollWidth <= chips.clientWidth) return;
      chips.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );

  function setStatus(mode) {
    statusDot.className = 'dot' + (mode === 'busy' ? ' busy' : mode === 'active' ? ' active' : '');
  }

  function setBusy(busy) {
    askForm.classList.toggle('busy', busy); // CSS cross-fades Send ⇄ Stop
    askSend.disabled = busy;
  }

  // ---------- actions ----------
  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => runAction(btn.dataset.action));
  });

  // With the mic on, Enter sends what you said (plus anything typed) as the
  // question. The mic keeps listening afterwards for the next one.
  let takingSpeech = false;
  askForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (activeRequestId || takingSpeech) return;
    const typed = askInput.value.trim();

    if (!window.ghostCapture.isMicOn()) {
      if (!typed) return;
      askInput.value = '';
      runAction('ask_anything', typed);
      return;
    }

    takingSpeech = true;
    setBusy(true);
    setStatus('busy');
    showToast('Transcribing what you said…');
    let spoken = '';
    let error = null;
    try {
      ({ text: spoken, error } = await window.ghostCapture.takeMicSpeech());
    } finally {
      takingSpeech = false;
      setBusy(false);
      setStatus('active');
    }
    const q = [typed, spoken].filter(Boolean).join(' ');
    if (!q) {
      showToast(
        error
          ? `⚠ Couldn't transcribe your voice: ${ipcErrorMessage(error)}`
          : "Didn't catch anything — speak, then press Enter.",
      );
      return;
    }
    askInput.value = '';
    runAction('ask_anything', q);
  });

  btnStop.addEventListener('click', () => {
    if (activeRequestId) window.ghost.cancelAction(activeRequestId);
  });

  window.ghost.onTriggerAction((actionId) => {
    if (actionId === 'ask_anything') {
      askInput.focus();
      return;
    }
    runAction(actionId);
  });

  // One set of stream listeners for the lifetime of the page; chunks are
  // routed to their entry by requestId.
  window.ghost.onStreamChunk(({ requestId, text }) => {
    const req = requests.get(requestId);
    if (!req) return;
    req.text += text;
    scheduleRender(req);
  });

  window.ghost.onStreamDone(({ requestId, meta }) => {
    const req = requests.get(requestId);
    if (!req) return;
    renderBody(req, true);
    finalizeEntry(req.entry, meta, { text: meta.fullText || req.text, retry: req.retry });
    remember(req.userTurn, meta.fullText || req.text);
    endRequest(requestId, 'active');
  });

  window.ghost.onStreamError((err) => {
    const req = requests.get(err.requestId);
    if (!req) return;
    renderBody(req, true);
    appendError(req, err.message, err.retryable, err.cancelled);
    endRequest(err.requestId, err.cancelled ? 'active' : 'idle');
  });

  function endRequest(requestId, status) {
    requests.delete(requestId);
    if (activeRequestId === requestId) {
      activeRequestId = null;
      setBusy(false);
    }
    setStatus(status);
  }

  // What the user's side of this turn looks like in the conversation history.
  function describeUserTurn(actionId, typedQuestion, hadImage, hadTranscript) {
    if (typedQuestion) return typedQuestion;
    const extras = [hadImage && 'a screenshot', hadTranscript && 'the audio transcript'].filter(Boolean);
    return `[${ACTION_LABELS[actionId] || actionId}${extras.length ? ` using ${extras.join(' and ')}` : ''}]`;
  }

  function remember(userText, assistantText) {
    if (!assistantText || !assistantText.trim()) return;
    history.push({ role: 'user', text: userText }, { role: 'assistant', text: assistantText });
    if (history.length > MAX_STORED_TURNS) history = history.slice(-MAX_STORED_TURNS);
    if (settings.saveHistory)
      window.ghost.saveHistory(history).catch((e) => console.warn('saving history failed', e));
  }

  async function runAction(actionId, typedQuestion, retryImage) {
    if (activeRequestId) {
      showToast('Still answering — press Stop first.');
      return;
    }
    clearEmptyState();
    const requestId = `req_${Date.now()}_${++reqCounter}`;
    const entry = createEntry(actionId, typedQuestion);

    let image = retryImage || pendingScreenshot;

    // "Solve coding problem" always wants a fresh screenshot if we don't
    // already have one queued, since it's meaningless without the screen.
    if (actionId === 'solve_code' && !image) {
      try {
        setStatus('busy');
        image = await window.ghostCapture.captureScreenshot();
      } catch {
        appendError(
          { entry },
          "Couldn't capture the screen — screen-share permission was blocked or cancelled.",
          false,
        );
        setStatus('idle');
        return;
      }
    }

    pendingScreenshot = null; // consume
    hideAttachmentPreview();

    const transcript = window.ghostCapture.getCombinedTranscript();
    const payload = {
      requestId,
      action: actionId,
      transcript,
      userQuestion: typedQuestion || '',
      imageBase64: image ? image.base64 : undefined,
      imageMimeType: image ? image.mimeType : undefined,
      history: history.slice(-MAX_HISTORY_TURNS),
    };

    const req = {
      entry,
      text: '',
      renderQueued: false,
      userTurn: describeUserTurn(actionId, typedQuestion, !!image, !!transcript),
      retry: () => runAction(actionId, typedQuestion, image),
    };
    requests.set(requestId, req);
    activeRequestId = requestId;
    setBusy(true);
    setStatus('busy');

    try {
      await window.ghost.runAction(payload);
    } catch (err) {
      // Rejected before streaming started (validation, rate limit, …).
      if (requests.has(requestId)) {
        appendError(req, ipcErrorMessage(err), false);
        endRequest(requestId, 'idle');
      }
    }
  }

  // ---------- response rendering ----------
  function clearEmptyState() {
    const empty = responseEl.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  function createEntry(actionId, typedQuestion) {
    const div = document.createElement('div');
    div.className = 'entry';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = ACTION_LABELS[actionId] || 'Ghost';
    div.appendChild(tag);
    if (typedQuestion) {
      const user = document.createElement('div');
      user.className = 'user-msg';
      user.textContent = typedQuestion;
      div.appendChild(user);
    }
    const body = document.createElement('div');
    body.className = 'body';
    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    body.appendChild(cursor);
    div.appendChild(body);
    responseEl.appendChild(div);
    responseEl.scrollTop = responseEl.scrollHeight;
    return div;
  }

  function copyText(text, btn) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = 'Copy';
        }, 1200);
      })
      .catch(() => {
        btn.textContent = 'Copy failed';
      });
  }

  function renderMarkdownInto(body, text) {
    const md = window.ghostMarkdown;
    body.replaceChildren(md.render(document, md.parse(text), { onCopy: copyText }));
  }

  // Re-render at most once per animation frame while streaming.
  function scheduleRender(req) {
    if (req.renderQueued) return;
    req.renderQueued = true;
    requestAnimationFrame(() => {
      req.renderQueued = false;
      renderBody(req, false);
    });
  }

  function renderBody(req, final) {
    const body = req.entry.querySelector('.body');
    const nearBottom = responseEl.scrollHeight - responseEl.scrollTop - responseEl.clientHeight < 40;
    renderMarkdownInto(body, req.text);
    if (!final) {
      const cursor = document.createElement('span');
      cursor.className = 'cursor-blink';
      (body.lastElementChild && body.lastElementChild.tagName === 'P'
        ? body.lastElementChild
        : body
      ).appendChild(cursor);
    }
    if (nearBottom) responseEl.scrollTop = responseEl.scrollHeight;
  }

  function formatTokens(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  function finalizeEntry(entry, meta, tools) {
    const cursor = entry.querySelector('.cursor-blink');
    if (cursor) cursor.remove();
    if (!meta) return;
    const info = document.createElement('div');
    info.className = 'meta';
    const parts = [meta.model];
    const u = meta.usage || {};
    if (Number.isFinite(u.inputTokens) || Number.isFinite(u.outputTokens)) {
      parts.push(`${formatTokens(u.inputTokens || 0)} in · ${formatTokens(u.outputTokens || 0)} out tokens`);
    }
    info.textContent = parts.join(' — ');
    entry.appendChild(info);
    if (tools) addAnswerTools(entry, tools);
  }

  function svgIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function toolButton(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-btn';
    const text = document.createElement('span');
    text.textContent = label;
    btn.append(svgIcon(icon), text);
    btn.addEventListener('click', () => onClick(text));
    return btn;
  }

  // Copy / Retry row under an answer. `retry` is omitted for restored history.
  function addAnswerTools(entry, { text, retry }) {
    const row = document.createElement('div');
    row.className = 'answer-tools';
    row.appendChild(
      toolButton('copy', 'Copy', (label) => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            label.textContent = 'Copied';
            setTimeout(() => {
              label.textContent = 'Copy';
            }, 1200);
          })
          .catch(() => {
            label.textContent = 'Copy failed';
          });
      }),
    );
    if (retry) row.appendChild(toolButton('retry', 'Retry', () => retry()));
    entry.appendChild(row);
    responseEl.querySelectorAll('.entry.latest').forEach((e) => e.classList.remove('latest'));
    entry.classList.add('latest');
  }

  function appendError(req, message, retryable, cancelled) {
    const entry = req.entry;
    finalizeEntry(entry);
    const div = document.createElement('div');
    div.className = cancelled ? 'stopped' : 'err';
    div.textContent = cancelled ? '■ Stopped.' : `⚠ ${message}`;
    if (retryable && req.retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-ghost small retry-btn';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => {
        btn.remove();
        req.retry();
      });
      div.appendChild(btn);
    }
    entry.appendChild(div);
    responseEl.scrollTop = responseEl.scrollHeight;
  }

  // Re-draw a persisted conversation after a restart.
  function restoreHistory() {
    if (!history.length) return;
    clearEmptyState();
    for (let i = 0; i < history.length; i++) {
      const turn = history[i];
      if (turn.role !== 'user') continue;
      const reply = history[i + 1] && history[i + 1].role === 'assistant' ? history[i + 1].text : '';
      const typed = turn.text.startsWith('[') ? '' : turn.text;
      const entry = createEntry(typed ? 'ask_anything' : null, typed);
      if (!typed) entry.querySelector('.tag').textContent = turn.text.slice(1, -1);
      renderMarkdownInto(entry.querySelector('.body'), reply);
      entry.querySelector('.cursor-blink')?.remove();
      if (reply) addAnswerTools(entry, { text: reply });
    }
    const note = document.createElement('div');
    note.className = 'history-note';
    note.textContent = 'Restored from your last session — press ＋ for a new chat.';
    responseEl.appendChild(note);
    responseEl.scrollTop = responseEl.scrollHeight;
  }

  // ---------- settings sheet ----------
  const settingsOverlay = $('#settings-overlay');
  const providerSelect = $('#provider-select');
  const keyInput = $('#key-input');
  const keyStatus = $('#key-status');
  const hideFromCapture = $('#hide-from-capture');
  const saveHistoryBox = $('#save-history');
  const keepTranscriptBox = $('#keep-transcript');
  const opacityRange = $('#panel-opacity');
  const opacityValue = $('#panel-opacity-value');
  const modelFast = $('#model-fast');
  const modelSmart = $('#model-smart');
  const modelsStatus = $('#models-status');
  const shortcutList = $('#shortcut-list');
  const shortcutsStatus = $('#shortcuts-status');

  const SHORTCUT_LABELS = {
    toggle_window: 'Show / hide panel',
    assist: 'Assist',
    what_to_say: 'What to say',
    follow_up: 'Follow-up questions',
    recap: 'Recap',
    ask_anything: 'Focus "Ask anything"',
    solve_code: 'Solve coding problem',
    toggle_smart: 'Toggle Smart mode',
    toggle_clickthrough: 'Toggle click-through',
    toggle_mic: 'Toggle mic',
  };

  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => closeOverlay(settingsOverlay));
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeOverlay(settingsOverlay); // tap the scrim
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) closeOverlay(settingsOverlay);
  });

  // ---------- settings tabs (segmented control) ----------
  const TABS = ['ai', 'look', 'privacy', 'keys'];
  const segmented = $('.segmented');
  let lastTab = 'ai';

  function selectTab(name) {
    lastTab = name;
    segmented.style.setProperty('--seg-index', String(TABS.indexOf(name)));
    segmented.querySelectorAll('.seg').forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    document
      .querySelectorAll('.tab-page')
      .forEach((p) => p.classList.toggle('active', p.dataset.tab === name));
  }

  segmented
    .querySelectorAll('.seg')
    .forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  segmented.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = TABS[(TABS.indexOf(lastTab) + step + TABS.length) % TABS.length];
    selectTab(next);
    segmented.querySelector(`.seg[data-tab="${next}"]`).focus();
  });

  // ---------- accent swatches ----------
  document.querySelectorAll('.swatch').forEach((s) =>
    s.addEventListener('click', () => {
      applyAccent(s.dataset.accent);
      saveSetting({ accent: s.dataset.accent });
    }),
  );

  function setStatusText(el, text, ok) {
    el.textContent = text;
    el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  }

  async function openSettings() {
    settings = await window.ghost.getSettings();
    selectTab(lastTab);
    openOverlay(settingsOverlay);
    applyAccent(settings.accent);
    providerSelect.value = settings.provider;
    hideFromCapture.checked = !!settings.hideFromCapture;
    saveHistoryBox.checked = !!settings.saveHistory;
    keepTranscriptBox.checked = !!settings.keepTranscriptAfterStop;
    syncOpacityControls(settings.panelOpacity);
    modelsStatus.textContent = '';
    shortcutsStatus.textContent = '';
    fillModelInputs();
    await refreshKeyStatus();
    await renderShortcuts();
  }

  async function saveSetting(patch) {
    try {
      settings = await window.ghost.setSettings(patch);
      return true;
    } catch (err) {
      showToast(`⚠ ${ipcErrorMessage(err)}`);
      return false;
    }
  }

  providerSelect.addEventListener('change', async () => {
    await saveSetting({ provider: providerSelect.value });
    keyInput.value = '';
    fillModelInputs();
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
      setStatusText(keyStatus, `⚠ ${ipcErrorMessage(err)}`, false);
    }
  });

  $('#key-clear').addEventListener('click', async () => {
    await window.ghost.clearApiKey(providerSelect.value);
    await refreshKeyStatus();
  });

  function fillModelInputs() {
    const o = (settings.models || {})[providerSelect.value] || {};
    modelFast.value = o.fast || '';
    modelSmart.value = o.smart || '';
    modelFast.placeholder = modelSmart.placeholder = 'Ghost default';
  }

  $('#models-save').addEventListener('click', async () => {
    const models = { ...(settings.models || {}) };
    models[providerSelect.value] = { fast: modelFast.value.trim(), smart: modelSmart.value.trim() };
    try {
      settings = await window.ghost.setSettings({ models });
      setStatusText(modelsStatus, '✓ Saved', true);
    } catch (err) {
      setStatusText(modelsStatus, `⚠ ${ipcErrorMessage(err)}`, false);
    }
  });

  hideFromCapture.addEventListener('change', () => saveSetting({ hideFromCapture: hideFromCapture.checked }));
  keepTranscriptBox.addEventListener('change', () =>
    saveSetting({ keepTranscriptAfterStop: keepTranscriptBox.checked }),
  );

  function syncOpacityControls(value) {
    opacityRange.value = String(value);
    opacityValue.textContent = `${Math.round(value * 100)}%`;
  }

  // 'input' rather than 'change', so the panel fades as the slider moves.
  opacityRange.addEventListener('input', () => {
    const value = Number(opacityRange.value);
    syncOpacityControls(value);
    saveSetting({ panelOpacity: value });
  });

  saveHistoryBox.addEventListener('change', async () => {
    const ok = await saveSetting({ saveHistory: saveHistoryBox.checked });
    if (ok && saveHistoryBox.checked && history.length) window.ghost.saveHistory(history);
  });

  async function renderShortcuts() {
    const status = await window.ghost.getShortcutStatus();
    shortcutList.replaceChildren();
    for (const [cmd, label] of Object.entries(SHORTCUT_LABELS)) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const name = document.createElement('label');
      name.textContent = label;
      name.htmlFor = `sc-${cmd}`;
      const input = document.createElement('input');
      input.id = `sc-${cmd}`;
      input.className = 'text-input';
      input.dataset.cmd = cmd;
      input.spellcheck = false;
      input.value = (settings.shortcuts || {})[cmd] || '';
      input.placeholder = 'off';
      const err = document.createElement('div');
      err.className = 'shortcut-err';
      const s = status[cmd];
      if (s && !s.ok) err.textContent = `⚠ ${s.error}`;
      row.append(name, input, err);
      shortcutList.appendChild(row);
    }
  }

  $('#shortcuts-save').addEventListener('click', async () => {
    const shortcuts = {};
    shortcutList.querySelectorAll('input[data-cmd]').forEach((input) => {
      shortcuts[input.dataset.cmd] = input.value.trim().replace(/\s*\+\s*/g, '+');
    });
    try {
      settings = await window.ghost.setSettings({ shortcuts });
      await renderShortcuts();
      const status = await window.ghost.getShortcutStatus();
      const failed = Object.values(status).filter((s) => !s.ok).length;
      setStatusText(
        shortcutsStatus,
        failed ? `${failed} shortcut(s) couldn't be registered` : '✓ Saved',
        !failed,
      );
    } catch (err) {
      setStatusText(shortcutsStatus, `⚠ ${ipcErrorMessage(err)}`, false);
    }
  });

  $('#shortcuts-reset').addEventListener('click', async () => {
    settings = await window.ghost.setSettings({ shortcuts: {} });
    await renderShortcuts();
    setStatusText(shortcutsStatus, '✓ Reset to defaults', true);
  });

  $('#rerun-tutorial').addEventListener('click', () => {
    closeOverlay(settingsOverlay);
    window.ghostTutorial.start();
  });
})();
