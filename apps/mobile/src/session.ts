import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { fetch as streamingFetch } from "expo/fetch";
import { createApiClient } from "@agus/api-client";
import type { CryptoVoiceTransport } from "./crypto-voice";

const base = process.env.EXPO_PUBLIC_API_URL;
if (!base) throw new Error("EXPO_PUBLIC_API_URL_REQUIRED");
export const apiOrigin = new URL(base).origin;
if (
  !apiOrigin.startsWith("https://") &&
  !(
    __DEV__ &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(new URL(base).hostname)
  )
)
  throw new Error("HTTPS_API_REQUIRED");
let unlocked = false;
const storage = {
  getItem: (key: string) => (unlocked ? SecureStore.getItem(key) : null),
  getItemAsync: async (key: string) =>
    unlocked ? SecureStore.getItemAsync(key) : null,
  setItem: (key: string, value: string) =>
    SecureStore.setItem(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
};
export const auth = createAuthClient({
  baseURL: apiOrigin,
  plugins: [
    twoFactorClient(),
    expoClient({
      scheme: "agus",
      storagePrefix: "agus",
      storage,
      disableCache: true,
    }),
  ],
});
export function lockSession() {
  unlocked = false;
}
export async function unlockSession() {
  if (
    !(await LocalAuthentication.hasHardwareAsync()) ||
    !(await LocalAuthentication.isEnrolledAsync())
  )
    return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock AGUS session",
    disableDeviceFallback: false,
  });
  unlocked = result.success;
  return unlocked;
}
export async function freshSignIn(email: string, password: string) {
  // Without enrolled biometrics, use a fresh server login instead of unlocking
  // an old credential from a client boolean. No password is persisted locally.
  await SecureStore.deleteItemAsync("agus_cookie");
  await SecureStore.deleteItemAsync("agus_session_data");
  unlocked = true;
  return auth.signIn.email({ email, password });
}
async function sessionHeaders(headers?: HeadersInit) {
  if (!unlocked) throw new Error("LOCAL_SESSION_LOCKED");
  const cookie = await auth.getCookie();
  if (!unlocked) throw new Error("LOCAL_SESSION_LOCKED");
  const result = new Headers(headers);
  result.set("cookie", cookie);
  result.set("origin", "agus://");
  return result;
}

async function expireSession(response: Response) {
  if (response.status !== 401) return;
  lockSession();
  await SecureStore.deleteItemAsync("agus_cookie");
  await SecureStore.deleteItemAsync("agus_session_data");
}

export const api = createApiClient(apiOrigin, async (input, init) => {
  const request = new Request(input, init);
  const headers = await sessionHeaders();
  headers.forEach((value, name) => request.headers.set(name, value));
  const response = await fetch(request);
  await expireSession(response);
  return response;
});

export const cryptoVoiceTransport: CryptoVoiceTransport = async (
  path,
  init,
) => {
  const response = await streamingFetch(apiOrigin + path, {
    ...init,
    headers: await sessionHeaders(init.headers),
    redirect: "error",
  });
  await expireSession(response);
  return response;
};

export async function apiRequest(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
) {
  const response = await fetch(apiOrigin + "/api/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: await sessionHeaders({
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    await expireSession(response);
    throw new Error("SESSION_REVOKED_OR_EXPIRED");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code ?? "REQUEST_FAILED");
  return result;
}
