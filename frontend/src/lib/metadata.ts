import { API_BASE_URL } from "./config";

export interface BackendIdentity {
  name: string;
  version: string;
  sourceType: string;
}

export type IdentityResult =
  | { ok: true; identity: BackendIdentity }
  | { ok: false; reason: string };

export async function fetchBackendIdentity(
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<IdentityResult> {
  let response: Response;
  try {
    response = await fetchFn(`${API_BASE_URL}/api/metadata`);
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    return { ok: false, reason: `http ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "bad payload" };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "bad payload" };
  }

  const { name, version, source_type: sourceType } = body as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    typeof sourceType !== "string"
  ) {
    return { ok: false, reason: "bad payload" };
  }

  return { ok: true, identity: { name, version, sourceType } };
}
