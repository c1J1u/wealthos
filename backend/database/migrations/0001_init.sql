
-- -----------------------------------------------------------------------------
-- 1. Identity and books
-- -----------------------------------------------------------------------------

CREATE TABLE users (
    user_id          UUID PRIMARY KEY,
    email            TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    base_currency    CHAR(3) NOT NULL DEFAULT 'CNY',
    timezone         TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    locale           TEXT NOT NULL DEFAULT 'zh-CN',
    status           TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version          INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));

CREATE TABLE ledger_books (
    book_id            UUID PRIMARY KEY,
    owner_user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    name               TEXT NOT NULL,
    base_currency      CHAR(3) NOT NULL DEFAULT 'CNY',
    fiscal_start_month SMALLINT NOT NULL DEFAULT 1
                       CHECK (fiscal_start_month BETWEEN 1 AND 12),
    status             TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    version            INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX ix_ledger_books_owner ON ledger_books (owner_user_id, status);

CREATE TABLE memberships (
    book_id     UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    role        TEXT NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (book_id, user_id)
);

CREATE TABLE sessions (
    session_id    UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_sessions_token_hash ON sessions (token_hash);
CREATE INDEX ix_sessions_user_expiry ON sessions (user_id, expires_at);

CREATE TABLE api_tokens (
    token_id     UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL,
    scopes       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_api_tokens_hash ON api_tokens (token_hash);
CREATE INDEX ix_api_tokens_user ON api_tokens (user_id);

-- -----------------------------------------------------------------------------
-- 2. Accounts and reference data
-- -----------------------------------------------------------------------------

CREATE TABLE accounts (
    account_id             UUID PRIMARY KEY,
    book_id                UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    name                   TEXT NOT NULL,
    type                   TEXT NOT NULL
                           CHECK (type IN ('CASH','BANK','PAYMENT','CREDIT','INVESTMENT','HOUSING','PROTECTION','OTHER')),
    subtype                TEXT NOT NULL,
    institution_name       TEXT,
    currency               CHAR(3) NOT NULL DEFAULT 'CNY',
    normal_side            TEXT NOT NULL CHECK (normal_side IN ('ASSET','LIABILITY')),
    include_in_net_worth   BOOLEAN NOT NULL DEFAULT TRUE,
    is_restricted          BOOLEAN NOT NULL DEFAULT FALSE,
    liquidity_level        TEXT NOT NULL
                           CHECK (liquidity_level IN ('INSTANT','HIGH','TERM','LOW','ILLIQUID')),
    status                 TEXT NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
    opened_at              DATE,
    closed_at              DATE,
    data_state             TEXT NOT NULL DEFAULT 'ACTUAL'
                           CHECK (data_state IN ('ACTUAL','ESTIMATE')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK (closed_at IS NULL OR opened_at IS NULL OR closed_at >= opened_at)
);
CREATE UNIQUE INDEX ux_accounts_book_name ON accounts (book_id, name);
CREATE INDEX ix_accounts_book_side ON accounts (book_id, normal_side, status);

CREATE TABLE categories (
    category_code          TEXT PRIMARY KEY,
    parent_code            TEXT,
    name_zh                TEXT NOT NULL,
    name_en                TEXT,
    kind                   TEXT NOT NULL CHECK (kind IN ('INCOME','EXPENSE')),
    default_necessity      TEXT
                           CHECK (default_necessity IS NULL OR default_necessity IN ('ESSENTIAL','OPTIONAL','LUXURY')),
    is_system              BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at            TIMESTAMPTZ,
    CHECK (category_code ~ '^[A-Z][A-Z0-9_]*$')
);
CREATE INDEX ix_categories_kind_parent ON categories (kind, parent_code);

CREATE TABLE counterparties (
    counterparty_id  UUID PRIMARY KEY,
    book_id          UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    type             TEXT NOT NULL CHECK (type IN ('MERCHANT','EMPLOYER','FINANCIAL_INSTITUTION','PERSON','OTHER')),
    name             TEXT NOT NULL,
    external_id      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_counterparties_book_type_name
    ON counterparties (book_id, type, name);

CREATE TABLE flow_effects (
    code                    TEXT PRIMARY KEY,
    description             TEXT NOT NULL,
    is_income               BOOLEAN NOT NULL DEFAULT FALSE,
    economic_expense_sign   SMALLINT NOT NULL DEFAULT 0
                            CHECK (economic_expense_sign IN (-1,0,1)),
    budget_bucket           TEXT
                            CHECK (budget_bucket IS NULL OR budget_bucket IN ('EXPENSE','SAVINGS','DEBT_REPAYMENT','REVERSE')),
    cashflow_bucket         TEXT
                            CHECK (cashflow_bucket IS NULL OR cashflow_bucket IN ('OPERATING','INVESTING','FINANCING')),
    savings_a_sign          SMALLINT NOT NULL DEFAULT 0
                            CHECK (savings_a_sign IN (-1,0,1)),
    is_debt_service         BOOLEAN NOT NULL DEFAULT FALSE,
    net_worth_sign          SMALLINT NOT NULL DEFAULT 0
                            CHECK (net_worth_sign IN (-1,0,1)),
    salary_cashflow_included BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- 3. Ledger chart of accounts
-- -----------------------------------------------------------------------------

CREATE TABLE ledger_accounts (
    ledger_account_id  UUID PRIMARY KEY,
    book_id            UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    code               TEXT NOT NULL,
    name               TEXT NOT NULL,
    class              TEXT NOT NULL
                       CHECK (class IN ('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY')),
    normal_side        TEXT NOT NULL CHECK (normal_side IN ('DEBIT','CREDIT')),
    parent_id          UUID REFERENCES ledger_accounts(ledger_account_id) ON DELETE RESTRICT,
    category_code      TEXT REFERENCES categories(category_code) ON DELETE RESTRICT,
    account_id         UUID REFERENCES accounts(account_id) ON DELETE RESTRICT,
    is_system          BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (class IN ('INCOME','EXPENSE') AND category_code IS NOT NULL AND account_id IS NULL)
        OR
        (class IN ('ASSET','LIABILITY') AND account_id IS NOT NULL AND category_code IS NULL)
        OR
        (class = 'EQUITY' AND account_id IS NULL AND category_code IS NULL)
    ),
    CHECK (
        (class IN ('ASSET','EXPENSE') AND normal_side = 'DEBIT')
        OR
        (class IN ('LIABILITY','INCOME','EQUITY') AND normal_side = 'CREDIT')
    )
);
CREATE UNIQUE INDEX ux_ledger_accounts_book_code ON ledger_accounts (book_id, code);
CREATE INDEX ix_ledger_accounts_book_class ON ledger_accounts (book_id, class);
CREATE INDEX ix_ledger_accounts_account ON ledger_accounts (account_id);
CREATE INDEX ix_ledger_accounts_category ON ledger_accounts (category_code);

-- -----------------------------------------------------------------------------
-- 4. Transactions and entries
-- -----------------------------------------------------------------------------

CREATE TABLE transactions (
    transaction_id          UUID PRIMARY KEY,
    book_id                 UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    transaction_type        TEXT NOT NULL CHECK (transaction_type IN (
        'INCOME','EXPENSE','TRANSFER','CREDIT_CARD_PURCHASE','CREDIT_CARD_REPAYMENT',
        'LOAN_DISBURSEMENT','LOAN_REPAYMENT','DEPOSIT_OPEN','DEPOSIT_MATURITY',
        'DEPOSIT_RENEWAL','INVESTMENT_BUY','INVESTMENT_SELL','DIVIDEND_RECEIVED',
        'INTEREST_RECEIVED','FEE_CHARGED','REFUND','REIMBURSEMENT','ASSET_REVALUATION',
        'LIABILITY_ADJUSTMENT','CURRENCY_EXCHANGE','OTHER_ADJUSTMENT'
    )),
    amount_cents            BIGINT NOT NULL
                            CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
    currency                CHAR(3) NOT NULL DEFAULT 'CNY',
    original_amount_cents   BIGINT CHECK (original_amount_cents IS NULL OR original_amount_cents > 0),
    original_currency       CHAR(3),
    fx_rate                 NUMERIC(18,10) CHECK (fx_rate IS NULL OR fx_rate > 0),
    fx_date                 DATE,
    fx_source               TEXT,
    transaction_date        DATE NOT NULL,
    posting_date            DATE NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'POSTED'
                            CHECK (status IN ('DRAFT','PENDING','POSTED','RECONCILED')),
    reconciliation_status   TEXT NOT NULL DEFAULT 'UNRECONCILED'
                            CHECK (reconciliation_status IN ('UNRECONCILED','MATCHED','NEEDS_REVIEW')),
    source_account_id       UUID REFERENCES accounts(account_id) ON DELETE RESTRICT,
    destination_account_id  UUID REFERENCES accounts(account_id) ON DELETE RESTRICT,
    credit_account_id       UUID REFERENCES accounts(account_id) ON DELETE RESTRICT,
    liability_id            UUID, -- FK added in Phase 2 when liabilities table exists
    category_code           TEXT REFERENCES categories(category_code) ON DELETE RESTRICT,
    subcategory_code        TEXT REFERENCES categories(category_code) ON DELETE RESTRICT,
    merchant_name           TEXT,
    description             TEXT,
    data_state              TEXT NOT NULL DEFAULT 'ACTUAL'
                            CHECK (data_state IN ('ACTUAL','ESTIMATE')),
    source_type             TEXT NOT NULL DEFAULT 'MANUAL'
                            CHECK (source_type IN ('MANUAL','FILE_IMPORT','BANK_API','CONNECTOR','AI_AGENT')),
    external_transaction_id TEXT,
    validation_status       TEXT NOT NULL DEFAULT 'UNVERIFIED'
                            CHECK (validation_status IN ('UNVERIFIED','VERIFIED','DISPUTED','CORRECTED')),
    posting_rule_version    TEXT NOT NULL DEFAULT '1.0',
    related_transaction_id  UUID REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
    voided_by_transaction_id UUID REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
    idempotency_key         TEXT,
    version                 INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata                JSONB NOT NULL DEFAULT '{}'::JSONB,
    CHECK (
        transaction_type NOT IN ('TRANSFER','DEPOSIT_OPEN','DEPOSIT_MATURITY','DEPOSIT_RENEWAL','INVESTMENT_BUY','INVESTMENT_SELL')
        OR source_account_id IS DISTINCT FROM destination_account_id
    ),
    CHECK (transaction_type <> 'INCOME' OR destination_account_id IS NOT NULL),
    CHECK (transaction_type <> 'REFUND' OR destination_account_id IS NOT NULL),
    CHECK (transaction_type <> 'REIMBURSEMENT'
           OR (source_account_id IS NOT NULL AND destination_account_id IS NOT NULL)),
    CHECK (transaction_type <> 'CREDIT_CARD_PURCHASE' OR destination_account_id IS NOT NULL),
    CHECK (transaction_type <> 'LOAN_REPAYMENT' OR destination_account_id IS NOT NULL),
    CHECK (voided_by_transaction_id IS NULL OR voided_by_transaction_id <> transaction_id)
);
CREATE INDEX ix_transactions_book_date ON transactions (book_id, transaction_date DESC, transaction_id);
CREATE INDEX ix_transactions_book_status ON transactions (book_id, status, transaction_date);
CREATE INDEX ix_transactions_book_category ON transactions (book_id, category_code, transaction_date);
CREATE INDEX ix_transactions_source ON transactions (book_id, source_account_id);
CREATE INDEX ix_transactions_destination ON transactions (book_id, destination_account_id);
CREATE UNIQUE INDEX ux_transactions_external
    ON transactions (book_id, source_type, external_transaction_id)
    WHERE external_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX ux_transactions_idempotency
    ON transactions (book_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_transactions_related ON transactions (related_transaction_id);
CREATE INDEX ix_transactions_voided_by ON transactions (voided_by_transaction_id);

CREATE TABLE transaction_entries (
    entry_id           UUID PRIMARY KEY,
    transaction_id     UUID NOT NULL REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
    line_no            SMALLINT NOT NULL CHECK (line_no >= 1),
    direction          TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
    amount_cents       BIGINT NOT NULL
                       CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
    ledger_account_id  UUID NOT NULL REFERENCES ledger_accounts(ledger_account_id) ON DELETE RESTRICT,
    flow_effect        TEXT NOT NULL REFERENCES flow_effects(code) ON DELETE RESTRICT,
    entry_role         TEXT NOT NULL DEFAULT 'PRIMARY'
                       CHECK (entry_role IN ('PRIMARY','FUNDING','MEMO')),
    expense_bucket     TEXT
                       CHECK (expense_bucket IS NULL OR expense_bucket IN ('ESSENTIAL','DISCRETIONARY','FINANCIAL_COST','REFUND_REVERSAL')),
    principal_cents    BIGINT CHECK (principal_cents IS NULL OR principal_cents >= 0),
    gain_cents         BIGINT CHECK (gain_cents IS NULL OR gain_cents >= 0),
    memo               TEXT,
    currency           CHAR(3) NOT NULL DEFAULT 'CNY',
    base_amount_cents  BIGINT CHECK (base_amount_cents IS NULL OR base_amount_cents >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (transaction_id, line_no)
);
CREATE INDEX ix_entries_transaction ON transaction_entries (transaction_id);
CREATE INDEX ix_entries_ledger_account ON transaction_entries (ledger_account_id, created_at);
CREATE INDEX ix_entries_effect ON transaction_entries (flow_effect, created_at);
CREATE INDEX ix_entries_expense_bucket ON transaction_entries (expense_bucket, created_at)
    WHERE expense_bucket IS NOT NULL;

CREATE TABLE transaction_links (
    link_id            UUID PRIMARY KEY,
    book_id            UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    from_transaction_id UUID NOT NULL REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
    to_transaction_id   UUID NOT NULL REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
    link_type           TEXT NOT NULL
                        CHECK (link_type IN ('REFUND_OF','REIMBURSEMENT_OF','REVERSAL_OF','TRANSFER_PAIR','OTHER')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_transaction_id <> to_transaction_id),
    UNIQUE (from_transaction_id, to_transaction_id, link_type)
);
CREATE INDEX ix_transaction_links_to ON transaction_links (to_transaction_id);

-- -----------------------------------------------------------------------------
-- 5. Opening balances, balances, reconciliation, periods
-- -----------------------------------------------------------------------------

CREATE TABLE opening_balances (
    opening_balance_id UUID PRIMARY KEY,
    book_id            UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    account_id         UUID NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    as_of              DATE NOT NULL,
    amount_cents       BIGINT NOT NULL,
    data_state         TEXT NOT NULL DEFAULT 'ESTIMATE'
                       CHECK (data_state IN ('ACTUAL','ESTIMATE')),
    source             TEXT,
    transaction_id     UUID NOT NULL REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
    note               TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, as_of)
);
CREATE INDEX ix_opening_balances_book ON opening_balances (book_id, as_of);

CREATE TABLE account_balances (
    account_id               UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE RESTRICT,
    book_id                  UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    debit_total_cents        BIGINT NOT NULL DEFAULT 0,
    credit_total_cents       BIGINT NOT NULL DEFAULT 0,
    balance_cents            BIGINT NOT NULL DEFAULT 0,
    available_balance_cents  BIGINT,
    frozen_amount_cents      BIGINT NOT NULL DEFAULT 0,
    last_entry_id            UUID REFERENCES transaction_entries(entry_id) ON DELETE RESTRICT,
    version                  INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_daily_balances (
    account_id      UUID NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    as_of           DATE NOT NULL,
    balance_cents   BIGINT NOT NULL,
    debit_total_cents BIGINT NOT NULL,
    credit_total_cents BIGINT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, as_of)
);

CREATE TABLE reconciliations (
    reconciliation_id UUID PRIMARY KEY,
    book_id           UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    account_id        UUID NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    as_of             DATE NOT NULL,
    book_balance_cents    BIGINT NOT NULL,
    ledger_balance_cents  BIGINT NOT NULL,
    difference_cents      BIGINT NOT NULL,
    status            TEXT NOT NULL
                      CHECK (status IN ('OPEN','MATCHED','DIFFERENCE')),
    note              TEXT,
    reconciled_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_reconciliations_account_date ON reconciliations (account_id, as_of DESC);

CREATE TABLE period_locks (
    book_id       UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    period_start  DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    closed_at     TIMESTAMPTZ,
    closed_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    note          TEXT,
    PRIMARY KEY (book_id, period_start),
    CHECK (period_start = date_trunc('month', period_start)::date),
    CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- 6. Read-only assets and positions (Phase 1 projections)
-- -----------------------------------------------------------------------------

CREATE TABLE instruments (
    instrument_id   UUID PRIMARY KEY,
    book_id         UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    ticker          TEXT NOT NULL,
    name            TEXT NOT NULL,
    asset_class     TEXT NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'CNY',
    risk_level      TEXT NOT NULL DEFAULT 'MEDIUM'
                    CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX ux_instruments_book_ticker ON instruments (book_id, ticker);

CREATE TABLE positions (
    position_id             UUID PRIMARY KEY,
    book_id                 UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    instrument_id           UUID NOT NULL REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    account_id              UUID NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    quantity                NUMERIC(28,8) NOT NULL CHECK (quantity > 0),
    average_cost_cents      BIGINT NOT NULL CHECK (average_cost_cents >= 0),
    total_cost_basis_cents  BIGINT NOT NULL CHECK (total_cost_basis_cents >= 0),
    realized_pnl_cents      BIGINT NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                 INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (book_id, instrument_id, account_id)
);
CREATE INDEX ix_positions_account ON positions (account_id);

CREATE TABLE market_prices (
    instrument_id  UUID NOT NULL REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    as_of          DATE NOT NULL,
    source         TEXT NOT NULL DEFAULT 'MANUAL',
    price_cents    BIGINT NOT NULL CHECK (price_cents >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (instrument_id, as_of, source)
);

CREATE TABLE assets (
    asset_id          UUID PRIMARY KEY,
    book_id           UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    name              TEXT NOT NULL,
    asset_type        TEXT NOT NULL,
    account_id        UUID REFERENCES accounts(account_id) ON DELETE RESTRICT,
    currency          CHAR(3) NOT NULL DEFAULT 'CNY',
    is_restricted     BOOLEAN NOT NULL DEFAULT FALSE,
    liquidity_level   TEXT NOT NULL
                      CHECK (liquidity_level IN ('INSTANT','HIGH','TERM','LOW','ILLIQUID')),
    risk_level        TEXT NOT NULL DEFAULT 'MEDIUM'
                      CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
    is_tradable       BOOLEAN NOT NULL DEFAULT FALSE,
    status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','DISPOSED')),
    data_state        TEXT NOT NULL DEFAULT 'ACTUAL'
                      CHECK (data_state IN ('ACTUAL','ESTIMATE')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX ix_assets_book_type ON assets (book_id, asset_type, status);

CREATE TABLE asset_valuations (
    valuation_id              UUID PRIMARY KEY,
    asset_id                  UUID NOT NULL REFERENCES assets(asset_id) ON DELETE RESTRICT,
    as_of                     DATE NOT NULL,
    market_value_cents        BIGINT NOT NULL CHECK (market_value_cents >= 0),
    cost_basis_cents          BIGINT CHECK (cost_basis_cents IS NULL OR cost_basis_cents >= 0),
    unrealized_gain_loss_cents BIGINT,
    source                    TEXT NOT NULL
                              CHECK (source IN ('ACCOUNT_STATEMENT','MARKET_PRICE','USER_ESTIMATE','APPRAISAL')),
    note                      TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (asset_id, as_of, source)
);
CREATE INDEX ix_asset_valuations_asset_date ON asset_valuations (asset_id, as_of DESC);

-- -----------------------------------------------------------------------------
-- 7. Analytics, metrics and snapshots
-- -----------------------------------------------------------------------------

CREATE TABLE financial_snapshots (
    snapshot_id             UUID PRIMARY KEY,
    book_id                 UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    as_of                   DATE NOT NULL,
    total_assets_cents      BIGINT NOT NULL,
    total_liabilities_cents BIGINT NOT NULL,
    net_worth_cents         BIGINT NOT NULL,
    cash_reserve_cents      BIGINT NOT NULL,
    liquid_assets_cents     BIGINT NOT NULL,
    formula_version         TEXT NOT NULL,
    inputs_hash             TEXT NOT NULL,
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (book_id, as_of, formula_version)
);
CREATE INDEX ix_financial_snapshots_book_date ON financial_snapshots (book_id, as_of DESC);

CREATE TABLE metric_definitions (
    metric_id        TEXT NOT NULL,
    metric_version   TEXT NOT NULL,
    name             TEXT NOT NULL,
    unit             TEXT NOT NULL CHECK (unit IN ('CNY','RATIO','COUNT','MONTHS')),
    formula          TEXT NOT NULL,
    inclusion_rules  JSONB NOT NULL DEFAULT '[]'::JSONB,
    exclusion_rules  JSONB NOT NULL DEFAULT '[]'::JSONB,
    null_handling    TEXT NOT NULL,
    aggregation      TEXT NOT NULL DEFAULT 'SUM',
    effective_from   DATE NOT NULL,
    effective_to     DATE,
    PRIMARY KEY (metric_id, metric_version),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE metric_snapshots (
    metric_snapshot_id UUID PRIMARY KEY,
    book_id            UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    metric_id          TEXT NOT NULL,
    metric_version     TEXT NOT NULL,
    as_of              DATE NOT NULL,
    period             TEXT,
    value_cents        BIGINT,
    value              NUMERIC(20,8),
    data_state         TEXT NOT NULL DEFAULT 'ACTUAL'
                       CHECK (data_state IN ('ACTUAL','ESTIMATE','BUDGET','FORECAST','SCENARIO')),
    partial            BOOLEAN NOT NULL DEFAULT FALSE,
    missing_count      INTEGER NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
    na_reason          TEXT,
    inputs_hash        TEXT,
    computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (metric_id, metric_version)
        REFERENCES metric_definitions(metric_id, metric_version) ON DELETE RESTRICT,
    UNIQUE (book_id, metric_id, metric_version, as_of, period, data_state),
    CHECK (
        (value_cents IS NOT NULL AND value IS NULL)
        OR (value_cents IS NULL AND value IS NOT NULL)
        OR (value_cents IS NULL AND value IS NULL AND na_reason IS NOT NULL)
    )
);
CREATE INDEX ix_metric_snapshots_book_metric
    ON metric_snapshots (book_id, metric_id, as_of DESC);

-- -----------------------------------------------------------------------------
-- 8. Governance, idempotency, outbox, quality
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
    log_id          UUID PRIMARY KEY,
    book_id         UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    actor_type      TEXT NOT NULL CHECK (actor_type IN ('USER','AGENT','SYSTEM')),
    actor_id        TEXT NOT NULL,
    agent_id        TEXT,
    tool_name       TEXT,
    operation_type  TEXT NOT NULL
                    CHECK (operation_type IN ('READ','CREATE','UPDATE','DELETE','ANALYZE','PROPOSE','EXECUTE','APPROVE')),
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    before_state    JSONB,
    after_state     JSONB,
    request_id      TEXT NOT NULL,
    approval_id     UUID,
    ip              INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_hash       TEXT,
    hash            TEXT NOT NULL
);
CREATE INDEX ix_audit_logs_book_time ON audit_logs (book_id, created_at DESC);
CREATE INDEX ix_audit_logs_entity ON audit_logs (entity_type, entity_id);

CREATE TABLE idempotency_keys (
    user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    key              TEXT NOT NULL,
    request_hash     TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED')),
    response_status  INTEGER,
    response_body    JSONB,
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
CREATE INDEX ix_idempotency_expiry ON idempotency_keys (expires_at);

CREATE TABLE outbox_events (
    event_id        UUID PRIMARY KEY,
    book_id         UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    aggregate_type  TEXT NOT NULL,
    aggregate_id    TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_outbox_pending ON outbox_events (status, available_at);

CREATE TABLE data_quality_reports (
    report_id    UUID PRIMARY KEY,
    book_id      UUID NOT NULL REFERENCES ledger_books(book_id) ON DELETE RESTRICT,
    run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    checks       JSONB NOT NULL,
    pass         BOOLEAN NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_quality_reports_book_time ON data_quality_reports (book_id, run_at DESC);

-- -----------------------------------------------------------------------------
-- 9. Reference seed: flow_effects
--    A row is a semantic registry; entries reference it by code.
--    economic_expense_sign: +1 expense, -1 refund, 0 none.
--    savings_a_sign: +1 adds to savings A net, -1 subtracts, 0 none.
--    salary_cashflow_included: false for restricted PF-funded economic expense.
-- -----------------------------------------------------------------------------


INSERT INTO flow_effects (code, description, is_income, economic_expense_sign, budget_bucket, cashflow_bucket, savings_a_sign, is_debt_service, net_worth_sign, salary_cashflow_included) VALUES
('INCOME_SALARY','工资/奖金/津贴到账',TRUE,0,NULL,'OPERATING',1,FALSE,1,TRUE),
('INCOME_OTHER','兼职/咨询/经营',TRUE,0,NULL,'OPERATING',1,FALSE,1,TRUE),
('INCOME_PASSIVE','利息/股息/租金',TRUE,0,NULL,'OPERATING',1,FALSE,1,TRUE),
('INCOME_REALIZED_GAIN','卖出收益部分（时点财富不变）',TRUE,0,NULL,'INVESTING',1,FALSE,0,TRUE),
('TRANSFER_INTERNAL','账户互转（合并抵消）',FALSE,0,NULL,NULL,0,FALSE,0,FALSE),
('ASSET_EXCHANGE','转入定存/买入投资（结构变化）',FALSE,0,'SAVINGS',NULL,0,FALSE,0,FALSE),
('DEBT_BORROW','借款到账/信用卡额度使用',FALSE,0,NULL,'FINANCING',0,FALSE,0,TRUE),
('DEBT_PRINCIPAL_REPAY','偿还本金（口径A不含）',FALSE,0,'DEBT_REPAYMENT','FINANCING',0,TRUE,0,TRUE),
('DEBT_INTEREST','利息（财务费用）',FALSE,1,NULL,'OPERATING',1,TRUE,1,TRUE),
('DEBT_FEE','手续费/违约金',FALSE,1,NULL,'OPERATING',1,TRUE,1,TRUE),
('CONSUMPTION','真实消费',FALSE,1,NULL,'OPERATING',1,FALSE,1,TRUE),
('CONSUMPTION_PF_RENT','公积金付房租（工资现金流 0）',FALSE,1,NULL,'OPERATING',1,FALSE,1,FALSE),
('REFUND_REVERSAL','消费退款（负支出）',FALSE,-1,'REVERSE','OPERATING',-1,FALSE,1,TRUE),
('REIMBURSEMENT_RECEIPT','报销到账（清偿应收款）',FALSE,0,NULL,'OPERATING',0,FALSE,0,TRUE),
('RECEIVABLE_SETTLEMENT','他人还借款本金',FALSE,0,NULL,'OPERATING',0,FALSE,0,TRUE),
('PROVIDENT_FUND_EMPLOYEE','个人公积金缴存（非现金报酬）',FALSE,0,NULL,NULL,0,FALSE,0,FALSE),
('PROVIDENT_FUND_EMPLOYER','单位公积金缴存（NON_CASH）',FALSE,0,NULL,NULL,0,FALSE,1,FALSE),
('ASSET_REVALUATION','市值重估/估值调整（未实现）',FALSE,0,NULL,NULL,0,FALSE,1,FALSE),
('LIABILITY_ADJUSTMENT','负债重估/核销',FALSE,0,NULL,NULL,0,FALSE,1,FALSE),
('OTHER_ADJUSTMENT','其他更正分录（视情况）',FALSE,0,NULL,NULL,0,FALSE,0,FALSE);


-- -----------------------------------------------------------------------------
-- 10. Reference seed: categories
-- -----------------------------------------------------------------------------

INSERT INTO categories (category_code, parent_code, name_zh, name_en, kind, default_necessity, is_system) VALUES
('SALARY_BASE','SALARY','基本工资',NULL,'INCOME',NULL,TRUE),
('SALARY_PERFORMANCE','SALARY','绩效奖金',NULL,'INCOME',NULL,TRUE),
('SALARY_ANNUAL_BONUS','SALARY','年终奖金',NULL,'INCOME',NULL,TRUE),
('SALARY_OVERTIME','SALARY','加班工资',NULL,'INCOME',NULL,TRUE),
('SALARY_ALLOWANCE','SALARY','津贴补助',NULL,'INCOME',NULL,TRUE),
('TRAVEL_ALLOWANCE','SALARY','出差补助',NULL,'INCOME',NULL,TRUE),
('MEAL_ALLOWANCE','SALARY','餐饮补助',NULL,'INCOME',NULL,TRUE),
('TRANSPORT_ALLOWANCE','SALARY','交通补助',NULL,'INCOME',NULL,TRUE),
('PART_TIME_INCOME','LABOR','兼职收入',NULL,'INCOME',NULL,TRUE),
('CONSULTING_INCOME','LABOR','咨询收入',NULL,'INCOME',NULL,TRUE),
('FREELANCE_INCOME','LABOR','自由职业收入',NULL,'INCOME',NULL,TRUE),
('BUSINESS_INCOME','BUSINESS','个体经营收入',NULL,'INCOME',NULL,TRUE),
('INTEREST_INCOME','INVESTMENT','存款利息',NULL,'INCOME',NULL,TRUE),
('DIVIDEND_INCOME','INVESTMENT','股息红利',NULL,'INCOME',NULL,TRUE),
('COUPON_INCOME','INVESTMENT','债券票息',NULL,'INCOME',NULL,TRUE),
('REALIZED_INVESTMENT_GAIN','INVESTMENT','已实现投资收益',NULL,'INCOME',NULL,TRUE),
('RENTAL_INCOME','INVESTMENT','租金收入',NULL,'INCOME',NULL,TRUE),
('GIFT_INCOME','OTHER','礼金赠与',NULL,'INCOME',NULL,TRUE),
('REWARD_INCOME','OTHER','奖励收入',NULL,'INCOME',NULL,TRUE),
('OTHER_RECURRING_INCOME','OTHER','其他经常性收入',NULL,'INCOME',NULL,TRUE),
('OTHER_ONE_OFF_INCOME','OTHER','其他一次性收入',NULL,'INCOME',NULL,TRUE),
('REIMBURSEMENT','OTHER','报销（结算款）',NULL,'INCOME',NULL,TRUE),
('REFUND','OTHER','退款（冲减支出）',NULL,'INCOME',NULL,TRUE),
('FOOD_BREAKFAST','FOOD','早餐',NULL,'EXPENSE','ESSENTIAL',TRUE),
('FOOD_LUNCH','FOOD','午餐',NULL,'EXPENSE','ESSENTIAL',TRUE),
('FOOD_DINNER','FOOD','晚餐',NULL,'EXPENSE','ESSENTIAL',TRUE),
('FOOD_DELIVERY','FOOD','外卖',NULL,'EXPENSE','ESSENTIAL',TRUE),
('FOOD_SNACKS','FOOD','零食饮料',NULL,'EXPENSE','OPTIONAL',TRUE),
('FOOD_BEVERAGES','FOOD','咖啡茶饮',NULL,'EXPENSE','OPTIONAL',TRUE),
('FOOD_GROCERIES','FOOD','食材采购',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HOUSING_RENT','HOUSING','房租',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HOUSING_WATER','HOUSING','水费',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HOUSING_ELECTRICITY','HOUSING','电费',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HOUSING_GAS','HOUSING','燃气费',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HOUSING_PROPERTY_FEE','HOUSING','物业费',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HOUSING_FURNITURE','HOUSING','家具家电',NULL,'EXPENSE','OPTIONAL',TRUE),
('HOUSING_MAINTENANCE','HOUSING','维修维护',NULL,'EXPENSE','ESSENTIAL',TRUE),
('TRANSPORT_BUS','TRANSPORT','公交',NULL,'EXPENSE','ESSENTIAL',TRUE),
('TRANSPORT_METRO','TRANSPORT','地铁',NULL,'EXPENSE','ESSENTIAL',TRUE),
('TRANSPORT_TAXI','TRANSPORT','出租车',NULL,'EXPENSE','OPTIONAL',TRUE),
('TRANSPORT_RIDE_HAILING','TRANSPORT','网约车',NULL,'EXPENSE','OPTIONAL',TRUE),
('TRANSPORT_RAIL','TRANSPORT','铁路',NULL,'EXPENSE','OPTIONAL',TRUE),
('TRANSPORT_FLIGHT','TRANSPORT','飞机',NULL,'EXPENSE','OPTIONAL',TRUE),
('TRANSPORT_CAR','TRANSPORT','自驾交通',NULL,'EXPENSE','ESSENTIAL',TRUE),
('TRANSPORT_PARKING_TOLL','TRANSPORT','停车及通行费',NULL,'EXPENSE','OPTIONAL',TRUE),
('PET_FOOD','PET','狗粮',NULL,'EXPENSE','ESSENTIAL',TRUE),
('PET_TREATS','PET','宠物零食',NULL,'EXPENSE','OPTIONAL',TRUE),
('PET_SUPPLIES','PET','玩具用品',NULL,'EXPENSE','OPTIONAL',TRUE),
('PET_GROOMING','PET','洗护美容',NULL,'EXPENSE','OPTIONAL',TRUE),
('PET_VACCINATION','PET','疫苗',NULL,'EXPENSE','ESSENTIAL',TRUE),
('PET_PARASITE_PREVENTION','PET','驱虫',NULL,'EXPENSE','ESSENTIAL',TRUE),
('PET_MEDICAL','PET','宠物医疗',NULL,'EXPENSE','ESSENTIAL',TRUE),
('PET_BOARDING','PET','寄养',NULL,'EXPENSE','OPTIONAL',TRUE),
('HEALTH_FITNESS','HEALTH','健身',NULL,'EXPENSE','OPTIONAL',TRUE),
('HEALTH_OUTPATIENT','HEALTH','医院门诊',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HEALTH_HOSPITALIZATION','HEALTH','住院',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HEALTH_MEDICATION','HEALTH','药品',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HEALTH_CHECKUP','HEALTH','体检',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HEALTH_DENTAL','HEALTH','牙科',NULL,'EXPENSE','ESSENTIAL',TRUE),
('HEALTH_VISION','HEALTH','眼科',NULL,'EXPENSE','ESSENTIAL',TRUE),
('SHOPPING_CLOTHING','SHOPPING','服装',NULL,'EXPENSE','OPTIONAL',TRUE),
('SHOPPING_ACCESSORIES','SHOPPING','鞋包',NULL,'EXPENSE','OPTIONAL',TRUE),
('SHOPPING_ELECTRONICS','SHOPPING','数码设备',NULL,'EXPENSE','OPTIONAL',TRUE),
('SHOPPING_DAILY_SUPPLIES','SHOPPING','日用品',NULL,'EXPENSE','ESSENTIAL',TRUE),
('SHOPPING_PERSONAL_CARE','SHOPPING','美容护理',NULL,'EXPENSE','OPTIONAL',TRUE),
('SOCIAL_DINING','SOCIAL','聚餐',NULL,'EXPENSE','OPTIONAL',TRUE),
('SOCIAL_GIFTS','SOCIAL','礼物',NULL,'EXPENSE','OPTIONAL',TRUE),
('SOCIAL_OBLIGATIONS','SOCIAL','人情往来',NULL,'EXPENSE','OPTIONAL',TRUE),
('ENTERTAINMENT_MOVIES','ENTERTAINMENT','电影',NULL,'EXPENSE','OPTIONAL',TRUE),
('ENTERTAINMENT_GAMES','ENTERTAINMENT','游戏',NULL,'EXPENSE','OPTIONAL',TRUE),
('ENTERTAINMENT_EVENTS','ENTERTAINMENT','演出',NULL,'EXPENSE','OPTIONAL',TRUE),
('ENTERTAINMENT_TRAVEL','ENTERTAINMENT','旅游',NULL,'EXPENSE','OPTIONAL',TRUE),
('ENTERTAINMENT_HOBBIES','ENTERTAINMENT','兴趣爱好',NULL,'EXPENSE','OPTIONAL',TRUE),
('EDUCATION_BOOKS','EDUCATION','图书',NULL,'EXPENSE','OPTIONAL',TRUE),
('EDUCATION_COURSES','EDUCATION','课程',NULL,'EXPENSE','OPTIONAL',TRUE),
('EDUCATION_CERTIFICATIONS','EDUCATION','考试认证',NULL,'EXPENSE','OPTIONAL',TRUE),
('DIGITAL_AI_SUBSCRIPTION','DIGITAL','AI服务订阅',NULL,'EXPENSE','OPTIONAL',TRUE),
('DIGITAL_CLOUD_SERVICE','DIGITAL','云计算服务',NULL,'EXPENSE','OPTIONAL',TRUE),
('DIGITAL_SAAS','DIGITAL','SaaS订阅',NULL,'EXPENSE','OPTIONAL',TRUE),
('DIGITAL_STREAMING','DIGITAL','视频会员',NULL,'EXPENSE','OPTIONAL',TRUE),
('DIGITAL_SOFTWARE','DIGITAL','软件购买',NULL,'EXPENSE','OPTIONAL',TRUE),
('COMMUNICATION_MOBILE','COMMUNICATION','手机话费',NULL,'EXPENSE','ESSENTIAL',TRUE),
('COMMUNICATION_INTERNET','COMMUNICATION','宽带网络',NULL,'EXPENSE','ESSENTIAL',TRUE),
('INSURANCE_MEDICAL','INSURANCE','医疗保险保费',NULL,'EXPENSE','ESSENTIAL',TRUE),
('INSURANCE_ACCIDENT','INSURANCE','意外保险保费',NULL,'EXPENSE','OPTIONAL',TRUE),
('INSURANCE_LIFE','INSURANCE','寿险保费',NULL,'EXPENSE','OPTIONAL',TRUE),
('TAX_PERSONAL_INCOME','TAX','个人所得税',NULL,'EXPENSE','ESSENTIAL',TRUE),
('TAX_OTHER','TAX','其他税费',NULL,'EXPENSE','OPTIONAL',TRUE),
('FINANCE_CARD_INTEREST','FINANCE','信用卡利息',NULL,'EXPENSE','ESSENTIAL',TRUE),
('FINANCE_INSTALLMENT_FEE','FINANCE','分期费用',NULL,'EXPENSE','OPTIONAL',TRUE),
('FINANCE_BANK_FEE','FINANCE','银行手续费',NULL,'EXPENSE','OPTIONAL',TRUE),
('FINANCE_LOAN_INTEREST','FINANCE','借款利息',NULL,'EXPENSE','ESSENTIAL',TRUE),
('FINANCE_PENALTY','FINANCE','违约费用',NULL,'EXPENSE','OPTIONAL',TRUE),
('OTHER_DONATION','OTHER','慈善捐赠',NULL,'EXPENSE','OPTIONAL',TRUE),
('OTHER_UNCLASSIFIED','OTHER','不可分类支出',NULL,'EXPENSE',NULL,TRUE);


-- -----------------------------------------------------------------------------
-- 11. Reference seed: core metric definitions
-- -----------------------------------------------------------------------------

INSERT INTO metric_definitions (metric_id, metric_version, name, unit, formula, inclusion_rules, exclusion_rules, null_handling, aggregation, effective_from, effective_to) VALUES
('total_assets','1.0','总资产','CNY','Σ 资产账户余额 + Σ positions 市值 + Σ 非账户资产最新估值（valuation_date ≤ as_of）','["include_in_net_worth=true", "normal_side=ASSET", "valuation_date ≤ as_of"]'::jsonb,'["normal_side=LIABILITY", "无估值日期的非账户资产"]'::jsonb,'余额为 null 的账户标记 partial；无估值资产排除并给 missing_count','SUM','2026-01-01'::date,NULL),
('total_liabilities','1.0','总负债','CNY','Σ 负债账户余额（normal_side=LIABILITY，含分期子账户）','["normal_side=LIABILITY"]'::jsonb,'["资产账户"]'::jsonb,'余额 null 标记 partial','SUM','2026-01-01'::date,NULL),
('net_worth','1.0','净资产','CNY','total_assets − total_liabilities','[]'::jsonb,'["—"]'::jsonb,'任一侧 partial 则整体 partial','DELTA','2026-01-01'::date,NULL),
('cash_reserve','1.0','可用现金储备','CNY','Σ 现金/活期/储蓄/钱包账户（排除定存、受限、信用卡）','["subtype ∈ CASH_WALLET/BANK_CHECKING/BANK_SAVINGS/ALIPAY_BALANCE/WECHAT_BALANCE/DIGITAL_WALLET"]'::jsonb,'["BANK_FIXED_DEPOSIT", "is_restricted=true", "信用卡"]'::jsonb,'余额 null 跳过并标记 partial','SUM','2026-01-01'::date,NULL),
('liquid_assets','1.0','流动资产','CNY','Σ 非受限、liquidity ∈ INSTANT/HIGH 的资产账户','["normal_side=ASSET", "liquidity_level ∈ INSTANT/HIGH"]'::jsonb,'["is_restricted=true"]'::jsonb,'—','SUM','2026-01-01'::date,NULL),
('monthly_total_income','1.0','月收入','CNY','Σ entry_role=PRIMARY 且 ledger_class=INCOME 的 flow_effect.is_income 分录','["PRIMARY", "INCOME", "ACTUAL/ESTIMATE 按查询"]'::jsonb,'["FUNDING", "报销/退款/转账/借款"]'::jsonb,'无收入 → 0；null 标记 partial','SUM','2026-01-01'::date,NULL),
('monthly_total_expense','1.0','月经济支出','CNY','Σ PRIMARY EXPENSE 的 economic_expense_sign × amount（含必要/非必要/财务成本，减退款）','["PRIMARY", "EXPENSE", "ACTUAL/ESTIMATE 按查询"]'::jsonb,'["FUNDING", "转账/定存/投资买入/本金偿还/报销"]'::jsonb,'null 标记 partial','SUM','2026-01-01'::date,NULL),
('essential_expense','1.0','必要支出','CNY','Σ expense_bucket=ESSENTIAL 的 PRIMARY EXPENSE','["expense_bucket=ESSENTIAL"]'::jsonb,'["DISCRETIONARY", "FINANCIAL_COST", "REFUND_REVERSAL"]'::jsonb,'—','SUM','2026-01-01'::date,NULL),
('discretionary_expense','1.0','非必要支出','CNY','Σ expense_bucket=DISCRETIONARY 的 PRIMARY EXPENSE','["expense_bucket=DISCRETIONARY"]'::jsonb,'["ESSENTIAL", "FINANCIAL_COST", "REFUND_REVERSAL"]'::jsonb,'—','SUM','2026-01-01'::date,NULL),
('financial_cost','1.0','财务成本','CNY','Σ expense_bucket=FINANCIAL_COST 的 PRIMARY EXPENSE（债务利息/费用）','["expense_bucket=FINANCIAL_COST"]'::jsonb,'["ESSENTIAL", "DISCRETIONARY", "REFUND_REVERSAL"]'::jsonb,'—','SUM','2026-01-01'::date,NULL),
('refund_reversal','1.0','退款冲减','CNY','Σ expense_bucket=REFUND_REVERSAL 的 PRIMARY EXPENSE（正数表示冲减额）','["expense_bucket=REFUND_REVERSAL"]'::jsonb,'["ESSENTIAL", "DISCRETIONARY", "FINANCIAL_COST"]'::jsonb,'—','SUM','2026-01-01'::date,NULL),
('debt_service_to_income','1.0','偿债收入比','RATIO','(本金偿还 PRIMARY LIABILITY + 利息 PRIMARY EXPENSE + 费用 PRIMARY EXPENSE) / 月收入','["entry_role=PRIMARY", "DEBT_PRINCIPAL_REPAY/DEBT_INTEREST/DEBT_FEE"]'::jsonb,'["FUNDING", "信用卡消费", "转账"]'::jsonb,'收入 0 → N/A','RATIO','2026-01-01'::date,NULL),
('savings_rate','1.0','储蓄率(口径A)','RATIO','(月收入 − 月经济支出) / 月收入；不含债务本金','["INCOME PRIMARY", "EXPENSE PRIMARY"]'::jsonb,'["FUNDING", "本金偿还", "转账/定存/投资买入/结算"]'::jsonb,'收入 0 → N/A','RATIO','2026-01-01'::date,NULL),
('savings_rate_incl_debt_principal','1.0','含偿债储蓄率(口径C)','RATIO','(口径A分子 + 本金偿还) / 月收入','["口径A + DEBT_PRINCIPAL_REPAY PRIMARY"]'::jsonb,'["FUNDING 资金腿"]'::jsonb,'收入 0 → N/A','RATIO','2026-01-01'::date,NULL),
('net_worth_change','1.0','净资产变化','CNY','期末净资产 − 期初净资产；Phase 1 可由收入−经济支出+估值变动重算','["ledger-derived"]'::jsonb,'["快照独立种子"]'::jsonb,'快照不足 → N/A','DELTA','2026-01-01'::date,NULL);


-- -----------------------------------------------------------------------------
-- 12. Functions, triggers and read-only balance views
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_ledger_books_updated_at
    BEFORE UPDATE ON ledger_books
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_instruments_updated_at
    BEFORE UPDATE ON instruments
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_positions_updated_at
    BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_assets_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Entry role / expense bucket guard.
CREATE OR REPLACE FUNCTION fn_guard_entry_semantics()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_class TEXT;
BEGIN
    SELECT class INTO v_class
      FROM ledger_accounts
     WHERE ledger_account_id = NEW.ledger_account_id;

    IF v_class IS NULL THEN
        RAISE EXCEPTION 'ledger account % not found', NEW.ledger_account_id;
    END IF;

    IF NEW.entry_role = 'FUNDING' AND v_class <> 'ASSET' THEN
        RAISE EXCEPTION 'FUNDING entry must use an ASSET ledger account (got %)', v_class;
    END IF;

    IF NEW.entry_role = 'MEMO' AND v_class <> 'EQUITY' THEN
        RAISE EXCEPTION 'MEMO entry must use an EQUITY ledger account (got %)', v_class;
    END IF;

    IF v_class = 'EXPENSE' AND NEW.entry_role = 'PRIMARY'
       AND NEW.flow_effect IN ('CONSUMPTION','CONSUMPTION_PF_RENT','DEBT_INTEREST','DEBT_FEE','REFUND_REVERSAL')
       AND NEW.expense_bucket IS NULL THEN
        RAISE EXCEPTION 'PRIMARY expense entry % must have expense_bucket', NEW.entry_id;
    END IF;

    IF NEW.expense_bucket IS NOT NULL
       AND NOT (v_class = 'EXPENSE' AND NEW.entry_role = 'PRIMARY') THEN
        RAISE EXCEPTION 'expense_bucket is only allowed on PRIMARY EXPENSE entries';
    END IF;

    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_entries_guard_semantics
    BEFORE INSERT OR UPDATE ON transaction_entries
    FOR EACH ROW EXECUTE FUNCTION fn_guard_entry_semantics();

-- Deferred balance assertion: transaction side.
CREATE OR REPLACE FUNCTION fn_assert_txn_balanced_txn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_debit BIGINT;
    v_credit BIGINT;
    v_count INTEGER;
    v_amount BIGINT;
BEGIN
    IF NEW.status NOT IN ('POSTED','RECONCILED') THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_cents ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END),0),
           COUNT(*),
           COALESCE(MAX(amount_cents),0)
      INTO v_debit, v_credit, v_count, v_amount
      FROM transaction_entries
     WHERE transaction_id = NEW.transaction_id;

    -- amount is read from the transaction row; MAX(entry amount) is only a fallback
    SELECT amount_cents INTO v_amount FROM transactions WHERE transaction_id = NEW.transaction_id;

    IF v_count < 2 OR v_debit <> v_credit OR v_debit <> v_amount THEN
        RAISE EXCEPTION
            'transaction % unbalanced: debit=%, credit=%, amount=%, entries=%',
            NEW.transaction_id, v_debit, v_credit, v_amount, v_count;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_txn_balanced_on_txn
    AFTER INSERT OR UPDATE OF amount_cents, status ON transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_assert_txn_balanced_txn();

-- Deferred balance assertion: entry side.
CREATE OR REPLACE FUNCTION fn_assert_txn_balanced_entry()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
    v_debit BIGINT;
    v_credit BIGINT;
    v_count INTEGER;
    v_amount BIGINT;
BEGIN
    SELECT status, amount_cents INTO v_status, v_amount
      FROM transactions
     WHERE transaction_id = NEW.transaction_id;

    IF v_status IS NULL OR v_status NOT IN ('POSTED','RECONCILED') THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_cents ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END),0),
           COUNT(*)
      INTO v_debit, v_credit, v_count
      FROM transaction_entries
     WHERE transaction_id = NEW.transaction_id;

    IF v_count < 2 OR v_debit <> v_credit OR v_debit <> v_amount THEN
        RAISE EXCEPTION
            'transaction % unbalanced: debit=%, credit=%, amount=%, entries=%',
            NEW.transaction_id, v_debit, v_credit, v_amount, v_count;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_txn_balanced_on_entry
    AFTER INSERT OR UPDATE OF amount_cents, direction, transaction_id ON transaction_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_assert_txn_balanced_entry();

-- Immutable entries after posting.
CREATE OR REPLACE FUNCTION fn_entries_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN
        SELECT status INTO v_status
          FROM transactions
         WHERE transaction_id = OLD.transaction_id;
        IF v_status IN ('POSTED','RECONCILED') THEN
            RAISE EXCEPTION 'entries of posted transaction % are immutable', OLD.transaction_id;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_entries_immutable
    BEFORE UPDATE OR DELETE ON transaction_entries
    FOR EACH ROW EXECUTE FUNCTION fn_entries_immutable();

-- Immutable audit log.
CREATE OR REPLACE FUNCTION fn_audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;
CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_audit_immutable();

-- Closed-period guard.
CREATE OR REPLACE FUNCTION fn_guard_period_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM period_locks
         WHERE book_id = NEW.book_id
           AND status = 'CLOSED'
           AND period_start = date_trunc('month', NEW.posting_date)::date
    ) THEN
        RAISE EXCEPTION 'period % is closed for book %',
            date_trunc('month', NEW.posting_date)::date, NEW.book_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_transactions_period_lock
    BEFORE INSERT OR UPDATE OF posting_date, book_id ON transactions
    FOR EACH ROW EXECUTE FUNCTION fn_guard_period_lock();

-- Computed trial totals per account (posted/reconciled only; reversals are
-- separate posted transactions and therefore net out naturally).
CREATE OR REPLACE VIEW v_account_ledger_totals AS
SELECT
    la.account_id,
    la.book_id,
    COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_cents ELSE 0 END), 0) AS debit_total_cents,
    COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_cents ELSE 0 END), 0) AS credit_total_cents
FROM ledger_accounts la
LEFT JOIN (
    SELECT e.ledger_account_id, e.direction, e.amount_cents
      FROM transaction_entries e
      JOIN transactions t ON t.transaction_id = e.transaction_id
     WHERE t.status IN ('POSTED','RECONCILED')
) e ON e.ledger_account_id = la.ledger_account_id
WHERE la.account_id IS NOT NULL
GROUP BY la.account_id, la.book_id;

CREATE OR REPLACE VIEW v_account_balances_computed AS
SELECT
    a.account_id,
    a.book_id,
    a.normal_side,
    COALESCE(t.debit_total_cents, 0) AS debit_total_cents,
    COALESCE(t.credit_total_cents, 0) AS credit_total_cents,
    CASE
        WHEN a.normal_side = 'ASSET'
            THEN COALESCE(t.debit_total_cents, 0) - COALESCE(t.credit_total_cents, 0)
        ELSE
            COALESCE(t.credit_total_cents, 0) - COALESCE(t.debit_total_cents, 0)
    END AS balance_cents
FROM accounts a
LEFT JOIN v_account_ledger_totals t ON t.account_id = a.account_id;

CREATE OR REPLACE VIEW v_unbalanced_transactions AS
SELECT
    t.transaction_id,
    t.book_id,
    t.amount_cents,
    COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0) AS debit_total_cents,
    COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END),0) AS credit_total_cents,
    COUNT(e.entry_id) AS entry_count
FROM transactions t
LEFT JOIN transaction_entries e ON e.transaction_id = t.transaction_id
WHERE t.status IN ('POSTED','RECONCILED')
GROUP BY t.transaction_id, t.book_id, t.amount_cents
HAVING COUNT(e.entry_id) < 2
    OR COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0)
       <> COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END),0)
    OR COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0)
       <> t.amount_cents;

-- Recompute an account balance as of a business date.
CREATE OR REPLACE FUNCTION fn_account_balance(p_account_id UUID, p_as_of DATE)
RETURNS TABLE (
    account_id UUID,
    debit_total_cents BIGINT,
    credit_total_cents BIGINT,
    balance_cents BIGINT
) LANGUAGE SQL STABLE AS $$
    SELECT
        a.account_id,
        COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0)::BIGINT,
        COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END),0)::BIGINT,
        CASE a.normal_side
            WHEN 'ASSET' THEN
                COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0)
                - COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END),0)
            ELSE
                COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END),0)
                - COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0)
        END::BIGINT
    FROM accounts a
    LEFT JOIN ledger_accounts la ON la.account_id = a.account_id
    LEFT JOIN (
        SELECT e.ledger_account_id, e.direction, e.amount_cents
          FROM transaction_entries e
          JOIN transactions t ON t.transaction_id = e.transaction_id
         WHERE t.status IN ('POSTED','RECONCILED')
           AND t.posting_date <= p_as_of
    ) e ON e.ledger_account_id = la.ledger_account_id
    WHERE a.account_id = p_account_id
    GROUP BY a.account_id, a.normal_side;
$$;
