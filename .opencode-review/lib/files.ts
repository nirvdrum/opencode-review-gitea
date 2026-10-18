/**
 * Whole files from the commit under review, for context the diff leaves out.
 *
 * The diff shows a few lines around each change. A finding often depends on
 * code further away, such as a variable defined at the top of the file or the
 * condition that guards a changed block. Without a way to read it, the model
 * either guesses or asks the author to confirm what the file already says.
 *
 * Files are read through the Gitea API at the snapshot's head commit, the same
 * commit the diff came from and the review is posted against, and only from the
 * repository under review. The model chooses the path and nothing else.
 */

import { giteaRequest, repoPath, type PullContext } from "./gitea"

/** The most lines returned by one read, so that a huge file cannot flood the context. */
export const MAX_LINES = 1000

/**
 * Check a path the model asked for and encode it for the API.
 *
 * Gitea would resolve "." and ".." segments before looking the file up, so
 * they are refused rather than encoded, along with anything else that is not a
 * plain relative path inside the repository.
 */
export function encodeRepoPath(path: string): string {
  const segments = path.replace(/^\.\//, "").split("/")
  const valid = path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    segments.every((s) => s !== "" && s !== "." && s !== "..")

  if (!valid) {
    throw new Error(`"${path}" is not a path to a file in the repository. Use a path such as app/models/user.rb.`)
  }

  return segments.map(encodeURIComponent).join("/")
}

export interface LineRange {
  start?: number
  end?: number
}

/** Number the lines of `text` in the requested range, at most MAX_LINES of them. */
export function formatFile(path: string, text: string, range: LineRange = {}): string {
  const lines = text.split("\n")
  if (lines[lines.length - 1] === "") {
    lines.pop()
  }

  const start = Math.max(1, range.start ?? 1)
  const end = Math.min(lines.length, range.end ?? lines.length, start + MAX_LINES - 1)

  if (start > lines.length) {
    return `\`${path}\` has ${lines.length} lines, so there is nothing from line ${start}.`
  }
  if (end < start) {
    return `end_line ${range.end} comes before start_line ${start}.`
  }

  const width = String(end).length
  const numbered = lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(width)} | ${line}`)
  const header = `# ${path} (lines ${start}-${end} of ${lines.length})`
  const more = end < lines.length && (range.end === undefined || end < range.end)
    ? `\n\nShowing at most ${MAX_LINES} lines. Read on with start_line: ${end + 1}.`
    : ""

  return `${header}\n\n${numbered.join("\n")}${more}`
}

/** Read `path` at `commit` in the repository under review. */
export async function readRepoFile(ctx: PullContext, commit: string, path: string, range: LineRange = {}): Promise<string> {
  const encoded = encodeRepoPath(path)
  const response = await giteaRequest(`${repoPath(ctx)}/raw/${encoded}?ref=${encodeURIComponent(commit)}`, {
    headers: { Accept: "*/*" },
  })

  if (response.status === 404) {
    return `There is no file \`${path}\` in commit ${commit.slice(0, 7)}. A file the pull request deletes exists only in the diff.`
  }
  if (!response.ok) {
    throw new Error(`Gitea answered ${response.status} for \`${path}\`: ${await response.text()}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.includes(0)) {
    return `\`${path}\` is a binary file, so it is not shown.`
  }

  return formatFile(path, new TextDecoder().decode(bytes), range)
}
