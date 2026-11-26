-- Preserve applied 013. Baseline part_index is bigint; JSON array indexing requires int.
CREATE OR REPLACE FUNCTION dg_native_transfer_part_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;
BEGIN
 SELECT * INTO r FROM media_transfers WHERE id=NEW.transfer_id FOR UPDATE;
 IF r.status IS DISTINCT FROM 'uploading' OR NEW.part_index<0 OR NEW.part_index>=r.chunk_count OR NEW.size<>LEAST(r.chunk_size,r.size-NEW.part_index*r.chunk_size) OR NEW.sha256 !~ '^[a-f0-9]{64}$' OR NEW.storage_key !~ '^[a-f0-9-]{36}\.bin$' OR(r.part_hashes IS NOT NULL AND r.part_hashes::jsonb->>(NEW.part_index::int) IS DISTINCT FROM NEW.sha256) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native transfer part does not match fixed input';
 END IF;
 RETURN NEW;
END;
$dg$;
