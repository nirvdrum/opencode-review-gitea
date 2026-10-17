/**
 * A fixed view of the pull request under review.
 *
 * The diff the model reads and the commit the review is posted against have to
 * be the same commit. If the pull request is updated while the model is
 * working, which is routine when an author responds to reviews automatically,
 * line numbers from the old diff posted against the new head land on the wrong
 * lines. Every tool therefore works from one snapshot taken the first time any
 * of them asks.
 */

import { giteaJson, giteaText, pullContext, pullPath, type PullContext } from "./gitea"
import { parseDiff, type ParsedFile } from "./diff"

export interface PullSnapshot {
  key: string
  headSha: string
  diffText: string
  files: ParsedFile[]
}

// OpenCode loads each tool as its own module, so module-level state is not
// guaranteed to be shared between them. A registered symbol on globalThis is.
const SNAPSHOT_KEY = Symbol.for("opencode-review.pull-snapshot")
const MAX_ATTEMPTS = 3

type SnapshotStore = { [SNAPSHOT_KEY]?: PullSnapshot }

async function fetchHeadSha(ctx: PullContext): Promise<string> {
  const pr = await giteaJson<{ head?: { sha?: string } }>(pullPath(ctx))
  const sha = pr.head?.sha
  if (!sha) throw new Error(`Gitea did not report a head commit for PR #${ctx.number}`)
  return sha
}

export async function pullSnapshot(ctx: PullContext = pullContext()): Promise<PullSnapshot> {
  const store = globalThis as SnapshotStore
  const key = `${ctx.owner}/${ctx.repo}#${ctx.number}`
  const cached = store[SNAPSHOT_KEY]
  if (cached?.key === key) return cached

  // The diff endpoint has no way to ask for a specific commit, so read the head
  // on both sides of it and only accept the diff if the head did not move.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await fetchHeadSha(ctx)
    const diffText = await giteaText(`${pullPath(ctx)}.diff`)
    const after = await fetchHeadSha(ctx)

    if (before === after) {
      const snapshot = { key, headSha: after, diffText, files: parseDiff(diffText) }
      store[SNAPSHOT_KEY] = snapshot
      return snapshot
    }
  }

  throw new Error(`PR #${ctx.number} kept changing while its diff was fetched. Try the review again.`)
}

/** Forget the snapshot. Only tests should need this. */
export function clearPullSnapshot(): void {
  delete (globalThis as SnapshotStore)[SNAPSHOT_KEY]
}
