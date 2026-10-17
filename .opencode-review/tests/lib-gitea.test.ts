/**
 * Tests for the pull request context shared by the review tools.
 * Run: cd .opencode-review && bun test tests/lib-gitea.test.ts
 */

import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pullContext, pullPath, repoPath } from "../lib/gitea"

/** Write an Actions event payload and return the environment that points at it. */
function eventEnv(event: unknown, extra: Record<string, string> = {}): Record<string, string> {
  const path = join(mkdtempSync(join(tmpdir(), "opencode-review-test-")), "event.json")
  writeFileSync(path, JSON.stringify(event))
  return { GITHUB_EVENT_PATH: path, ...extra }
}

const repository = { name: "taskerator", owner: { login: "kevin", username: "kevin" } }

describe("pullContext in Gitea Actions", () => {
  test("reads a pull_request event", () => {
    const env = eventEnv({ action: "synchronize", number: 42, pull_request: { number: 42 }, repository })
    expect(pullContext(env)).toEqual({ owner: "kevin", repo: "taskerator", number: 42 })
  })

  test("reads a comment on a pull request", () => {
    const env = eventEnv({ action: "created", issue: { number: 7, pull_request: { merged: false } }, comment: { body: "/oc" }, repository })
    expect(pullContext(env)).toEqual({ owner: "kevin", repo: "taskerator", number: 7 })
  })

  test("rejects a comment on a plain issue", () => {
    const env = eventEnv({ action: "created", issue: { number: 7, pull_request: null }, repository })
    expect(() => pullContext(env)).toThrow(/pull request number/)
  })

  test("ignores variables when there is an event", () => {
    const env = eventEnv({ pull_request: { number: 42 }, repository }, { REPO_OWNER: "someone-else", PR_NUMBER: "1" })
    expect(pullContext(env)).toEqual({ owner: "kevin", repo: "taskerator", number: 42 })
  })

  test("validates names from the event too", () => {
    const env = eventEnv({ pull_request: { number: 42 }, repository: { name: "..", owner: { login: "kevin" } } })
    expect(() => pullContext(env)).toThrow(/repository name/)
  })
})

describe("pullContext outside Gitea Actions", () => {
  test("reads the pull request from the environment", () => {
    const ctx = pullContext({ REPO_OWNER: "kevin", REPO_NAME: "taskerator", PR_NUMBER: "42" })
    expect(ctx).toEqual({ owner: "kevin", repo: "taskerator", number: 42 })
  })

  test("accepts REPO_NAME in owner/repo form", () => {
    expect(pullContext({ REPO_NAME: "kevin/taskerator", PR_NUMBER: "7" }))
      .toEqual({ owner: "kevin", repo: "taskerator", number: 7 })
  })

  test("prefers an explicit REPO_OWNER over the owner in REPO_NAME", () => {
    expect(pullContext({ REPO_OWNER: "org", REPO_NAME: "kevin/taskerator", PR_NUMBER: "7" }).owner)
      .toBe("org")
  })

  test("rejects names that could change the API path", () => {
    expect(() => pullContext({ REPO_OWNER: "..", REPO_NAME: "x", PR_NUMBER: "1" })).toThrow()
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: ".", PR_NUMBER: "1" })).toThrow()
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: "my.repo", PR_NUMBER: "1" })).not.toThrow()
    expect(() => pullContext({ REPO_OWNER: "a/../b", REPO_NAME: "x", PR_NUMBER: "1" })).toThrow()
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: "x?y=1", PR_NUMBER: "1" })).toThrow()
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: "x#y", PR_NUMBER: "1" })).toThrow()
  })

  test("rejects a missing or malformed pull request number", () => {
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: "x" })).toThrow(/PR_NUMBER/)
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: "x", PR_NUMBER: "0" })).toThrow(/PR_NUMBER/)
    expect(() => pullContext({ REPO_OWNER: "kevin", REPO_NAME: "x", PR_NUMBER: "4/files" })).toThrow(/PR_NUMBER/)
  })

  test("rejects a missing repository", () => {
    expect(() => pullContext({ PR_NUMBER: "1" })).toThrow(/REPO_OWNER/)
    expect(() => pullContext({ REPO_OWNER: "kevin", PR_NUMBER: "1" })).toThrow(/REPO_NAME/)
  })
})

describe("API paths", () => {
  test("build from the context", () => {
    const ctx = { owner: "kevin", repo: "taskerator", number: 42 }
    expect(repoPath(ctx)).toBe("/repos/kevin/taskerator")
    expect(pullPath(ctx)).toBe("/repos/kevin/taskerator/pulls/42")
  })
})
