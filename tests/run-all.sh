#!/usr/bin/env bash
# Runs every automated test. Requires Node 22+ and Playwright with Chromium.
set -e
cd "$(dirname "$0")/.."
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
node -e "const h=require('fs').readFileSync('index.html','utf8');[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{new Function(m[1]);console.log('script '+i+': syntax ok')})"
node --experimental-strip-types tests/edge.test.mjs
node tests/e2e-existing.mjs
node --experimental-strip-types tests/e2e-ai.mjs
