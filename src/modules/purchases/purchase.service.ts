import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client.js';
import {
  events,
  tickets,
  type Ticket,
  type TicketChannel,
} from '../../db/schema.js';
import {
  isValidCardNumber,
  scheduleGatewayProcessing,
} from './gateway.service.js';

export type DbExecutor =
  | Database
  | Parameters<Parameters<Database['transaction']>[0]>[0];

export class InvalidPurchaseRequestError extends Error {
  readonly code = 'invalid_request' as const;

  constructor(message = 'Dados da compra inválidos.') {
    super(message);
    this.name = 'InvalidPurchaseRequestError';
  }
}

export const InvalidPurchaseInputError = InvalidPurchaseRequestError;

export class EventNotAvailableError extends Error {
  readonly code = 'event_not_available' as const;

  constructor(message = 'Evento não disponível para venda.') {
    super(message);
    this.name = 'EventNotAvailableError';
  }
}

export class SoldOutError extends Error {
  readonly code = 'sold_out' as const;

  constructor(message = 'Ingressos esgotados.') {
    super(message);
    this.name = 'SoldOutError';
  }
}

export interface PurchaseTicketInput {
  readonly eventId: string;
  readonly buyerEmail: string;
  readonly cardNumber: string;
  readonly userId?: string | null;
  readonly channel: TicketChannel;
}

export interface PurchasedTicket extends Ticket {
  readonly ticketId: string;
}

export interface EventSeatMetrics {
  readonly capacity: number;
  readonly occupied: number;
  readonly available: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 8;
// Largest multiple of 36 below 256 (36 * 7 = 252) to avoid modulo bias.
const MAX_UNBIASED_BYTE = 252;
const MAX_CODE_INSERT_ATTEMPTS = 5;

export function generateTicketCode(): string {
  let code = '';
  while (code.length < CODE_LENGTH) {
    const bytes = randomBytes(CODE_LENGTH * 2);
    for (const byte of bytes) {
      if (byte < MAX_UNBIASED_BYTE) {
        const char = CODE_ALPHABET[byte % CODE_ALPHABET.length];
        if (char) {
          code += char;
          if (code.length === CODE_LENGTH) {
            break;
          }
        }
      }
    }
  }
  return code;
}

interface ValidatedPurchaseInput {
  readonly eventId: string;
  readonly buyerEmail: string;
  readonly cardNumber: string;
  readonly userId: string | null;
  readonly channel: TicketChannel;
}

function validatePurchaseInput(input: PurchaseTicketInput): ValidatedPurchaseInput {
  if (typeof input.eventId !== 'string' || input.eventId.trim().length === 0) {
    throw new InvalidPurchaseRequestError('Evento obrigatório.');
  }

  if (typeof input.buyerEmail !== 'string') {
    throw new InvalidPurchaseRequestError('E-mail do comprador inválido.');
  }
  const buyerEmail = input.buyerEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(buyerEmail)) {
    throw new InvalidPurchaseRequestError('E-mail do comprador inválido.');
  }

  if (typeof input.cardNumber !== 'string' || !isValidCardNumber(input.cardNumber)) {
    throw new InvalidPurchaseRequestError(
      'Número de cartão inválido. Informe exatamente 16 dígitos numéricos.',
    );
  }

  if (input.channel !== 'storefront' && input.channel !== 'partner_api') {
    throw new InvalidPurchaseRequestError('Canal de compra inválido.');
  }

  let userId: string | null = null;
  if (input.userId !== undefined && input.userId !== null) {
    if (typeof input.userId !== 'string' || input.userId.trim().length === 0) {
      throw new InvalidPurchaseRequestError('Usuário inválido.');
    }
    userId = input.userId.trim();
  }

  return {
    eventId: input.eventId.trim(),
    buyerEmail,
    cardNumber: input.cardNumber,
    userId,
    channel: input.channel,
  };
}

function isUniqueViolationError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export async function getOccupiedSeatCount(
  eventId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const [row] = await executor
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.eventId, eventId),
        inArray(tickets.status, ['pending', 'confirmed']),
      ),
    );

  return row?.count ?? 0;
}

export async function getEventSeatMetrics(
  eventId: string,
  executor: DbExecutor = db,
): Promise<EventSeatMetrics | null> {
  const [event] = await executor
    .select({
      id: events.id,
      capacity: events.capacity,
      status: events.status,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) {
    return null;
  }

  const occupied = await getOccupiedSeatCount(event.id, executor);
  const available =
    event.status === 'cancelled' ? 0 : Math.max(0, event.capacity - occupied);

  return {
    capacity: event.capacity,
    occupied,
    available,
  };
}

export async function getEventSeatMetricsMap(
  eventIds: readonly string[],
  executor: DbExecutor = db,
): Promise<Map<string, EventSeatMetrics>> {
  const result = new Map<string, EventSeatMetrics>();
  if (eventIds.length === 0) {
    return result;
  }

  const uniqueIds = Array.from(new Set(eventIds));
  const eventRows = await executor
    .select({
      id: events.id,
      capacity: events.capacity,
      status: events.status,
    })
    .from(events)
    .where(inArray(events.id, uniqueIds));

  if (eventRows.length === 0) {
    return result;
  }

  const occupiedRows = await executor
    .select({
      eventId: tickets.eventId,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        inArray(tickets.eventId, uniqueIds),
        inArray(tickets.status, ['pending', 'confirmed']),
      ),
    )
    .groupBy(tickets.eventId);

  const occupiedMap = new Map<string, number>();
  for (const row of occupiedRows) {
    occupiedMap.set(row.eventId, row.count);
  }

  for (const event of eventRows) {
    const occupied = occupiedMap.get(event.id) ?? 0;
    const available =
      event.status === 'cancelled' ? 0 : Math.max(0, event.capacity - occupied);
    result.set(event.id, {
      capacity: event.capacity,
      occupied,
      available,
    });
  }

  return result;
}

/**
 * Reserves one ticket in `pending` status inside a pessimistic row lock
 * transaction on the target event (`SELECT ... FOR UPDATE`, R07), then
 * triggers simulated asynchronous payment processing after commit (R06, R08).
 */
export async function purchaseTicket(
  input: PurchaseTicketInput,
): Promise<PurchasedTicket> {
  const validated = validatePurchaseInput(input);

  let created: Ticket | undefined;

  for (let attempt = 1; attempt <= MAX_CODE_INSERT_ATTEMPTS; attempt += 1) {
    try {
      created = await db.transaction(async (tx) => {
        const [lockedEvent] = await tx
          .select({
            id: events.id,
            capacity: events.capacity,
            priceCents: events.priceCents,
            status: events.status,
          })
          .from(events)
          .where(eq(events.id, validated.eventId))
          .for('update');

        if (!lockedEvent || lockedEvent.status !== 'published') {
          throw new EventNotAvailableError();
        }

        const occupied = await getOccupiedSeatCount(lockedEvent.id, tx);
        if (occupied >= lockedEvent.capacity) {
          throw new SoldOutError();
        }

        const now = new Date();
        const ticketId = `tkt_${randomBytes(6).toString('hex')}`;
        const code = generateTicketCode();

        const [inserted] = await tx
          .insert(tickets)
          .values({
            id: ticketId,
            eventId: lockedEvent.id,
            userId: validated.userId,
            buyerEmail: validated.buyerEmail,
            code,
            priceCents: lockedEvent.priceCents,
            status: 'pending',
            checkedIn: false,
            checkedInAt: null,
            channel: validated.channel,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!inserted) {
          throw new Error('Falha ao criar ingresso no banco de dados.');
        }

        return inserted;
      });
      break;
    } catch (err) {
      if (isUniqueViolationError(err) && attempt < MAX_CODE_INSERT_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }

  if (!created) {
    throw new Error('Falha ao gerar código único para o ingresso.');
  }

  scheduleGatewayProcessing(created.id, validated.cardNumber);

  return {
    ...created,
    ticketId: created.id,
  };
}

export async function getTicketById(
  ticketId: string,
  executor: DbExecutor = db,
): Promise<Ticket | null> {
  const [ticket] = await executor
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);

  return ticket ?? null;
}

export async function listTicketsByUser(
  userId: string,
  executor: DbExecutor = db,
): Promise<Ticket[]> {
  return executor
    .select()
    .from(tickets)
    .where(eq(tickets.userId, userId))
    .orderBy(desc(tickets.createdAt));
}

export const listTicketsByUserId = listTicketsByUser;
