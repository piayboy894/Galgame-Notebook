import { readFile, writeFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error("Release versions must be stable semver.");
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
config.version = pkg.version;
const npmLock = JSON.parse(await readFile("package-lock.json", "utf8"));
npmLock.version = pkg.version;
npmLock.packages[""].version = pkg.version;
await writeFile("package-lock.json", JSON.stringify(npmLock, null, 2) + "\n");
await writeFile(
  "src-tauri/tauri.conf.json",
  JSON.stringify(config, null, 2) + "\n",
);
for (const path of [
  "src-tauri/Cargo.toml",
  "crates/story-store/Cargo.toml",
  "crates/github-sync/Cargo.toml",
]) {
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source.replace(/^version = ".*"$/m, `version = "${pkg.version}"`),
  );
}
for (const path of [
  "src-tauri/Cargo.lock",
  "crates/story-store/Cargo.lock",
  "crates/github-sync/Cargo.lock",
]) {
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source.replace(
      /(name = "xuxian-(?:desktop|story-store|github-sync)"\nversion = ")[^"]+/g,
      `$1${pkg.version}`,
    ),
  );
}
console.log(`Synchronized version ${pkg.version}`);
