# Repository instructions

## Before editing code

Before making code changes, run `git fetch origin` and compare the local branch with its GitHub counterpart. If GitHub has new commits, incorporate them before editing. Use a fast-forward when possible and preserve local commits and uncommitted work if the branches have diverged.

When starting a new branch, create it from the freshly fetched base branch (normally `origin/main`). When working directly through the GitHub API, read the target branch’s current head and use that revision as the basis for the edit.
