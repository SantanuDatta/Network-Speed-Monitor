# Development

Use Node.js 24 LTS. Supported versions are 22.12+ within 22.x, 24.x, and 26 or newer.
TypeScript stays on 6.x because the test harness uses its JavaScript compiler API.

## Development

```sh
npm install
npm run dev
```

The project is compiled from `src/` into `dist/`. The build copies the manifest, HTML, CSS, locale files, and assets into the distribution directory.

### Useful commands

| Command                | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `npm run dev`          | Build and launch Firefox with the extension available in `about:debugging`. |
| `npm run build`        | Compile TypeScript and create `dist/`.                                      |
| `npm run format`       | Format the repository with Oxfmt.                                           |
| `npm run lint`         | Type-check the project and run Oxlint.                                      |
| `npm test`             | Run the Vitest test suite.                                                  |
| `npm run lint:web-ext` | Validate the built extension with web-ext.                                  |
| `npm run check`        | Run formatting checks, linting, tests, and a production build.              |
| `npm run package`      | Build and create a distributable archive in `web-ext-artifacts/`.           |

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

## Contributing

Issues and pull requests are welcome. Please include:

- the Firefox version and operating system;
- the extension version or commit being tested;
- steps to reproduce the issue;
- relevant console output or screenshots with private data removed.

Keep changes focused, preserve the Firefox-only scope, add or update tests when behavior changes, and run the validation commands above before submitting a pull request.
