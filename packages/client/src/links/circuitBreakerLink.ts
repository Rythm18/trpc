import { observable } from '@trpc/server/observable';
import type { InferrableClientTypes } from '@trpc/server/unstable-core-do-not-import';
import { TRPCClientError } from '../TRPCClientError';
import type { TRPCLink } from './types';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before opening the circuit
   * @default 5
   */
  failureThreshold?: number;
  /**
   * Time in milliseconds to wait before attempting to close the circuit again
   * @default 10000
   */
  openToHalfOpenTimeoutMs?: number;
  /**
   * Number of successful requests in half-open state to close the circuit
   * @default 2
   */
  halfOpenSuccessThreshold?: number;
  /**
   * Optional callback when circuit state changes
   */
  onStateChange?: (state: CircuitState) => void;
}

interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

/**
 * Circuit breaker link to prevent cascading failures
 * @see https://trpc.io/docs/client/links/circuitBreakerLink
 */
export function circuitBreakerLink<TInferrable extends InferrableClientTypes>(
  opts: CircuitBreakerOptions = {},
): TRPCLink<TInferrable> {
  const failureThreshold = opts.failureThreshold ?? 5;
  const openToHalfOpenTimeoutMs = opts.openToHalfOpenTimeoutMs ?? 10000;
  const halfOpenSuccessThreshold = opts.halfOpenSuccessThreshold ?? 2;
  const onStateChange = opts.onStateChange;

  return () => {
    const circuitState: CircuitBreakerState = {
      state: 'closed',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };

    function transitionTo(newState: CircuitState) {
      if (circuitState.state !== newState) {
        circuitState.state = newState;
        onStateChange?.(newState);
      }
    }

    function shouldAllowRequest(): boolean {
      const now = Date.now();

      switch (circuitState.state) {
        case 'closed':
          return true;
        case 'open':
          if (now >= circuitState.nextAttemptTime) {
            transitionTo('half-open');
            circuitState.consecutiveSuccesses = 0;
            return true;
          }
          return false;
        case 'half-open':
          return true;
      }
    }

    function recordSuccess() {
      circuitState.consecutiveFailures = 0;

      if (circuitState.state === 'half-open') {
        circuitState.consecutiveSuccesses++;
        if (circuitState.consecutiveSuccesses >= halfOpenSuccessThreshold) {
          transitionTo('closed');
          circuitState.consecutiveSuccesses = 0;
        }
      }
    }

    function recordFailure() {
      circuitState.consecutiveFailures++;
      circuitState.consecutiveSuccesses = 0;
      circuitState.lastFailureTime = Date.now();

      if (circuitState.state === 'half-open') {
        // Any failure in half-open state reopens the circuit
        transitionTo('open');
        circuitState.nextAttemptTime =
          Date.now() + openToHalfOpenTimeoutMs;
      } else if (circuitState.state === 'closed') {
        if (circuitState.consecutiveFailures >= failureThreshold) {
          transitionTo('open');
          circuitState.nextAttemptTime =
            Date.now() + openToHalfOpenTimeoutMs;
        }
      }
    }

    return ({ op, next }) => {
      return observable((observer) => {
        if (!shouldAllowRequest()) {
          observer.error(
            new TRPCClientError('Circuit breaker is open', {
              cause: new Error(
                `Circuit breaker is open. Last failure: ${new Date(
                  circuitState.lastFailureTime,
                ).toISOString()}`,
              ),
            }),
          );
          return;
        }

        const subscription = next(op).subscribe({
          next(value) {
            recordSuccess();
            observer.next(value);
          },
          error(err) {
            recordFailure();
            observer.error(err);
          },
          complete() {
            observer.complete();
          },
        });

        return () => {
          subscription.unsubscribe();
        };
      });
    };
  };
}
