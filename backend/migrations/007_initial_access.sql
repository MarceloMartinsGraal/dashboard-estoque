-- Contas existentes mantêm funcionamento e senhas. Só o bootstrap automático cria pendência.
ALTER TABLE employees ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
