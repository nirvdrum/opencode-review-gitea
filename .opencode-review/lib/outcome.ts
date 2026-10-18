/**
 * What a review run accomplished, as recorded by the tools themselves.
 *
 * OpenCode exits successfully whenever the model stops, including when it gave
 * up because every tool call failed. The model's own account of what happened
 * is not reliable either, so the tools that finish a review append an outcome
 * to the file named by REVIEW_OUTCOME_FILE, and the run is judged by that.
 */

import { appendFileSync, readFileSync } from "node:fs"

export type ReviewOutcome =
  // A review was posted on the pull request.
  | "posted"
  // The pull request has no commits since its last review, so there was
  // nothing to post.
  | "up-to-date"

export function recordOutcome(outcome: ReviewOutcome, env: Record<string, string | undefined> = process.env): void {
  const file = env.REVIEW_OUTCOME_FILE
  if (!file) {
    return
  }

  appendFileSync(file, `${outcome}\n`)
}

export function readOutcomes(file: string): ReviewOutcome[] {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return []
  }

  return text.split("\n").filter((line): line is ReviewOutcome => line === "posted" || line === "up-to-date")
}

/** Whether a run with these outcomes did what a review run is for. */
export function runSucceeded(outcomes: ReviewOutcome[]): boolean {
  return outcomes.length > 0
}
