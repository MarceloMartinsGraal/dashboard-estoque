
CREATE TABLE employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE,
 name text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
 manages_accounts boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
CREATE INDEX sessions_expire ON sessions(expire);
CREATE TABLE login_attempts (key text PRIMARY KEY, count integer NOT NULL, expires timestamptz NOT NULL);
CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
CREATE TABLE subcategories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_id uuid NOT NULL REFERENCES categories(id), name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(category_id,name), UNIQUE(id,category_id));
CREATE TABLE units (code text PRIMARY KEY, name text NOT NULL, precision_digits integer NOT NULL CHECK(precision_digits IN (0,3)));
INSERT INTO units VALUES ('unidade','Unidade',0),('metro','Metro',3);
CREATE TABLE locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true);
INSERT INTO locations(id,code,name) VALUES ('00000000-0000-0000-0000-000000000001','NAO_INFORMADA','Não informada');
CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text, legacy_id bigint,
 description text NOT NULL, original_description text, category_id uuid REFERENCES categories(id),
 subcategory_id uuid, unit text NOT NULL REFERENCES units(code), active boolean NOT NULL DEFAULT true,
 minimum_quantity bigint CHECK(minimum_quantity >= 0), validation_status text NOT NULL DEFAULT 'pendente_validacao',
 opening_date date, UNIQUE(source,legacy_id), FOREIGN KEY(subcategory_id,category_id) REFERENCES subcategories(id,category_id),
 CHECK(subcategory_id IS NULL OR category_id IS NOT NULL)
);
CREATE TABLE movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id),
 kind text NOT NULL CHECK(kind IN ('abertura','entrada','saida','ajuste_entrada','ajuste_saida','realocacao','estorno')),
 quantity bigint NOT NULL CHECK(quantity > 0), event_date date NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid NOT NULL REFERENCES employees(id), reason text NOT NULL, ticket text, justification text,
 reversal_of uuid UNIQUE REFERENCES movements(id), CHECK(kind <> 'estorno' OR reversal_of IS NOT NULL)
);
CREATE TABLE ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, movement_id uuid NOT NULL REFERENCES movements(id),
 location_id uuid NOT NULL REFERENCES locations(id), delta bigint NOT NULL CHECK(delta <> 0)
);
CREATE INDEX movements_product_date ON movements(product_id,event_date);
CREATE INDEX ledger_movement_location ON ledger(movement_id,location_id);
CREATE UNIQUE INDEX one_opening_per_product ON movements(product_id) WHERE kind='abertura';
CREATE TABLE import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, checksum text NOT NULL,
 created_by uuid NOT NULL REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz, confirmed_by uuid REFERENCES employees(id), payload jsonb NOT NULL, preview jsonb NOT NULL,
 UNIQUE(source,checksum)
);
CREATE TABLE legacy_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES import_batches(id),
 source text NOT NULL, legacy_id bigint NOT NULL, product_id uuid NOT NULL REFERENCES products(id),
 kind text NOT NULL, quantity bigint NOT NULL CHECK(quantity >= 0), event_date date NOT NULL,
 reason text NOT NULL, ticket text, origin text, observation text, date_estimated boolean NOT NULL,
 date_original text, conversion_rule text, validation_status text NOT NULL DEFAULT 'pendente_validacao',
 author_label text NOT NULL DEFAULT 'importação legada', zero_evidence boolean NOT NULL, UNIQUE(source,legacy_id)
);
CREATE TABLE audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES employees(id),
 action text NOT NULL, entity text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Registro histórico imutável'; END $$;
CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_legacy BEFORE UPDATE OR DELETE ON legacy_movements FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION immutable_record();
