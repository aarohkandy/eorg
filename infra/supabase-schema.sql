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

CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages(user_id);
CREATE INDEX IF NOT EXISTS messages_date_idx ON messages(date DESC);
CREATE INDEX IF NOT EXISTS messages_thread_id_idx ON messages(thread_id);
CREATE INDEX IF NOT EXISTS messages_user_folder_idx ON messages(user_id, folder);
CREATE INDEX IF NOT EXISTS messages_cached_at_idx ON messages(cached_at);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
