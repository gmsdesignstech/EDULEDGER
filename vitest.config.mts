import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never let integration tests write generated schools/users into the local
    // development database displayed by the super-admin dashboard.
    env: {
      SQLITE_DATABASE_PATH: "data/eduledger.test.db",
    },
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/server-only.ts", import.meta.url),
      ),
    },
  },
});
