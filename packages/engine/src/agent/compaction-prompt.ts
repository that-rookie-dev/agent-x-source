export const COMPACTION_PROMPT = `Summarize this conversation into an anchored summary following the template below. Be concise — do NOT repeat the full history.

<template>
## Goal
- [single-sentence summary of the user's main objective]

## Progress
### Done
- [completed tasks with key outcomes, or "(none)"]
### In Progress
- [current work being done, or "(none)"]
### Blocked
- [any blockers preventing progress, or "(none)"]

## Key Decisions
- [important decisions made and why, or "(none)"]

## Next Steps
- [ordered next actions to take]

## Critical Context
- [important technical facts, errors encountered, open questions, or "(none)"]

## Relevant Files
- [file or directory paths: why each is relevant, or "(none)"]
</template>`

export const COMPACTION_UPDATE_PROMPT = `Update the anchored summary below using the conversation history above. Preserve still-true details, remove stale details, and merge in the new facts.

<previous-summary>
{previousSummary}
</previous-summary>

Follow the same template as before.

<template>
## Goal
- [updated single-sentence summary]

## Progress
### Done
- [completed tasks, or "(none)"]
### In Progress
- [current work, or "(none)"]
### Blocked
- [blockers, or "(none)"]

## Key Decisions
- [decisions, or "(none)"]

## Next Steps
- [ordered next actions]

## Critical Context
- [important facts, errors, open questions]

## Relevant Files
- [file paths: why relevant, or "(none)"]
</template>`
