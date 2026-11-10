# Changelog

All notable changes to Ghost are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — Apple-style redesign

Renderer redesign; same features. Design: [docs/superpowers/specs/2026-11-10-ghost-apple-redesign-design.md](docs/superpowers/specs/2026-11-10-ghost-apple-redesign-design.md).

### Changed
- Decluttered fixed panel: compact title bar with icon capture toggles (Mic, Meeting, Screen, Transcript), a scrollable row of action chips, and a floating glass input bar that answers scroll under.
- Status messages appear as a short-lived toast instead of a permanent hint line.
- Settings is now a bottom sheet with tabs: AI · Look · Privacy · Keys. Long privacy and Zoom notes are folded under "Learn more".
- The opacity slider moved from the header to Settings → Look.
- Inline SVG icons replace emoji; system font with size-specific tracking; spring-curve motion (CSS `linear()` easing), press feedback on pointer-down.
- Respects Windows "reduce motion", reduced transparency and high-contrast preferences.

### Added
- Accent color setting (Blue, Violet, Green, Orange), validated in the main process.
- Copy / Retry row under each answer.

## [1.1.0] — 2026-10-27

Security hardening and quality release; addresses every item in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

### Security
- Removed the unrestricted `open-external` IPC handler.
- Screen / system-audio capture is only granted to Ghost's own page within 5 s of the user arming it; loopback audio only for Meeting. Unarmed requests are denied.
- Renderer now runs with `sandbox: true`; removed `experimentalFeatures`.
- Added permission request/check handlers (deny all except mic + clipboard write for Ghost's page).
- Blocked navigation, redirects, pop-ups and `<webview>`.
- Every IPC handler verifies the sender and validates input (allowlisted providers, actions, settings schema, model ids, shortcuts; size limits on images/audio/text). The provider can no longer be overridden by the renderer.
- Rate limits on LLM requests and transcription; 120 s request timeout, 30 s transcription timeout.
- Prompt-injection mitigations: captured transcript wrapped in delimited tags and marked untrusted; replies rendered without HTML; links shown as plain text.
- Stricter Content-Security-Policy (no `unsafe-inline` styles, `default-src 'none'`).
- Upgraded Electron 33 → 44 and electron-builder 25 → 26; Electron fuses enabled for packaged builds.
- Only the API key in use is decrypted per request.
- Settings writes are atomic (temp file + rename).

### Fixed
- **Ghost now remembers the conversation.** Recent turns are sent with each request for all three providers.
- Stream listeners no longer leak (one set registered for the page's lifetime).
- Tray "Settings" opens Settings instead of silently running an Assist request.
- "Hide from capture" is now genuinely off by default and the setting is respected.
- The transcript is cleared when capture stops (configurable) and on New chat.
- `Ctrl+Shift+L` (toggle mic) is now actually registered.
- Removed the stale duplicate `src/main.js`.
- Window build number log line printed a literal `${...}`.

### Added
- New chat button; optional encrypted chat history across restarts.
- Stop button for in-flight replies.
- Markdown rendering with code blocks and a Copy button.
- Token usage shown under each reply.
- Friendly provider errors (bad key, rate limit, outage, timeout, offline) with Retry.
- Per-provider model id overrides in Settings.
- Configurable global shortcuts with conflict detection.
- Live transcript viewer with Clear, and a ● REC indicator while audio is captured.
- Consent reminder for meeting capture.
- Panel opacity slider.
- App icon (`src/renderer/assets/icon.png`).
- Single-instance lock.

### Performance
- Screenshots are downscaled to ≤1920 px and JPEG-compressed (~200 KB instead of several MB).
- Silent audio clips are skipped using an RMS level meter.
- Transcription runs one clip at a time and drops the oldest when the provider falls behind.

### Tooling
- ESLint (flat config, bans `innerHTML` in the renderer), Prettier, Vitest unit tests, `jsconfig.json`.
- Shared IPC channel constants with a test that keeps the preload in sync.
- GitHub Actions CI (lint, test, `npm audit`) and Dependabot.

## [1.0.0]

- Initial release.
