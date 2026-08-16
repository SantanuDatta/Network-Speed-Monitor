import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
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

const branch = readCommand("git", ["branch", "--show-current"]);
if (branch !== "main") {
  throw new Error(
    `Releases must be created from main; current branch is ${branch || "detached HEAD"}.`
  );
}

run(npmCommand, ["version", versionArgument, "--no-git-tag-version"]);
run(npmCommand, ["run", "version:sync"]);
run(npmCommand, ["run", "format"]);
run(npmCommand, ["run", "check"]);
run(npmCommand, ["run", "lint:web-ext"]);

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

console.log(`Released ${tag}. GitHub Actions will build and publish the archive.`);
