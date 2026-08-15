import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "test", "scripts"];
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) {
      const source = await readFile(path, "utf8");
      if (/console\.log\s*\(/u.test(source) && path.startsWith("src/")) {
        violations.push(
          `${path}: stdout logging is forbidden in MCP server code`,
        );
      }
      if (/@ts-(?:ignore|nocheck)\b/u.test(source)) {
        violations.push(
          `${path}: TypeScript suppression comments are forbidden`,
        );
      }
      if (/from ['"]\.\.?\/[^'"\n]+\.ts['"]/u.test(source)) {
        violations.push(
          `${path}: import specifiers must use extensionless NodeNext paths`,
        );
      }
    }
  }
}

for (const root of roots) {
  await walk(root);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.error(`lint: scanned ${roots.join(", ")}`);
}
