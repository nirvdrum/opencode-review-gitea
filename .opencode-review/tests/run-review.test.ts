/**
 * Tests for judging a review run by what its tools recorded.
 * Run: cd .opencode-review && bun test tests/run-review.test.ts
 */

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readOutcomes, recordOutcome } from "../lib/outcome"

const RUN_REVIEW = join(import.meta.dir, "../bin/run-review.ts")

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-review-test-"))
})

afterEach(() => {
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
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    stdout: "pipe",
    stderr: "pipe",
  })
  const status = await run.exited
  return { status, stderr: await new Response(run.stderr).text() }
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
})
