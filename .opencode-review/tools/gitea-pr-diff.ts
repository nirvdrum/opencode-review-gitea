/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-pr-diff.txt"
import { pullContext } from "../lib/gitea"
import { pullSnapshot } from "../lib/snapshot"
import { formatDiffForReview, parseDiff, type ParsedFile } from "../lib/diff"

/**
 * Gitea/Forgejo PR Diff Tool
 *
 * This MCP tool fetches the diff for a pull request.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

function matchPattern(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Supports: *, **, ?, [abc], [!abc]
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".")
  
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filename)
}

function filterFilesByPatterns(files: ParsedFile[], patterns: string[]): ParsedFile[] {
  if (!patterns || patterns.length === 0) {
    return files
  }
  
  return files.filter(file => 
    patterns.some(pattern => matchPattern(file.path, pattern))
  )
}

function formatAsRawDiff(files: ParsedFile[]): string {
  // Reconstruct a simplified raw diff from parsed files
  const parts: string[] = []
  
  for (const file of files) {
    parts.push(`diff --git a/${file.path} b/${file.path}`)
    
    for (const hunk of file.hunks) {
      parts.push(`@@ -${hunk.oldStart},0 +${hunk.newStart},0 @@`)
      
      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`+${change.content}`)
        } else if (change.type === "del") {
          parts.push(`-${change.content}`)
        } else {
          parts.push(` ${change.content}`)
        }
      }
    }
    parts.push("")
  }
  
  return parts.join("\n")
}

export default tool({
  description: DESCRIPTION,
  args: {
    format: tool.schema
      .enum(["raw", "parsed"])
      .optional()
      .default("parsed")
      .describe("Output format: 'raw' for unified diff, 'parsed' for line-numbered format"),
    file_patterns: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Optional glob patterns to filter files (e.g., ['*.ts', 'src/**/*.go']). Only matching files will be included in the diff."),
  },
  async execute(args) {
    const { format = "parsed", file_patterns } = args
    const ctx = pullContext()

    const { diffText, headSha } = await pullSnapshot(ctx)

    let parsed = parseDiff(diffText)
    
    // Apply file filtering if patterns provided
    if (file_patterns && file_patterns.length > 0) {
      parsed = filterFilesByPatterns(parsed, file_patterns)
    }

    if (format === "raw") {
      // For raw format with filtering, we reconstruct from parsed
      if (file_patterns && file_patterns.length > 0) {
        return formatAsRawDiff(parsed)
      }
      return diffText
    }

    const formatted = formatDiffForReview(parsed)

    const summary = parsed.map((f) => `- ${f.path} (${f.status})`).join("\n")
    
    const filterNote = file_patterns && file_patterns.length > 0 
      ? `\n**Filter:** ${file_patterns.join(", ")}\n` 
      : ""

    return `# PR #${ctx.number} Diff\n\n**Head commit:** \`${headSha.slice(0, 7)}\`\n${filterNote}\n**Files Changed:**\n${summary}\n\n---\n${formatted}`
  },
})
