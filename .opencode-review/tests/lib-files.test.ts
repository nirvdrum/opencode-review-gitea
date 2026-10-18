/**
 * Tests for reading whole files from the reviewed commit.
 * Run: cd .opencode-review && bun test tests/lib-files.test.ts
 */

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { encodeRepoPath, formatFile, MAX_LINES, readRepoFile } from "../lib/files"

const ctx = { owner: "kevin", repo: "taskerator", number: 42 }
const realFetch = globalThis.fetch
let requests: string[] = []

function serveFile(status: number, body: BodyInit) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input))
    return new Response(body, { status })
  }) as typeof fetch
}

beforeEach(() => {
  process.env.GITEA_SERVER_URL = "https://gitea.example.com"
  process.env.GITEA_TOKEN = "test-token"
  requests = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("encodeRepoPath", () => {
  test("encodes each segment of a relative path", () => {
    expect(encodeRepoPath("app/models/user.rb")).toBe("app/models/user.rb")
    expect(encodeRepoPath("docs/a file?.md")).toBe("docs/a%20file%3F.md")
    expect(encodeRepoPath("./Gemfile")).toBe("Gemfile")
  })

  test("refuses paths that leave the repository or are not plain paths", () => {
    for (const path of ["", "/etc/passwd", "../other/file", "app/../../x", "app//x", "app/./x", "app\\x", "app/\0x", "app/"]) {
      expect(() => encodeRepoPath(path)).toThrow(/not a path to a file/)
    }
  })
})

describe("formatFile", () => {
  const text = "one\ntwo\nthree\nfour\n"

  test("numbers every line of a short file", () => {
    expect(formatFile("a.txt", text)).toBe("# a.txt (lines 1-4 of 4)\n\n1 | one\n2 | two\n3 | three\n4 | four")
  })

  test("returns only the requested range", () => {
    expect(formatFile("a.txt", text, { start: 2, end: 3 })).toBe("# a.txt (lines 2-3 of 4)\n\n2 | two\n3 | three")
  })

  test("explains a range past the end or backwards", () => {
    expect(formatFile("a.txt", text, { start: 9 })).toContain("has 4 lines")
    expect(formatFile("a.txt", text, { start: 3, end: 2 })).toContain("comes before")
  })

  test("caps a long file and says where to read on", () => {
    const long = Array.from({ length: MAX_LINES + 5 }, (_, i) => `line ${i + 1}`).join("\n")
    const shown = formatFile("long.txt", long)
    expect(shown).toContain(`(lines 1-${MAX_LINES} of ${MAX_LINES + 5})`)
    expect(shown).toContain(`start_line: ${MAX_LINES + 1}`)
    expect(shown).not.toContain(`line ${MAX_LINES + 1}\n`)
  })
})

describe("readRepoFile", () => {
  test("reads the file at the given commit of the repository under review", async () => {
    serveFile(200, "puts 1\n")
    const shown = await readRepoFile(ctx, "abc1234def", "lib/a b.rb")
    expect(requests).toEqual(["https://gitea.example.com/api/v1/repos/kevin/taskerator/raw/lib/a%20b.rb?ref=abc1234def"])
    expect(shown).toContain("1 | puts 1")
  })

  test("explains a file missing at that commit", async () => {
    serveFile(404, "not found")
    expect(await readRepoFile(ctx, "abc1234def", "gone.rb")).toContain("no file `gone.rb` in commit abc1234")
  })

  test("does not show binary files", async () => {
    serveFile(200, new Uint8Array([0x89, 0x50, 0x00, 0x47]))
    expect(await readRepoFile(ctx, "abc1234def", "logo.png")).toContain("binary file")
  })

  test("fails on other errors", async () => {
    serveFile(500, "boom")
    await expect(readRepoFile(ctx, "abc1234def", "a.rb")).rejects.toThrow(/answered 500/)
  })

  test("never requests a path it refuses", async () => {
    serveFile(200, "secret")
    await expect(readRepoFile(ctx, "abc1234def", "../../../etc/passwd")).rejects.toThrow(/not a path/)
    expect(requests).toEqual([])
  })
})
