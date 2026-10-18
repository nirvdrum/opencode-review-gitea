/**
 * Run the review agent and fail unless it finished the review.
 *
 * Usage: bun run-review.ts <prompt>
 *
 * OpenCode exits successfully whenever the model stops, so a run in which every
 * Gitea call failed and nothing was posted would otherwise pass. The tools
 * record what they accomplished (see lib/outcome.ts), and this decides the
 * run's result from that record instead.
 *
 * OpenCode loads project configuration from its working directory up to the
 * git root, so run this from a directory the pull request does not control.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readOutcomes, runSucceeded } from "../lib/outcome"

const prompt = process.argv.slice(2).join(" ")
if (!prompt) {
  console.error("Usage: bun run-review.ts <prompt>")
  process.exit(2)
}

const outcomeDir = mkdtempSync(join(tmpdir(), "review-outcome-"))
const outcomeFile = join(outcomeDir, "outcomes")

const opencode = Bun.spawn(["opencode", "run", "--agent", "code-review", prompt], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, REVIEW_OUTCOME_FILE: outcomeFile },
})
const status = await opencode.exited
const outcomes = readOutcomes(outcomeFile)
rmSync(outcomeDir, { recursive: true, force: true })

if (status !== 0) {
  console.error(`OpenCode exited with status ${status}.`)
  process.exit(status)
}

if (!runSucceeded(outcomes)) {
  console.error("The reviewer finished without posting a review. See its output above for the reason.")
  process.exit(1)
}
