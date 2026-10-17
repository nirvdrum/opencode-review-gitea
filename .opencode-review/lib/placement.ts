/**
 * Decide where each review comment the model drafted is attached.
 *
 * Comments may only be attached to lines the pull request adds or deletes.
 * The model's line numbers are checked against the diff, and each comment
 * carries the code it is about, which is used to move the comment to the right
 * line when the number is wrong. A comment that cannot be placed is not
 * dropped: it is reported in the review summary instead, because the most
 * valuable findings, such as a change breaking an unchanged caller, often have
 * no changed line to attach to.
 */

import type { ParsedFile } from "./diff"

export interface DraftComment {
  path: string
  line?: number
  old_line?: number
  anchor_text?: string
  body: string
  suggestion?: string
}

export interface PlacedComment {
  path: string
  side: "new" | "old"
  line: number
  body: string
  suggestion?: string
  /** True when the comment was moved away from the line the model asked for. */
  moved: boolean
}

export interface UnplacedComment {
  comment: DraftComment
  reason: string
}

interface ChangedLine {
  side: "new" | "old"
  line: number
  content: string
}

// A partial quote shorter than this matches too many lines to locate anything.
const MIN_PARTIAL_ANCHOR = 6

function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, " ")
}

/**
 * Reduce the quoted code to a comparable form. Models often copy the line as
 * the diff tool printed it, so a leading "[NEW:12] +" is removed first.
 */
function normalizeAnchor(anchor: string | undefined): string {
  const firstLine = (anchor ?? "").split("\n").find(l => l.trim() !== "") ?? ""
  const prefixed = firstLine.match(/^\s*\[(?:NEW|OLD):\d+\]\s?(.*)$/)
  const code = prefixed ? prefixed[1].replace(/^[+-]/, "") : firstLine
  return normalizeCode(code)
}

function matchKind(content: string, anchor: string): "exact" | "partial" | undefined {
  const code = normalizeCode(content)
  if (code === anchor) return "exact"
  if (anchor.length >= MIN_PARTIAL_ANCHOR && code.includes(anchor)) return "partial"
  return undefined
}

function changedLines(file: ParsedFile): ChangedLine[] {
  const lines: ChangedLine[] = []
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "add" && change.newLine !== undefined) {
        lines.push({ side: "new", line: change.newLine, content: change.content })
      } else if (change.type === "del" && change.oldLine !== undefined) {
        lines.push({ side: "old", line: change.oldLine, content: change.content })
      }
    }
  }
  return lines
}

function findFile(files: ParsedFile[], path: string): ParsedFile | undefined {
  const cleaned = path.trim().replace(/^\.?\//, "")
  return files.find(f => f.path === cleaned) ??
    files.find(f => /^[ab]\//.test(cleaned) && f.path === cleaned.slice(2))
}

/** Pick the matching line closest to the one requested, preferring the same side. */
function nearest(candidates: ChangedLine[], side: "new" | "old", requested: number | undefined): ChangedLine {
  const distance = (l: ChangedLine) =>
    (l.side === side ? 0 : 1_000_000) + (requested === undefined ? 0 : Math.abs(l.line - requested))
  return candidates.reduce((best, l) => (distance(l) < distance(best) ? l : best))
}

export function placeComments(
  files: ParsedFile[],
  comments: DraftComment[],
): { placed: PlacedComment[]; unplaced: UnplacedComment[] } {
  const placed: PlacedComment[] = []
  const unplaced: UnplacedComment[] = []

  for (const comment of comments) {
    const file = findFile(files, comment.path)
    if (!file) {
      unplaced.push({ comment, reason: "the file is not changed in this pull request" })
      continue
    }

    const side = comment.old_line ? "old" : "new"
    const requested = comment.old_line || comment.line || undefined
    const anchor = normalizeAnchor(comment.anchor_text)
    const lines = changedLines(file)
    const place = (target: ChangedLine, moved: boolean) => placed.push({
      path: file.path,
      side: target.side,
      line: target.line,
      body: comment.body,
      suggestion: comment.suggestion,
      moved,
    })

    const atRequested = requested === undefined
      ? undefined
      : lines.find(l => l.side === side && l.line === requested)
    if (atRequested && (!anchor || matchKind(atRequested.content, anchor))) {
      place(atRequested, false)
      continue
    }

    if (anchor) {
      const exact = lines.filter(l => matchKind(l.content, anchor) === "exact")
      const pool = exact.length > 0 ? exact : lines.filter(l => matchKind(l.content, anchor) === "partial")
      if (pool.length > 0) {
        const target = nearest(pool, side, requested)
        place(target, target.side !== side || target.line !== requested)
        continue
      }
    }

    let reason: string
    if (requested === undefined) {
      reason = anchor ? "the quoted code is not on any changed line" : "it has no line number"
    } else if (!atRequested) {
      reason = `line ${requested} is not a line this pull request adds or deletes` +
        (anchor ? ", and the quoted code is not on any changed line" : "")
    } else {
      reason = `the quoted code does not match line ${requested} or any other changed line`
    }
    unplaced.push({ comment, reason })
  }

  return { placed, unplaced }
}

/** Render the comments that could not be placed as a section of the review summary. */
export function formatUnplacedComments(unplaced: UnplacedComment[]): string {
  if (unplaced.length === 0) return ""

  const items = unplaced.map(({ comment, reason }) => {
    const line = comment.old_line ? `old line ${comment.old_line}` : comment.line ? `line ${comment.line}` : ""
    const location = line ? `${comment.path}, ${line}` : comment.path
    const body = comment.body.trim().replace(/\n/g, "\n  ")
    const suggestion = comment.suggestion
      ? `\n\n  Suggested code:\n\n  \`\`\`\n  ${comment.suggestion.replace(/\n/g, "\n  ")}\n  \`\`\``
      : ""
    return `- **\`${location}\`** (${reason}): ${body}${suggestion}`
  })

  return [
    "",
    "### Findings not attached to a changed line",
    "",
    "These comments could not be attached to a line this pull request adds or deletes, so they are listed here instead.",
    "",
    ...items,
  ].join("\n")
}
