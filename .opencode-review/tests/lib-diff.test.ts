/**
 * Tests for the shared diff parser.
 * Run: cd .opencode-review && bun test tests/lib-diff.test.ts
 */

import { describe, test, expect } from "bun:test"
import { parseDiff } from "../lib/diff"

function modified(path: string): string {
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n`
}

describe("parseDiff paths", () => {
  test("reads paths in directories whose names end in b", () => {
    for (const path of ["lib/gitea.ts", "db/migrate/001_create.rb", "web/index.html", "src/app.ts"]) {
      expect(parseDiff(modified(path)).map(f => f.path)).toEqual([path])
    }
  })

  test("reads the path of an added file", () => {
    const diff = "diff --git a/lib/new.rb b/lib/new.rb\nnew file mode 100644\n--- /dev/null\n+++ b/lib/new.rb\n@@ -0,0 +1 @@\n+hello\n"
    expect(parseDiff(diff)).toMatchObject([{ path: "lib/new.rb", status: "added" }])
  })

  test("reads the path of a deleted file from its old side", () => {
    const diff = "diff --git a/lib/old.rb b/lib/old.rb\ndeleted file mode 100644\n--- a/lib/old.rb\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n"
    expect(parseDiff(diff)).toMatchObject([{ path: "lib/old.rb", status: "deleted" }])
  })

  test("reads the new path of a renamed file", () => {
    const diff = "diff --git a/lib/a.rb b/lib/b.rb\nsimilarity index 100%\nrename from lib/a.rb\nrename to lib/b.rb\n"
    expect(parseDiff(diff)).toMatchObject([{ path: "lib/b.rb", status: "renamed", hunks: [] }])
  })

  test("falls back to the git header for a binary file", () => {
    const diff = "diff --git a/lib/logo.png b/lib/logo.png\nindex 1111111..2222222 100644\nBinary files a/lib/logo.png and b/lib/logo.png differ\n"
    expect(parseDiff(diff)).toMatchObject([{ path: "lib/logo.png", hunks: [] }])
  })

  test("does not let a file without hunks swallow the next file", () => {
    const binary = "diff --git a/lib/logo.png b/lib/logo.png\nBinary files a/lib/logo.png and b/lib/logo.png differ\n"
    const files = parseDiff(binary + modified("db/schema.rb"))
    expect(files.map(f => f.path)).toEqual(["lib/logo.png", "db/schema.rb"])
    expect(files[1].hunks).toHaveLength(1)
  })
})

describe("parseDiff line numbers", () => {
  test("numbers added lines on the new side and deleted lines on the old side", () => {
    const [file] = parseDiff(modified("lib/x.rb"))
    expect(file.hunks[0].changes).toEqual([
      { type: "normal", content: "context", oldLine: 1, newLine: 1 },
      { type: "del", content: "old", oldLine: 2 },
      { type: "add", content: "new", newLine: 2 },
    ])
  })
})
