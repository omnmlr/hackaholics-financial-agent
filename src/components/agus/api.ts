export async function productApi<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : (data.reply?.text ??
          `Request unavailable (${response.status}). Please try again.`);
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}
