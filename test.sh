#!/bin/bash
set -e

case "$1" in
  base)
    # Run existing deduplication tests
    pnpm vitest --run packages/client/src/links/internals/dedupeLink.test.ts
    ;;
  new)
    # Run newly added request deduplication tests
    pnpm vitest --run packages/client/src/links/deduplicationLink.test.ts
    ;;
  *)
    echo "Usage: ./test.sh {base|new}"
    exit 1
    ;;
esac
