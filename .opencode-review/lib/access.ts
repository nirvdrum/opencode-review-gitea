/**
 * Whether the reviewer can read the pull request it was started for.
 *
 * A workflow shared across many repositories, such as a Gitea scoped workflow,
 * starts for every pull request in all of them. Which repositories are reviewed
 * is then decided by which ones the token's account can read: a repository not
 * shared with it is not reviewed. That has to be settled before the model is
 * started, since a model started without access spends tokens finding out and
 * then has nothing to review.
 */

import { giteaRequest, pullPath, repoPath, type PullContext } from "./gitea"

export type PullAccess = "readable" | "not-shared"

export async function pullAccess(ctx: PullContext): Promise<PullAccess> {
  // A wrong server URL answers 404 too, and mistaking that for a repository
  // that is not shared would quietly stop every review. Gitea answers this
  // endpoint for any account, whatever it can read, so anything but a version
  // here means the URL or the token is wrong.
  const version = await giteaRequest("/version")
  if (version.status === 401) {
    throw new Error("Gitea rejected GITEA_TOKEN. It may have expired or been revoked.")
  }
  const body = version.ok ? await version.json().catch(() => null) as { version?: unknown } | null : null
  if (typeof body?.version !== "string") {
    throw new Error(`GITEA_SERVER_URL does not point at a Gitea API: /version answered ${version.status}`)
  }

  const pull = await giteaRequest(pullPath(ctx))
  if (pull.ok) {
    return "readable"
  }
  if (pull.status !== 404) {
    throw new Error(`Gitea answered ${pull.status} for PR #${ctx.number}: ${await pull.text()}`)
  }

  // Gitea answers 404 rather than 403 for a private repository the account
  // cannot see. Only a missing repository means it was not shared. A readable
  // repository without the pull request is a broken event.
  const repo = await giteaRequest(repoPath(ctx))
  if (repo.status === 404) {
    return "not-shared"
  }
  if (repo.ok) {
    throw new Error(`${ctx.owner}/${ctx.repo} has no PR #${ctx.number}`)
  }
  throw new Error(`Gitea answered ${repo.status} for ${ctx.owner}/${ctx.repo}: ${await repo.text()}`)
}
