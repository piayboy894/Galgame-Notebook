import { readFile, writeFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error("Release versions must be stable semver.");
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
config.version = pkg.version;
await writeFile(
  "src-tauri/tauri.conf.json",
  JSON.stringify(config, null, 2) + "\n",
);
for (const path of ["src-tauri/Cargo.toml", "crates/story-store/Cargo.toml"]) {
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source.replace(/^version = ".*"$/m, `version = "${pkg.version}"`),
  );
}
console.log(`Synchronized version ${pkg.version}`);
