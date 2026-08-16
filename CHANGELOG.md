# Changelog

## 0.1.2 - 2026-08-16

- Added native setup adapters for Gemini CLI, OpenCode, Cursor, Windsurf, VS Code, Pi, Cline, Zed, and Goose.
- Improved upstream event normalization for numeric identifiers, empty traits, and safe integer boundaries.
- Added client-specific setup documentation and regression coverage.

## 0.1.1 - 2026-08-15

- Fixed the published command entrypoint so `npx tonnel-market-mcp` runs on Unix hosts.
- Added packaged-binary execution to the release smoke test.

## 0.1.0 - 2026-08-15

- Initial local read-only Tonnel Marketplace MCP collector and query server.
- Added a one-command guided installer that detects supported MCP hosts and configures local stdio usage.
