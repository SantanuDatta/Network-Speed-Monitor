import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const dist = path.join(root, "dist");
const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));

await rm(dist, { recursive: true, force: true });
execFileSync(process.execPath, [tsc], { cwd: root, stdio: "inherit" });

await mkdir(dist, { recursive: true });

for (const file of ["manifest.json", "src/popup.html", "src/dashboard.html", "src/style.css"]) {
  await cp(path.join(root, file), path.join(dist, path.basename(file)));
}

for (const directory of ["assets", "_locales"]) {
  await cp(path.join(root, directory), path.join(dist, directory), { recursive: true });
}
