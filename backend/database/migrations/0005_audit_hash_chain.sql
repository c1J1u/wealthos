-- =============================================================================
-- 0005: audit_logs hash chain (ADR-015 / FI-22, Ruling B-04 fulfilled)
--
-- The chain is maintained by a BEFORE INSERT trigger so even the application
-- role cannot write an unchained or forged audit row. Concurrency within a
-- book is serialized with a transaction-scoped advisory lock.
--
-- hash = sha256(prev_hash || book || actor || operation || entity ||
--               request_id || created_at || before_state || after_state)
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_audit_chain() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_prev TEXT;
BEGIN
    -- serialize chain appends for this book
    PERFORM pg_advisory_xact_lock(hashtext(NEW.book_id::text));

    SELECT hash INTO v_prev
      FROM audit_logs
     WHERE book_id = NEW.book_id
     ORDER BY created_at DESC, log_id
     LIMIT 1;

    NEW.prev_hash := COALESCE(v_prev, 'GENESIS');
    NEW.hash := encode(sha256(convert_to(concat_ws('|',
        COALESCE(v_prev, 'GENESIS'),
        NEW.book_id::text,
        NEW.actor_type, NEW.actor_id,
        NEW.operation_type, NEW.entity_type, NEW.entity_id,
        NEW.request_id,
        to_char(NEW.created_at, 'YYYY-MM-DD HH24:MI:SS.USOF'),
        COALESCE(NEW.before_state::text, '-'),
        COALESCE(NEW.after_state::text, '-')
    ), 'UTF8')), 'hex');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_chain
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_audit_chain();

-- Chain verification helper: returns the first broken link, or NULL if the
-- whole chain is intact.
CREATE OR REPLACE FUNCTION fn_audit_verify(p_book UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
    r RECORD;
    expected_prev TEXT := 'GENESIS';
    expected_hash TEXT;
BEGIN
    FOR r IN
        SELECT * FROM audit_logs
         WHERE book_id = p_book
         ORDER BY created_at, log_id
    LOOP
        IF r.prev_hash IS DISTINCT FROM expected_prev THEN
            RETURN format('broken prev_hash at %s: expected %s, stored %s',
                          r.log_id, expected_prev, r.prev_hash);
        END IF;
        expected_hash := encode(sha256(convert_to(concat_ws('|',
            COALESCE(r.prev_hash, 'GENESIS'),
            r.book_id::text,
            r.actor_type, r.actor_id,
            r.operation_type, r.entity_type, r.entity_id,
            r.request_id,
            to_char(r.created_at, 'YYYY-MM-DD HH24:MI:SS.USOF'),
            COALESCE(r.before_state::text, '-'),
            COALESCE(r.after_state::text, '-')
        ), 'UTF8')), 'hex');
        IF r.hash IS DISTINCT FROM expected_hash THEN
            RETURN format('forged hash at %s', r.log_id);
        END IF;
        expected_prev := r.hash;
    END LOOP;
    RETURN NULL;
END;
$$;
