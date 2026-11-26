CREATE TABLE IF NOT EXISTS agus2_tasks (
      owner text NOT NULL,id text NOT NULL,version integer NOT NULL DEFAULT 0,
      state text NOT NULL,due_at timestamptz NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(owner,id));

CREATE INDEX IF NOT EXISTS agus2_tasks_due ON agus2_tasks(state,due_at);

CREATE TABLE IF NOT EXISTS agus2_memories (
      owner text NOT NULL,id text NOT NULL,confirmed boolean NOT NULL DEFAULT false,
      payload jsonb NOT NULL,PRIMARY KEY(owner,id));

CREATE TABLE IF NOT EXISTS agus2_events (
      owner text NOT NULL,id text NOT NULL,task text NOT NULL,kind text NOT NULL,
      created_at timestamptz NOT NULL,PRIMARY KEY(owner,id));

CREATE TABLE IF NOT EXISTS agus2_notifications (
      owner text NOT NULL,id text NOT NULL,task text NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(owner,id));

CREATE TABLE IF NOT EXISTS agus_solana_drafts (
      owner text NOT NULL,
      id text NOT NULL,
      revision integer NOT NULL CHECK (revision >= 0),
      state text NOT NULL,
      signature text UNIQUE,
      payload jsonb NOT NULL,
      PRIMARY KEY (owner, id),
      CHECK (payload->>'owner' = owner AND payload->>'id' = id AND payload->>'state' = state),
      CHECK ((payload->>'revision')::integer = revision)
    );

CREATE TABLE IF NOT EXISTS agus_solana_events (
      id text PRIMARY KEY,
      owner text NOT NULL,
      draft_id text NOT NULL,
      action text NOT NULL,
      at timestamptz NOT NULL,
      details jsonb NOT NULL,
      FOREIGN KEY (owner, draft_id) REFERENCES agus_solana_drafts(owner, id)
    );

CREATE TABLE IF NOT EXISTS chat_history (
      owner text NOT NULL, id text NOT NULL, title text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), lease text, lease_until timestamptz,
      PRIMARY KEY (owner, id));

CREATE TABLE IF NOT EXISTS chat_turns (
      owner text NOT NULL, chat text NOT NULL, id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
      PRIMARY KEY (owner, chat, id),
      FOREIGN KEY (owner, chat) REFERENCES chat_history(owner, id));

CREATE INDEX IF NOT EXISTS chat_history_recent ON chat_history(owner, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS agus2_agent_runs (
    owner text NOT NULL,id text NOT NULL,conversation text NOT NULL,state text NOT NULL,
    version integer NOT NULL,lease text,lease_until timestamptz,payload jsonb NOT NULL,
    PRIMARY KEY(owner,id));
