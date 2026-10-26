/** Administrator-only fixture lifecycle; never used by the request path. */
import type { PoolClient } from "pg";

export async function setForceRls(client: PoolClient, force: boolean): Promise<void> {
  if (!force) {
    const owner = await client.query<{ is_super: boolean; bypass: boolean }>(
      "SELECT rolsuper AS is_super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user",
    );
    if (!owner.rows[0]?.is_super && !owner.rows[0]?.bypass) {
      throw new Error("Fixture rebuild requires a local database administrator with RLS bypass; the application role is intentionally insufficient.");
    }
  }
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'book_id'
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
      ORDER BY table_name`,
  );
  for (const { table_name } of tables.rows) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table_name)) throw new Error("Unexpected fixture table name");
    await client.query(`ALTER TABLE "${table_name}" ${force ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`);
  }
}
