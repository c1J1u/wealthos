-- =============================================================================
-- 0004: transaction metadata for recurring / fixed-expense / reimbursement
-- read models (frontend handoff §3.4), plus account reconciliation stamp.
--
-- The importer populates these from fixture income_meta/expense_meta; manual
-- P2 commands may set them explicitly.
-- =============================================================================

ALTER TABLE transactions
    ADD COLUMN is_recurring  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN frequency_type TEXT
        CHECK (frequency_type IS NULL OR frequency_type IN
               ('ONE_OFF','RECURRING','MONTHLY','WEEKLY','QUARTERLY','YEARLY','IRREGULAR')),
    ADD COLUMN reimbursable  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE accounts
    ADD COLUMN last_reconciled_at TIMESTAMPTZ;
