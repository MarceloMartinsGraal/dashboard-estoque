-- Preparação somente; nenhuma credencial/vínculo é criado ou ativado por esta migração.
CREATE TABLE integration_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instance_id text NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 120),
 name text NOT NULL, token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] NOT NULL CHECK(cardinality(scopes)>0 AND scopes <@ ARRAY['read','products:write','movements:write']::text[]),
 active boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_clients_instance ON integration_clients(instance_id);
CREATE TABLE external_employee_links (
 instance_id text NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 120),
 external_user_id text NOT NULL CHECK(length(external_user_id) BETWEEN 1 AND 200),
 employee_id uuid NOT NULL REFERENCES employees(id), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(instance_id,external_user_id)
);
CREATE TABLE integration_operations (
 instance_id text NOT NULL, idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 120),
 operation text NOT NULL CHECK(operation IN ('movement','product')),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL,
 client_id uuid NOT NULL REFERENCES integration_clients(id), employee_id uuid NOT NULL REFERENCES employees(id),
 external_user_id text NOT NULL, ticket_id text,
 movement_id uuid UNIQUE REFERENCES movements(id), product_id uuid NOT NULL REFERENCES products(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(instance_id,idempotency_key),
 CHECK((operation='movement' AND movement_id IS NOT NULL AND ticket_id IS NOT NULL) OR (operation='product' AND movement_id IS NULL))
);
CREATE INDEX integration_operations_ticket ON integration_operations(instance_id,ticket_id,movement_id);
CREATE TRIGGER immutable_integration_operations BEFORE UPDATE OR DELETE ON integration_operations FOR EACH ROW EXECUTE FUNCTION immutable_record();
