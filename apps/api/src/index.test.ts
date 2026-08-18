import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";
process.env.CORS_ORIGIN = "https://cms.example.com";

const {
  app,
  createsBigCycle,
  isSelfBigReference,
  resolveUpdatedDynasty,
} = await import("./index.js");

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health check remains public", async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    databaseConfigured: true,
  });
});

test("CORS returns an allow-origin header only for an exact configured origin", async () => {
  const allowedResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://cms.example.com" },
  });
  const rejectedResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://lookalike.example.com" },
  });

  assert.equal(
    allowedResponse.headers.get("access-control-allow-origin"),
    "https://cms.example.com",
  );
  assert.equal(rejectedResponse.headers.get("access-control-allow-origin"), null);
});

test("protected routes reject a non-bearer authorization scheme", async () => {
  const response = await fetch(`${baseUrl}/api/members`, {
    headers: { Authorization: "Basic not-a-session" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "A valid sign-in session is required.",
  });
});

test("development auth bypass headers are rejected outside development", async () => {
  const response = await fetch(`${baseUrl}/api/members`, {
    headers: { "X-Dev-Auth-Bypass": "true" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "A valid sign-in session is required.",
  });
});

test("a rename cannot use the member's old name as their new big", () => {
  assert.equal(isSelfBigReference("Alice Wong", "Alice Chen", "alice wong"), true);
});

test("cycle detection follows little links through a pending rename", () => {
  assert.equal(
    createsBigCycle(
      [
        { id: "1", member_name: "Alice Wong", member_big: null },
        { id: "2", member_name: "Ben Carter", member_big: "Alice Wong" },
      ],
      "1",
      "Alice Wong",
      "Alice Chen",
      "Ben Carter",
    ),
    true,
  );
});

test("an existing big's dynasty wins over a simultaneous dynasty change", () => {
  assert.equal(resolveUpdatedDynasty("earth", true, "fire"), "fire");
  assert.equal(resolveUpdatedDynasty("earth", true), "earth");
});

for (const protectedRequest of [
  { name: "member reads", method: "GET", path: "/api/members" },
  { name: "member creation", method: "POST", path: "/api/members" },
  { name: "bulk imports", method: "POST", path: "/api/pairings/import" },
  { name: "admin management", method: "GET", path: "/api/admin-users" },
]) {
  test(`${protectedRequest.name} reject requests without a bearer token`, async () => {
    const response = await fetch(`${baseUrl}${protectedRequest.path}`, {
      method: protectedRequest.method,
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "A valid sign-in session is required.",
    });
  });
}
