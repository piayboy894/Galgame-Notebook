import { releaseNotes } from "./release-notes.mjs";
/** Publish complete, already signed Windows and Android assets. Never reads signing keys. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const repository = "piayboy894/Galgame-Notebook";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || version !== config.version)
  throw new Error("Run version:sync before publishing.");
const installer = resolve(
  process.argv[2] ||
    `src-tauri/target/release/bundle/nsis/Xuxian_${version}_x64-setup.exe`,
);
const bytes = await readFile(installer);
const signature = (await readFile(installer + ".sig", "utf8")).trim();
if (
  !Buffer.from(signature, "base64")
    .toString("utf8")
    .includes(`version:${version}`)
)
  throw new Error(
    "Installer signature does not name this release version. Rebuild with the current Tauri CLI.",
  );
const tag = `v${version}`;
const androidFolder = resolve("work/android-release");
const androidApk = `${androidFolder}/Xuxian_${version}_android.apk`;
const androidBytes = await readFile(androidApk);
const androidSignature = (await readFile(androidApk + ".sig", "utf8")).trim();
const androidManifest = JSON.parse(
  await readFile(`${androidFolder}/android-latest.json`, "utf8"),
);
if (
  androidManifest.version !== version ||
  androidManifest.signature !== androidSignature ||
  androidManifest.url !==
    `https://github.com/${repository}/releases/download/${tag}/${basename(androidApk)}` ||
  androidManifest.sha256 !==
    createHash("sha256").update(androidBytes).digest("hex") ||
  !Buffer.from(androidSignature, "base64")
    .toString("utf8")
    .split(/\r?\n/)
    .some(
      (line) =>
        line.startsWith("trusted comment: ") &&
        line.split("\t").includes(`version:${version}`),
    )
)
  throw new Error(
    "Run scripts/android-release.mjs for the same version before publishing.",
  );
if (
  spawnSync("gh", ["release", "view", tag, "--repo", repository], {
    stdio: "ignore",
  }).status === 0
)
  throw new Error(
    `${tag} already exists. Bump the version instead of replacing a published program.`,
  );
const target = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
  encoding: "utf8",
}).split(/\s/)[0];
if (!/^[a-f0-9]{40}$/.test(target)) throw new Error("Cannot resolve main.");
const local = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  encoding: "utf8",
}).trim();
const remote = execFileSync("git", ["rev-parse", `${target}^{tree}`], {
  encoding: "utf8",
}).trim();
if (local !== remote)
  throw new Error(
    "Installer source must match the merged main tree. Fetch main first.",
  );
const folder = resolve("work/release");
await mkdir(folder, { recursive: true });
const manifest = {
  version,
  notes: releaseNotes(version),
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(basename(installer))}`,
      signature,
    },
  },
};
await writeFile(
  `${folder}/latest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  `${folder}/SHA256SUMS.txt`,
  createHash("sha256").update(bytes).digest("hex") +
    "  " +
    basename(installer) +
    "\n",
);
const notes = `叙线 ${tag} · Windows 10/11 x64 / Android 8+\n\nWindows 下载 Xuxian_${version}_x64-setup.exe；Android 下载 Xuxian_${version}_android.apk。也可在已安装的程序中检测更新。\n\n${releaseNotes(version)}\n`;
await writeFile(`${folder}/release-notes.md`, notes);
const run = (args) => execFileSync("gh", args, { stdio: "inherit" });
run([
  "release",
  "create",
  tag,
  installer,
  installer + ".sig",
  `${folder}/latest.json`,
  `${folder}/SHA256SUMS.txt`,
  androidApk,
  androidApk + ".sig",
  `${androidFolder}/android-latest.json`,
  `${androidFolder}/android-SHA256SUMS.txt`,
  "--repo",
  repository,
  "--target",
  target,
  "--title",
  `叙线 ${tag}`,
  "--notes-file",
  `${folder}/release-notes.md`,
  "--draft",
]);
run([
  "release",
  "edit",
  tag,
  "--repo",
  repository,
  "--draft=false",
  "--latest",
]);
console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
