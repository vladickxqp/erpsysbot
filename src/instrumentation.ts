/** Runs once when the server starts: the database is brought up to date first. */
export async function register() {
  // Written exactly like this so the edge build drops the import entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { migrateDatabase } = await import("./db/migrate");
    await migrateDatabase();
  }
}
