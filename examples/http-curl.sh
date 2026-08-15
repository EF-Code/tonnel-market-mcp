#!/usr/bin/env sh
set -eu

# This is a local example. Do not send a bearer token over plain HTTP on an
# untrusted network; use HTTPS at a correctly configured reverse proxy.
curl --fail-with-body \
  -H 'content-type: application/json' \
  -H 'origin: http://127.0.0.1:8787' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-example","version":"1.0.0"}}}' \
  http://127.0.0.1:8787/mcp
