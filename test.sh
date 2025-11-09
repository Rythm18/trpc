#!/bin/bash
set -e

case "$1" in
  base)
    # Run existing link tests to ensure no regression
    pnpm test -- --watch false packages/client/src/links/internals/dedupeLink.test.ts
    ;;
  new)
    # Run newly added circuit breaker tests
    pnpm test -- --watch false packages/client/src/links/circuitBreakerLink.test.ts
    ;;
  *)
    echo "Usage: ./test.sh {base|new}"
    exit 1
    ;;
esac
