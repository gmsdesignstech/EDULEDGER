import { rmSync } from "node:fs";
import { resolve } from "node:path";

export default function setup() {
  const databasePath = resolve("data", "eduledger.test.db");

  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}
