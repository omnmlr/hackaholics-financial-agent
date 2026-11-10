import { randomUUID } from "node:crypto";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
} from "drizzle-orm/pg-core";
const dates = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const user = pgTable("agus_users", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("consumer"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  ...dates(),
});
export const session = pgTable("agus_sessions", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...dates(),
});
export const account = pgTable("agus_auth_accounts", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  ...dates(),
});
export const verification = pgTable("agus_verifications", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...dates(),
});
export const twoFactor = pgTable("agus_two_factor", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
export const rateLimit = pgTable("agus_rate_limit", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
