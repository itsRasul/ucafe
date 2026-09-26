"use client";

import { useCallback, useEffect, useState } from "react";
import { platformRaw, platformStorageKey } from "./platform-api";

export type PlatformApi = <T>(path: string, init?: RequestInit) => Promise<T>;
type SessionState = "loading" | "login" | "ready" | "denied";

export function usePlatformSession() {
  const [state, setState] = useState<SessionState>("loading");
  const [token, setToken] = useState("");
  const [access, setAccess] = useState<string[]>([]);

  const establish = useCallback(async (value: string) => {
    const result = await platformRaw<{ permissions: string[] }>("/platform/admin/access", value);
    sessionStorage.setItem(platformStorageKey, value);
    setToken(value);
    setAccess(result.permissions);
    setState("ready");
  }, []);
  const refresh = useCallback(async () => establish((await platformRaw<{ accessToken: string }>("/auth/refresh", undefined, { method: "POST" })).accessToken), [establish]);

  useEffect(() => {
    const saved = sessionStorage.getItem(platformStorageKey);
    (saved ? establish(saved).catch(refresh) : refresh()).catch((error: { status?: number }) => setState(error.status === 403 ? "denied" : "login"));
  }, [establish, refresh]);

  const api = useCallback<PlatformApi>(async <T,>(path: string, init?: RequestInit) => {
    try { return await platformRaw<T>(path, token, init); }
    catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      const nextToken = (await platformRaw<{ accessToken: string }>("/auth/refresh", undefined, { method: "POST" })).accessToken;
      await establish(nextToken);
      return platformRaw<T>(path, nextToken, init);
    }
  }, [token, establish]);

  const logout = useCallback(async () => {
    await platformRaw("/auth/logout", undefined, { method: "POST" });
    sessionStorage.removeItem(platformStorageKey);
    setToken(""); setAccess([]); setState("login");
  }, []);

  return { state, access, establish, api, logout };
}
