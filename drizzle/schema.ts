import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * FaucetPay accounts created by the automation system.
 */
export const accounts = mysqlTable("accounts", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  referrer: varchar("referrer", { length: 255 }),
  status: mysqlEnum("status", ["pendente", "ativada", "falhou"]).default("pendente").notNull(),
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  
  // SEOFast fields
  createSeofast: int("createSeofast").default(0).notNull(), // 0 = false, 1 = true
  seofastUsername: varchar("seofastUsername", { length: 255 }),
  seofastPassword: varchar("seofastPassword", { length: 255 }),
  seofastStatus: mysqlEnum("seofastStatus", ["pendente", "ativada", "falhou"]).default("pendente").notNull(),
  
  // SEOFast Session Persistence
  seofastCookies: text("seofastCookies"), // JSON string of cookies
  seofastDeviceId: varchar("seofastDeviceId", { length: 255 }),
  seofastProfile: text("seofastProfile"), // JSON string of user agent profile
  seofastHashAjax: varchar("seofastHashAjax", { length: 255 }),
});

export type Account = typeof accounts.$inferSelect;
export type InsertAccount = typeof accounts.$inferInsert;

/**
 * Configuration store for API keys and credentials.
 */
export const appConfig = mysqlTable("app_config", {
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("configKey", { length: 100 }).notNull().unique(),
  configValue: text("configValue").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppConfig = typeof appConfig.$inferSelect;
export type InsertAppConfig = typeof appConfig.$inferInsert;

/**
 * Account creation progress tracking.
 * Persiste o estado de criação de conta para retomada em caso de falha ou reload.
 */
export const accountProgress = mysqlTable("account_progress", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 64 }).notNull().unique(),

  // Dados da conta
  email: varchar("email", { length: 320 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }),

  // Etapa atual do processo
  currentStep: mysqlEnum("currentStep", [
    "captcha_pending",
    "registration_pending",
    "registration_done",
    "verification_pending",
    "activation_pending",
    "wallet_pending",
    "completed",
    "failed"
  ]).default("captcha_pending").notNull(),

  // Dados preenchidos pelo usuário (JSON)
  formData: text("formData"),

  // Sessão HTTP (cookies, tokens, headers usados)
  cookies: text("cookies"),
  tokens: text("tokens"),
  headersUsed: text("headersUsed"),

  // Info do IP/País
  ipAddress: varchar("ipAddress", { length: 45 }),
  countryCode: varchar("countryCode", { length: 5 }),

  // Erro
  errorMessage: text("errorMessage"),
  errorStep: varchar("errorStep", { length: 50 }),

  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),

  // Referência à conta final
  accountId: int("accountId"),
});

export type AccountProgress = typeof accountProgress.$inferSelect;
export type InsertAccountProgress = typeof accountProgress.$inferInsert;
