/**
 * Notices the review always carries, whatever the model writes.
 */

import type { ParsedFile } from "./diff"

// Files that control how pull requests are built and reviewed. A pull request
// that changes them may be changing the rules of its own review, and on a
// pull_request event it may even be the version that runs.
const CONFIG_DIRECTORIES = [".gitea/", ".forgejo/", ".github/", ".opencode-review/", ".opencode/"]
const CONFIG_FILES = ["opencode.json", "opencode.jsonc"]

export function reviewConfigFiles(files: ParsedFile[]): string[] {
  return files
    .map(f => f.path)
    .filter(path => CONFIG_DIRECTORIES.some(dir => path.startsWith(dir)) || CONFIG_FILES.includes(path))
}

export function reviewConfigNotice(files: ParsedFile[]): string {
  const changed = reviewConfigFiles(files)
  if (changed.length === 0) return ""

  const list = changed.map(path => `\`${path}\``).join(", ")
  return `> **Note:** This pull request changes CI or review configuration: ${list}. ` +
    `A pull request can change how it is itself built and reviewed, so check these changes yourself ` +
    `rather than relying on this review.\n\n`
}
