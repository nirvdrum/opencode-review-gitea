/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-pr-file.txt"
import { pullContext } from "../lib/gitea"
import { pullSnapshot } from "../lib/snapshot"
import { readRepoFile } from "../lib/files"

/**
 * Gitea/Forgejo PR File Tool
 *
 * Reads a whole file from the pull request at the commit being reviewed, so
 * that the model can check code outside the diff. See lib/files.ts.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

export default tool({
  description: DESCRIPTION,
  args: {
    path: tool.schema.string().describe("Path of the file in the repository, such as app/models/user.rb"),
    start_line: tool.schema.number().int().min(1).optional().describe("First line to read (default: 1)"),
    end_line: tool.schema.number().int().min(1).optional().describe("Last line to read (default: the end of the file, at most 1000 lines from start_line)"),
  },
  async execute(args) {
    const ctx = pullContext()
    const { headSha } = await pullSnapshot(ctx)

    return readRepoFile(ctx, headSha, args.path, { start: args.start_line, end: args.end_line })
  },
})
