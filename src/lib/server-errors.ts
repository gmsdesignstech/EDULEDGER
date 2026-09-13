import "server-only";

type DatabaseError = Error & {
  code?: string;
  constraint_name?: string;
  constraint?: string;
};

export function isUniqueConstraintError(error: unknown, constraint?: string) {
  const databaseError = error as DatabaseError;
  const isUnique =
    databaseError?.code === "23505" ||
    databaseError?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    databaseError?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    (databaseError?.code === "ERR_SQLITE_ERROR" &&
      databaseError.message.startsWith("UNIQUE constraint failed:"));

  if (!isUnique || !constraint) return isUnique;
  return [databaseError.constraint_name, databaseError.constraint].some((value) =>
    value?.includes(constraint),
  );
}

export function logServerError(operation: string, error: unknown) {
  const databaseError = error as DatabaseError;

  // Deliberately omit messages, queries, parameters and connection strings.
  console.error("Server operation failed", {
    operation,
    errorType: error instanceof Error ? error.name : typeof error,
    errorCode:
      typeof databaseError?.code === "string" ? databaseError.code : undefined,
  });
}
