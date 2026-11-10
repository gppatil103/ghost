// @ts-check
// Turns provider HTTP / network failures into short, user-facing messages
// and flags which ones are worth a "Retry" button.

class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, retryable?: boolean }} [opts]
   */
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

const PROVIDER_LABELS = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini' };

/** Pull a human-readable message out of a provider's JSON error body. */
function extractDetail(body) {
  try {
    const json = JSON.parse(body);
    const err = Array.isArray(json) ? json[0]?.error : json.error;
    return (err && (err.message || err.status)) || '';
  } catch {
    return '';
  }
}

/**
 * @param {string} provider
 * @param {number} status
 * @param {string} body
 */
function httpError(provider, status, body) {
  const name = PROVIDER_LABELS[provider] || provider;
  const detail = extractDetail(body).slice(0, 200);
  const suffix = detail ? ` (${detail})` : '';

  if (status === 401 || status === 403) {
    return new ProviderError(`${name} rejected your API key. Check or replace it in Settings.${suffix}`, { status });
  }
  if (status === 400 && /api key|api_key|API_KEY_INVALID/i.test(body)) {
    return new ProviderError(`${name} rejected your API key. Check or replace it in Settings.`, { status });
  }
  if (status === 404) {
    return new ProviderError(`${name} doesn't recognise that model. Check the model ids in Settings.${suffix}`, { status });
  }
  if (status === 429) {
    return new ProviderError(`${name} rate limit or quota reached. Wait a moment, or check your plan/billing.${suffix}`, { status, retryable: true });
  }
  if (status >= 500) {
    return new ProviderError(`${name} is having trouble right now (HTTP ${status}). Try again shortly.`, { status, retryable: true });
  }
  return new ProviderError(`${name} error ${status}${suffix || `: ${body.slice(0, 200)}`}`, { status });
}

/** Map fetch/abort/timeout failures to friendly messages; pass others through. */
function networkError(provider, err) {
  if (err instanceof ProviderError) return err;
  const name = PROVIDER_LABELS[provider] || provider;
  if (err && err.name === 'TimeoutError') {
    return new ProviderError(`${name} took too long to respond.`, { retryable: true });
  }
  if (err && err.name === 'AbortError') return err; // user pressed Stop
  if (err instanceof TypeError && /fetch failed|network/i.test(err.message)) {
    return new ProviderError(`Couldn't reach ${name}. Check your internet connection.`, { retryable: true });
  }
  return err;
}

module.exports = { ProviderError, httpError, networkError };
