# Project: Newsfeed App

## What This Is
A personalized PWA news feed app built with Next.js and TypeScript. It aggregates
content from across the internet (news, tech, science, entertainment, politics, etc.)
and learns the user's taste over time via explicit like/dislike feedback.

## Tech Stack
- Framework: Next.js (App Router) with TypeScript
- Styling: Tailwind CSS
- Deployment target: Progressive Web App (PWA)
- Package manager: npm
- Version control: GitHub
- Platform: Web (desktop browser) + installable on mobile via PWA — no app stores

## Agent Pipeline
This project is developed using a four-agent system. Each agent has a defined role
and produces structured outputs that feed the next agent. Do not skip stages.

1. **BA** (Business Analyst) — converts plain English requests into requirements docs
2. **PM** (Product Manager) — converts requirements into user stories and maintains roadmap
3. **Architect** — converts PM artifacts into technical design and task breakdown
4. **Dev** — executes individual tasks assigned by the Architect

## Shared Memory
All agents read and write to the /agents directory. This is the source of truth.
Never delete files here. Append, update, or create new versioned files only.

## Ground Rules
- Make incremental progress. Never try to complete large features in one pass.
- Leave clear artifacts at the end of every session so the next session can orient quickly.
- When in doubt about scope, do less and document the decision.
- All requirements, stories, designs, and tasks live in /agents before any code is written.
