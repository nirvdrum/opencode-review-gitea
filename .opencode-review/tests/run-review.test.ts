/**
 * Tests for judging a review run by what its tools recorded.
 * Run: cd .opencode-review && bun test tests/run-review.test.ts
 */

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readOutcomes, recordOutcome } from "../lib/outcome"

const RUN_REVIEW = join(import.meta.dir, "../bin/run-review.ts")

let dir: string
let gitea: ReturnType<typeof Bun.serve>
let shared: boolean

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-review-test-"))
  shared = true

  // Just enough of Gitea for the access check.
  gitea = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/api/v1/version") return Response.json({ version: "1.26.0" })
      if (!shared) return new Response("not found", { status: 404 })
      if (path === "/api/v1/repos/kevin/taskerator/pulls/42") return Response.json({ number: 42 })
      return new Response("not found", { status: 404 })
    },
  })
})

afterEach(() => {
  gitea.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

describe("recordOutcome", () => {
  test("appends to the outcome file", () => {
    const file = join(dir, "outcomes")
    recordOutcome("up-to-date", { REVIEW_OUTCOME_FILE: file })
    recordOutcome("posted", { REVIEW_OUTCOME_FILE: file })
    expect(readOutcomes(file)).toEqual(["up-to-date", "posted"])
  })

  test("does nothing outside a review run", () => {
    expect(() => recordOutcome("posted", {})).not.toThrow()
  })

  test("reads a missing file as no outcomes", () => {
    expect(readOutcomes(join(dir, "missing"))).toEqual([])
  })
})

/** Run run-review.ts with a fake opencode that runs `script` in sh. */
async function runReview(script: string) {
  const bin = join(dir, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "opencode"), `#!/bin/sh\necho "$@" > "${dir}/args"\n${script}\n`)
  chmodSync(join(bin, "opencode"), 0o755)

  const run = Bun.spawn(["bun", RUN_REVIEW, "Review this pull request."], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITEA_SERVER_URL: gitea.url.href,
      GITEA_TOKEN: "test-token",
      GITHUB_EVENT_PATH: "",
      REPO_OWNER: "kevin",
      REPO_NAME: "taskerator",
      PR_NUMBER: "42",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const status = await run.exited
  return {
    status,
    stdout: await new Response(run.stdout).text(),
    stderr: await new Response(run.stderr).text(),
    ranOpenCode: existsSync(join(dir, "args")),
  }
}

describe("run-review", () => {
  test("passes when a review was posted", async () => {
    const { status } = await runReview(`echo posted >> "$REVIEW_OUTCOME_FILE"`)
    expect(status).toBe(0)
    expect(readFileSync(join(dir, "args"), "utf8")).toBe("run --agent code-review Review this pull request.\n")
  })

  test("passes when there was nothing new to review", async () => {
    const { status } = await runReview(`echo up-to-date >> "$REVIEW_OUTCOME_FILE"`)
    expect(status).toBe(0)
  })

  test("fails when OpenCode stops without posting anything", async () => {
    const { status, stderr } = await runReview("exit 0")
    expect(status).toBe(1)
    expect(stderr).toContain("without posting a review")
  })

  test("reports OpenCode's own failure", async () => {
    const { status, stderr } = await runReview(`echo posted >> "$REVIEW_OUTCOME_FILE"; exit 3`)
    expect(status).toBe(3)
    expect(stderr).toContain("status 3")
  })

  test("passes without starting OpenCode when the repository is not shared", async () => {
    shared = false
    const { status, stdout, ranOpenCode } = await runReview("exit 0")
    expect(status).toBe(0)
    expect(ranOpenCode).toBe(false)
    expect(stdout).toContain("kevin/taskerator is not shared")
  })
})
