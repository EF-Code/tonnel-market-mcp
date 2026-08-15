import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const expected = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/architecture.md",
  "docs/data-contract.md",
  "docs/operations.md",
  "docs/security.md",
  "docs/tool-reference.md",
  "dist/src/cli.js",
];
const forbidden = [
  "LUNA_MAX_TONNEL_MARKET_MCP_BUILD_PROMPT.md",
  "MARKETPLACE_EVENTS.md",
];

if (!existsSync(packageJson.bin["tonnel-market-mcp"])) {
  throw new Error(
    `Package entrypoint is missing: ${packageJson.bin["tonnel-market-mcp"]}`,
  );
}

const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const packResult = JSON.parse(output);
const pack = Array.isArray(packResult)
  ? packResult[0]
  : (packResult[packageJson.name] ?? packResult);
const files = new Set(pack?.files?.map((file) => file.path) ?? []);
const missing = expected.filter((file) => !files.has(file));
const leaked = forbidden.filter((file) => files.has(file));
if (missing.length > 0)
  throw new Error(`Package is missing: ${missing.join(", ")}`);
if (leaked.length > 0)
  throw new Error(`Package includes local-only files: ${leaked.join(", ")}`);

console.log(`release preflight: ${files.size} package files inspected`);
console.log("release preflight: local-only prompt and contract files excluded");
