/**
 * Tests for deciding where review comments are attached.
 * Run: cd .opencode-review && bun test tests/lib-placement.test.ts
 */

import { describe, test, expect } from "bun:test"
import { parseDiff } from "../lib/diff"
import { formatUnplacedComments, placeComments } from "../lib/placement"

// Old file lines 10-14 become new file lines 10-15:
//   10 context, 11 deleted, 11-12 added, 13 context, 14 deleted, 14-15 added
const files = parseDiff(`diff --git a/lib/auth.rb b/lib/auth.rb
--- a/lib/auth.rb
+++ b/lib/auth.rb
@@ -10,5 +10,6 @@ class Auth
   def login(user, password)
-    user.password == password
+    digest = Digest::SHA256.hexdigest(password)
+    user.password_digest == digest
   end
-  def logout; end
+  def logout
+    reset_session
`)

const comment = (fields: Record<string, unknown>) => ({ path: "lib/auth.rb", body: "Finding", ...fields })

describe("placeComments", () => {
  test("keeps a comment whose line and quote agree", () => {
    const { placed, unplaced } = placeComments(files, [
      comment({ line: 12, anchor_text: "user.password_digest == digest" }),
    ])
    expect(unplaced).toEqual([])
    expect(placed).toMatchObject([{ path: "lib/auth.rb", side: "new", line: 12, moved: false }])
  })

  test("keeps a comment on a deleted line", () => {
    const { placed } = placeComments(files, [comment({ old_line: 11, anchor_text: "user.password == password" })])
    expect(placed).toMatchObject([{ side: "old", line: 11, moved: false }])
  })

  test("moves a comment to the line its quote is on", () => {
    const { placed } = placeComments(files, [
      comment({ line: 15, anchor_text: "digest = Digest::SHA256.hexdigest(password)" }),
    ])
    expect(placed).toMatchObject([{ side: "new", line: 11, moved: true }])
  })

  test("moves a comment off a context line to the quoted changed line", () => {
    const { placed } = placeComments(files, [comment({ line: 13, anchor_text: "reset_session" })])
    expect(placed).toMatchObject([{ line: 15, moved: true }])
  })

  test("accepts a quote copied with the diff tool's line label", () => {
    const { placed } = placeComments(files, [
      comment({ line: 99, anchor_text: "[NEW:12] +    user.password_digest == digest" }),
    ])
    expect(placed).toMatchObject([{ line: 12, moved: true }])
  })

  test("accepts a distinctive partial quote", () => {
    const { placed } = placeComments(files, [comment({ line: 99, anchor_text: "Digest::SHA256" })])
    expect(placed).toMatchObject([{ line: 11 }])
  })

  test("prefers the matching line closest to the requested one", () => {
    const repeated = parseDiff(`diff --git a/a.rb b/a.rb
--- a/a.rb
+++ b/a.rb
@@ -1,0 +1,3 @@
+save!
+other
+save!
`)
    const { placed } = placeComments(repeated, [{ path: "a.rb", line: 2, anchor_text: "save!", body: "x" }])
    expect(placed[0].line).toBe(1)
    const { placed: later } = placeComments(repeated, [{ path: "a.rb", line: 4, anchor_text: "save!", body: "x" }])
    expect(later[0].line).toBe(3)
  })

  test("does not attach a comment to an unchanged line", () => {
    const { placed, unplaced } = placeComments(files, [comment({ line: 10, anchor_text: "def login(user, password)" })])
    expect(placed).toEqual([])
    expect(unplaced[0].reason).toMatch(/line 10 is not a line this pull request adds or deletes/)
  })

  test("does not attach a comment whose quote matches nothing", () => {
    const { unplaced } = placeComments(files, [comment({ line: 12, anchor_text: "something else entirely" })])
    expect(unplaced[0].reason).toMatch(/does not match line 12/)
  })

  test("does not attach a comment on a file outside the pull request", () => {
    const { unplaced } = placeComments(files, [{ path: "app/models/user.rb", line: 3, anchor_text: "x", body: "y" }])
    expect(unplaced[0].reason).toMatch(/not changed in this pull request/)
  })

  test("tolerates a/ and ./ prefixes on the path", () => {
    for (const path of ["./lib/auth.rb", "b/lib/auth.rb"]) {
      const { placed } = placeComments(files, [{ path, line: 12, anchor_text: "user.password_digest == digest", body: "x" }])
      expect(placed).toMatchObject([{ path: "lib/auth.rb", line: 12 }])
    }
  })

  test("ignores short partial quotes that would match too much", () => {
    // "word" appears inside both password lines but is too short to pick one.
    const { unplaced } = placeComments(files, [comment({ line: 99, anchor_text: "word" })])
    expect(unplaced).toHaveLength(1)
  })
})

describe("formatUnplacedComments", () => {
  test("renders nothing when every comment was placed", () => {
    expect(formatUnplacedComments([])).toBe("")
  })

  test("lists each finding with its location and reason", () => {
    const text = formatUnplacedComments([
      { comment: comment({ line: 10, body: "**[BUG:HIGH]** Callers still pass a plaintext password.\nSee the controller." }), reason: "line 10 is not a line this pull request adds or deletes" },
    ])
    expect(text).toContain("### Findings not attached to a changed line")
    expect(text).toContain("- **`lib/auth.rb, line 10`** (line 10 is not a line this pull request adds or deletes): **[BUG:HIGH]** Callers still pass a plaintext password.\n  See the controller.")
  })
})
