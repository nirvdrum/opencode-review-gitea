/**
 * Tests for the notices every review carries.
 * Run: cd .opencode-review && bun test tests/lib-notices.test.ts
 */

import { describe, test, expect } from "bun:test"
import type { ParsedFile } from "../lib/diff"
import { reviewConfigFiles, reviewConfigNotice } from "../lib/notices"

const files = (...paths: string[]): ParsedFile[] => paths.map(path => ({ path, status: "modified", hunks: [] }))

describe("reviewConfigNotice", () => {
  test("says nothing when no configuration changed", () => {
    expect(reviewConfigNotice(files("app/models/user.rb", "lib/tasks/github.rake"))).toBe("")
  })

  test("names each changed workflow or reviewer file", () => {
    const changed = files(".gitea/workflows/review.yaml", "app/models/user.rb", ".opencode-review/agents/code-review.md", "opencode.json")
    expect(reviewConfigFiles(changed)).toEqual([".gitea/workflows/review.yaml", ".opencode-review/agents/code-review.md", "opencode.json"])
    expect(reviewConfigNotice(changed)).toContain("`.gitea/workflows/review.yaml`, `.opencode-review/agents/code-review.md`, `opencode.json`")
  })

  test("only matches configuration at the repository root", () => {
    expect(reviewConfigFiles(files("docs/.github/notes.md", "vendor/opencode.json"))).toEqual([])
  })
})
