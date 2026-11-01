import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const npmCli = process.env.npm_execpath;
const versionArgument = process.argv[2];
const bumpNames = new Set(["patch", "minor", "major"]);
const explicitVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (
  !versionArgument ||
  (!bumpNames.has(versionArgument) && !explicitVersionPattern.test(versionArgument))
) {
  console.error("Usage: npm run release -- <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function readCommand(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function runNpm(args) {
  if (!npmCli) {
    throw new Error("Run releases through npm run release -- <patch|minor|major|X.Y.Z>.");
  }
  run(process.execPath, [npmCli, ...args]);
}

const branch = readCommand("git", ["branch", "--show-current"]);
if (branch !== "main") {
  throw new Error(
    `Releases must be created from main; current branch is ${branch || "detached HEAD"}.`
  );
}

if (readCommand("git", ["status", "--porcelain"])) {
  throw new Error("Releases require a clean working tree before versioning.");
}

runNpm(["version", versionArgument, "--no-git-tag-version"]);
runNpm(["run", "version:sync"]);
runNpm(["run", "format"]);
runNpm(["run", "check"]);
runNpm(["run", "lint:web-ext"]);
runNpm(["run", "package"]);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;

try {
  readCommand("git", ["rev-parse", "--verify", `refs/tags/${tag}`]);
  throw new Error(`Tag ${tag} already exists locally.`);
} catch (error) {
  if (error.status !== 128) {
    throw error;
  }
}

run("git", ["add", "-A"]);
run("git", ["commit", "-m", `chore(release): ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
run("git", ["push", "origin", "HEAD:main"]);
run("git", ["push", "origin", tag]);

console.log(
  `Released ${tag}. Archive created in web-ext-artifacts/; GitHub Actions will publish it.`
);
