import { getDb } from "./server/db";
import { sql } from "drizzle-orm";

async function run() {
  const db = await getDb();
  if (!db) {
    console.error("No DB connection");
    process.exit(1);
  }
  
  try {
    await db.execute(sql`ALTER TABLE accounts ADD COLUMN seofastCookies text;`);
    await db.execute(sql`ALTER TABLE accounts ADD COLUMN seofastDeviceId varchar(255);`);
    await db.execute(sql`ALTER TABLE accounts ADD COLUMN seofastProfile text;`);
    await db.execute(sql`ALTER TABLE accounts ADD COLUMN seofastHashAjax varchar(255);`);
    console.log("Migration successful!");
  } catch (e) {
    console.error("Migration error:", e);
  }
  process.exit(0);
}

run();
