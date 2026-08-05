# Network Speed Monitor for Firefox

A Firefox extension for desktop and Android that checks Internet connectivity and records outages, latency, availability, public IP changes, and no-data gaps caused by sleep, shutdown, or paused monitoring.

Repository: <https://github.com/SantanuDatta/Network-Speed-Monitor>

## Features

- Connectivity checks every 1, 2, 3, or 5 seconds.
- Online, connection-issue, offline, and no-data statuses.
- Public IP lookup, latency history, toolbar status, and transition sounds.
- Realtime monitor, event log, availability statistics, CSV export, and PDF report export.
- Monitoring history is stored locally. The extension does not access browsing history or page contents, use analytics, or require an account.

## Development

Requirements: Node.js 20+ and Firefox 152+ for desktop or Android.

```sh
npm install
npm run format
npm run check
npm run build-for-amo
npm run package
```

The distributable archive is created in `web-ext-artifacts/`. For day-to-day testing, run `npm run dev`; it builds the extension and opens Firefox's **This Firefox** developer page. Choose **Load Temporary Add-on** once and select `dist/manifest.json`. Firefox keeps that temporary add-on running in your normal browser session; use **Reload** on the same page after later builds.

For AMO source-code review, submit this repository as the source package. It contains the TypeScript source, `package-lock.json`, and the `build-for-amo` script that reproduces the Firefox build in `dist/`.

The bundled Google probe and public-IP service are declared in the manifest. Selecting a custom probe URL requests optional access to that host when you save or start monitoring with it.

## Firefox for Android

The manifest explicitly supports Firefox for Android and the dashboard adapts to narrow screens. Install the signed add-on from AMO or Firefox for Android's Add-ons Manager. Android may suspend Firefox while it is backgrounded; these periods are recorded as **No data**, not as a disconnect or downtime.

## Publishing

Before AMO submission, replace `network-speed-monitor@example.local` in `manifest.json` with an owned, stable add-on ID. Run `npm run package`, then submit the versioned archive from `web-ext-artifacts/`. AMO reviewers may also request the corresponding source repository.

The selected probe host and optional public-IP service receive normal HTTPS requests needed to provide their responses. No browsing data is sent to either service.

The full privacy policy is available in [PRIVACY.md](PRIVACY.md).

## License

Network Speed Monitor is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for the full text.
