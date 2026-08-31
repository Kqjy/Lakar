import { LOCAL_SESSION_KEY } from "../constants";

export interface RemoteSceneMeta {
  id: string;
  folderId: string | null;
  encTitle: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  size: number;
}

export interface RemoteScene extends RemoteSceneMeta {
  encData: string;
}

export interface RemoteFolder {
  id: string;
  encName: string;
  createdAt: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let token: string | null = null;

export const setToken = (t: string | null) => {
  token = t;
  try {
    if (t) localStorage.setItem(LOCAL_SESSION_KEY, t);
    else localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    void 0;
  }
};

export const loadToken = (): string | null => {
  try {
    token = localStorage.getItem(LOCAL_SESSION_KEY);
  } catch {
    token = null;
  }
  return token;
};

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Network unreachable");
  }
  if (res.status === 204) return undefined as T;
  let data: { error?: { code?: string; message?: string } } & Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, "bad-response", "Invalid server response");
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? "unknown",
      data?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return data as T;
};

export interface WrapRecord {
  kind: "password" | "recovery" | "passkey";
  slot: string;
  wrapped: string;
  params: string;
  label: string | null;
  createdAt: number;
}

export interface DataKeyRecord {
  epoch: number;
  wrapped: string;
  dkCheck: string;
  createdAt: number;
}

export interface KeyState {
  userId: string;
  wraps: WrapRecord[];
  dataKeys: DataKeyRecord[];
  writeEpoch: number;
  arkCheck: string | null;
  hasRecovery: boolean;
}

export interface ServerMeta {
  invitesRequired: boolean;
}

let metaRequest: Promise<ServerMeta> | null = null;

export const fetchMeta = (): Promise<ServerMeta> => {
  if (!metaRequest) {
    metaRequest = request<ServerMeta>("GET", "/meta").catch((err) => {
      metaRequest = null;
      throw err;
    });
  }
  return metaRequest;
};

export interface KeyChange {
  newAuthKey?: string;
  wraps?: {
    kind: string;
    slot?: string;
    wrapped: string;
    params?: string;
    label?: string | null;
  }[];
  removeWraps?: { kind: string; slot?: string }[];
  recoveryAuthKey?: string;
  arkCheck?: string;
  dataKeys?: { epoch: number; wrapped: string; dkCheck: string }[];
  writeEpoch?: number;
  expectNoHierarchy?: boolean;
}

const scoped = (t: string) => ({ Authorization: `Bearer ${t}` });

export const api = {
  register: (
    email: string,
    authKey: string,
    userId: string,
    keys: KeyChange,
    inviteCode?: string,
  ) =>
    request<{ token: string; email: string } & KeyState>(
      "POST",
      "/auth/register",
      { email, authKey, userId, ...keys, ...(inviteCode ? { inviteCode } : {}) },
    ),
  login: (email: string, authKey: string) =>
    request<{ token: string; email: string } & KeyState>("POST", "/auth/login", {
      email,
      authKey,
    }),
  me: () => request<{ email: string } & KeyState>("GET", "/auth/me"),
  deleteAccount: () => request<void>("DELETE", "/auth/me"),

  reauth: (authKey: string) =>
    request<{ token: string }>("POST", "/auth/reauth", { authKey }),
  getKeys: () => request<KeyState>("GET", "/keys"),
  rewrap: (keysToken: string, change: KeyChange) =>
    request<{ token: string } & KeyState>(
      "POST",
      "/keys/rewrap",
      change,
      scoped(keysToken),
    ),
  recover: (email: string, recoveryAuthKey: string) =>
    request<{ token: string; email: string; wrapped: string } & KeyState>(
      "POST",
      "/auth/recover",
      { email, recoveryAuthKey },
    ),
  passkeyChallenge: (purpose: "register" | "auth") =>
    request<{ challenge: string; rpId: string }>(
      "GET",
      `/passkeys/challenge?purpose=${purpose}`,
    ),
  registerPasskey: (
    keysToken: string,
    payload: {
      credentialId: string;
      publicKey: string;
      alg: number;
      transports: string[];
      clientDataJSON: string;
      authenticatorData: string;
      challenge: string;
      wrapped: string;
      label: string;
      assertion: {
        clientDataJSON: string;
        authenticatorData: string;
        signature: string;
        challenge: string;
      };
    },
  ) => request<KeyState>("POST", "/passkeys/register", payload, scoped(keysToken)),
  passkeyLogin: (payload: {
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    challenge: string;
  }) =>
    request<{ token: string; email: string } & KeyState>(
      "POST",
      "/passkeys/login",
      payload,
    ),
  removePasskey: (keysToken: string, credentialId: string) =>
    request<{ token: string } & KeyState>(
      "DELETE",
      `/passkeys/${credentialId}`,
      undefined,
      scoped(keysToken),
    ),

  recoverComplete: (recoverToken: string, change: KeyChange) =>
    request<{ token: string; email: string } & KeyState>(
      "POST",
      "/auth/recover/complete",
      change,
      scoped(recoverToken),
    ),

  listScenes: () =>
    request<{
      scenes: RemoteSceneMeta[];
      folders: RemoteFolder[];
      sceneBytes: number;
      quotaBytes: number | null;
    }>("GET", "/scenes"),
  getScene: (id: string) => request<RemoteScene>("GET", `/scenes/${id}`),
  createScene: (payload: {
    id?: string;
    encTitle: string;
    encData: string;
    folderId: string | null;
  }) =>
    request<{ id: string; version: number; createdAt: number; updatedAt: number }>(
      "POST",
      "/scenes",
      payload,
    ),
  updateScene: (
    id: string,
    payload: {
      encTitle?: string;
      encData?: string;
      folderId?: string | null;
      version: number;
    },
  ) =>
    request<{ version: number; updatedAt: number }>(
      "PUT",
      `/scenes/${id}`,
      payload,
    ),
  deleteScene: (id: string) => request<void>("DELETE", `/scenes/${id}`),

  createFolder: (encName: string, id?: string) =>
    request<{ id: string; createdAt: number }>("POST", "/folders", { encName, id }),
  renameFolder: (id: string, encName: string) =>
    request<void>("PUT", `/folders/${id}`, { encName }),
  deleteFolder: (id: string) => request<void>("DELETE", `/folders/${id}`),

  listSatchel: () =>
    request<{ items: { id: string; encData: string; createdAt: number }[] }>(
      "GET",
      "/satchel",
    ),
  createSatchelItem: (id: string, encData: string) =>
    request<{ id: string; createdAt: number }>("POST", "/satchel", {
      id,
      encData,
    }),
  deleteSatchelItem: (id: string) => request<void>("DELETE", `/satchel/${id}`),

  listPublished: () =>
    request<{
      items: {
        id: string;
        sceneId: string | null;
        encSecret: string | null;
        size: number;
        createdAt: number;
        updatedAt: number;
      }[];
    }>("GET", "/published"),
  createPublished: (
    encData: string,
    sceneId: string | null,
    encSecret: string | null,
    id?: string,
  ) =>
    request<{ id: string; createdAt: number; updatedAt: number }>(
      "POST",
      "/published",
      { encData, sceneId, encSecret, id },
    ),
  setPublishedSecret: (id: string, encSecret: string) =>
    request<void>("PUT", `/published/${id}/secret`, { encSecret }),
  updatePublished: (id: string, encData: string) =>
    request<{ id: string; updatedAt: number }>("PUT", `/published/${id}`, {
      encData,
    }),
  getPublished: (id: string) =>
    request<{ encData: string; updatedAt: number }>("GET", `/published/${id}`),
  deletePublished: (id: string) =>
    request<void>("DELETE", `/published/${id}`),

  createRoom: (roomId: string, verifier: string, mode: "link" | "password") =>
    request<{ roomId: string; mode: string; ownerToken: string }>(
      "POST",
      "/rooms",
      { roomId, verifier, mode },
    ),
  getRoom: (roomId: string) =>
    request<{
      roomId: string;
      mode: "link" | "password";
      peers: number;
      hasSnapshot: boolean;
    }>("GET", `/rooms/${roomId}`),
  getRoomSnapshot: (roomId: string, verifier: string) =>
    request<{ encData: string; updatedAt: number }>(
      "GET",
      `/rooms/${roomId}/snapshot`,
      undefined,
      { "x-room-verifier": verifier },
    ),
  putRoomSnapshot: (roomId: string, verifier: string, encData: string) =>
    request<void>("PUT", `/rooms/${roomId}/snapshot`, { encData }, {
      "x-room-verifier": verifier,
    }),
  endRoom: (roomId: string, ownerToken: string) =>
    request<void>("DELETE", `/rooms/${roomId}`, undefined, {
      "x-owner-token": ownerToken,
    }),
};
