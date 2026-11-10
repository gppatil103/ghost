(function () {
  const overlay = document.getElementById('tutorial-overlay');
  const sheet = document.getElementById('tutorial-sheet');

  const steps = [
    {
      title: 'Welcome to Ghost 👋',
      body: `Ghost is a small floating panel that can help you while you
work — look at your screen when you ask, listen to your mic, and hear
meeting audio, so it can assist in real time. Nothing happens
automatically: you turn each input on and off yourself.`,
    },
    {
      title: 'Add your API key',
      body: `Ghost is bring-your-own-key: it needs an API key from OpenAI,
Anthropic, or Google Gemini to think. Your key is encrypted and stored only
on this PC — it's never sent anywhere except directly to the provider you
choose. You can add or change it any time from Settings (⚙).`,
    },
    {
      title: 'Screen, mic, and meeting audio',
      body: `Click the "Screen" pill to let Ghost see a single screenshot
when you ask it something. Click "Mic" or "Meeting" to start a rolling,
short-term transcript of your voice or system audio — useful during a call
or while working through a problem out loud. Turn any of these off any
time; Ghost never listens or looks in the background by default.`,
    },
    {
      title: 'What gets captured',
      body: `Screen grabs a single still image of your main display — only at
the moment you click it (or run "Solve coding problem"). Meeting listens
to your PC's system audio until you turn it off; a red ● REC badge shows
while Mic or Meeting is on. For Mic, Windows may show a one-time
microphone permission prompt. Other people's voices are sent to your AI
provider, so get their consent before transcribing a call.`,
    },
    {
      title: 'A note on privacy and honesty',
      body: `Ghost can attempt to hide its own window from screen-shares and
recordings on Windows (off by default — toggle it in Settings). This is best-effort only — it
is not guaranteed to work in every app and can be defeated by OS updates or
recording tools. Please only use this for legitimate purposes, like private
note-taking or personal assistance, and follow your organization's and
meeting counterparts' policies on recording, consent, and AI use.`,
    },
    {
      title: 'Zoom tip',
      body: `To let Ghost hear other people on a Zoom call (not just you),
Zoom's audio needs to actually be playing out of your speakers — Ghost
captures meeting audio via Windows system-audio loopback, not from Zoom
directly. If you're on exclusive-mode headphones or a virtual audio device,
switch to your normal speaker output first.`,
    },
    {
      title: 'Shortcuts to remember',
      body: `Ctrl+Shift+G shows/hides the panel. Ctrl+Shift+A is Assist,
Ctrl+Shift+C solves a coding problem on screen, Ctrl+Shift+K jumps to "Ask
anything", Ctrl+Shift+L toggles the mic. Ghost remembers the conversation
until you press ＋ for a new chat. You can change every shortcut in
Settings. You're all set — have fun.`,
    },
  ];

  let idx = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function render() {
    const s = steps[idx];
    const step = el('div', 'tutorial-step');
    step.append(el('h2', '', s.title), el('p', '', s.body.replace(/\s*\n\s*/g, ' ')));

    const dots = el('div', 'tutorial-dots');
    steps.forEach((_, i) => dots.appendChild(el('span', i === idx ? 'active' : '')));

    const nav = el('div', 'tutorial-nav');
    const skip = el('button', 'btn-ghost', 'Skip');
    const next = el('button', 'btn-primary', idx === steps.length - 1 ? 'Get started' : 'Next');
    skip.addEventListener('click', finish);
    next.addEventListener('click', () => {
      if (idx === steps.length - 1) finish();
      else { idx++; render(); }
    });
    nav.append(skip, next);

    sheet.replaceChildren(step, dots, nav);
  }

  function finish() {
    overlay.classList.add('hidden');
    window.ghost.completeOnboarding();
  }

  function start() {
    idx = 0;
    overlay.classList.remove('hidden');
    render();
  }

  window.ghostTutorial = { start };
})();
