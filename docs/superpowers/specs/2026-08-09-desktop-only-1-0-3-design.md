# Network Speed Monitor 1.0.3: Desktop-only release design

## Goal

Prepare version 1.0.3 as a desktop Firefox release. The extension will no longer advertise or declare Firefox for Android compatibility because continuous one-second monitoring and background alert playback are not a reliable or battery-friendly mobile experience.

The release also corrects the visual alignment of the Mozilla listing icons while preserving the existing navy/indigo visual language.

## Scope

### Desktop-only compatibility

- Remove the `browser_specific_settings.gecko_android` compatibility block from `manifest.json`.
- Keep the desktop `gecko.strict_min_version` declaration unchanged.
- Update `README.md` so requirements and publishing guidance describe desktop Firefox only.
- Remove the Android-specific README section and change the narrow-layout CSS comment to describe narrow Firefox windows without claiming Android support.
- Keep responsive CSS itself; it remains useful for compact desktop windows and dashboard tabs.

### Listing icon alignment

- Rebuild `assets/icons/listing-48.png` and `assets/icons/listing-96.png` from the existing white gauge artwork.
- Preserve the dark navy rounded tile, border, and subtle indigo accent already used by the extension.
- Trim the source artwork, then place it with exact geometric centering in each square canvas so both sizes use the same composition.
- Do not alter toolbar icon assets or the popup/dashboard logo treatment.

### Versioning and artifacts

- Bump the extension version consistently to `1.0.3` in `package.json`, `package-lock.json`, `manifest.json`, and the popup footer constant.
- Rebuild the `dist/` directory and generate fresh ZIP and XPI artifacts under `web-ext-artifacts/`.
- Do not change monitoring, alert, permissions, or data-storage behavior in this release; alert debouncing remains a separate follow-up.

## Verification

Run the existing formatting, TypeScript, test, and build checks. Then run `web-ext lint` against `dist/`, inspect the manifest to confirm there is no `gecko_android` key, verify both listing PNG dimensions, and validate the generated ZIP/XPI archives with `unzip -t`.
