/** Validate the signed APK, then create a version-bound Minisign update and its public manifest. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { releaseNotes } from "./release-notes.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const apk = resolve(
  process.argv[2] ||
    "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk",
);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw Error("ANDROID_HOME is required");
const tools = join(
  sdk,
  "build-tools",
  process.env.ANDROID_BUILD_TOOLS || "37.0.0",
);
const certificates = execFileSync(
  join(tools, "apksigner"),
  ["verify", "--print-certs", apk],
  { encoding: "utf8" },
);
const fingerprints = new Set(
  [
    ...certificates.matchAll(/certificate SHA-256 digest:\s*([a-f0-9]{64})/gi),
  ].map((match) => match[1].toLowerCase()),
);
const expected = (
  await readFile("release/android-certificate.sha256", "utf8")
).trim();
if (fingerprints.size !== 1 || !fingerprints.has(expected))
  throw Error("APK signing identity changed; publication stopped");
execFileSync(join(tools, "zipalign"), ["-c", "-P", "16", "4", apk], {
  stdio: "pipe",
});
const badging = execFileSync(join(tools, "aapt2"), ["dump", "badging", apk], {
  encoding: "utf8",
});
if (
  !badging.includes(`versionName='${version}'`) ||
  !badging.includes("package: name='io.github.piayboy894.xuxian'")
)
  throw Error("APK package or version does not match the release");
if (!badging.includes("'arm64-v8a'") || !badging.includes("'x86_64'"))
  throw Error("APK is missing a supported ABI");
const directory = resolve("work/android-release");
await mkdir(directory, { recursive: true });
const name = `Xuxian_${version}_android.apk`,
  destination = join(directory, name);
await copyFile(apk, destination);
let material = process.env.TAURI_SIGNING_PRIVATE_KEY;
if (!material) throw Error("Release signing key is missing");
if (existsSync(material)) material = await readFile(material, "utf8");
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/@tauri-apps/cli/tauri.js",
      "signer",
      "sign",
      "--app-version",
      version,
      "--password",
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "",
      destination,
    ],
    {
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: material },
      stdio: "pipe",
    },
  );
} catch {
  throw Error("APK update signing failed; no manifest was published");
}
const signature = (await readFile(destination + ".sig", "utf8")).trim();
const sha256 = createHash("sha256")
  .update(await readFile(destination))
  .digest("hex");
await writeFile(
  join(directory, "android-latest.json"),
  JSON.stringify(
    {
      version,
      notes: releaseNotes(version),
      url: `https://github.com/piayboy894/Galgame-Notebook/releases/download/v${version}/${name}`,
      signature,
      sha256,
      apk_certificate_sha256: expected,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(directory, "android-SHA256SUMS.txt"),
  `${sha256}  ${name}\n`,
);
process.stdout.write(
  `Verified Android ${version}: stable signing certificate, arm64/x86_64 and 16 KB ZIP alignment.\n`,
);
