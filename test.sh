#!/bin/bash

set -e

case "$1" in
  base)
    echo "Running base tests..."
    cd /workspace
    pnpm test -- --watch false --run packages/client/src/links/internals/dedupeLink.test.ts
    ;;
  new)
    echo "Running new request deduplication tests..."
    cd /workspace
    pnpm test -- --watch false --run packages/client/src/links/deduplicationLink.test.ts
    ;;
  *)
    echo "Usage: $0 {base|new}"
    echo "  base - Run existing deduplication tests"
    echo "  new  - Run new request deduplication feature tests"
    exit 1
    ;;
esac
