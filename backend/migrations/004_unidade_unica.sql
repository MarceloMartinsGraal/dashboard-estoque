-- Metro foi descontinuado: produtos passam a usar somente unidades inteiras.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ledger l JOIN movements m ON m.id=l.movement_id JOIN products p ON p.id=m.product_id WHERE p.unit='metro' AND l.delta%1000<>0)
 OR EXISTS(SELECT 1 FROM legacy_movements lm JOIN products p ON p.id=lm.product_id WHERE p.unit='metro' AND lm.quantity%1000<>0) THEN
  RAISE EXCEPTION 'Produto em metros com quantidade fracionária; converta manualmente antes de migrar';
 END IF;
END $$;
UPDATE products SET unit='unidade' WHERE unit='metro';
DELETE FROM units WHERE code='metro';
