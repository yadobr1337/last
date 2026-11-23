import { Prisma, type Squad } from "@prisma/client";
import { db, writeTransaction } from "@/lib/db";
import { DEFAULT_SQUAD_MEMBER_LIMIT } from "@/lib/site";
import { slugify } from "@/lib/utils";

export async function findAvailableSquad(tx: Prisma.TransactionClient = db) {
  const squads = await tx.squad.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: { users: true },
      },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  const available = squads
    .filter((squad) => squad._count.users < squad.memberLimit)
    .sort((left, right) => {
      const leftFill = left._count.users / left.memberLimit;
      const rightFill = right._count.users / right.memberLimit;
      return rightFill - leftFill;
    });

  return available[0] ?? null;
}

export async function ensureUserSquad(userId: string, tx: Prisma.TransactionClient = db) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { squad: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  if (user.squadId) {
    return user.squad;
  }

  const squad = await findAvailableSquad(tx);
  let assignedSquad: Squad | null = squad;

  if (!assignedSquad) {
    const { createProvisioningSquadForCapacity } = await import("@/lib/provisioning-capacity");
    assignedSquad = await createProvisioningSquadForCapacity(tx, { requireProduction: true });
  }

  assignedSquad ??= await createAutoSquad(tx);

  await tx.user.update({
    where: { id: userId },
    data: { squadId: assignedSquad.id },
  });

  return assignedSquad;
}

function buildSquadName(uuid: string, name?: string) {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return trimmedName;
  }

  return `Squad ${uuid.slice(0, 8)}`;
}

export async function createSquad(input: {
  name?: string;
  memberLimit: number;
  remnawaveInternalSquadUuid: string;
  actor: string;
}) {
  const name = buildSquadName(input.remnawaveInternalSquadUuid, input.name);
  return writeTransaction(async (tx) => {
    const squad = await tx.squad.create({
      data: {
        name,
        slug: slugify(`${name}-${input.remnawaveInternalSquadUuid.slice(0, 8)}`),
        memberLimit: input.memberLimit,
        position: (await tx.squad.count()) + 1,
        remnawaveInternalSquadUuid: input.remnawaveInternalSquadUuid,
      },
    });
    await tx.adminAuditEvent.create({ data: { actor: input.actor, action: "CREATE_SQUAD", target: squad.id } });
    return squad;
  });
}

async function createAutoSquad(tx: Prisma.TransactionClient = db) {
  const position = (await tx.squad.count()) + 1;
  const name = `Auto Squad ${position}`;

  return tx.squad.create({
    data: {
      name,
      slug: slugify(`${name}-${Date.now().toString(36)}`),
      memberLimit: DEFAULT_SQUAD_MEMBER_LIMIT,
      position,
      isActive: true,
    },
  });
}

export async function updateSquad(input: {
  squadId: string;
  name?: string;
  memberLimit: number;
  isActive: boolean;
  remnawaveInternalSquadUuid: string;
  actor: string;
}) {
  const name = buildSquadName(input.remnawaveInternalSquadUuid, input.name);
  return writeTransaction(async (tx) => {
    const squad = await tx.squad.update({
      where: { id: input.squadId },
      data: {
        name,
        slug: slugify(`${name}-${input.remnawaveInternalSquadUuid.slice(0, 8)}`),
        memberLimit: input.memberLimit,
        isActive: input.isActive,
        remnawaveInternalSquadUuid: input.remnawaveInternalSquadUuid,
      },
    });
    await tx.user.updateMany({
      where: { squadId: squad.id, balanceKopeks: { gt: 0 } },
      data: { vpnSyncAt: new Date(), vpnSyncRevision: { increment: 1 } },
    });
    await tx.adminAuditEvent.create({ data: { actor: input.actor, action: "UPDATE_SQUAD", target: squad.id } });
    return squad;
  });
}

export async function deleteSquad(squadId: string, actor: string) {
  await writeTransaction(async (tx) => {
    await tx.user.updateMany({
      where: { squadId },
      data: { squadId: null, vpnSyncAt: new Date(), vpnSyncRevision: { increment: 1 } },
    });
    await tx.provisioningJob.updateMany({ where: { squadId }, data: { squadId: null } });
    await tx.squad.delete({ where: { id: squadId } });
    await tx.adminAuditEvent.create({ data: { actor, action: "DELETE_SQUAD", target: squadId } });
  });
}

export type SquadWithUsage = Squad & {
  _count: {
    users: number;
  };
};
