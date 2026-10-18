/**
 * Whether the repository under review has been shared with the reviewer.
 *
 * A workflow shared across many repositories, such as a Gitea scoped workflow,
 * starts for every pull request in all of them. Which repositories are reviewed
 * is then decided by whether the token's account is a collaborator on them: a
 * repository not shared with it is not reviewed. That has to be settled before
 * the model is started, since a model started for a repository it should not
 * review would send that repository's code to the model's provider.
 *
 * Being able to read the repository is not enough. Any account can read a
 * public repository, so read access alone would review every public repository
 * the workflow covers without anyone choosing to.
 */

import { giteaRequest, repoPath, type PullContext } from "./gitea"

export type PullAccess = "shared" | "not-shared"

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

  const login = await reviewerLogin()

  // Gitea answers 204 for a collaborator and 404 otherwise. It also answers 404
  // when the account cannot see the repository at all, which for a private
  // repository is the same answer: it was not shared.
  const collaborator = await giteaRequest(`${repoPath(ctx)}/collaborators/${encodeURIComponent(login)}`)
  if (collaborator.status === 204) {
    return "shared"
  }
  if (collaborator.status === 404) {
    return "not-shared"
  }
  throw new Error(`Gitea answered ${collaborator.status} when checking whether ${login} is a collaborator on ${ctx.owner}/${ctx.repo}: ${await collaborator.text()}`)
}

/** The login of the account the token belongs to. */
async function reviewerLogin(): Promise<string> {
  const response = await giteaRequest("/user")
  if (response.status === 403) {
    throw new Error("GITEA_TOKEN cannot read its own account. Create the token with the read:user scope as well as write:issue and write:repository.")
  }
  if (!response.ok) {
    throw new Error(`Gitea answered ${response.status} for the token's account: ${await response.text()}`)
  }

  const { login } = await response.json() as { login?: unknown }
  if (typeof login !== "string" || login === "") {
    throw new Error("Gitea did not report the token's account name")
  }
  return login
}
