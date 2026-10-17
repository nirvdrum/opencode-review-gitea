/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-incremental-diff.txt"
import { giteaJson, giteaText, pullContext, pullPath, repoPath } from "../lib/gitea"

/**
 * Gitea/Forgejo Incremental PR Diff Tool
 *
 * This MCP tool fetches only the incremental diff for a pull request,
 * showing changes since the last review.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

interface Commit {
  sha: string
  created: string
  commit: {
    message: string
    author: {
      date: string
    }
  }
}

interface Review {
  id: number
  user: {
    login: string
  }
  commit_id: string
  submitted_at: string
  state: string
}

interface PRInfo {
  head: {
    sha: string
  }
  base: {
    sha: string
  }
  merged: boolean
}

// Identify bot reviews by checking for our review marker
const BOT_REVIEW_MARKER = "<!-- opencode-review -->"

function isBotReview(review: Review): boolean {
  // Check if review was made by a bot-like user or contains our marker
  // Since we can't easily identify our own reviews, we look for any APPROVED or REQUEST_CHANGES
  // reviews that have a commit_id
  return Boolean(review.commit_id && review.commit_id.length > 0 && 
         (review.state === "APPROVED" || review.state === "REQUEST_CHANGES" || review.state === "COMMENT"))
}

function findLastReviewedCommit(reviews: Review[], commits: Commit[]): string | null {
  if (!reviews || reviews.length === 0) return null
  
  // Get commit SHAs in order
  const commitShas = new Set(commits.map(c => c.sha))
  
  // Find the most recent review with a valid commit_id
  const validReviews = reviews
    .filter(r => r.commit_id && commitShas.has(r.commit_id))
    .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
  
  return validReviews.length > 0 ? validReviews[0].commit_id : null
}

function findCommitsAfter(commits: Commit[], afterSha: string | null): Commit[] {
  if (!afterSha) return commits
  
  const afterIndex = commits.findIndex(c => c.sha === afterSha)
  if (afterIndex === -1) {
    // Commit not found - likely rebased, return all
    return commits
  }
  
  // Return commits after the found one (commits are usually in chronological order)
  return commits.slice(afterIndex + 1)
}

interface ParsedChange {
  type: "add" | "del" | "normal"
  content: string
  oldLine?: number
  newLine?: number
}

interface ParsedHunk {
  oldStart: number
  newStart: number
  changes: ParsedChange[]
}

interface ParsedFile {
  path: string
  status: string
  hunks: ParsedHunk[]
}

function parseDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const lines = diffText.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("diff --git")) {
      const pathMatch = line.match(/b\/(.+)$/)
      const path = pathMatch ? pathMatch[1] : "unknown"

      let status = "modified"
      while (i < lines.length && !lines[i].startsWith("@@")) {
        if (lines[i].startsWith("new file")) status = "added"
        else if (lines[i].startsWith("deleted file")) status = "deleted"
        else if (lines[i].startsWith("rename")) status = "renamed"
        i++
      }

      const hunks: ParsedHunk[] = []

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

function formatDiffForReview(files: ParsedFile[]): string {
  const parts: string[] = []

  for (const file of files) {
    parts.push(`\n## ${file.path} (${file.status})\n`)

    for (const hunk of file.hunks) {
      parts.push(`@@ starting at line ${hunk.newStart} (old: ${hunk.oldStart}) @@`)

      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`[NEW:${change.newLine}] +${change.content}`)
        } else if (change.type === "del") {
          parts.push(`[OLD:${change.oldLine}] -${change.content}`)
        } else {
          parts.push(`[NEW:${change.newLine}]  ${change.content}`)
        }
      }
      parts.push("")
    }
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
  },
  async execute(args) {
    const { format = "parsed" } = args
    const ctx = pullContext()

    // 1. Get PR info
    const pr = await giteaJson<PRInfo>(`${pullPath(ctx)}`)
    
    // 2. Get all commits in the PR
    const commits = await giteaJson<Commit[]>(`${pullPath(ctx)}/commits`)
    
    // 3. Get all reviews
    const reviews = await giteaJson<Review[]>(`${pullPath(ctx)}/reviews`)
    
    // 4. Find last reviewed commit
    const lastReviewedCommit = findLastReviewedCommit(reviews, commits)
    
    // 5. Determine new commits
    const newCommits = findCommitsAfter(commits, lastReviewedCommit)
    
    // Build status message
    let statusMessage = ""
    let diffText = ""
    
    if (!lastReviewedCommit) {
      // First review - get full diff
      statusMessage = "📋 **First Review** - Showing full PR diff\n"
      diffText = await giteaText(`${pullPath(ctx)}.diff`)
    } else if (newCommits.length === 0) {
      // No new commits
      return `✅ **No New Changes**\n\nThe PR has not been updated since the last review (commit \`${lastReviewedCommit.slice(0, 7)}\`).\n\nNo review needed.`
    } else if (newCommits.length === commits.length) {
      // All commits are "new" - likely rebased
      statusMessage = `⚠️ **Rebase Detected** - PR appears to have been rebased.\n\nShowing full PR diff for complete re-review.\n\n`
      diffText = await giteaText(`${pullPath(ctx)}.diff`)
    } else {
      // Incremental review
      const newCommitShas = newCommits.map(c => c.sha.slice(0, 7)).join(", ")
      statusMessage = `🔄 **Incremental Review**\n\n` +
        `- Last reviewed: \`${lastReviewedCommit.slice(0, 7)}\`\n` +
        `- New commits (${newCommits.length}): ${newCommitShas}\n` +
        `- Current HEAD: \`${pr.head.sha.slice(0, 7)}\`\n\n`
      
      // Try to get incremental diff using compare
      try {
        diffText = await giteaText(`${repoPath(ctx)}/compare/${lastReviewedCommit}...${pr.head.sha}.diff`)
      } catch (error) {
        // Fallback: get individual commit diffs
        statusMessage += `> Note: Using individual commit diffs as fallback\n\n`
        const diffs: string[] = []
        for (const commit of newCommits) {
          try {
            const commitDiff = await giteaText(`${repoPath(ctx)}/git/commits/${commit.sha}.diff`)
            diffs.push(commitDiff)
          } catch {
            // Skip if commit diff not available
          }
        }
        diffText = diffs.join("\n")
      }
    }
    
    if (!diffText || diffText.trim() === "") {
      return `${statusMessage}⚠️ No diff content available.`
    }
    
    const parsed = parseDiff(diffText)
    
    if (format === "raw") {
      return `${statusMessage}---\n\n${diffText}`
    }
    
    const formatted = formatDiffForReview(parsed)
    const summary = parsed.map((f) => `- ${f.path} (${f.status})`).join("\n")
    
    return `# PR #${ctx.number} Incremental Diff\n\n${statusMessage}**Files Changed:**\n${summary}\n\n---\n${formatted}`
  },
})
