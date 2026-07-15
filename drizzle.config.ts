import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/engine/database/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/appilot.db",
  },
});
