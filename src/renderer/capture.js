// Capture helpers. Screen screenshots use a one-shot getDisplayMedia grab
// (video only, discarded immediately after). Mic uses plain getUserMedia.
// Meeting/system audio uses getDisplayMedia's Windows loopback path that
// main.js wires up via session.setDisplayMediaRequestHandler.
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

  function pushTranscript(source, text) {
    if (!text || !text.trim()) return;
    const bucket = rollingTranscript[source];
    bucket.push(text.trim());
    let joined = bucket.join(' ');
    if (joined.length > MAX_TRANSCRIPT_CHARS) {
      joined = joined.slice(joined.length - MAX_TRANSCRIPT_CHARS);
      rollingTranscript[source] = [joined];
    }
  }

  function getCombinedTranscript() {
    const lines = [];
    if (rollingTranscript.mic.length) lines.push(`[You] ${rollingTranscript.mic.join(' ')}`);
    if (rollingTranscript.meeting.length) lines.push(`[Meeting audio] ${rollingTranscript.meeting.join(' ')}`);
    return lines.join('\n\n');
  }

  function clearTranscript() {
    rollingTranscript.mic = [];
    rollingTranscript.meeting = [];
  }

  // ---- One-shot screenshot ----
  async function captureScreenshot() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      videoEl.srcObject = stream;
      await videoEl.play();
      // let a frame or two render
      await new Promise((r) => setTimeout(r, 120));
      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      const ctx = canvasEl.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      const dataUrl = canvasEl.toDataURL('image/png');
      return dataUrl.split(',')[1]; // base64 only
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    }
  }

  // ---- Rolling recorder: records N-second clips and ships them off for
  // transcription in the background, appending to the rolling transcript.
  function startRollingRecorder(stream, sourceKey, onTranscribed) {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size < 800) return; // skip near-silent/empty
      try {
        const buf = await e.data.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        const text = await window.ghost.transcribeClip(b64, 'audio/webm');
        pushTranscript(sourceKey, text);
        if (onTranscribed) onTranscribed(text);
      } catch (err) {
        console.warn('transcription failed', err);
      }
    };
    recorder.start();
    // slice into ~7s chunks
    const interval = setInterval(() => {
      if (recorder.state === 'recording') { recorder.stop(); recorder.start(); }
    }, 7000);
    recorder._ghostInterval = interval;
    return recorder;
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
    if (micRecorder) { clearInterval(micRecorder._ghostInterval); micRecorder.stop(); micRecorder = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  }

  async function startMeeting(onTranscribed) {
    if (meetingStream) return;
    const raw = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    raw.getVideoTracks().forEach((t) => { t.stop(); raw.removeTrack(t); });
    meetingStream = raw;
    meetingRecorder = startRollingRecorder(meetingStream, 'meeting', onTranscribed);
  }

  function stopMeeting() {
    if (meetingRecorder) { clearInterval(meetingRecorder._ghostInterval); meetingRecorder.stop(); meetingRecorder = null; }
    if (meetingStream) { meetingStream.getTracks().forEach((t) => t.stop()); meetingStream = null; }
  }

  window.ghostCapture = {
    captureScreenshot,
    startMic, stopMic,
    startMeeting, stopMeeting,
    getCombinedTranscript, clearTranscript,
    isMicOn: () => !!micStream,
    isMeetingOn: () => !!meetingStream,
  };
})();
