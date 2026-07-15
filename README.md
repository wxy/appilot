# Appilot

> AI-powered promotion tool for indie developers — connect your GitHub repo, let AI generate platform-adapted content, publish and track results.

## Status

**Design Phase / Pre-development** — See [design docs](docs/README.md).  
**Current focus: Phase 0 minimal MVP** — validate the core hypothesis: "AI-generated promotion content from code is better/faster than writing it yourself."

## Phase 0 Minimal MVP

1. **Connect a GitHub public repo** → AI reads README, code structure, recent commits
2. **AI generates a tweet** → tailored to your project's features and tech stack
3. **One-click Twitter Web Intent** → opens browser with pre-filled content, you click send
4. **Paste the tweet URL back** → manually enter views/likes/comments
5. **See a trend chart** → track engagement over time

**What Phase 0 does NOT include** (coming in later phases): multi-repo, local/private repos, OAuth auto-publishing, Reddit/Discord/YouTube, inbox, operations dashboard, multi-project, i18n, system tray.

## Full Vision (Phase 0–5)

1. **Self-use** — Solve OPC operations fragmentation (dev + promotion + tracking + costs)
2. **Open Source** — Community-driven plugin ecosystem
3. **Commercial** — Paid model when mature

## Full Feature Set (Post Phase 5)

- **AI reads your repo** (local or GitHub, multi-repo) to understand your product
- **Generates promotion plans and platform-adapted content** (Twitter/X, Reddit, Discord, YouTube)
- **Tracks interactions and downloads** (API or URL backfill, with manual fallback)
- **Operations dashboard** — dev progress, promotion status, costs, and ROI in one view

## Tech Stack

- **Desktop:** Electron + React + TypeScript (macOS + Windows)
- **UI:** Tailwind CSS + shadcn/ui (暗色模式)
- **State:** Zustand
- **Engine:** Pure TypeScript package (zero Electron dependency, reusable for future mobile PWA / cloud server)
- **Data:** better-sqlite3 + drizzle-orm (SQLite)
- **Git:** simple-git + @octokit/rest (GitHub API)
- **AI:** OpenAI-compatible API (openai npm SDK)
- **Security (Phase 1+):** electron-store + safeStorage (macOS Keychain / Windows DPAPI)

## MVP Platforms (Phase 1+)

Twitter/X · Reddit · Discord · YouTube
