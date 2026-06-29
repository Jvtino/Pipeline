// Initial schema as idempotent SQL (Postgres / PGlite). Kept as a string so the
// runtime can apply it without a migration-CLI step; a tool like drizzle-kit can
// take over generated migrations later. DO-blocks make enum creation re-runnable.
export const INIT_SQL = `
DO $$ BEGIN CREATE TYPE plan AS ENUM ('free','pro','teams'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE provider AS ENUM ('google','microsoft','imap'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE app_status AS ENUM ('applied','interview','offer','rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE conn_status AS ENUM ('active','reauth_required','disconnected'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  plan        plan NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_connections (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          provider NOT NULL,
  email             text NOT NULL,
  encrypted_secret  text NOT NULL,
  status            conn_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_user_provider_email ON mail_connections (user_id, provider, email);

CREATE TABLE IF NOT EXISTS sync_state (
  connection_id   text PRIMARY KEY REFERENCES mail_connections(id) ON DELETE CASCADE,
  cursor          text,
  last_synced_at  timestamptz
);

CREATE TABLE IF NOT EXISTS applications (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id       text NOT NULL,
  company         text NOT NULL,
  company_domain  text NOT NULL,
  role            text NOT NULL,
  status          app_status NOT NULL,
  first_seen      text NOT NULL,
  last_activity   text NOT NULL,
  snippet         text NOT NULL,
  timeline        text,
  manual          boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_thread ON applications (user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_app_user ON applications (user_id);
-- additive column for existing deployments (timeline added after first ship)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS timeline text;

CREATE TABLE IF NOT EXISTS application_events (
  id              text PRIMARY KEY,
  application_id  text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status          app_status NOT NULL,
  occurred_at     text NOT NULL,
  source          text NOT NULL DEFAULT 'sync'
);

CREATE TABLE IF NOT EXISTS notes (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id  text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_app ON notes (application_id);

CREATE TABLE IF NOT EXISTS contacts (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id  text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name            text NOT NULL,
  email           text,
  role            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_app ON contacts (application_id);
`;
