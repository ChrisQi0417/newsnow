# NewsNow Information Desk

## Product Purpose

Help a Chinese-reading user scan international developments, inspect the original
source and publication time, and retain articles worth returning to. Prioritize
US technology and global markets while keeping China-focused reporting separate.

## Product Decisions

- The default route opens the real-time desk. Existing source URLs, subscriptions,
  market instruments, and the user-defined default module order remain intact.
- The former hottest route is labelled curated: its mixed news feeds do not have
  a shared, measurable popularity score. GitHub retains its own source ranking.
- Source view respects configured order; chronological view sorts explicit item
  publication dates. Missing dates remain unknown and sort last.
- Search operates over loaded titles, source labels, and supplied original text.
  It does not claim to search the entire web or fetch article full text.
- Exact article URLs are deduplicated in the timeline after removing tracking
  parameters. Similar headlines from different publishers are not merged.
- Market quotes expose structured values and signed changes, plus the upstream
  delay/market status and quote timestamp. Weather provides separate tabs for
  local/Beijing conditions, cyclones and earthquakes.
- X has separate Tibo and OpenAI filters; missing accounts are explicitly marked.
- Reading uses a keyboard-accessible native modal with original text when supplied,
  source context, the original article link and a save action.
- Article bookmarks (300) and reading history (1000) are device-local. Source
  subscriptions continue to use the existing metadata and sync mechanism.

## Freshness And Resilience

- Bulk cache hydration is bounded to two seconds; independent source loading
  proceeds if it fails. Source requests retain the existing concurrency limit.
- Initial content remains readable during background refreshes. Mounted sources
  update at their configured interval and when the page returns to the foreground
  or connectivity returns. Duplicate requests use the existing cooldown.
- Requests consume cancellation signals, including after waiting for a request
  slot, so leaving a view does not start abandoned network work.
- Cache hits preserve the actual stored retrieval timestamp. Server fallback
  responses carry an explicit refresh error without discarding cached items.
- Device snapshots retain up to 30 items per public source for at most 24 hours,
  capped at 60,000 characters each. Restored timestamps remain unchanged. Weather
  is excluded because its result is specific to the viewer's approximate location.
- Stale cache, source errors, offline state and partial account/weather results
  have visible states. Retrieval time never replaces article publication time.

## Validation

- Unit coverage: category mapping, exact deduplication, multiword search, missing
  dates, source identity, snapshot expiry and invalid data, cache timestamps and
  failed-refresh fallback.
- Browser checks: desktop/mobile layouts, theme switching, category filtering,
  search, reader opening/closing, saved articles across reload, subscriptions,
  subscription ordering, weather tabs, timeline and original links.
- Existing parser and metadata regression suites remain part of release checks.
