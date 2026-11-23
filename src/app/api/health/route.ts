import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.systemSettings.findFirst({ select: { id: true } });
    await db.workLease.findFirst({ select: { key: true } });
    return Response.json(
      {
        ok: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { ok: false },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
