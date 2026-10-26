-- =============================================================================
-- 0003: Same-book integrity (fixes acceptance-report D-3)
-- A transaction_entry must reference a ledger_account in the SAME book as its
-- transaction. Plain FKs cannot express this; enforce with a trigger.
-- Also: transaction_links rows must stay within one book.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_entries_same_book()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_txn_book UUID;
    v_acct_book UUID;
BEGIN
    SELECT book_id INTO v_txn_book FROM transactions WHERE transaction_id = NEW.transaction_id;
    SELECT book_id INTO v_acct_book FROM ledger_accounts WHERE ledger_account_id = NEW.ledger_account_id;

    IF v_txn_book IS DISTINCT FROM v_acct_book THEN
        RAISE EXCEPTION
            'cross-book entry: transaction % (book %) references ledger account % (book %)',
            NEW.transaction_id, v_txn_book, NEW.ledger_account_id, v_acct_book;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entries_same_book
    BEFORE INSERT OR UPDATE OF transaction_id, ledger_account_id ON transaction_entries
    FOR EACH ROW EXECUTE FUNCTION fn_entries_same_book();

CREATE OR REPLACE FUNCTION fn_links_same_book()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_from_book UUID;
    v_to_book UUID;
BEGIN
    SELECT book_id INTO v_from_book FROM transactions WHERE transaction_id = NEW.from_transaction_id;
    SELECT book_id INTO v_to_book FROM transactions WHERE transaction_id = NEW.to_transaction_id;
    IF v_from_book IS DISTINCT FROM v_to_book OR v_from_book IS DISTINCT FROM NEW.book_id THEN
        RAISE EXCEPTION 'cross-book transaction link %', NEW.link_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_links_same_book
    BEFORE INSERT OR UPDATE ON transaction_links
    FOR EACH ROW EXECUTE FUNCTION fn_links_same_book();
