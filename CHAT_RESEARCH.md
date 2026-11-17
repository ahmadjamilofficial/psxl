# WAB chat redesign research

## Product patterns applied

- **Project-scoped conversation history:** Claude describes projects as self-contained workspaces with their own chat histories, knowledge, and instructions. WAB keeps the same mental model for financial threads, but puts the thread switcher inside the active chat instead of in a persistent second sidebar.
- **Fast start and low cold-start friction:** Claude emphasizes quick access to curated context. WAB now opens a fresh conversation when the user enters `/app/parser`, while preserving an existing thread when the user explicitly opens its URL.
- **Work alongside the conversation:** Claude's Artifacts model uses a dedicated adjacent workspace for outputs. WAB keeps financial actions and tool results inline for now, with compact activity cards that do not interrupt the transcript.
- **Recoverable work:** Claude supports revisiting and iterating on prior chats. WAB keeps durable thread history, drafts, retryable errors, and a compact in-page switcher with search and delete actions.

## Sources

- [1] https://www.anthropic.com/news/projects "Collaborate with Claude on Projects"
- [2] https://support.claude.com/en/articles/9517075-what-are-projects "What are projects?"
- [3] https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them "What are artifacts and how do I use them?"

## WAB-specific reliability decisions

- Greetings are answered locally and deterministically so a provider outage cannot break a basic first interaction.
- Provider-backed requests still use the existing probe, cascade, and failover path.
- The UI should not show a second chat sidebar; the active conversation controls its own thread selection and creation.
