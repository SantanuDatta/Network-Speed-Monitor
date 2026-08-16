# Network Speed Monitor

[![CI](https://github.com/SantanuDatta/Network-Speed-Monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/SantanuDatta/Network-Speed-Monitor/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Network Speed Monitor is a Firefox extension for observing the health of an Internet connection over time. It periodically probes a configurable HTTPS endpoint, measures response latency, records connection transitions, and presents the results in a popup and dashboard.

The project is intentionally local-first: monitoring history and settings stay in Firefox, and the extension does not inspect visited pages or require an account.

## Features

- Configurable connectivity checks at 1, 2, 3, or 5-second intervals.
- Online, connection-issue, offline, and no-data states.
- Response latency and public IP display.
- Real-time latency view with recent probes.
- Connection log with CSV and PDF report export.
- Daily, weekly, monthly, and all-time availability statistics.
- Independent severity indicators for latency, disconnects, availability, and downtime.
- Optional sounds when the connection comes back or a probe fails.
- Start/stop monitoring and manual probe controls.
- Light and dark toolbar icon variants for Firefox themes.

## Support

- Firefox desktop 152 or newer.
- TypeScript 6, Node.js 20 or newer, and current Firefox tooling for development.

This repository targets Firefox desktop.

## Install

### From a release

Download the latest release archive from the repository's [Releases](https://github.com/SantanuDatta/Network-Speed-Monitor/releases) page. Signed AMO releases can be installed normally through Firefox. A locally built archive is intended for AMO submission or temporary development installation.

### Temporary installation during development

1. Install the development dependencies with `npm install`.
2. Run `npm run dev`.
3. In Firefox, open `about:debugging#/runtime/this-firefox` if it is not opened automatically.
4. Select **Load Temporary Add-on** and choose `dist/manifest.json`.

After making changes, run `npm run build` and use **Reload** for the temporary add-on. Temporary add-ons are removed when Firefox closes.

## Development

```sh
npm install
npm run dev
```

The project is compiled from `src/` into `dist/`. The build copies the manifest, HTML, CSS, locale files, and assets into the distribution directory.

### Useful commands

| Command                    | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`              | Build and launch Firefox with the extension available in `about:debugging`. |
| `npm run build`            | Compile TypeScript and create `dist/`.                                      |
| `npm run build-for-amo`    | Create the reproducible AMO build in `dist/`.                               |
| `npm run format`           | Format the repository with Oxfmt.                                           |
| `npm run lint`             | Type-check the project and run Oxlint.                                      |
| `npm test`                 | Run the Vitest test suite.                                                  |
| `npm run lint:web-ext`     | Validate the built extension with web-ext.                                  |
| `npm run check`            | Run formatting checks, linting, tests, and a production build.              |
| `npm run package`          | Build and create a distributable archive in `web-ext-artifacts/`.           |
| `npm run release -- patch` | Validate, tag, push, and publish the next patch release.                    |

Before opening a pull request, run:

```sh
npm run format
npm run lint
npm test
npm run build
npm run lint:web-ext
```

GitHub Actions runs the same quality gates for pushes and pull requests. Oxfmt, Oxlint, and Vitest are used alongside TypeScript; no generated or minified source is required for local development.

## Project layout

```text
src/
  background.ts   Extension message handling and monitor lifecycle
  monitor.ts      HTTPS probes, latency, status transitions, and sounds
  model.ts        Runtime state and statistics calculations
  storage.ts      Firefox local-storage persistence
  popup.ts        Toolbar popup UI
  dashboard.ts    Realtime, log, statistics, and settings pages
  export.ts       CSV and PDF report generation
tests/            Vitest tests
assets/           Toolbar, listing, and interface icons
_locales/         Firefox localization messages
scripts/          Build, version synchronization, and release helpers
```

## Permissions and privacy

The extension requests `storage`, access to the default Google probe, and access to `api.ipify.org` for the public IP display. Choosing a custom HTTPS probe asks Firefox for optional permission to contact that host.

Only the selected probe and public-IP service receive the HTTPS requests needed for their measurements. Monitoring history, settings, and reports are stored locally in Firefox and are not sent to the developer. The complete policy is available in [PRIVACY.md](PRIVACY.md).

## Publishing

Run `npm run package` to create a distributable archive in `web-ext-artifacts/`. For normal releases, use the command below so versioning, validation, pushing, and GitHub publishing stay in one flow.

To publish a release from `main`, run one command with the desired version change:

```sh
npm run release -- patch   # 1.0.4 -> 1.0.5
npm run release -- minor   # 1.0.5 -> 1.1.0
npm run release -- major   # 1.1.0 -> 2.0.0
npm run release -- 1.2.0   # set an exact version
```

The command synchronizes the manifest and popup version, formats and validates the project, commits the release, creates the `vX.Y.Z` tag, and pushes both the commit and tag. Pushing the tag starts the GitHub Actions release workflow, which rebuilds the extension, validates it with `web-ext`, and attaches the archive to a generated GitHub release.

For AMO source-code review, submit the repository source archive rather than `dist/` alone. It includes the TypeScript source, lockfile, build script, tests, and configuration needed to reproduce the extension. Reviewers can reproduce the build with `npm ci && npm run build-for-amo`.

## Contributing

Issues and pull requests are welcome. Please include:

- the Firefox version and operating system;
- the extension version or commit being tested;
- steps to reproduce the issue;
- relevant console output or screenshots with private data removed.

Keep changes focused, preserve the Firefox-only scope, add or update tests when behavior changes, and run the validation commands above before submitting a pull request.

## License

Network Speed Monitor is licensed under the [GNU General Public License v3.0](LICENSE).
