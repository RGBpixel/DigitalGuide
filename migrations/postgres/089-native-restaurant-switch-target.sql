-- A staff next-guest intent is bound to the visitor who was actually confirmed.
CREATE OR REPLACE FUNCTION dg_native_dining_terminal_view(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',t.id,'restaurantId',d.restaurant_id,'name',t.name,'currentSessionId',s.id,'currentSessionVersion',s.version,'currentFocusVersion',s.focus_version) FROM reception_terminals t JOIN _dg_native_dining_terminal_origins d ON d.terminal_id=t.id LEFT JOIN reception_sessions s ON s.terminal_id=t.id AND s.status IN('active','human') WHERE t.id=target
$dg$;
CREATE OR REPLACE FUNCTION dg_native_dining_open(target text,input jsonb,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;m memberships%ROWTYPE;s reception_sessions%ROWTYPE;next_value text;version_value bigint;focus_value bigint;
BEGIN
 meta:=dg_native_dining_terminal_prepare(target,false,true);m:=dg_native_restaurant_actor();PERFORM dg_native_restaurant_fields(input,ARRAY['action','confirmed','sessionId','version','focusVersion']);
 IF input->>'action' NOT IN('open','next') OR input->>'action' IS NULL OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'action'='open' AND input ?| ARRAY['sessionId','version','focusVersion'] THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 SELECT * INTO s FROM reception_sessions WHERE terminal_id=target AND status IN('active','human') FOR UPDATE;
 IF input->>'action'='next' THEN
  version_value:=dg_native_restaurant_integer(input->'version',1,9007199254740991);focus_value:=dg_native_restaurant_integer(input->'focusVersion',0,9007199254740991);
  IF s.id IS NULL OR input->>'sessionId' IS DISTINCT FROM s.id OR s.version<>version_value OR s.focus_version<>focus_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;
 END IF;
 IF s.id IS NOT NULL AND input->>'action'='open' THEN IF NOT dg_native_dining_source_valid(s.id) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;next_value:=s.id;
 ELSE
  IF s.id IS NOT NULL THEN PERFORM dg_native_reception_end(s.id,'restaurant_next_guest');END IF;
  next_value:=dg_native_dining_spawn(target,m.user_id,'manual',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),inputs_value);
 END IF;RETURN dg_native_dining_operation(meta->>'restaurantId',target,next_value,NULL,input->>'action');
END;$dg$;
