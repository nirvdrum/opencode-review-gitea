/**
 * Tests for pinning the reviewed commit.
 * Run: cd .opencode-review && bun test tests/lib-snapshot.test.ts
 */

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { clearPullSnapshot, pullSnapshot } from "../lib/snapshot"

const ctx = { owner: "kevin", repo: "taskerator", number: 42 }
const DIFF = "diff --git a/app.rb b/app.rb\n--- a/app.rb\n+++ b/app.rb\n@@ -1 +1 @@\n-old\n+new\n"

const realFetch = globalThis.fetch
let requests: string[] = []

/** Serve Gitea responses, reporting each head SHA in turn from `heads`. */
function serveGitea(heads: string[]) {
  let headCalls = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith("/pulls/42")) {
      const sha = heads[Math.min(headCalls++, heads.length - 1)]
      return new Response(JSON.stringify({ head: { sha } }))
    }
    if (url.endsWith("/pulls/42.diff")) return new Response(DIFF)
    return new Response("not found", { status: 404 })
  }) as typeof fetch
}

beforeEach(() => {
  process.env.GITEA_SERVER_URL = "https://gitea.example.com"
  process.env.GITEA_TOKEN = "test-token"
  requests = []
  clearPullSnapshot()
})

afterEach(() => {
  globalThis.fetch = realFetch
  clearPullSnapshot()
})

describe("pullSnapshot", () => {
  test("pins the head commit the diff was read at", async () => {
    serveGitea(["aaa", "aaa"])
    const snapshot = await pullSnapshot(ctx)
    expect(snapshot.headSha).toBe("aaa")
    expect(snapshot.files.map(f => f.path)).toEqual(["app.rb"])
  })

  test("retries when the head moves while the diff is fetched", async () => {
    serveGitea(["aaa", "bbb", "bbb", "bbb"])
    const snapshot = await pullSnapshot(ctx)
    expect(snapshot.headSha).toBe("bbb")
  })

  test("gives up when the head never settles", async () => {
    serveGitea(["a", "b", "c", "d", "e", "f", "g"])
    await expect(pullSnapshot(ctx)).rejects.toThrow(/kept changing/)
  })

  test("reuses the snapshot so every tool sees the same commit", async () => {
    serveGitea(["aaa", "aaa", "bbb", "bbb"])
    const first = await pullSnapshot(ctx)
    const requestCount = requests.length
    const second = await pullSnapshot(ctx)
    expect(second).toBe(first)
    expect(requests.length).toBe(requestCount)
  })

  test("does not reuse a snapshot of a different pull request", async () => {
    serveGitea(["aaa"])
    await pullSnapshot(ctx)
    const other = { ...ctx, number: 43 }
    await expect(pullSnapshot(other)).rejects.toThrow(/404/)
  })
})
