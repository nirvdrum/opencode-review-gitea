/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-incremental-diff.txt"
import { giteaJson, giteaText, pullContext, pullPath, repoPath } from "../lib/gitea"
import { pullSnapshot } from "../lib/snapshot"
import { formatDiffForReview, parseDiff } from "../lib/diff"

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

    // 1. Pin the head commit, so that the review is posted against the commit
    //    this diff describes.
    const snapshot = await pullSnapshot(ctx)
    
    // 2. Get all commits in the PR, up to the pinned head. Anything pushed after
    //    the snapshot belongs to the next review.
    const allCommits = await giteaJson<Commit[]>(`${pullPath(ctx)}/commits`)
    const headIndex = allCommits.findIndex(c => c.sha === snapshot.headSha)
    const commits = headIndex === -1 ? allCommits : allCommits.slice(0, headIndex + 1)

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
      diffText = snapshot.diffText
    } else if (newCommits.length === 0) {
      // No new commits
      return `✅ **No New Changes**\n\nThe PR has not been updated since the last review (commit \`${lastReviewedCommit.slice(0, 7)}\`).\n\nNo review needed.`
    } else if (newCommits.length === commits.length) {
      // All commits are "new" - likely rebased
      statusMessage = `⚠️ **Rebase Detected** - PR appears to have been rebased.\n\nShowing full PR diff for complete re-review.\n\n`
      diffText = snapshot.diffText
    } else {
      // Incremental review
      const newCommitShas = newCommits.map(c => c.sha.slice(0, 7)).join(", ")
      statusMessage = `🔄 **Incremental Review**\n\n` +
        `- Last reviewed: \`${lastReviewedCommit.slice(0, 7)}\`\n` +
        `- New commits (${newCommits.length}): ${newCommitShas}\n` +
        `- Current HEAD: \`${snapshot.headSha.slice(0, 7)}\`\n\n`
      
      // Try to get incremental diff using compare
      try {
        diffText = await giteaText(`${repoPath(ctx)}/compare/${lastReviewedCommit}...${snapshot.headSha}.diff`)
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
