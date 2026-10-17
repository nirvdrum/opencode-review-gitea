/**
 * Unified diff parsing shared by the diff tools and the review validator.
 */

export interface ParsedChange {
  type: "add" | "del" | "normal"
  content: string
  oldLine?: number
  newLine?: number
}

export interface ParsedHunk {
  oldStart: number
  newStart: number
  changes: ParsedChange[]
}

export interface ParsedFile {
  path: string
  status: string
  hunks: ParsedHunk[]
}

/**
 * Read the new path from a "diff --git a/<path> b/<path>" line.
 *
 * This is only a fallback for files without "---"/"+++" lines. Matching the
 * first "b/" in the line would cut paths such as "lib/x" or "db/x" short, so
 * use the fact that both halves are the same path when the file was not
 * renamed, and otherwise take the text after the last " b/".
 */
function pathFromGitHeader(line: string): string {
  const rest = line.slice("diff --git ".length)
  const half = (rest.length - "a/ b/".length) / 2
  if (rest.startsWith("a/") && Number.isInteger(half)) {
    const candidate = rest.slice(2, 2 + half)
    if (rest === `a/${candidate} b/${candidate}`) return candidate
  }

  const index = rest.lastIndexOf(" b/")
  return index === -1 ? "unknown" : rest.slice(index + " b/".length)
}

export function parseDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const lines = diffText.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Look for file header
    if (line.startsWith("diff --git")) {
      // Determine status and path. The header ends at the first hunk, or at the
      // next file for a file with no hunks, such as a binary file or a pure
      // rename.
      let status = "modified"
      let newPath: string | undefined
      let oldPath: string | undefined
      let renamedTo: string | undefined
      i++
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
        const header = lines[i]
        if (header.startsWith("new file")) status = "added"
        else if (header.startsWith("deleted file")) status = "deleted"
        else if (header.startsWith("rename")) status = "renamed"

        if (header.startsWith("+++ b/")) newPath = header.slice("+++ b/".length)
        else if (header.startsWith("--- a/")) oldPath = header.slice("--- a/".length)
        else if (header.startsWith("rename to ")) renamedTo = header.slice("rename to ".length)
        i++
      }

      // A deleted file's "+++" line is /dev/null, so its path comes from "---".
      const path = newPath ?? renamedTo ?? oldPath ?? pathFromGitHeader(line)

      const hunks: ParsedHunk[] = []

      // Parse hunks
      while (i < lines.length && !lines[i].startsWith("diff --git")) {
        if (lines[i].startsWith("@@")) {
          const hunkMatch = lines[i].match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
          if (hunkMatch) {
            const oldStart = parseInt(hunkMatch[1], 10)
            const newStart = parseInt(hunkMatch[2], 10)
            const changes: ParsedChange[] = []
            let oldLine = oldStart
            let newLine = newStart

            i++
            while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
              const content = lines[i].slice(1)
              if (lines[i].startsWith("+")) {
                changes.push({ type: "add", content, newLine: newLine++ })
              } else if (lines[i].startsWith("-")) {
                changes.push({ type: "del", content, oldLine: oldLine++ })
              } else if (lines[i].startsWith(" ")) {
                changes.push({ type: "normal", content, oldLine: oldLine++, newLine: newLine++ })
              }
              i++
            }

            hunks.push({ oldStart, newStart, changes })
          } else {
            i++
          }
        } else {
          i++
        }
      }

      files.push({ path, status, hunks })
    } else {
      i++
    }
  }

  return files
}

export function formatDiffForReview(files: ParsedFile[]): string {
  const parts: string[] = []

  for (const file of files) {
    parts.push(`\n## ${file.path} (${file.status})\n`)

    for (const hunk of file.hunks) {
      parts.push(`@@ starting at line ${hunk.newStart} (old: ${hunk.oldStart}) @@`)

      for (const change of hunk.changes) {
        if (change.type === "add") {
          // New line: [NEW:行号] +内容
          parts.push(`[NEW:${change.newLine}] +${change.content}`)
        } else if (change.type === "del") {
          // Deleted line: [OLD:行号] -内容 (用于 old_position 评论)
          parts.push(`[OLD:${change.oldLine}] -${change.content}`)
        } else {
          // Context line: [NEW:行号] 内容
          parts.push(`[NEW:${change.newLine}]  ${change.content}`)
        }
      }
      parts.push("")
    }
  }

  return parts.join("\n")
}
