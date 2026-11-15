(function () {
  const $ = (sel) => document.querySelector(sel);

  const statusDot = $('#status-dot');
  const recBadge = $('#rec-badge');
  const responseEl = $('#response'); // scroll container
  const listEl = $('#response-list'); // where entries go; its background drags the window
  const smartToggle = $('#smart-toggle');
  const btnMic = $('#btn-mic');
  const btnScreen = $('#btn-screen');
  const btnWatch = $('#btn-watch');
  const watchBadge = $('#watch-badge');
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
  let pendingScreenshot = null; // { base64, mimeType } attached to every message until removed
  let customActions = []; // settings.customActions, mirrored into the "/" menu
  let compact = false; // one-line "quick ask" bar (see setCompact)
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

  function actionLabel(actionId) {
    if (ACTION_LABELS[actionId]) return ACTION_LABELS[actionId];
    if (actionId && actionId.startsWith('custom:')) {
      const custom = customActions.find((a) => `custom:${a.id}` === actionId);
      return custom ? custom.name : actionId.slice('custom:'.length);
    }
    return actionId;
  }

  // ipcRenderer.invoke wraps main-process errors; show just the message.
  function ipcErrorMessage(err) {
    return String((err && err.message) || err).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      '',
    );
  }

  // An inline <svg><use href="#id"/></svg> for the icon sprite.
  function iconSvg(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.appendChild(use);
    return svg;
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

  // ---------- theme ----------
  // 'system' follows Windows' app mode live; 'light' / 'dark' pin it.
  const THEMES = ['system', 'light', 'dark'];
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  let themeChoice = 'system';
  function applyTheme(choice) {
    themeChoice = THEMES.includes(choice) ? choice : 'system';
    const resolved = themeChoice === 'system' ? (systemDark.matches ? 'dark' : 'light') : themeChoice;
    document.documentElement.dataset.theme = resolved;
    document.querySelectorAll('.theme-option').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.themeChoice === themeChoice));
    });
  }
  systemDark.addEventListener('change', () => {
    if (themeChoice === 'system') applyTheme('system');
  });
  applyTheme('system'); // paint the right theme before settings arrive

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
    applyTheme(settings.theme);
    syncCustomActions(settings);
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

  // ---------- window controls ----------
  $('#btn-minimize').addEventListener('click', () => window.ghost.hidePanel());
  $('#btn-close').addEventListener('click', () => window.ghost.quitApp());
  $('#btn-new-chat').addEventListener('click', newChat);

  // Fill the work area / go back to the small panel; main does the resizing.
  const btnMaximize = $('#btn-maximize');
  btnMaximize.addEventListener('click', async () => {
    const maximized = await window.ghost.toggleMaximize();
    $('#maximize-icon').setAttribute('href', maximized ? '#i-collapse' : '#i-expand');
    btnMaximize.setAttribute('aria-label', maximized ? 'Restore size' : 'Maximize');
    btnMaximize.title = maximized ? 'Back to the small panel' : 'Fill the screen';
  });

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
    pendingScreenshot = null;
    hideAttachmentPreview();
    listEl.replaceChildren(emptyState());
    showToast('New chat — Ghost has forgotten the previous conversation.');
  }

  function emptyState() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.textContent =
      'Ask anything, or type / for actions. Ghost only sees your screen or hears your mic when you turn on a capture icon.';
    return div;
  }

  // ---------- capture toggles ----------
  // REC badge and the transcript button only exist while audio is being captured.
  // Any transcript text is sent with every action, so its button stays visible
  // (to view or Clear it) while capture is on or text remains.
  function updateRecBadge() {
    const on = window.ghostCapture.isMicOn();
    const hasText = !!window.ghostCapture.getCombinedTranscript();
    recBadge.classList.toggle('hidden', !on);
    btnTranscript.hidden = !(on || hasText);
    if (btnTranscript.hidden) setTranscriptOpen(false);
  }

  // Region capture: main hides the panel, freezes the display and shows a
  // selector; the crop comes back here. It stays attached for follow-ups.
  btnScreen.addEventListener('click', async () => {
    try {
      setStatus('busy');
      const shot = await window.ghost.captureRegion();
      if (!shot) {
        showToast('Capture cancelled.');
        setStatus('idle');
        return;
      }
      pendingScreenshot = shot;
      showAttachmentPreview(shot);
      btnScreen.classList.add('on');
      showToast('Screenshot attached — it stays with every message until you remove it (×).');
      setStatus('active');
      askInput.focus();
    } catch (err) {
      showToast(`⚠ Couldn't capture the screen: ${ipcErrorMessage(err)}`);
      setStatus('idle');
    } finally {
      setTimeout(() => btnScreen.classList.remove('on'), 1500);
    }
  });

  // Watch mode: one live screen stream; a frame is grabbed with each message.
  function updateWatchUi() {
    const on = window.ghostCapture.isWatchOn();
    btnWatch.classList.toggle('on', on);
    watchBadge.classList.toggle('hidden', !on);
  }
  btnWatch.addEventListener('click', async () => {
    if (window.ghostCapture.isWatchOn()) {
      window.ghostCapture.stopWatch();
      updateWatchUi();
      showToast('Stopped watching the screen.');
      return;
    }
    try {
      await window.ghostCapture.startWatch();
      updateWatchUi();
      showToast(
        'Watching your screen — every message now includes what is on screen at that moment. Click the eye again to stop.',
      );
    } catch {
      showToast('Screen watch was cancelled or blocked.');
    }
  });
  window.ghostCapture.onWatchEnded(() => {
    updateWatchUi();
    showToast('Screen watch ended.');
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

  // ---------- live transcript viewer ----------
  function renderTranscript() {
    const text = window.ghostCapture.getCombinedTranscript();
    transcriptText.textContent = text || 'Nothing transcribed yet. Turn on the mic.';
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

  function setStatus(mode) {
    statusDot.className = 'dot' + (mode === 'busy' ? ' busy' : mode === 'active' ? ' active' : '');
  }

  function setBusy(busy) {
    askForm.classList.toggle('busy', busy); // CSS cross-fades Send ⇄ Stop
    askSend.disabled = busy;
  }

  // ---------- "/" action menu ----------
  // Typing "/" in the input lists the actions, like slash commands; whatever
  // follows the "/" filters them. Enter, Tab or a click runs the highlighted
  // one; Esc closes. If nothing matches, the text is sent as a normal question.
  const slashMenu = $('#slash-menu');
  const slashCustom = $('#slash-custom');
  const slashItems = () => [...slashMenu.querySelectorAll('.slash-item')]; // built-ins + custom
  let slashIndex = 0;

  const squash = (s) => s.toLowerCase().replace(/[\s_-]/g, '');
  const visibleSlashItems = () => slashItems().filter((item) => !item.hidden);

  function setSlashActive(index, visible = visibleSlashItems()) {
    slashIndex = index;
    visible.forEach((item, i) => {
      item.classList.toggle('active', i === index);
      item.setAttribute('aria-selected', String(i === index));
    });
  }

  function closeSlashMenu() {
    slashMenu.hidden = true;
    slashIndex = 0;
  }

  function updateSlashMenu() {
    const value = askInput.value;
    if (!value.startsWith('/')) return closeSlashMenu();
    const filter = squash(value.slice(1));
    const visible = slashItems().filter((item) => {
      item.hidden = !squash(item.dataset.action + item.textContent).includes(filter);
      return !item.hidden;
    });
    if (!visible.length) return closeSlashMenu();
    slashMenu.hidden = false;
    setSlashActive(Math.min(slashIndex, visible.length - 1), visible);
  }

  function chooseSlash(item) {
    closeSlashMenu();
    askInput.value = '';
    if (item.dataset.action === 'clipboard') explainClipboard();
    else runAction(item.dataset.action);
  }

  // Custom actions from Settings → Actions, appended after the built-ins.
  function syncCustomActions(s) {
    customActions = Array.isArray(s.customActions) ? s.customActions : [];
    slashCustom.replaceChildren(
      ...customActions.map((a) => {
        const item = document.createElement('button');
        item.className = 'slash-item';
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.dataset.action = `custom:${a.id}`;
        const svg = iconSvg('i-sparkle');
        const text = document.createElement('span');
        text.className = 'slash-text';
        const name = document.createElement('span');
        name.className = 'slash-name';
        name.textContent = `/${a.id}`;
        const desc = document.createElement('span');
        desc.className = 'slash-desc';
        desc.textContent = a.name !== a.id ? a.name : a.prompt;
        text.append(name, desc);
        item.append(svg, text);
        return item;
      }),
    );
  }

  // "/clipboard": an image is attached like a screenshot; text becomes the question.
  async function explainClipboard() {
    let clip;
    try {
      clip = await window.ghost.readClipboard();
    } catch (err) {
      showToast(`⚠ ${ipcErrorMessage(err)}`);
      return;
    }
    if (clip.image) {
      pendingScreenshot = clip.image;
      showAttachmentPreview(clip.image);
      runAction('assist', 'Explain what is in this image from my clipboard.');
    } else if (clip.text && clip.text.trim()) {
      runAction('ask_anything', `Explain this (from my clipboard):\n\n${clip.text.trim()}`);
    } else {
      showToast('Clipboard is empty — copy some text or an image first.');
    }
  }

  // Pasting an image into the input attaches it (main re-encodes it as JPEG).
  askInput.addEventListener('paste', async (e) => {
    const hasImage = [...((e.clipboardData && e.clipboardData.items) || [])].some((i) =>
      i.type.startsWith('image/'),
    );
    if (!hasImage) return;
    e.preventDefault();
    try {
      const clip = await window.ghost.readClipboard();
      if (!clip.image) return;
      pendingScreenshot = clip.image;
      showAttachmentPreview(clip.image);
      showToast('Image attached from the clipboard.');
    } catch (err) {
      showToast(`⚠ ${ipcErrorMessage(err)}`);
    }
  });

  askInput.addEventListener('input', updateSlashMenu);
  askInput.addEventListener('blur', closeSlashMenu);
  askInput.addEventListener('keydown', (e) => {
    if (slashMenu.hidden) return;
    const visible = visibleSlashItems();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSlashActive((slashIndex + step + visible.length) % visible.length, visible);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); // don't submit "/recap" as a question
      chooseSlash(visible[slashIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSlashMenu();
    }
  });
  slashMenu.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus (and the menu) while clicking
  slashMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.slash-item');
    if (item) chooseSlash(item);
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
    let speech;
    try {
      speech = await window.ghostCapture.takeMicSpeech();
    } finally {
      takingSpeech = false;
      setBusy(false);
      setStatus('active');
    }
    const { text: spoken = '', error = null } = speech || {};
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
    return `[${actionLabel(actionId)}${extras.length ? ` using ${extras.join(' and ')}` : ''}]`;
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

    if (compact) setCompact(false); // the answer needs the full panel

    let image = retryImage || pendingScreenshot;

    // Watch mode: what's on screen at this moment, unless a screenshot is attached.
    if (!image && window.ghostCapture.isWatchOn()) {
      try {
        image = await window.ghostCapture.grabWatchFrame();
      } catch (err) {
        console.warn('watch frame failed', err);
      }
    }

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

    // The attached screenshot is kept for follow-up questions; × removes it.
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
    tag.textContent = actionLabel(actionId) || 'Ghost';
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
    listEl.appendChild(div);
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
    listEl.appendChild(note);
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
    quick_ask: 'Quick ask (one-line bar)',
  };

  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => closeOverlay(settingsOverlay));
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeOverlay(settingsOverlay); // tap the scrim
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (settingsOverlay.classList.contains('open')) closeOverlay(settingsOverlay);
    else if (compact && slashMenu.hidden) {
      // Esc in the quick-ask bar dismisses it, Spotlight-style.
      setCompact(false);
      window.ghost.hidePanel();
    }
  });

  // ---------- compact "quick ask" bar ----------
  // Shortcut → a one-line input at the panel's spot; the first answer (or
  // Esc, or opening Settings) brings the full panel back.
  async function setCompact(on) {
    if (compact === on) return;
    compact = on;
    document.body.classList.toggle('compact', on);
    try {
      await window.ghost.setCompact(on);
    } catch (err) {
      console.warn('compact mode failed', err);
    }
    if (on) {
      askInput.focus();
      askInput.select();
    }
  }
  window.ghost.onQuickAsk(() => setCompact(true));

  // ---------- settings tabs (segmented control) ----------
  const TABS = ['ai', 'actions', 'look', 'privacy', 'keys'];
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

  // ---------- theme picker ----------
  document.querySelectorAll('.theme-option').forEach((b) =>
    b.addEventListener('click', () => {
      applyTheme(b.dataset.themeChoice);
      saveSetting({ theme: themeChoice });
    }),
  );

  // ---------- custom action editor (Settings → Actions) ----------
  const customActionList = $('#custom-action-list');
  const customActionsStatus = $('#custom-actions-status');

  function customActionRow(a = { id: '', name: '', prompt: '' }) {
    const row = document.createElement('div');
    row.className = 'custom-action';
    const head = document.createElement('div');
    head.className = 'custom-action-head';
    const prefix = document.createElement('span');
    prefix.className = 'slash-prefix';
    prefix.textContent = '/';
    const id = document.createElement('input');
    id.className = 'field field--mono ca-id';
    id.placeholder = 'name';
    id.maxLength = 32;
    id.spellcheck = false;
    id.setAttribute('aria-label', 'Slash command name');
    id.value = a.id;
    const name = document.createElement('input');
    name.className = 'field ca-name';
    name.placeholder = 'Label (optional)';
    name.maxLength = 40;
    name.setAttribute('aria-label', 'Label');
    name.value = a.name === a.id ? '' : a.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn ca-delete';
    del.setAttribute('aria-label', 'Delete action');
    del.title = 'Delete';
    del.appendChild(iconSvg('i-x'));
    del.addEventListener('click', () => row.remove());
    head.append(prefix, id, name, del);
    const prompt = document.createElement('textarea');
    prompt.className = 'field ca-prompt';
    prompt.rows = 3;
    prompt.maxLength = 2000;
    prompt.placeholder =
      'What should Ghost do? e.g. Translate everything on screen to Spanish, keeping the layout.';
    prompt.setAttribute('aria-label', 'Prompt');
    prompt.value = a.prompt;
    row.append(head, prompt);
    return row;
  }

  function renderCustomActionEditor() {
    customActionList.replaceChildren(...customActions.map((a) => customActionRow(a)));
  }

  $('#custom-action-add').addEventListener('click', () => {
    const row = customActionRow();
    customActionList.appendChild(row);
    row.querySelector('.ca-id').focus();
  });

  $('#custom-actions-save').addEventListener('click', async () => {
    const list = [...customActionList.querySelectorAll('.custom-action')].map((row) => ({
      id: row.querySelector('.ca-id').value.trim().toLowerCase(),
      name: row.querySelector('.ca-name').value.trim(),
      prompt: row.querySelector('.ca-prompt').value.trim(),
    }));
    try {
      settings = await window.ghost.setSettings({ customActions: list });
      syncCustomActions(settings);
      renderCustomActionEditor();
      setStatusText(customActionsStatus, list.length ? `✓ Saved — type / to use them.` : '✓ Saved.', true);
    } catch (err) {
      setStatusText(customActionsStatus, ipcErrorMessage(err), false);
    }
  });

  function setStatusText(el, text, ok) {
    el.textContent = text;
    el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  }

  async function openSettings() {
    if (compact) await setCompact(false);
    settings = await window.ghost.getSettings();
    selectTab(lastTab);
    openOverlay(settingsOverlay);
    applyTheme(settings.theme);
    syncCustomActions(settings);
    renderCustomActionEditor();
    customActionsStatus.textContent = '';
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
