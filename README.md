# Network Speed Monitor for Firefox

A Firefox extension for desktop and Android that checks Internet connectivity and records outages, latency, availability, public IP changes, and no-data gaps caused by sleep, shutdown, or paused monitoring.

## Features

- Connectivity checks every 1, 2, 3, or 5 seconds.
- Online, connection-issue, offline, and no-data statuses.
- Public IP lookup, latency history, toolbar status, and transition sounds.
- Realtime monitor, event log, availability statistics, CSV export, and PDF report export.
- Local-only history. No browsing history, page contents, analytics, or remote account is used.

## Development

Requirements: Node.js 20+ and Firefox desktop 152+.

```sh
npm install
npm run format
npm run check
npm run package
```

The distributable archive is created in `web-ext-artifacts/`. For day-to-day testing, run `npm run dev`; it builds the extension and opens Firefox's **This Firefox** developer page. Choose **Load Temporary Add-on** once and select `dist/manifest.json`. Firefox keeps that temporary add-on running in your normal browser session; use **Reload** on the same page after later builds.

Firefox grants the bundled Google probe host and public-IP service when the extension is installed. Selecting a custom probe URL requests access to that host once, when you save or start monitoring with it.

## Firefox for Android

The manifest explicitly supports Firefox for Android and the dashboard adapts to narrow screens. Install the signed add-on from AMO or Firefox for Android's Add-ons Manager. Android may suspend Firefox while it is backgrounded; these periods are recorded as **No data**, not as a disconnect or downtime.

## Publishing

Before AMO submission, replace `network-speed-monitor@example.local` in `manifest.json` with an owned, stable add-on ID. Submit the generated archive and this repository's source. The extension stores monitoring data only in Firefox; the selected probe host and optional public-IP service receive normal HTTPS requests needed to provide their responses.
