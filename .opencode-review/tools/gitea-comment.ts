/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-comment.txt"
import { giteaFetch, pullContext, repoPath } from "../lib/gitea"

/**
 * Gitea/Forgejo Comment Tool
 *
 * This MCP tool allows AI agents to post comments on issues and PRs.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

export default tool({
  description: DESCRIPTION,
  args: {
    body: tool.schema.string().describe("Comment content (supports Markdown)"),
  },
  async execute(args) {
    const { body } = args
    const ctx = pullContext()

    await giteaFetch(`${repoPath(ctx)}/issues/${ctx.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    })

    return `✅ Comment posted successfully on #${ctx.number}`
  },
})
