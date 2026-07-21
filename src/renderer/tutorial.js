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
      title: 'Windows will ask for permission',
      body: `The first time you turn on Screen or Meeting, Windows shows a
built-in picker asking which screen to share — pick your main display.
For Mic, Windows may show a one-time microphone permission prompt.`,
    },
    {
      title: 'A note on privacy and honesty',
      body: `Ghost can attempt to hide its own window from screen-shares and
recordings on Windows (toggle in Settings). This is best-effort only — it
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
anything". Full list is in Settings. You're all set — have fun.`,
    },
  ];

  let idx = 0;

  function render() {
    const s = steps[idx];
    const dots = steps.map((_, i) => `<span class="${i === idx ? 'active' : ''}"></span>`).join('');
    sheet.innerHTML = `
      <div class="tutorial-step">
        <h2>${s.title}</h2>
        <p>${s.body}</p>
      </div>
      <div class="tutorial-dots">${dots}</div>
      <div class="tutorial-nav">
        <button class="btn-ghost" id="tut-skip">Skip</button>
        <button class="btn-primary" id="tut-next">${idx === steps.length - 1 ? 'Get started' : 'Next'}</button>
      </div>
    `;
    document.getElementById('tut-skip').onclick = finish;
    document.getElementById('tut-next').onclick = () => {
      if (idx === steps.length - 1) finish();
      else { idx++; render(); }
    };
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
