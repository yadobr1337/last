import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runLifecycleSweep } from "@/lib/billing";
import { runProvisioningSweep } from "@/lib/provisioning";
import { timingSafeEqual } from "@/lib/yookassa";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!env.CRON_SECRET || !authorization ||
      !timingSafeEqual(authorization, `Bearer ${env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provisioning = await runProvisioningSweep();
  await runLifecycleSweep();
  return NextResponse.json({
    ok: provisioning.ok,
    provisioning,
    processedAt: new Date().toISOString(),
  });
}
