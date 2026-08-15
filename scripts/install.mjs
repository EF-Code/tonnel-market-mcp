import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const setupArgs = process.argv.slice(2);

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("tonnel-market-mcp requires Node.js 22 or newer.");
  process.exit(1);
}

if (!existsSync(join(root, "package-lock.json"))) {
  console.error("Run this installer from the repository checkout.");
  process.exit(1);
}

try {
  console.error("Installing dependencies...");
  execFileSync(npmCommand, ["ci"], { cwd: root, stdio: "inherit" });
  console.error("Building tonnel-market-mcp...");
  execFileSync(npmCommand, ["run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  console.error("Configuring detected MCP hosts...");
  execFileSync(
    process.execPath,
    [join(root, "dist", "src", "cli.js"), "setup", ...setupArgs],
    { cwd: root, stdio: "inherit" },
  );
} catch (error) {
  const status =
    error && typeof error === "object" && "status" in error ? error.status : 1;
  process.exit(typeof status === "number" ? status : 1);
}
