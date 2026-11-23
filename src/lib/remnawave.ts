import {
  CreateConfigProfileCommand,
  CreateHostCommand,
  CreateInternalSquadCommand,
  CreateNodeCommand,
  CreateUserCommand,
  DeleteUserCommand,
  DeleteUserHwidDeviceCommand,
  DisableUserCommand,
  EnableUserCommand,
  GetInternalSquadByUuidCommand,
  GetInternalSquadsCommand,
  GetRemnawaveHealthCommand,
  GetUserHwidDevicesCommand,
  GetUserByUsernameCommand,
  UpdateUserCommand,
} from "@remnawave/backend-contract";
import type { Squad, User } from "@prisma/client";
import { env } from "@/lib/env";

function isConfigured() {
  return Boolean(env.REMNAWAVE_BASE_URL && env.REMNAWAVE_API_TOKEN);
}

export type RemnawaveConnectionStatus = {
  state: "connected" | "error" | "not_configured";
  checkedAt: string;
  baseUrl: string | null;
  latencyMs: number | null;
  instanceCount: number | null;
  uptimeSeconds: number | null;
  message: string;
};

class RemnawaveHttpError extends Error {
  constructor(readonly status: number) {
    super(`Remnawave API HTTP ${status}`);
  }
}

function isMissing(error: unknown) {
  return error instanceof RemnawaveHttpError && error.status === 404;
}

async function remnawaveRequest<T>({
  path,
  method,
  body,
  signal,
}: {
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}) {
  if (!isConfigured()) {
    throw new Error("Remnawave is not configured.");
  }

  const response = await fetch(new URL(path, env.REMNAWAVE_BASE_URL).toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.REMNAWAVE_API_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: signal ?? AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new RemnawaveHttpError(response.status);
  }

  return (await response.json()) as T;
}

function getConnectionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Неизвестная ошибка подключения.";
  }

  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return "Панель не ответила за 8 секунд.";
  }

  const causeMessage =
    error.cause instanceof Error && error.cause.message ? `: ${error.cause.message}` : "";
  return `${error.message}${causeMessage}`.slice(0, 300);
}

export async function checkRemnawaveConnection(): Promise<RemnawaveConnectionStatus> {
  const checkedAt = new Date().toISOString();
  const baseUrl = env.REMNAWAVE_BASE_URL ? new URL(env.REMNAWAVE_BASE_URL).origin : null;

  if (!isConfigured()) {
    return {
      state: "not_configured",
      checkedAt,
      baseUrl,
      latencyMs: null,
      instanceCount: null,
      uptimeSeconds: null,
      message: "Укажите REMNAWAVE_BASE_URL и REMNAWAVE_API_TOKEN в .env.",
    };
  }

  const startedAt = performance.now();

  try {
    const result = await remnawaveRequest<GetRemnawaveHealthCommand.Response>({
      path: GetRemnawaveHealthCommand.url,
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
    const health = GetRemnawaveHealthCommand.ResponseSchema.parse(result).response;

    return {
      state: "connected",
      checkedAt,
      baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      instanceCount: health.runtimeMetrics.length,
      uptimeSeconds: health.runtimeMetrics.length
        ? Math.max(...health.runtimeMetrics.map((metric) => metric.uptime))
        : null,
      message: "Панель Remnawave отвечает, API-токен принят.",
    };
  } catch (error) {
    return {
      state: "error",
      checkedAt,
      baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      instanceCount: null,
      uptimeSeconds: null,
      message: getConnectionErrorMessage(error),
    };
  }
}

export async function getRemoteInternalSquad(squadUuid: string) {
  if (!isConfigured()) {
    return null;
  }

  GetInternalSquadByUuidCommand.RequestSchema.parse({ uuid: squadUuid });
  const result = await remnawaveRequest<GetInternalSquadByUuidCommand.Response>({
    path: GetInternalSquadByUuidCommand.url(squadUuid),
    method: "GET",
  });

  return GetInternalSquadByUuidCommand.ResponseSchema.parse(result).response;
}

function getDefaultInboundUuids() {
  return env.REMNAWAVE_DEFAULT_INBOUND_UUIDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function ensureRemoteSquad(squad: Pick<Squad, "name" | "remnawaveInternalSquadUuid">) {
  if (!isConfigured()) {
    return null;
  }

  if (squad.remnawaveInternalSquadUuid) {
    return squad.remnawaveInternalSquadUuid;
  }

  const inbounds = getDefaultInboundUuids();
  if (!inbounds?.length) {
    return null;
  }
  const result = await remnawaveRequest<GetInternalSquadsCommand.Response>({
    path: GetInternalSquadsCommand.url,
    method: "GET",
  });
  const current = GetInternalSquadsCommand.ResponseSchema.parse(result).response.internalSquads;
  const matching = current.find(({ name }) => name === squad.name);
  if (matching) {
    if (matching.inbounds.length !== inbounds.length ||
        !matching.inbounds.every(({ uuid }) => inbounds.includes(uuid))) {
      throw new Error("Existing Remnawave squad has different inbounds.");
    }
    return matching.uuid;
  }

  const body = {
    name: squad.name,
    inbounds,
  };
  CreateInternalSquadCommand.RequestSchema.parse(body);
  const created = await remnawaveRequest<CreateInternalSquadCommand.Response>({
    path: CreateInternalSquadCommand.url,
    method: "POST",
    body,
  });

  return CreateInternalSquadCommand.ResponseSchema.parse(created).response.uuid;
}

export async function createRemoteInternalSquad(params: {
  name: string;
  inbounds: string[];
}) {
  if (!isConfigured()) {
    throw new Error("Remnawave is not configured.");
  }

  const body = {
    name: params.name,
    inbounds: params.inbounds,
  };
  CreateInternalSquadCommand.RequestSchema.parse(body);
  const result = await remnawaveRequest<CreateInternalSquadCommand.Response>({
    path: CreateInternalSquadCommand.url,
    method: "POST",
    body,
  });

  return CreateInternalSquadCommand.ResponseSchema.parse(result).response;
}

export function buildRemoteUsername(user: Pick<User, "id" | "email">) {
  const local = user.email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) || "user";
  return `${local}-${user.id.slice(-8)}`.slice(0, 36);
}

export async function findRemoteUserByUsername(username: string, email: string, knownUuid?: string | null) {
  if (!isConfigured()) throw new Error("Remnawave is not configured.");
  try {
    const result = await remnawaveRequest<GetUserByUsernameCommand.Response>({
      path: GetUserByUsernameCommand.url(username),
      method: "GET",
    });
    const existing = GetUserByUsernameCommand.ResponseSchema.parse(result).response;
    if (existing.username !== username || (existing.uuid !== knownUuid && existing.email !== email)) {
      throw new Error("Remnawave user ownership could not be confirmed.");
    }
    return existing;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function provisionRemoteUser(params: {
  user: Pick<
    User,
    | "id"
    | "email"
    | "hwidDeviceLimit"
    | "telegramId"
    | "vpnProvisionState"
    | "remnawaveUserUuid"
    | "remnawaveUsername"
    | "remnawaveShortUuid"
    | "subscriptionUrl"
  >;
  squadRemoteUuid?: string | null;
  hwidDeviceLimit?: number | null;
  expireAt: Date;
}) {
  if (!isConfigured()) {
    return null;
  }

  const desired = {
    email: params.user.email,
    telegramId: params.user.telegramId ? Number(params.user.telegramId) : null,
    hwidDeviceLimit: params.hwidDeviceLimit ?? params.user.hwidDeviceLimit ?? undefined,
    activeInternalSquads: params.squadRemoteUuid ? [params.squadRemoteUuid] : undefined,
    expireAt: params.expireAt.toISOString(),
    status: "ACTIVE" as const,
  };

  async function update(uuid: string) {
    const body = { ...desired, uuid };
    UpdateUserCommand.RequestSchema.parse(body);
    const result = await remnawaveRequest<UpdateUserCommand.Response>({
      path: UpdateUserCommand.url,
      method: "PATCH",
      body,
    });
    const user = UpdateUserCommand.ResponseSchema.parse(result).response;
    if (user.uuid !== uuid) throw new Error("Remnawave returned a different user UUID.");
    return user;
  }

  if (params.user.remnawaveUserUuid) {
    try {
      return await update(params.user.remnawaveUserUuid);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const username = params.user.remnawaveUsername ?? buildRemoteUsername(params.user);
  const existing = await findRemoteUserByUsername(username, params.user.email, params.user.remnawaveUserUuid);
  if (existing) return update(existing.uuid);

  const body = { ...desired, username, shortUuid: params.user.remnawaveShortUuid ?? undefined };
  CreateUserCommand.RequestSchema.parse(body);
  const result = await remnawaveRequest<CreateUserCommand.Response>({
    path: CreateUserCommand.url,
    method: "POST",
    body,
  });

  const created = CreateUserCommand.ResponseSchema.parse(result).response;
  if (created.username !== username) throw new Error("Remnawave returned a different username.");
  if (params.user.remnawaveShortUuid && created.shortUuid !== params.user.remnawaveShortUuid) {
    throw new Error("Remnawave did not preserve the subscription identifier.");
  }
  return created;
}

export async function enableRemoteUser(remnawaveUserUuid?: string | null) {
  if (!isConfigured() || !remnawaveUserUuid) {
    return null;
  }

  const result = await remnawaveRequest<EnableUserCommand.Response>({
    path: EnableUserCommand.url(remnawaveUserUuid),
    method: "POST",
    body: { uuid: remnawaveUserUuid },
  });

  return EnableUserCommand.ResponseSchema.parse(result).response;
}

export async function disableRemoteUser(remnawaveUserUuid?: string | null) {
  if (!remnawaveUserUuid) {
    return null;
  }

  const result = await remnawaveRequest<DisableUserCommand.Response>({
    path: DisableUserCommand.url(remnawaveUserUuid),
    method: "POST",
    body: { uuid: remnawaveUserUuid },
  }).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });

  return result ? DisableUserCommand.ResponseSchema.parse(result).response : null;
}

export async function deleteRemoteUser(remnawaveUserUuid?: string | null) {
  if (!remnawaveUserUuid) {
    return null;
  }

  const result = await remnawaveRequest<DeleteUserCommand.Response>({
    path: DeleteUserCommand.url(remnawaveUserUuid),
    method: "DELETE",
    body: { uuid: remnawaveUserUuid },
  }).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });

  if (!result) return null;
  const deleted = DeleteUserCommand.ResponseSchema.parse(result).response;
  if (!deleted.isDeleted) throw new Error("Remnawave did not confirm deletion.");
  return deleted;
}

export async function getRemoteUserDevices(
  remnawaveUserUuid?: string | null,
  signal?: AbortSignal,
) {
  if (!isConfigured() || !remnawaveUserUuid) {
    return [];
  }

  GetUserHwidDevicesCommand.RequestSchema.parse({ userUuid: remnawaveUserUuid });
  const result = await remnawaveRequest<GetUserHwidDevicesCommand.Response>({
    path: GetUserHwidDevicesCommand.url(remnawaveUserUuid),
    method: "GET",
    signal,
  });

  return GetUserHwidDevicesCommand.ResponseSchema.parse(result).response.devices;
}

export async function deleteRemoteUserDevice(params: {
  remnawaveUserUuid?: string | null;
  hwid: string;
}) {
  if (!isConfigured() || !params.remnawaveUserUuid) {
    return [];
  }

  const body = {
    userUuid: params.remnawaveUserUuid,
    hwid: params.hwid,
  };

  DeleteUserHwidDeviceCommand.RequestSchema.parse(body);
  const result = await remnawaveRequest<DeleteUserHwidDeviceCommand.Response>({
    path: DeleteUserHwidDeviceCommand.url,
    method: "POST",
    body,
  });

  return DeleteUserHwidDeviceCommand.ResponseSchema.parse(result).response.devices;
}

export async function createRemoteConfigProfile(params: {
  name: string;
  config: Record<string, unknown>;
}) {
  if (!isConfigured()) {
    throw new Error("Remnawave is not configured.");
  }

  const body = {
    name: params.name,
    config: params.config,
  };
  CreateConfigProfileCommand.RequestSchema.parse(body);
  const result = await remnawaveRequest<CreateConfigProfileCommand.Response>({
    path: CreateConfigProfileCommand.url,
    method: "POST",
    body,
  });

  return CreateConfigProfileCommand.ResponseSchema.parse(result).response;
}

export async function createRemoteNode(params: {
  name: string;
  address: string;
  port: number;
  countryCode: string;
  activeConfigProfileUuid: string;
  activeInbounds: string[];
}) {
  if (!isConfigured()) {
    throw new Error("Remnawave is not configured.");
  }

  const body = {
    name: params.name,
    address: params.address,
    port: params.port,
    countryCode: params.countryCode,
    isTrafficTrackingActive: true,
    configProfile: {
      activeConfigProfileUuid: params.activeConfigProfileUuid,
      activeInbounds: params.activeInbounds,
    },
    tags: ["auto-provisioned"],
  };
  CreateNodeCommand.RequestSchema.parse(body);
  const result = await remnawaveRequest<CreateNodeCommand.Response>({
    path: CreateNodeCommand.url,
    method: "POST",
    body,
  });

  return CreateNodeCommand.ResponseSchema.parse(result).response;
}

export async function createRemoteHost(params: {
  remark: string;
  address: string;
  port: number;
  configProfileUuid: string;
  configProfileInboundUuid: string;
  nodeUuid: string;
  internalSquadUuid?: string | null;
}) {
  if (!isConfigured()) {
    throw new Error("Remnawave is not configured.");
  }

  const body = {
    remark: params.remark,
    address: params.address,
    port: params.port,
    sni: params.address,
    alpn: "h3" as const,
    securityLayer: "TLS" as const,
    tag: "ROUTING_HOST",
    inbound: {
      configProfileUuid: params.configProfileUuid,
      configProfileInboundUuid: params.configProfileInboundUuid,
    },
    nodes: [params.nodeUuid],
    excludedInternalSquads: params.internalSquadUuid ? [] : undefined,
  };
  CreateHostCommand.RequestSchema.parse(body);
  const result = await remnawaveRequest<CreateHostCommand.Response>({
    path: CreateHostCommand.url,
    method: "POST",
    body,
  });

  return CreateHostCommand.ResponseSchema.parse(result).response;
}
