import { spawn } from "node:child_process";

const url = process.env.APP_URL || "http://127.0.0.1:1420";
let server;
async function ready() {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
try {
  if (!(await ready())) {
    server = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
      { stdio: "inherit" },
    );
    for (let attempt = 0; !(await ready()); attempt++) {
      if (attempt > 60 || server.exitCode !== null)
        throw new Error("Preview server did not become ready.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const smokeTests = [
    "tests/editor_smoke.py",
    "tests/desktop_smoke.py",
    "tests/scenes_smoke.py",
    "tests/clipboard_smoke.py",
    "tests/investigation_cards_smoke.py",
    "tests/investigation_pool_smoke.py",
    "tests/encyclopedia_smoke.py",
    "tests/github_sync_smoke.py",
    "tests/android_smoke.py",
    "tests/touch_graph_smoke.py",
    "tests/dialogue_smoke.py",
  ];
  const requested = process.argv.slice(2);
  for (const path of requested.length ? requested : smokeTests) {
    const child = spawn(process.env.PYTHON || "python", [path], {
      stdio: "inherit",
      env: { ...process.env, APP_URL: url },
    });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) throw new Error(`${path} failed (${code})`);
  }
} finally {
  server?.kill();
}
