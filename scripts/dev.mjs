import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { PostgresInstance } from "pg-embedded";

const hasExternalDatabase = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL,
);
let database;

if (!hasExternalDatabase) {
  try {
    database = new PostgresInstance({
      port: 54329,
      username: "postgres",
      password: "eduledger-local",
      databaseName: "postgres",
      dataDir: path.resolve("data/postgres"),
      persistent: true,
      setupTimeout: 300,
    });
    await database.start();
    if (!(await database.databaseExists("eduledger"))) {
      await database.createDatabase("eduledger");
    }
    process.env.DATABASE_URL =
      "postgresql://postgres:eduledger-local@127.0.0.1:54329/eduledger";
    console.log("Local PostgreSQL is ready on port 54329.");
  } catch (error) {
    database = undefined;
    console.warn(
      "Embedded PostgreSQL could not start; using the local SQLite database.",
    );
  }
}

const next = spawn(
  process.execPath,
  [path.resolve("node_modules/next/dist/bin/next"), "dev"],
  {
  env: process.env,
  stdio: "inherit",
  },
);

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (next.exitCode === null) next.kill("SIGINT");
  if (database?.state === "Running") {
    try {
      await database.stop();
    } catch (error) {
      console.error("Could not stop local PostgreSQL cleanly:", error);
    }
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
next.on("exit", (code) => void stop(code ?? 0));
next.on("error", (error) => {
  console.error("Could not start Next.js:", error);
  void stop(1);
});
