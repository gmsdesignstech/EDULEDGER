import { NextResponse } from "next/server";
import { databaseHealth } from "@/lib/db";
import { logServerError } from "@/lib/server-errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    await databaseHealth();
    return NextResponse.json({
      status: "ok",
      service: "eduledger",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logServerError("health.database", error);
    return NextResponse.json(
      {
        status: "unavailable",
        service: "eduledger",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
