-- Biblioteca documental privada. Não altera produto, movimento ou ledger.
CREATE TABLE invoice_documents (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
 storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[a-f0-9-]{36}\.pdf$'),
 mime_type text NOT NULL CHECK(mime_type='application/pdf'),
 byte_size integer NOT NULL CHECK(byte_size>0 AND byte_size<=20971520),
 checksum text NOT NULL UNIQUE CHECK(checksum ~ '^[a-f0-9]{64}$'),
 uploaded_by uuid NOT NULL REFERENCES employees(id),uploaded_at timestamptz NOT NULL DEFAULT now()
);
-- PK do documento limita vínculo atual a zero/um; futuramente pode virar chave composta sem copiar PDF.
CREATE TABLE invoice_product_links (
 document_id uuid PRIMARY KEY REFERENCES invoice_documents(id),product_id uuid NOT NULL REFERENCES products(id)
);
CREATE INDEX invoice_product_links_product ON invoice_product_links(product_id,document_id);
CREATE INDEX invoice_documents_newest ON invoice_documents(uploaded_at DESC,id DESC);
CREATE FUNCTION preserve_invoice_document() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Documento preservado; exclusão não permitida'; END IF;
 IF (NEW.id,NEW.original_name,NEW.storage_key,NEW.mime_type,NEW.byte_size,NEW.checksum,NEW.uploaded_by,NEW.uploaded_at)
 IS DISTINCT FROM (OLD.id,OLD.original_name,OLD.storage_key,OLD.mime_type,OLD.byte_size,OLD.checksum,OLD.uploaded_by,OLD.uploaded_at)
 THEN RAISE EXCEPTION 'Conteúdo e autoria do documento são preservados'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER preserve_invoice_document BEFORE UPDATE OR DELETE ON invoice_documents FOR EACH ROW EXECUTE FUNCTION preserve_invoice_document();
