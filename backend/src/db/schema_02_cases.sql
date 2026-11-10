-- Stage 1: cases, notes, attachments, feedback labels, settings.

ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE case_status AS ENUM ('open', 'investigating', 'escalated', 'closed');
CREATE TYPE case_verdict AS ENUM ('confirmed', 'false_positive');

CREATE TABLE cases (
  id           SERIAL PRIMARY KEY,
  dataset      TEXT NOT NULL,
  day          DATE NOT NULL,
  group_label  TEXT,
  title        TEXT NOT NULL,
  status       case_status NOT NULL DEFAULT 'open',
  assignee_id  INTEGER REFERENCES users(id),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  verdict      case_verdict,
  closing_note TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ,
  UNIQUE (dataset, group_label)
);

-- A snapshot of the alerts when the case was opened, so the case never changes underneath you.
CREATE TABLE case_alerts (
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  edge_id     BIGINT NOT NULL,
  rank        INTEGER,
  src         TEXT NOT NULL,
  dst         TEXT NOT NULL,
  amount      NUMERIC,
  probability DOUBLE PRECISION,
  band        TEXT,
  txn_time    TIMESTAMP,
  PRIMARY KEY (case_id, edge_id)
);

CREATE TABLE case_notes (
  id         SERIAL PRIMARY KEY,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_attachments (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Module 12: investigator verdicts become labels for retraining.
CREATE TABLE feedback_labels (
  id         SERIAL PRIMARY KEY,
  dataset    TEXT NOT NULL,
  edge_id    BIGINT NOT NULL,
  label      SMALLINT NOT NULL CHECK (label IN (0, 1)),
  case_id    INTEGER REFERENCES cases(id),
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset, edge_id)
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES ('review_budget_k', '200');

CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX cases_status_idx ON cases (status);
