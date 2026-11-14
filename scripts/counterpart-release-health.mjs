import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "https://agusweb.up.railway.app";
const { password } = JSON.parse(
  await readFile(".data/counterpart-railway/access.json"),
);
const post = (path, body, origin = base, cookie = "") =>
  fetch(base + path, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const login = await post("/api/session", { password });
assert.equal(login.status, 200, "new operator login");
const cookie = login.headers.get("set-cookie").split(";")[0];
const header = login.headers.get("set-cookie");
for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"])
  assert.ok(header.includes(flag));
const old = JSON.parse(
  await readFile(".data/counterpart-railway/before-release-access.json"),
);
assert.equal(
  (await post("/api/session", { password: old.password })).status,
  401,
  "old password rejected",
);
assert.equal(
  (await fetch(base + "/api/product")).status,
  401,
  "financial data protected",
);
assert.equal(
  (await post("/api/conversation", {}, "https://untrusted.invalid", cookie))
    .status,
  403,
  "hostile origin rejected",
);
const get = async (path) => {
  const r = await fetch(base + path, { headers: { cookie } });
  assert.equal(r.status, 200, path);
  return r.json();
};
const [product, chats, workspace, network, state] = await Promise.all(
  [
    "/api/product",
    "/api/conversations",
    "/api/agent-workspace",
    "/api/product/zcash-network",
    "/api/state",
  ].map(get),
);
assert.notEqual(state.mode, "live");
assert.equal(state.liveEnabled, false);
for (const payload of [product, chats, workspace, network, state]) {
  const text = JSON.stringify(payload);
  for (const secret of [
    password,
    JSON.parse(await readFile(".data/counterpart-railway/access.json")).hash,
  ])
    assert.ok(
      !text.includes(secret),
      "No private credential in authenticated API responses",
    );
}
const before = JSON.parse(
  await readFile(".data/counterpart-railway/before-release.json"),
);
const after = {
  conversationIds: chats.chats.map((x) => x.id),
  responsibilityIds: workspace.tasks.map((x) => x.id),
  invoiceIds: product.invoices.map((x) => x.id),
  accountIds: product.accounts.map((x) => x.id),
};
for (const key of Object.keys(before))
  for (const id of before[key])
    assert.ok(after[key].includes(id), "preserved " + key);
assert.equal(product.capabilities.pollar.network, "testnet");
assert.equal(network.live, true);
assert.equal(network.branchId.toLowerCase(), "77190ad9");
const report = {
  url: base,
  login: 200,
  oldPasswordRejected: 401,
  unauthenticatedFinancialData: 401,
  hostileOrigin: 403,
  cookie: { httpOnly: true, secure: true, sameSite: "Strict" },
  allPriorRecordsPreserved: true,
  recordCounts: Object.fromEntries(
    Object.entries(after).map(([k, v]) => [k, v.length]),
  ),
  pollarTestnet: true,
  paystackMode: state.mode,
  mainnetExecutionEnabled: state.liveEnabled,
  network,
  credentialsInReport: false,
};
await writeFile(
  "docs/release-pass/live/security-network.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
