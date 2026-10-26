-- =============================================================================
-- 0002: Row-level security (fixes acceptance-report D-2)
-- - discovers every table that actually has a book_id column
-- - ENABLE + FORCE ROW LEVEL SECURITY on each
-- - policy reads app.book_id via NULLIF guard (missing var -> NULL,
--   comparison -> false, row filtered; never a uuid cast error)
-- - FORCE applies the policy to the table owner too.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_book_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.book_id', true), '')::uuid
$$;

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT c.table_name
          FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.column_name = 'book_id'
           AND c.table_name IN (
               SELECT table_name FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE'
           )
         ORDER BY c.table_name
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
        EXECUTE format('DROP POLICY IF EXISTS book_isolation ON %I', t.table_name);
        EXECUTE format(
            'CREATE POLICY book_isolation ON %I USING (book_id = app_book_id())',
            t.table_name);
    END LOOP;
END $$;

-- Grants: app role gets schema usage + table access only through RLS.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wealthos_app') THEN
        GRANT USAGE ON SCHEMA public TO wealthos_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wealthos_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wealthos_app;
    END IF;
END $$;
