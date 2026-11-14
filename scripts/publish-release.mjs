/** Publish an already built and signed installer. Never reads or uploads the signing key. */
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
  notes: "叙线独立桌面版：GitHub 一键更新、剧本备份和旧项目导入。",
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
const notes = `叙线 ${tag} · Windows 10/11 x64\n\n下载下方 Xuxian_${version}_x64-setup.exe 并安装。独立桌面窗口，无需手动启动浏览器或 PowerShell。\n\n- 项目列表或更多菜单中检测 GitHub 更新，保存并备份后校验签名、一键安装。\n- 项目保存在系统「文档/叙线/剧本项目」，升级不会覆盖。\n- 旧版用户点击「导入旧版文件夹」复制原有项目，保留原文件。兼容 JSON v1–v3。\n- Tauri 2 + Rust 存储核心 + TypeScript 应用服务，保留现有路线、调查、分支和排序功能。\n\n本版本采用更新包签名；未配置微软 Authenticode 发布者证书。\n`;
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
