import { defineConfig } from "drizzle-kit";

// Yalnızca `pnpm db:generate` (şemadan SQL migration üretme) için kullanılır;
// bu işlem veritabanına bağlanmaz.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
