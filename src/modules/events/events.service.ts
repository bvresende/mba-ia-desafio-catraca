import { randomBytes } from 'node:crypto';
import { and, desc, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { events, tickets, type Event } from '../../db/schema.js';
import {
  getOccupiedSeatCount,
  type DbExecutor,
} from '../purchases/purchase.service.js';

export type { DbExecutor };
export { getOccupiedSeatCount };

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventValidationError';
  }
}

export class EventNotFoundError extends Error {
  constructor(message = 'Evento não encontrado.') {
    super(message);
    this.name = 'EventNotFoundError';
  }
}

export class EventForbiddenError extends Error {
  constructor(message = 'Você não tem permissão para acessar este evento.') {
    super(message);
    this.name = 'EventForbiddenError';
  }
}

export class EventStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStateError';
  }
}

export interface CreateEventInput {
  readonly name: unknown;
  readonly startsAt: unknown;
  readonly location: unknown;
  readonly capacity: unknown;
  readonly price: unknown;
}

export interface UpdateEventInput {
  readonly name?: unknown;
  readonly startsAt?: unknown;
  readonly location?: unknown;
  readonly capacity?: unknown;
  readonly price?: unknown;
}

export interface OrganizerEventSummary extends Event {
  readonly occupiedSeats: number;
}

const DEFAULT_SAO_PAULO_OFFSET = '-03:00';
const MAX_PG_INT4 = 2_147_483_647;

function parseRequiredText(raw: unknown, label: string): string {
  if (typeof raw !== 'string') {
    throw new EventValidationError(`${label} é obrigatório.`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new EventValidationError(`${label} é obrigatório.`);
  }
  return trimmed;
}

export function parseCapacity(raw: unknown): number {
  let value: number;

  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new EventValidationError(
        'A lotação deve ser um número inteiro maior ou igual a 1.',
      );
    }
    value = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new EventValidationError(
        'A lotação deve ser um número inteiro maior ou igual a 1.',
      );
    }
    value = Number.parseInt(trimmed, 10);
  } else {
    throw new EventValidationError(
      'A lotação deve ser um número inteiro maior ou igual a 1.',
    );
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PG_INT4) {
    throw new EventValidationError(
      'A lotação deve ser um número inteiro maior ou igual a 1.',
    );
  }

  return value;
}

export function parsePriceToCents(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new EventValidationError(
        'O preço deve ser maior que zero (ex.: 100,00).',
      );
    }
    const scaled = raw * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-6) {
      throw new EventValidationError(
        'O preço deve ter no máximo 2 casas decimais.',
      );
    }
    if (rounded < 1 || rounded > MAX_PG_INT4) {
      throw new EventValidationError(
        'O preço deve ser maior que zero (ex.: 100,00).',
      );
    }
    return rounded;
  }

  if (typeof raw !== 'string') {
    throw new EventValidationError(
      'O preço deve ser maior que zero (ex.: 100,00).',
    );
  }

  let cleaned = raw.trim().replace(/^r\$\s*/i, '').trim();
  if (cleaned.length === 0) {
    throw new EventValidationError(
      'O preço deve ser maior que zero (ex.: 100,00).',
    );
  }

  // Support Brazilian thousands separator format like 1.250,50
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    cleaned = cleaned.replaceAll('.', '');
  }

  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new EventValidationError(
      'Informe um preço válido em reais maior que zero (ex.: 100,00).',
    );
  }

  const wholePart = Number.parseInt(match[1] ?? '0', 10);
  const fracRaw = (match[2] ?? '').padEnd(2, '0');
  const fracPart = Number.parseInt(fracRaw || '0', 10);
  const cents = wholePart * 100 + fracPart;

  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_PG_INT4) {
    throw new EventValidationError(
      'O preço deve ser maior que zero (ex.: 100,00).',
    );
  }

  return cents;
}

function assertValidCalendarDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): void {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new EventValidationError('Data e hora de início inválidas.');
  }
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new EventValidationError('Data de início inválida.');
  }
}

export function parseFutureStartsAt(
  raw: unknown,
  now: Date = new Date(),
): Date {
  let parsed: Date;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new EventValidationError('Data e hora de início inválidas.');
    }
    parsed = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new EventValidationError('A data e hora de início são obrigatórias.');
    }

    const naiveMatch =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(
        trimmed,
      );
    const isoWithTzMatch =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(
        trimmed,
      );

    if (naiveMatch) {
      assertValidCalendarDate(
        Number(naiveMatch[1]),
        Number(naiveMatch[2]),
        Number(naiveMatch[3]),
        Number(naiveMatch[4]),
        Number(naiveMatch[5]),
        Number(naiveMatch[6] ?? '0'),
      );
      const withSeconds = naiveMatch[6]
        ? trimmed
        : `${trimmed}:00`;
      parsed = new Date(`${withSeconds}${DEFAULT_SAO_PAULO_OFFSET}`);
    } else if (isoWithTzMatch) {
      assertValidCalendarDate(
        Number(isoWithTzMatch[1]),
        Number(isoWithTzMatch[2]),
        Number(isoWithTzMatch[3]),
        Number(isoWithTzMatch[4]),
        Number(isoWithTzMatch[5]),
        Number(isoWithTzMatch[6] ?? '0'),
      );
      parsed = new Date(trimmed);
    } else {
      throw new EventValidationError('Data e hora de início inválidas.');
    }

    if (Number.isNaN(parsed.getTime())) {
      throw new EventValidationError('Data e hora de início inválidas.');
    }
  } else {
    throw new EventValidationError('A data e hora de início são obrigatórias.');
  }

  if (parsed.getTime() <= now.getTime()) {
    throw new EventValidationError(
      'A data e hora de início devem estar no futuro.',
    );
  }

  return parsed;
}

export const countOccupiedSeats = getOccupiedSeatCount;

export async function createEvent(
  ownerId: string,
  input: CreateEventInput,
  now: Date = new Date(),
): Promise<Event> {
  const name = parseRequiredText(input.name, 'Nome do evento');
  const location = parseRequiredText(input.location, 'Local do evento');
  const startsAt = parseFutureStartsAt(input.startsAt, now);
  const capacity = parseCapacity(input.capacity);
  const priceCents = parsePriceToCents(input.price);

  const id = `evt_${randomBytes(6).toString('hex')}`;
  const timestamp = new Date();

  const [created] = await db
    .insert(events)
    .values({
      id,
      ownerId,
      name,
      startsAt,
      location,
      capacity,
      priceCents,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  if (!created) {
    throw new Error('Falha ao criar evento no banco de dados.');
  }

  return created;
}

export async function listOrganizerEvents(
  ownerId: string,
): Promise<OrganizerEventSummary[]> {
  const ownerEvents = await db
    .select()
    .from(events)
    .where(eq(events.ownerId, ownerId))
    .orderBy(desc(events.createdAt));

  if (ownerEvents.length === 0) {
    return [];
  }

  const eventIds = ownerEvents.map((evt) => evt.id);
  const counts = await db
    .select({
      eventId: tickets.eventId,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        inArray(tickets.eventId, eventIds),
        inArray(tickets.status, ['pending', 'confirmed']),
      ),
    )
    .groupBy(tickets.eventId);

  const countMap = new Map<string, number>();
  for (const row of counts) {
    countMap.set(row.eventId, row.count);
  }

  return ownerEvents.map((evt) => ({
    ...evt,
    occupiedSeats: countMap.get(evt.id) ?? 0,
  }));
}

export async function getOrganizerEventById(
  ownerId: string,
  eventId: string,
): Promise<Event | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.ownerId, ownerId)))
    .limit(1);

  return event ?? null;
}

export async function getOrganizerEventOrThrow(
  eventId: string,
  ownerId: string,
  executor: DbExecutor = db,
): Promise<Event> {
  const [event] = await executor
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) {
    throw new EventNotFoundError();
  }

  if (event.ownerId !== ownerId) {
    throw new EventForbiddenError();
  }

  return event;
}

export async function updateEvent(
  ownerId: string,
  eventId: string,
  input: UpdateEventInput,
  now: Date = new Date(),
): Promise<Event> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update');

    if (!existing) {
      throw new EventNotFoundError();
    }

    if (existing.ownerId !== ownerId) {
      throw new EventForbiddenError();
    }

    if (existing.status === 'cancelled') {
      throw new EventStateError('Eventos cancelados não podem ser editados.');
    }

    const name =
      input.name !== undefined
        ? parseRequiredText(input.name, 'Nome do evento')
        : existing.name;
    const location =
      input.location !== undefined
        ? parseRequiredText(input.location, 'Local do evento')
        : existing.location;
    const startsAt =
      input.startsAt !== undefined
        ? parseFutureStartsAt(input.startsAt, now)
        : parseFutureStartsAt(existing.startsAt, now);
    const capacity =
      input.capacity !== undefined
        ? parseCapacity(input.capacity)
        : existing.capacity;
    const priceCents =
      input.price !== undefined
        ? parsePriceToCents(input.price)
        : existing.priceCents;

    const occupiedSeats = await getOccupiedSeatCount(eventId, tx);
    if (capacity < occupiedSeats) {
      throw new EventValidationError(
        `A lotação não pode ser menor que as vagas já ocupadas (${occupiedSeats}).`,
      );
    }

    const [updated] = await tx
      .update(events)
      .set({
        name,
        startsAt,
        location,
        capacity,
        priceCents,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning();

    if (!updated) {
      throw new Error('Falha ao atualizar evento.');
    }

    return updated;
  });
}

export async function publishEvent(
  ownerId: string,
  eventId: string,
): Promise<Event> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update');

    if (!existing) {
      throw new EventNotFoundError();
    }

    if (existing.ownerId !== ownerId) {
      throw new EventForbiddenError();
    }

    if (existing.status === 'cancelled') {
      throw new EventStateError('Eventos cancelados não podem ser publicados.');
    }

    if (existing.status === 'published') {
      return existing;
    }

    const [updated] = await tx
      .update(events)
      .set({
        status: 'published',
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning();

    if (!updated) {
      throw new Error('Falha ao publicar evento.');
    }

    return updated;
  });
}

export async function getEventById(eventId: string): Promise<Event | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  return event ?? null;
}

export async function listPublishedEvents(): Promise<Event[]> {
  return db
    .select()
    .from(events)
    .where(eq(events.status, 'published'))
    .orderBy(asc(events.startsAt));
}
