import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { events, tickets } from '../../db/schema.js';

export type GatewayOutcome = 'confirmed' | 'declined';
export type GatewayTier = 'fast' | 'slow';

export interface GatewayTimingConfig {
  readonly fastMinMs: number;
  readonly fastMaxMs: number;
  readonly slowMinMs: number;
  readonly slowMaxMs: number;
}

export interface GatewayDecision {
  readonly outcome: GatewayOutcome;
  readonly tier: GatewayTier;
  readonly minMs: number;
  readonly maxMs: number;
}

export interface ScheduledGatewayJob {
  readonly outcome: GatewayOutcome;
  readonly tier: GatewayTier;
  readonly delayMs: number;
}

export interface ScheduleGatewayOptions {
  readonly config?: GatewayTimingConfig;
  readonly onError?: (err: unknown) => void;
  readonly onSettled?: (updated: boolean) => void;
}

interface TrackedGatewayJob {
  readonly timer: NodeJS.Timeout;
  readonly promise: Promise<void>;
  readonly cancel: () => void;
}

const CARD_NUMBER_PATTERN = /^\d{16}$/;
const trackedJobs = new Set<TrackedGatewayJob>();

export function isValidCardNumber(cardNumber: string): boolean {
  return CARD_NUMBER_PATTERN.test(cardNumber);
}

export function getGatewayTimingConfig(): GatewayTimingConfig {
  const fastMinMs = Math.max(0, env.GATEWAY_FAST_MIN_MS);
  const fastMaxMs = Math.max(fastMinMs, env.GATEWAY_FAST_MAX_MS);
  const slowMinMs = Math.max(0, env.GATEWAY_SLOW_MIN_MS);
  const slowMaxMs = Math.max(slowMinMs, env.GATEWAY_SLOW_MAX_MS);

  return {
    fastMinMs,
    fastMaxMs,
    slowMinMs,
    slowMaxMs,
  };
}

export function resolveGatewayBehavior(
  cardNumber: string,
  config: GatewayTimingConfig = getGatewayTimingConfig(),
): GatewayDecision {
  if (!isValidCardNumber(cardNumber)) {
    throw new Error('Invalid card number: expected exactly 16 numeric digits.');
  }

  const lastFour = cardNumber.slice(-4);
  switch (lastFour) {
    case '0001':
      return {
        outcome: 'confirmed',
        tier: 'fast',
        minMs: config.fastMinMs,
        maxMs: config.fastMaxMs,
      };
    case '0002':
      return {
        outcome: 'declined',
        tier: 'fast',
        minMs: config.fastMinMs,
        maxMs: config.fastMaxMs,
      };
    case '0003':
      return {
        outcome: 'confirmed',
        tier: 'slow',
        minMs: config.slowMinMs,
        maxMs: config.slowMaxMs,
      };
    case '0004':
      return {
        outcome: 'declined',
        tier: 'slow',
        minMs: config.slowMinMs,
        maxMs: config.slowMaxMs,
      };
    default:
      return {
        outcome: 'declined',
        tier: 'fast',
        minMs: config.fastMinMs,
        maxMs: config.fastMaxMs,
      };
  }
}

export const resolveSimulatedGatewayDecision = resolveGatewayBehavior;

export function computeRandomDelayMs(minMs: number, maxMs: number): number {
  const safeMin = Math.max(0, Math.floor(minMs));
  const safeMax = Math.max(safeMin, Math.floor(maxMs));
  if (safeMax === safeMin) {
    return safeMin;
  }
  return safeMin + randomInt(0, safeMax - safeMin + 1);
}

/**
 * Applies the simulated gateway outcome using a strict atomic guard (R11):
 * a late callback must never overwrite tickets that are no longer pending or
 * belong to a cancelled/non-published event.
 */
export async function applyGatewayOutcome(
  ticketId: string,
  outcome: GatewayOutcome,
): Promise<boolean> {
  const updatedRows = await db
    .update(tickets)
    .set({
      status: outcome,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.status, 'pending'),
        sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${tickets.eventId} AND ${events.status} = 'published')`,
      ),
    )
    .returning({ id: tickets.id });

  return updatedRows.length > 0;
}

export function scheduleGatewayProcessing(
  ticketId: string,
  cardNumber: string,
  options?: ScheduleGatewayOptions,
): ScheduledGatewayJob {
  const decision = resolveGatewayBehavior(cardNumber, options?.config);
  const delayMs = computeRandomDelayMs(decision.minMs, decision.maxMs);

  let settled = false;
  let resolveJob!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveJob = resolve;
  });

  let entry!: TrackedGatewayJob;

  const finish = () => {
    if (!settled) {
      settled = true;
      trackedJobs.delete(entry);
      resolveJob();
    }
  };

  const timer = setTimeout(() => {
    void (async () => {
      try {
        const updated = await applyGatewayOutcome(ticketId, decision.outcome);
        options?.onSettled?.(updated);
      } catch (err) {
        if (options?.onError) {
          options.onError(err);
        } else {
          console.error(
            `[gateway] Error applying '${decision.outcome}' for ticket ${ticketId}:`,
            err,
          );
        }
      } finally {
        finish();
      }
    })();
  }, delayMs);

  entry = {
    timer,
    promise,
    cancel: () => {
      clearTimeout(timer);
      finish();
    },
  };

  trackedJobs.add(entry);

  return {
    outcome: decision.outcome,
    tier: decision.tier,
    delayMs,
  };
}

export const scheduleSimulatedPayment = scheduleGatewayProcessing;

export function cancelPendingTimers(): void {
  for (const job of Array.from(trackedJobs)) {
    job.cancel();
  }
}

export const clearPendingGatewayTimers = cancelPendingTimers;

export async function waitForPendingGatewayJobs(): Promise<void> {
  while (trackedJobs.size > 0) {
    const promises = Array.from(trackedJobs, (job) => job.promise);
    await Promise.all(promises);
  }
}

export const waitForPendingGatewayCallbacks = waitForPendingGatewayJobs;

export function getPendingGatewayJobCount(): number {
  return trackedJobs.size;
}
