# Appilot

> AI-powered operations center for OPC indie developers — manage your app's dev progress, promotion, downloads, feedback, and costs in one place.

## Status

**Pre-development / Design Phase** — See [design docs](docs/README.md).

## Vision

1. **Self-use** — Solve OPC operations fragmentation (dev + promotion + tracking + costs)
2. **Open Source** — Community-driven plugin ecosystem
3. **Commercial** — Paid model when mature

## What It Does

- **AI reads your repo** (local or GitHub) to understand your product
- **Generates promotion plans and platform-adapted content** (Twitter/X, Reddit, Discord, YouTube)
- **Tracks interactions and downloads** (API or URL backfill, with manual fallback)
- **Operations dashboard** — dev progress, promotion status, costs, and ROI in one view

## Tech Stack

- **Framework:** Flutter (Desktop: macOS + Windows)
- **Architecture:** Hub-and-Spoke (Dart-native plugin interfaces)
- **Data:** SQLite (drift) + System Keychain/Credential Manager
- **AI:** OpenAI-compatible API (supports Ollama/LM Studio local models)

## MVP Platforms

Twitter/X · Reddit · Discord · YouTube
