CREATE TABLE source_records(source text NOT NULL, entity text NOT NULL, legacy_id text NOT NULL, fingerprint text NOT NULL, PRIMARY KEY(source,entity,legacy_id));
