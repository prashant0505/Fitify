import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    format: text("format").notNull(),
    status: text("status").notNull().default("draft"),
    stage: integer("stage").notNull().default(0),
    score: integer("score"),
    role: text("role").notNull().default("Untitled role"),
    company: text("company").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    leaseUntil: integer("lease_until").notNull().default(0),
    error: text("error"),
    requestKey: text("request_key").notNull(),
    stateKey: text("state_key").notNull().default("state"),
  },
  (t) => [
    index("jobs_owner_created").on(t.userId, t.createdAt),
    index("jobs_expiry").on(t.expiresAt),
    uniqueIndex("jobs_owner_request").on(t.userId, t.requestKey),
  ],
);
export const limits = sqliteTable("limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
});
