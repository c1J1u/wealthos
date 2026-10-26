// Read-only fixture adapter. Run through the backend's existing tsx runtime;
// this never invokes its importer, opens a database, or mutates source files.
import fs from "node:fs";
import { normalizeFixture } from "../../backend/src/scripts/normalize-fixture.ts";
import { buildEntries } from "../../backend/src/modules/ledger/entry-templates.ts";
import { fixtureId } from "../../backend/src/scripts/fixture-ids.ts";

const persona = process.argv[2] ?? "chen";
if (!["chen", "me"].includes(persona)) throw new Error("Unknown mock persona");
const fixture = normalizeFixture(JSON.parse(fs.readFileSync(`backend/fixtures/${persona}.json`, "utf8")));
const entries = Object.fromEntries(fixture.transactions.map((transaction) => [
  transaction.transaction_id,
  buildEntries(transaction).map((entry) => ({
    ...entry,
    entry_id: fixtureId(persona, "entry", `${transaction.transaction_id}:${entry.line_no}`),
    ledger_account_id: fixtureId(persona, "ledger_account", entry.ledgerAccountKey),
    amount_cents: Number(entry.amount_cents),
  })),
]));
process.stdout.write(JSON.stringify({ fixture, entries, bookId: fixtureId(persona, "book", persona) }));
