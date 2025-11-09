# Circuit Breaker Link for tRPC Client

## Problem Brief

Build a circuit breaker link for tRPC's client-side request chain to prevent cascading failures when a server becomes unresponsive. The circuit breaker should automatically stop sending requests to a failing server, wait a configurable timeout period, then gradually test if the server has recovered. This improves system resilience by failing fast during outages rather than overwhelming struggling services.

## Agent Instructions

Implement a new client link following tRPC's existing link patterns (see `retryLink.ts`, `dedupeLink.ts` for reference). The circuit breaker must track three states:

**Closed** (normal): All requests pass through. Track consecutive failures.

**Open** (blocking): After reaching failure threshold, reject new requests immediately without hitting the server. Return a clear error indicating the circuit is open.

**Half-open** (testing): After timeout expires, allow limited requests through (one at a time to test recovery without overwhelming the service). If they succeed (based on success threshold), transition to closed. Any failure reopens the circuit.

The implementation should:
- Accept configuration for failure threshold, timeout duration, and success threshold for recovery
- Maintain state across multiple requests within the same client instance
- Provide an optional callback for state change notifications
- Use tRPC's observable pattern for request handling
- Reset failure counters on success in closed state

Tests should verify all state transitions, threshold behaviors, and edge cases like interleaved successes/failures.

## Test Assumptions

- Export as `circuitBreakerLink` from `packages/client/src/links/circuitBreakerLink.ts` following the standard link signature pattern used by other tRPC links
- Configuration options: `failureThreshold`, `openToHalfOpenTimeoutMs`, `halfOpenSuccessThreshold`, and optional `onStateChange` callback
- State callback receives one of: `'closed'`, `'open'`, or `'half-open'`
- When circuit is open, requests should fail with an error indicating the circuit breaker blocked the request
