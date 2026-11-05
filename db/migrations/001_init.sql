CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  roles       text[] NOT NULL CHECK (roles <@ ARRAY['author','reviewer','approver','reader','admin'])
);

CREATE TABLE documents (
  id          text PRIMARY KEY,
  metadata    jsonb NOT NULL,
  created_by  text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE versions (
  id          text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id),
  major       int  NOT NULL,
  minor       int  NOT NULL,
  state       text NOT NULL CHECK (state IN ('draft','in_review','changes_requested','pending_approval',
                                              'approved','active','superseded','retired')),
  content     jsonb NOT NULL,
  plain_text  text NOT NULL DEFAULT '',
  author_id   text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE (document_id, major, minor)
);
-- Exactly one active version per document. Supersession happens in the same
-- transaction as activation, so readers never see zero or two.
CREATE UNIQUE INDEX one_active_version ON versions (document_id) WHERE state = 'active';
-- Only one version of a document can be in progress at a time.
CREATE UNIQUE INDEX one_open_version ON versions (document_id)
  WHERE state IN ('draft','in_review','changes_requested','pending_approval','approved');
CREATE INDEX versions_text_trgm ON versions USING gin (plain_text gin_trgm_ops);

CREATE TABLE comments (
  id          text PRIMARY KEY,
  version_id  text NOT NULL REFERENCES versions(id),
  clause_id   text,
  parent_id   text REFERENCES comments(id),
  author_id   text NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(trim(body)) > 0),
  critical    boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by text REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR critical = false)
);
CREATE INDEX comments_version ON comments (version_id);

-- Append-only audit log. The trigger refuses UPDATE and DELETE for every role,
-- including the table owner, so history can't be edited from the app.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    text NOT NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_entity ON audit_log (entity, entity_id, id);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
