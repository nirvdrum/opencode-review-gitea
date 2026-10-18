/**
 * Tests for deciding whether the reviewer can read the pull request.
 * Run: cd .opencode-review && bun test tests/lib-access.test.ts
 */

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { pullAccess } from "../lib/access"

const ctx = { owner: "kevin", repo: "taskerator", number: 42 }
const realFetch = globalThis.fetch

/** Answer each API path from `routes`, and everything else with a 404. */
function serveGitea(routes: Record<string, Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\/v1/, "")
    return routes[path] ?? new Response("not found", { status: 404 })
  }) as typeof fetch
}

const version = () => Response.json({ version: "1.26.0" })

beforeEach(() => {
  process.env.GITEA_SERVER_URL = "https://gitea.example.com"
  process.env.GITEA_TOKEN = "test-token"
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("pullAccess", () => {
  test("reads a pull request the account can see", async () => {
    serveGitea({ "/version": version(), "/repos/kevin/taskerator/pulls/42": Response.json({ number: 42 }) })
    expect(await pullAccess(ctx)).toBe("readable")
  })

  test("reports a repository that is not shared with the account", async () => {
    serveGitea({ "/version": version() })
    expect(await pullAccess(ctx)).toBe("not-shared")
  })

  test("fails rather than skipping when the server is not Gitea", async () => {
    serveGitea({})
    await expect(pullAccess(ctx)).rejects.toThrow(/does not point at a Gitea API/)
  })

  test("fails rather than skipping when the token is rejected", async () => {
    serveGitea({ "/version": new Response("unauthorized", { status: 401 }) })
    await expect(pullAccess(ctx)).rejects.toThrow(/rejected GITEA_TOKEN/)
  })

  test("fails when the repository is readable but the pull request is missing", async () => {
    serveGitea({ "/version": version(), "/repos/kevin/taskerator": Response.json({ name: "taskerator" }) })
    await expect(pullAccess(ctx)).rejects.toThrow(/has no PR #42/)
  })

  test("fails on any other error", async () => {
    serveGitea({ "/version": version(), "/repos/kevin/taskerator/pulls/42": new Response("scope", { status: 403 }) })
    await expect(pullAccess(ctx)).rejects.toThrow(/answered 403/)
  })
})
