import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const configs = pgTable("configs", {
  key: text("config_key").primaryKey(),
  value: text("config_value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
