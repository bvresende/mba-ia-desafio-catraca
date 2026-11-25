import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export type UserRole = 'participant' | 'organizer';
export type EventStatus = 'draft' | 'published' | 'cancelled';
export type TicketStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'refunded';
export type TicketChannel = 'storefront' | 'partner_api';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<UserRole>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    location: text('location').notNull(),
    capacity: integer('capacity').notNull(),
    priceCents: integer('price_cents').notNull(),
    status: text('status').$type<EventStatus>().notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('events_owner_id_idx').on(table.ownerId),
    index('events_status_idx').on(table.status),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    userId: text('user_id').references(() => users.id),
    buyerEmail: text('buyer_email').notNull(),
    code: text('code').notNull().unique(),
    priceCents: integer('price_cents').notNull(),
    status: text('status').$type<TicketStatus>().notNull(),
    checkedIn: boolean('checked_in').notNull().default(false),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    channel: text('channel').$type<TicketChannel>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('tickets_event_id_status_idx').on(table.eventId, table.status),
    index('tickets_user_id_idx').on(table.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
