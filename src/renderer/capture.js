// Capture helpers. Screen screenshots use a one-shot getDisplayMedia grab
// (video only, discarded immediately after). Mic uses plain getUserMedia.
// Meeting/system audio uses getDisplayMedia's Windows loopback path that
// main.js wires up via session.setDisplayMediaRequestHandler.
//
// Every getDisplayMedia call is preceded by window.ghost.armCapture(): the
// main process denies display-media requests that weren't armed moments
// before, so nothing can grab the screen silently in the background.
//
// Nothing here starts capturing until the user explicitly clicks a pill —
// there's no background listening by default.

(function () {
  const videoEl = document.getElementById('capture-video');
  const canvasEl = document.getElementById('capture-canvas');

  let micStream = null;
  let meetingStream = null;
  let micRecorder = null;
  let meetingRecorder = null;

  const rollingTranscript = { mic: [], meeting: [] };
  const MAX_TRANSCRIPT_CHARS = 6000;
  const transcriptListeners = new Set();

  // Screenshots are downscaled and JPEG-compressed before sending: a
  // full-resolution PNG is several MB, slow to upload and costs more tokens.
  const SCREENSHOT_MAX_SIDE = 1920;
  const SCREENSHOT_JPEG_QUALITY = 0.85;

  const CLIP_MS = 7000;
  const MIN_CLIP_BYTES = 800;
  // Peak RMS level below which a clip is treated as silence and skipped.
  const SILENCE_RMS = 0.01;
  // At most one transcription request in flight; if the provider is slow,
  // keep only the newest few clips instead of piling requests up.
  const MAX_QUEUED_CLIPS = 2;

  function notifyTranscript() {
    for (const cb of transcriptListeners) {
      try { cb(); } catch (err) { console.warn('transcript listener failed', err); }
    }
  }

  function pushTranscript(source, text) {
    if (!text || !text.trim()) return;
    const bucket = rollingTranscript[source];
    bucket.push(text.trim());
    const joined = bucket.join(' ');
    if (joined.length > MAX_TRANSCRIPT_CHARS) {
      rollingTranscript[source] = [joined.slice(joined.length - MAX_TRANSCRIPT_CHARS)];
    }
    notifyTranscript();
  }

  function getCombinedTranscript() {
    const lines = [];
    if (rollingTranscript.mic.length) lines.push(`[You] ${rollingTranscript.mic.join(' ')}`);
    if (rollingTranscript.meeting.length) lines.push(`[Meeting audio] ${rollingTranscript.meeting.join(' ')}`);
    return lines.join('\n\n');
  }

  // Bumped on every clear so clips recorded before the clear (still queued
  // or mid-transcription) don't repopulate the transcript afterwards.
  const generation = { mic: 0, meeting: 0 };

  function clearTranscript(source) {
    for (const key of source ? [source] : ['mic', 'meeting']) {
      rollingTranscript[key] = [];
      generation[key]++;
    }
    notifyTranscript();
  }

  // ---- One-shot screenshot ----
  async function captureScreenshot() {
    await window.ghost.armCapture('screen');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      videoEl.srcObject = stream;
      await videoEl.play();
      // let a frame or two render
      await new Promise((r) => setTimeout(r, 120));
      const scale = Math.min(1, SCREENSHOT_MAX_SIDE / Math.max(videoEl.videoWidth, videoEl.videoHeight));
      canvasEl.width = Math.round(videoEl.videoWidth * scale);
      canvasEl.height = Math.round(videoEl.videoHeight * scale);
      const ctx = canvasEl.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      const dataUrl = canvasEl.toDataURL('image/jpeg', SCREENSHOT_JPEG_QUALITY);
      return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
      canvasEl.width = canvasEl.height = 0; // drop the pixels
    }
  }

  // ---- Transcription queue ----
  const clipQueue = [];
  let transcribing = false;

  function enqueueClip(job) {
    clipQueue.push(job);
    while (clipQueue.length > MAX_QUEUED_CLIPS) clipQueue.shift(); // drop oldest
    drainQueue();
  }

  async function drainQueue() {
    if (transcribing) return;
    const job = clipQueue.shift();
    if (!job) return;
    transcribing = true;
    try {
      const b64 = arrayBufferToBase64(await job.blob.arrayBuffer());
      const text = await window.ghost.transcribeClip(b64, 'audio/webm');
      if (job.generation !== generation[job.sourceKey]) return; // cleared meanwhile
      pushTranscript(job.sourceKey, text);
      if (job.onTranscribed) job.onTranscribed(text);
    } catch (err) {
      console.warn('transcription failed', err);
    } finally {
      transcribing = false;
      drainQueue();
    }
  }

  // ---- Simple level meter used to skip silent clips ----
  function createLevelMeter(stream) {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
    }, 100);
    return {
      takePeak() { const p = peak; peak = 0; return p; },
      close() { clearInterval(timer); ctx.close().catch(() => {}); },
    };
  }

  // ---- Rolling recorder: records ~7s clips and queues them for
  // transcription, appending to the rolling transcript.
  function startRollingRecorder(stream, sourceKey, onTranscribed) {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const meter = createLevelMeter(stream);
    const clipPeaks = []; // one entry per stop(), matched to dataavailable in order

    recorder.ondataavailable = (e) => {
      const peak = clipPeaks.shift() ?? 1;
      if (!e.data || e.data.size < MIN_CLIP_BYTES) return; // empty
      if (peak < SILENCE_RMS) return;                       // silent
      enqueueClip({ blob: e.data, sourceKey, onTranscribed, generation: generation[sourceKey] });
    };

    const cut = () => { clipPeaks.push(meter.takePeak()); recorder.stop(); };

    recorder.start();
    const interval = setInterval(() => {
      if (recorder.state === 'recording') { cut(); recorder.start(); }
    }, CLIP_MS);

    return {
      stop() {
        clearInterval(interval);
        if (recorder.state === 'recording') cut();
        meter.close();
      },
    };
  }

  function arrayBufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function startMic(onTranscribed) {
    if (micStream) return;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micRecorder = startRollingRecorder(micStream, 'mic', onTranscribed);
  }

  function stopMic() {
    if (micRecorder) { micRecorder.stop(); micRecorder = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  }

  async function startMeeting(onTranscribed) {
    if (meetingStream) return;
    await window.ghost.armCapture('meeting');
    const raw = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    raw.getVideoTracks().forEach((t) => { t.stop(); raw.removeTrack(t); });
    if (!raw.getAudioTracks().length) throw new Error('No system audio track was granted');
    meetingStream = raw;
    meetingRecorder = startRollingRecorder(meetingStream, 'meeting', onTranscribed);
  }

  function stopMeeting() {
    if (meetingRecorder) { meetingRecorder.stop(); meetingRecorder = null; }
    if (meetingStream) { meetingStream.getTracks().forEach((t) => t.stop()); meetingStream = null; }
  }

  window.ghostCapture = {
    captureScreenshot,
    startMic, stopMic,
    startMeeting, stopMeeting,
    getCombinedTranscript, clearTranscript,
    onTranscriptChange: (cb) => { transcriptListeners.add(cb); return () => transcriptListeners.delete(cb); },
    isMicOn: () => !!micStream,
    isMeetingOn: () => !!meetingStream,
  };
})();
