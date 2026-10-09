// `npm start`: everything needed to play, in one command. Installs the
// dependencies the first time (or after they were deleted), then serves the
// game on http://localhost:9000 and opens it in the browser.
//
// Plain Node with no imports beyond the standard library, because it has to
// run before anything is installed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

if (!existsSync(path.join(root, "node_modules", "vite", "package.json"))) {
  console.log("First run: installing dependencies (this takes a minute)...");
  const install = spawnSync(npm, ["ci", "--ignore-scripts"], {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
  });
  if (install.status !== 0) {
    console.error("Installing dependencies failed; see the output above.");
    process.exit(install.status ?? 1);
  }
}

const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [vite, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
