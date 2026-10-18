/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-review.txt"
import { giteaJson, pullContext, pullPath } from "../lib/gitea"
import { pullSnapshot } from "../lib/snapshot"
import { formatUnplacedComments, placeComments } from "../lib/placement"
import { reviewConfigNotice } from "../lib/notices"
import { recordOutcome } from "../lib/outcome"

/**
 * Gitea/Forgejo Code Review Tool
 *
 * This MCP tool allows AI agents to submit code reviews on PRs.
 * The AI generates the summary and comments, this tool just submits them.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

interface ReviewRequest {
  body: string
  event: "COMMENT" | "APPROVED" | "REQUEST_CHANGES"
  commit_id?: string
  comments?: Array<{
    path: string
    body: string
    new_position?: number
    old_position?: number
  }>
}

/**
 * Review Tag Categories and Severities
 * Used for structured review comments that can be parsed for statistics
 * 
 * Format: [CATEGORY:SEVERITY] message
 * 
 * Categories:
 *   - BUG: Logic errors, null access, race conditions
 *   - SECURITY: SQL injection, XSS, auth issues, hardcoded secrets
 *   - PERFORMANCE: N+1 queries, memory leaks, inefficient algorithms
 *   - STYLE: Naming, formatting, code organization
 *   - DOCS: Missing or incorrect documentation
 *   - TEST: Missing tests, test quality issues
 * 
 * Severities:
 *   - CRITICAL: Must fix before merge
 *   - HIGH: Should fix before merge
 *   - MEDIUM: Recommended to fix
 *   - LOW: Nice to have, optional
 */
export const REVIEW_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "STYLE", "DOCS", "TEST"] as const
export const REVIEW_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const

export type ReviewCategory = typeof REVIEW_CATEGORIES[number]
export type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

/**
 * Format a structured review tag
 */
export function formatReviewTag(category: ReviewCategory, severity: ReviewSeverity): string {
  return `**[${category}:${severity}]**`
}

/**
 * Parse a review comment to extract category and severity
 */
export function parseReviewTag(body: string): { category?: ReviewCategory; severity?: ReviewSeverity } | null {
  const match = body.match(/\*?\*?\[([A-Z]+):([A-Z]+)\]\*?\*?/)
  if (!match) return null
  
  const category = match[1] as ReviewCategory
  const severity = match[2] as ReviewSeverity
  
  if (REVIEW_CATEGORIES.includes(category) && REVIEW_SEVERITIES.includes(severity)) {
    return { category, severity }
  }
  return null
}

/**
 * Format a comment with optional suggestion block
 */
export function formatCommentBody(body: string, suggestion?: string): string {
  if (!suggestion) return body
  
  const trimmedBody = body.trimEnd()
  
  return `${trimmedBody}

\`\`\`suggestion
${suggestion}
\`\`\`
`
}

// ═══════════════════════════════════════════════════════════════
// MAIN TOOL EXPORT
// ═══════════════════════════════════════════════════════════════

export default tool({
  description: DESCRIPTION,
  args: {
    summary: tool.schema.string().describe("Review summary/report content. This is the main review body that will be displayed. AI should generate a complete, well-formatted summary including overview, key findings, file table, etc."),
    comments: tool.schema
      .array(
        tool.schema.object({
          path: tool.schema.string().describe("File path"),
          line: tool.schema.number().optional().describe("Line number in the NEW file of an added line ([NEW:X] +). Use this OR old_line, not both."),
          old_line: tool.schema.number().optional().describe("Line number in the OLD file of a deleted line ([OLD:X] -). Use this OR line, not both."),
          anchor_text: tool.schema.string().describe("The code on the line being commented on, copied exactly from the diff without the [NEW:X] or [OLD:X] prefix. Used to check the line number and to correct it if it is wrong."),
          body: tool.schema.string().describe("Comment content. Use structured tags like **[BUG:HIGH]** or **[SECURITY:CRITICAL]** for categorization."),
          suggestion: tool.schema.string().optional().describe("Optional: Suggested replacement code. Will create a one-click applicable suggestion block in Gitea."),
        }),
      )
      .optional()
      .describe("Line-level review comments, attached only to lines the pull request adds or deletes. Use 'line' for added lines, 'old_line' for deleted lines, and always include 'anchor_text'. Include 'suggestion' for auto-fix proposals. Comments that cannot be attached are listed in the summary instead."),
    approval: tool.schema
      .enum(["comment", "approve", "request_changes"])
      .optional()
      .default("comment")
      .describe("Review decision"),
  },
  async execute(args) {
    const { 
      summary, 
      comments = [], 
      approval = "comment",
    } = args

    // Map approval to Gitea event type
    const eventMap: Record<string, "COMMENT" | "APPROVED" | "REQUEST_CHANGES"> = {
      comment: "COMMENT",
      approve: "APPROVED",
      request_changes: "REQUEST_CHANGES",
    }
    const event = eventMap[approval] || "COMMENT"

    // Post against the commit the diff was read from, not whatever the head is
    // now. If the pull request moved on in the meantime, Gitea shows these
    // comments as outdated rather than attaching them to the wrong lines.
    const ctx = pullContext()
    const { headSha: commitId, files } = await pullSnapshot(ctx)

    const unescape = (text: string) => text.replace(/\\n/g, "\n").replace(/\\t/g, "\t")

    // Check every comment against the reviewed diff before posting, so that
    // inline comments only land on lines this pull request changed. The prompt
    // asks for that too, but nothing else enforces it.
    const { placed, unplaced } = placeComments(files, comments.map((c) => ({
      ...c,
      body: unescape(c.body),
      suggestion: c.suggestion === undefined ? undefined : unescape(c.suggestion),
      anchor_text: unescape(c.anchor_text),
    })))

    const processedSummary = reviewConfigNotice(files) +
      unescape(summary) +
      formatUnplacedComments(unplaced) +
      `\n\n<sub>Reviewed at commit ${commitId.slice(0, 7)}.</sub>`

    // Format review comments for API
    const reviewComments = placed.map((c) => ({
      path: c.path,
      body: formatCommentBody(c.body, c.suggestion),
      new_position: c.side === "new" ? c.line : 0,
      old_position: c.side === "old" ? c.line : 0,
    }))

    // Count suggestions
    const suggestionCount = placed.filter(c => c.suggestion).length
    const movedCount = placed.filter(c => c.moved).length

    // Create the review
    const reviewPayload: ReviewRequest = {
      body: processedSummary,
      event,
      commit_id: commitId,
      comments: reviewComments.length > 0 ? reviewComments : undefined,
    }

    await giteaJson(`${pullPath(ctx)}/reviews`, {
      method: "POST",
      body: JSON.stringify(reviewPayload),
    })
    recordOutcome("posted")

    const suggestionMsg = suggestionCount > 0 ? ` | 💡 ${suggestionCount} auto-fix` : ""
    const placementMsg = (movedCount > 0 ? ` | ${movedCount} moved to the quoted line` : "") +
      (unplaced.length > 0 ? ` | ${unplaced.length} listed in the summary instead` : "")
    return `✅ Review submitted successfully!\n\n**Decision:** ${approval} | **Inline comments:** ${placed.length}${placementMsg}${suggestionMsg}`
  },
})
