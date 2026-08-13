import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

await migrate(db, { migrationsFolder: "drizzle" });
await pool.end();
console.log("database migrations complete");
