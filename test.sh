#!/bin/bash
set -e

case "$1" in
  base)
    # Run existing middleware tests to ensure no regression
    pnpm test -- --watch false packages/server/src/unstable-core-do-not-import/procedureBuilder.test.ts
    ;;
  new)
    # Run newly added request deduplication tests
    pnpm test -- --watch false packages/server/src/unstable-core-do-not-import/requestDeduplication.test.ts
    ;;
  *)
    echo "Usage: ./test.sh {base|new}"
    exit 1
    ;;
esac
