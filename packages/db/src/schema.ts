// Drizzle schema — the hosted persistence model (plan §7).
//
// PRIVACY: we persist DERIVED records (company, role, status, dates, <=600-char
// snippet) and ENVELOPE-ENCRYPTED mail tokens only. No raw email bodies, no
// plaintext tokens. Every row is owned by a user_id for row-level isolation.
import { pgTable, text, timestamp, boolean, real, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "pro", "teams"]);
export const providerEnum = pgEnum("provider", ["google", "microsoft", "imap"]);
export const appStatusEnum = pgEnum("app_status", ["applied", "interview", "offer", "rejected", "cancelled"]);
export const connStatusEnum = pgEnum("conn_status", ["active", "reauth_required", "disconnected"]);
export const devicePlatformEnum = pgEnum("device_platform", ["ios", "android", "web"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A connected mailbox. The OAuth/IMAP secret is stored ONLY as an envelope blob. */
export const mailConnections = pgTable(
  "mail_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    email: text("email").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(), // @pipeline/crypto envelope blob — never plaintext
    status: connStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uq: uniqueIndex("uq_conn_user_provider_email").on(t.userId, t.provider, t.email) }),
);

/** Incremental-sync cursor per connection (Gmail historyId / Graph deltaLink). */
export const syncState = pgTable("sync_state", {
  connectionId: text("connection_id")
    .primaryKey()
    .references(() => mailConnections.id, { onDelete: "cascade" }),
  cursor: text("cursor"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

/** One derived application per (user, thread). */
export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(), // `${userId}:${threadId}`
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    company: text("company").notNull(),
    companyDomain: text("company_domain").notNull(),
    role: text("role").notNull(),
    status: appStatusEnum("status").notNull(),
    firstSeen: text("first_seen").notNull(),
    lastActivity: text("last_activity").notNull(),
    snippet: text("snippet").notNull(),
    manual: boolean("manual").notNull().default(false),
    confidence: real("confidence"), // classifier confidence 0..1; nullable (additive)
    enrichment: text("enrichment"), // extracted facts as a JSON string; nullable (additive)
    classification: text("classification"), // current evidence/confidence audit JSON
    classificationEvents: text("classification_events"), // chronological event audit JSON
    platformFallback: boolean("platform_fallback"), // company is only the shared ATS name; nullable (additive)
    // User's sticky status override. Sync upserts never write these columns, so a
    // manual correction survives every re-classification by construction; reads
    // coalesce override_status ?? status.
    overrideStatus: appStatusEnum("override_status"),
    overrideAt: timestamp("override_at", { withTimezone: true }),
    // Review-queue resolution: set when the user confirms/handles a low-confidence
    // classification; NULL means still awaiting review (if flagged).
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("uq_app_user_thread").on(t.userId, t.threadId),
    byUser: index("idx_app_user").on(t.userId),
  }),
);

/** Status-change timeline (drives analytics / funnel later). */
export const applicationEvents = pgTable("application_events", {
  id: text("id").primaryKey(),
  applicationId: text("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  status: appStatusEnum("status").notNull(),
  occurredAt: text("occurred_at").notNull(),
  source: text("source").notNull().default("sync"),
});

/** Free-form notes per application (Pro). */
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byApp: index("idx_notes_app").on(t.applicationId) }),
);

/** Recruiter / hiring-manager contacts per application (Pro). */
export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byApp: index("idx_contacts_app").on(t.applicationId) }),
);

/** Per-message previews (Email tab). Same privacy budget as `applications.snippet`:
 *  a <=600-char preview + attachment METADATA (JSON), never raw mail or file content. */
export const applicationMessages = pgTable(
  "application_messages",
  {
    id: text("id").primaryKey(), // `${userId}:${threadId}:${msgKey}`
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    date: text("date").notNull(),
    fromAddr: text("from_addr").notNull(),
    bodyPreview: text("body_preview").notNull(),
    attachments: text("attachments"), // JSON [{name,contentType,size}] or NULL
    webLink: text("web_link"), // deep link to the original in the provider's web mail
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byApp: index("idx_appmsg_app").on(t.applicationId),
    byUser: index("idx_appmsg_user").on(t.userId),
  }),
);

/** A phone (or browser) registered for push notifications. One row per push token;
 *  re-registration moves the token to the signing-in user. */
export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: devicePlatformEnum("platform").notNull(),
    expoPushToken: text("expo_push_token").notNull().unique(),
    deviceName: text("device_name"),
    notifyStatusChanges: boolean("notify_status_changes").notNull().default(true),
    notifyReminders: boolean("notify_reminders").notNull().default(true),
    disabled: boolean("disabled").notNull().default(false), // provider said DeviceNotRegistered
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byUser: index("idx_devices_user").on(t.userId) }),
);

/** Send-once ledger for push notifications: a unique dedupe key per logical
 *  notification, so retries and overlapping sync ticks can never double-send. */
export const pushLog = pgTable("push_log", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'transition' | 'interview'
  dedupeKey: text("dedupe_key").notNull().unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { users, mailConnections, syncState, applications, applicationEvents, notes, contacts, applicationMessages, devices, pushLog };
