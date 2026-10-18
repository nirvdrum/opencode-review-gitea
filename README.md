# OpenCode Gitea Review

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/ccsert/opencode-review)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[中文文档](README_zh.md) | English

An AI-powered **automatic code review tool for Gitea/Forgejo PRs**, built on the [OpenCode](https://opencode.ai) plugin system. It listens for PR and comment events via Gitea Actions, automatically fetches code diffs, and submits structured reviews.

## About This Fork

This fork of [ccsert/opencode-review-gitea](https://github.com/ccsert/opencode-review-gitea) hardens the reviewer for unattended use, where an author model pushes fixes in response to reviews:

- **Pinned dependencies.** OpenCode, Bun, the container images, and the actions are pinned to exact versions, digests, or commit SHAs, and tool dependencies install from the lockfile only.
- **Configuration the pull request cannot change.** The review configuration comes from the image or the base branch, never from the pull request, and OpenCode runs outside the checkout so that a pull request's own `opencode.json` or `.opencode/` is not loaded.
- **Fixed target.** The tools take the repository and pull request from the Gitea Actions event payload, not from the model, so workflows do not pass them in. `REPO_OWNER`, `REPO_NAME`, and `PR_NUMBER` name the pull request only when running the review by hand.
- **Reviews pinned to the reviewed commit.** The diff and the review share one snapshot, so a push during a review cannot move its comments onto the wrong lines.
- **Comments only on changed lines.** Each comment quotes the code it is about and is checked against the diff before posting. Comments are moved to the line their quote is on, and those that match no changed line are listed in the summary instead.
- **Correct paths** for files in directories such as `lib/` and `db/`, which the diff parser used to garble.
- **Exact comment trigger**, and a notice on every review of a pull request that changes CI or review configuration.
- **A run that posts nothing fails.** OpenCode exits successfully whenever the model stops, even after every Gitea call failed. The tools record what they accomplished, and the job fails unless a review was posted or the pull request had nothing new to review.
- **Reviews only repositories shared with the reviewer.** Before starting the model, the run checks that the token's account can read the pull request. If the repository is not shared with it, the run says so and passes without contacting the model, so one workflow can serve many repositories, such as through a Gitea scoped workflow, and the reviewer's collaborator access decides which are reviewed. A wrong server URL or a rejected token fails the run instead.
- **Context beyond the diff.** The reviewer can read whole files from the pull request at the reviewed commit, so it can check code outside the diff instead of asking the author to confirm it. Its comments are still limited to changed lines.

## ✨ Features

- 🤖 **AI-Powered Code Review** - Uses Claude/GPT/DeepSeek models to analyze code changes
- 📝 **Line-Level Comments** - Provides precise feedback on specific code lines
- ✅ **Review Decisions** - Supports approve, request_changes, and comment states
- 🔄 **Auto-Trigger** - Reviews new and updated PRs, or on a `/oc` or `/opencode` comment
- � **Incremental Review** - Only reviews new changes since last review (for updated PRs)
- 🏷️ **Structured Tags** - Categorizes issues by type (BUG, SECURITY, PERFORMANCE) and severity
- �🐳 **Docker Support** - Zero-config installation with pre-built image
- 🛡️ **Isolated Configuration** - Uses `.opencode-review/` directory, won't conflict with your existing `.opencode/` setup

## 📦 Installation

Copy one of the workflow templates from a checkout of this repository you have reviewed:

- **Docker:** build the image from this repository's `Dockerfile`, push it to a registry your runner can reach, and copy `templates/workflow-docker.yaml` to `.gitea/workflows/opencode-review.yaml`, filling in the image reference and its digest.
- **Source:** copy `.opencode-review/` and `templates/workflow-source.yaml` (as `.gitea/workflows/opencode-review.yaml`) into your repository.

`install.sh` is still present, but it downloads upstream's `main` branch unpinned, so this fork does not recommend it.

## 🔄 Installation Methods Comparison

| Aspect | Docker 🐳 | Source 📦 |
|--------|----------|-----------|
| **Files added** | 1 workflow file | .opencode-review/ + workflow |
| **CI speed** | Fast (cached image) | Slower (install deps each run) |
| **Customization** | Environment variables | Full control over agents/tools |
| **Updates** | Rebuild the image and update the pinned digest | Copy the updated files |
| **Best for** | Quick setup, standard use | Custom prompts, advanced users |

## ⚙️ Configuration

### 1. Set Up Secrets

Configure the following secrets in your Gitea repository:

| Secret Name | Description |
|-------------|-------------|
| `OPENCODE_GIT_TOKEN` | Gitea API Token (requires repo permissions) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key (default model) |
| `ANTHROPIC_API_KEY` | Anthropic API Key (optional) |
| `OPENAI_API_KEY` | OpenAI API Key (optional) |

### 2. Configure Model (Optional)

Edit `.gitea/workflows/opencode-review.yaml`:

```yaml
env:
  # Format: provider/model-id
  MODEL: deepseek/deepseek-chat        # Default (requires DEEPSEEK_API_KEY)
  # MODEL: anthropic/claude-sonnet-4-5  # Requires ANTHROPIC_API_KEY
  # MODEL: openai/gpt-4o                # Requires OPENAI_API_KEY
```

### 3. Using LLM Gateways (Optional)

You can use LLM gateways like **LiteLLM**, **OpenRouter**, **Together AI**, **NVIDIA NIM**, etc. via the OpenAI-compatible API:

```yaml
env:
  # Point MODEL to an OpenAI-compatible provider
  MODEL: openai/your-model-name
  OPENAI_API_KEY: ${{ secrets.YOUR_API_KEY }}
  # Set the gateway URL
  OPENAI_BASE_URL: "https://openrouter.ai/api/v1"    # OpenRouter
  # OPENAI_BASE_URL: "http://localhost:4000/v1"        # LiteLLM
  # OPENAI_BASE_URL: "https://api.together.xyz/v1"     # Together AI
```

| Gateway | OPENAI_BASE_URL | Notes |
|---------|-----------------|-------|
| OpenRouter | `https://openrouter.ai/api/v1` | Use `OPENROUTER_API_KEY` |
| LiteLLM | `http://localhost:4000/v1` | Self-hosted proxy |
| Together AI | `https://api.together.xyz/v1` | |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | |
| Ollama (local) | `http://localhost:11434/v1` | No API key needed |

> **Note**: When using gateways, set `MODEL` to `openai/<model-name>` so opencode routes through the OpenAI-compatible provider.

### 4. Review Configuration

These options work with both Docker and Source installations:

```yaml
env:
  # Response language
  REVIEW_LANGUAGE: auto      # auto | en | zh-CN
  
  # Review depth and focus
  REVIEW_STYLE: balanced     # concise | balanced | thorough | security
  
  # File filtering (glob patterns, comma-separated)
  FILE_PATTERNS: ""          # e.g., "*.ts,*.go,src/**" (empty = all files)
```

#### Language Options

| Value | Description |
|-------|-------------|
| `auto` | Auto-detect from code comments (default) |
| `en` | Review in English |
| `zh-CN` | 使用简体中文审查 |

#### File Filtering Examples

```yaml
# Only review TypeScript files
FILE_PATTERNS: "*.ts,*.tsx"

# Only review source files (exclude tests)
FILE_PATTERNS: "src/**/*.go"

# Multiple patterns
FILE_PATTERNS: "*.py,*.js"

# Note: currently only positive matching is supported (no leading '!').
```

## 🚀 Usage

### Trigger Code Review

Comment on a PR:

```
/oc
```

or

```
/opencode
```

The comment must be exactly the command, on a pull request. Comments that merely mention it do not start a review.

### Local Testing (Docker)

```bash
docker build -t opencode-review .
docker run --rm \
  -e GITEA_TOKEN="your-token" \
  -e GITEA_SERVER_URL="https://your-gitea.example.com" \
  -e DEEPSEEK_API_KEY="your-key" \
  -e PR_NUMBER=123 \
  -e REPO_OWNER="your-org" \
  -e REPO_NAME="your-repo" \
  opencode-review
```

The image uses its built-in configuration. To try a modified one, mount it anywhere other than the reviewed checkout and point `OPENCODE_CONFIG_DIR` at it.

`REPO_NAME` can be either `repo` or `owner/repo` (entrypoint will normalize it).

> **Note**: The Docker image currently only supports **x86_64/amd64** architecture. ARM devices (Raspberry Pi, etc.) should use the [Source installation](#local-testing-source) method instead.

### Local Testing (Source)

```bash
export GITEA_TOKEN="your-token"
export GITEA_SERVER_URL="https://your-gitea.example.com"
export OPENCODE_CONFIG_DIR="$(pwd)/.opencode-review"
export REPO_OWNER="owner" REPO_NAME="repo" PR_NUMBER=123

# Run from an empty directory so OpenCode loads no project configuration.
(cd "$(mktemp -d)" && bun "$OPENCODE_CONFIG_DIR/bin/run-review.ts" "Please review PR #123 in owner/repo")
```

## 🔧 Customization (Source Installation)

### Modify Review Style

Edit `.opencode-review/agents/code-review.md`:

```markdown
---
description: AI code reviewer for Gitea/Forgejo PRs
tools:
  "*": false
  "gitea-review": true
  "gitea-pr-diff": true
---

You are a code review expert focusing on [your domain]...
```

### Add New Tools

Create a TypeScript file in `.opencode-review/tools/`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Tool description",
  args: {
    param: tool.schema.string().describe("Parameter description"),
  },
  async execute(args, context) {
    return "Result"
  },
})
```

## 📁 Project Structure

```
.
├── Dockerfile                      # Docker image definition
├── docker-compose.yaml             # Local testing
├── entrypoint.sh                   # Container entrypoint
├── install.sh                      # Installation script
├── templates/
│   ├── workflow-docker.yaml        # Docker workflow template
│   └── workflow-source.yaml        # Source workflow template
├── .github/workflows/
│   └── docker-publish.yaml         # Auto-build Docker image
└── .opencode-review/               # Isolated config directory
    ├── agents/
    │   ├── code-review.md          # Code review agent (main)
    │   └── gitea-assistant.md      # General assistant agent
    ├── tools/
    │   ├── gitea-pr-diff.ts        # Get full PR diff
    │   ├── gitea-pr-files.ts       # List changed files
    │   ├── gitea-pr-file.ts        # Read a file at the reviewed commit
    │   ├── gitea-incremental-diff.ts # Get incremental diff (new changes only)
    │   ├── gitea-review.ts         # Submit review with comments
    │   └── gitea-comment.ts        # Post comments on issues/PRs
    ├── skills/
    │   └── pr-review/SKILL.md      # Reusable review skill
    └── package.json                # Dependencies
```

> **Note**: After installation, `.gitea/workflows/opencode-review.yaml` will be created in your project.

## 🔗 Related Links

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [Gitea API Documentation](https://docs.gitea.io/en-us/api-usage/)
- [Docker Image](https://ghcr.io/ccsert/opencode-review)

## 📄 License

MIT License - See [LICENSE](LICENSE)
