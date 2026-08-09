import { readFile, writeFile } from "node:fs/promises";

const packagePath = "package.json";
const manifestPath = "manifest.json";
const popupPath = "src/popup.ts";

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const version = packageJson.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Unsupported extension version: ${version}`);
}

const popup = await readFile(popupPath, "utf8");
const popupVersionPattern = /const POPUP_VERSION = "[^"]+";/;

if (!popupVersionPattern.test(popup)) {
  throw new Error(`Could not find POPUP_VERSION in ${popupPath}`);
}

const updatedPopup = popup.replace(popupVersionPattern, `const POPUP_VERSION = "${version}";`);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(popupPath, updatedPopup);
console.log(`Synchronized extension version ${version}`);
