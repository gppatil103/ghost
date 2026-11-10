// Minimal server-sent-events reader for the Node/undici fetch streaming
// body. Calls onEvent({ event, data }) for every "data: ..." line/block.

function parseBufferedEvents(buffer, onEvent) {
  let idx;
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const rawEvent = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let eventName = 'message';
    const dataLines = [];
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      else if (line.trim() && !line.startsWith(':')) dataLines.push(line.trim()); // tolerate unprefixed continuation lines
    }
    const data = dataLines.join('\n');
    if (data) onEvent({ event: eventName, data });
  }
  return buffer;
}

async function readSSE(response, onEvent) {
  if (!response.body) throw new Error('No response body to stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // Normalize CRLF to LF first — some providers (Gemini included) separate
    // SSE events with "\r\n\r\n" rather than "\n\n", which would otherwise
    // never match below and silently drop the entire stream.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    buffer = parseBufferedEvents(buffer, onEvent);
  }

  // Flush anything left over — the final event may not be followed by a
  // trailing blank line before the connection closes.
  buffer += decoder.decode().replace(/\r\n/g, '\n');
  if (buffer.trim()) {
    parseBufferedEvents(buffer + '\n\n', onEvent);
  }
}

module.exports = { readSSE };
