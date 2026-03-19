CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  encrypted_password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sync TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  uid INTEGER,
  message_id TEXT,
  subject TEXT,
  from_name TEXT,
  from_email TEXT,
  to_addresses JSONB,
  date TIMESTAMPTZ,
  snippet TEXT,
  is_outgoing BOOLEAN DEFAULT FALSE,
  folder TEXT NOT NULL,
  thread_id TEXT,
  flags JSONB,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_key TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_text TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_html TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_format TEXT DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS has_remote_images BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS has_linked_images BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sync_jobs (
  job_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  error TEXT,
  counts JSONB DEFAULT '{}'::jsonb,
  timings JSONB DEFAULT '{}'::jsonb,
  trace JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages(user_id);
CREATE INDEX IF NOT EXISTS messages_date_idx ON messages(date DESC);
CREATE INDEX IF NOT EXISTS messages_thread_id_idx ON messages(thread_id);
CREATE INDEX IF NOT EXISTS messages_user_folder_idx ON messages(user_id, folder);
CREATE INDEX IF NOT EXISTS messages_cached_at_idx ON messages(cached_at);
CREATE INDEX IF NOT EXISTS messages_contact_key_idx ON messages(contact_key);
CREATE INDEX IF NOT EXISTS messages_contact_email_idx ON messages(contact_email);
CREATE INDEX IF NOT EXISTS sync_jobs_user_id_idx ON sync_jobs(user_id);
CREATE INDEX IF NOT EXISTS sync_jobs_status_idx ON sync_jobs(status);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
