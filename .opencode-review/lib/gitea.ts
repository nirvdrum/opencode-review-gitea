/**
 * Shared Gitea/Forgejo API access for the review tools.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 *   GITHUB_EVENT_PATH - Set by Gitea Actions; identifies the pull request
 *
 * Outside Gitea Actions, the pull request is named instead by:
 *   REPO_OWNER - Owner of the repository being reviewed
 *   REPO_NAME - Name of the repository being reviewed ("repo" or "owner/repo")
 *   PR_NUMBER - Number of the pull request being reviewed
 */

import { readFileSync } from "node:fs"

export interface PullContext {
  owner: string
  repo: string
  number: number
}

// Gitea names are limited to these characters. Names made only of dots are
// excluded because "." and ".." would still be resolved as path segments
// after encoding.
const NAME_PATTERN = /^(?!\.+$)[A-Za-z0-9_.-]+$/

interface ContextLabels {
  owner: string
  repo: string
  number: string
}

function checkedContext(owner: string, repo: string, rawNumber: string, labels: ContextLabels): PullContext {
  if (!NAME_PATTERN.test(owner)) {
    throw new Error(`${labels.owner} must be a repository owner (got "${owner}")`)
  }
  if (!NAME_PATTERN.test(repo)) {
    throw new Error(`${labels.repo} must be a repository name (got "${repo}")`)
  }

  const number = Number(rawNumber)
  if (!/^\d+$/.test(rawNumber) || number < 1) {
    throw new Error(`${labels.number} must be a pull request number (got "${rawNumber}")`)
  }

  return { owner, repo, number }
}

interface ActionsEvent {
  repository?: { name?: string; owner?: { login?: string; username?: string } }
  pull_request?: { number?: number }
  issue?: { number?: number; pull_request?: unknown }
}

/** Read the pull request from the event payload Gitea Actions writes for every run. */
function contextFromEvent(eventPath: string): PullContext {
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as ActionsEvent

  // A pull_request event names the pull request directly. A comment arrives
  // as an issue_comment event, where the pull request is the issue, and only
  // counts if that issue is a pull request.
  const number = event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : undefined)
  const owner = event.repository?.owner?.login ?? event.repository?.owner?.username ?? ""

  return checkedContext(owner, event.repository?.name ?? "", String(number ?? ""), {
    owner: "The event's repository owner",
    repo: "The event's repository name",
    number: "The event's pull request number (is this event for a pull request?)",
  })
}

/** Read the pull request from variables, for running the review by hand. */
function contextFromVariables(env: Record<string, string | undefined>): PullContext {
  let owner = env.REPO_OWNER?.trim() ?? ""
  let repo = env.REPO_NAME?.trim() ?? ""

  if (repo.includes("/")) {
    const [ownerPart, repoPart] = repo.split("/", 2)
    if (!owner) owner = ownerPart
    repo = repoPart
  }

  return checkedContext(owner, repo, env.PR_NUMBER?.trim() ?? "", {
    owner: "REPO_OWNER",
    repo: "REPO_NAME",
    number: "PR_NUMBER",
  })
}

/**
 * Identify the pull request under review.
 *
 * The repository and pull request come from the run itself, never from tool
 * arguments. Tool arguments are whatever the model writes, and text in a diff
 * can steer the model, so letting it choose would let a pull request point the
 * token at any repository the token can reach. In Gitea Actions they are read
 * from the event payload, so there is nothing for a workflow to configure or
 * get wrong. The variables are only for running the review by hand, where
 * there is no event.
 */
export function pullContext(env: Record<string, string | undefined> = process.env): PullContext {
  return env.GITHUB_EVENT_PATH ? contextFromEvent(env.GITHUB_EVENT_PATH) : contextFromVariables(env)
}

/** The API path of the repository under review, without the /api/v1 prefix. */
export function repoPath(ctx: PullContext): string {
  return `/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`
}

/** The API path of the pull request under review, without the /api/v1 prefix. */
export function pullPath(ctx: PullContext): string {
  return `${repoPath(ctx)}/pulls/${ctx.number}`
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/api\/v1\/?$/, "")
}

export async function giteaFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const rawUrl = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN

  if (!rawUrl) throw new Error("GITEA_SERVER_URL environment variable is required")
  if (!token) throw new Error("GITEA_TOKEN environment variable is required")

  const baseUrl = normalizeBaseUrl(rawUrl)
  const url = `${baseUrl}/api/v1${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()

    if (response.status === 403 || text.includes("required scope")) {
      throw new Error(
        `Gitea API permission error: Your token lacks required permissions.\n` +
        `Required: write:repository scope\n` +
        `Please create a new token with write:repository permission in Gitea Settings → Applications → Access Tokens\n` +
        `Original error: ${text}`
      )
    }

    if (response.status === 404) {
      throw new Error(
        `Gitea API error: 404 Not Found for ${url}\n` +
        `Possible causes:\n` +
        `  - GITEA_SERVER_URL is incorrect (current: ${rawUrl})\n` +
        `  - Repository or PR does not exist\n` +
        `  - Token does not have access to this resource\n` +
        `Response: ${text}`
      )
    }

    throw new Error(`Gitea API error: ${response.status} ${response.statusText} - ${text}`)
  }

  return response
}

export async function giteaJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await giteaFetch(endpoint, options)
  return response.json() as Promise<T>
}

export async function giteaText(endpoint: string): Promise<string> {
  const response = await giteaFetch(endpoint, { headers: { Accept: "text/plain" } })
  return response.text()
}
