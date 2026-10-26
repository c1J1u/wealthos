-- =============================================================================
-- 0006: sessions.csrf_token — M2 pairing-mode CSRF double insurance.
-- The pairing response issues a per-session csrf token that mutating
-- requests must echo in the X-CSRF-Token header.
-- =============================================================================

ALTER TABLE sessions
    ADD COLUMN csrf_token TEXT;
