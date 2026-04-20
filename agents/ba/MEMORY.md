# BA Agent Memory

**Maintained by**: BA Agent
**Last Updated**: 2026-04-04

This file is the index of all Business Requirements Documents produced for the
Tangent project. Update it whenever a new BRD is created or an existing
BRD's status changes.

---

## BRD Index

| ID | File | Title | Status | Milestone |
|----|------|-------|--------|-----------|
| BRD-001 | `requirements_article_feed_v1.md` | Article Feed — Core Feed View | Resolved | Milestone 1 — Core Feed |
| BRD-002 | `requirements_feedback_capture_v1.md` | Feedback Capture and Storage | Resolved | Milestone 2 — Feedback System |
| BRD-003 | `requirements_server_feedback_v1.md` | Server-Side Feedback Storage with Anonymous Device Identity | Resolved | Milestone 2.5 — Feedback Durability |
| BRD-004 | `brd_feed_personalization_v1.md` | Feed Personalization via Feedback-Driven Article Ranking | Draft | Milestone 3 — Personalized Feed |
| BRD-005 | `brd_user_auth_v1.md` | User Accounts and Authentication | Draft | Milestone 3.5 — Identity Foundation |
| BRD-006 | `brd_proactive_discovery.md` | Proactive Daily Content Discovery | Resolved | Milestone 7 — Proactive Discovery |

---

## Naming Conventions

Note: BRD-001 through BRD-003 were written before a filename convention was
established and use the `requirements_*_v1.md` pattern. BRD-004 onward uses the
`brd_*_v1.md` pattern. Both are valid; do not rename existing files.

---

## Key Decisions Recorded Across BRDs

- **Daily article cap**: 20 articles per day (configurable constant). BRD-001.
- **Once-daily feed**: No mid-day refresh. BRD-001.
- **In-app reading view**: Articles open inside the app; source link always present. BRD-001.
- **Feedback granularity**: Per article, per device. No account required. BRD-002.
- **Feedback never pruned**: Full history accumulates indefinitely. BRD-002.
- **Device identity**: Anonymous UUID v4, stored in cookie + localStorage + X-Device-ID header. BRD-003.
- **Server storage**: PostgreSQL via managed cloud provider (Neon). BRD-003.
- **localStorage as write-through cache**: Server is source of truth; localStorage is resilience fallback. BRD-003.
- **Personalization unit**: Source-level scoring derived from article-level feedback. BRD-004.
- **Personalization timing**: Pipeline time (pre-ranked batch written to disk). Architecture TBD by Architect. BRD-004.
- **Filter bubble prevention**: Fixed exploration budget per daily feed for unseen/neutral sources. BRD-004.
- **Personalization scope**: Follows the authenticated user across devices. Anonymous users retain device-scoped personalization. BRD-004 (updated), BRD-005.
- **User accounts**: Required prerequisite for cross-device personalization. Auth method TBD (open question). BRD-005.
- **Identity migration**: Existing device-level feedback is associated to the user account at first login. The `user_id` column is already nullable in the feedback table (no schema migration needed). BRD-005.
- **Proactive discovery quota**: 6 of 20 daily articles come from active web discovery; 14 from the fixed RSS/NewsAPI pipeline. Shortfall filled by fixed pipeline. Both values are configurable constants. BRD-006.
- **Discovery topic autonomy**: The topic list is not user-configurable. The system has genuine autonomy to surface content from any topic. Users influence discovery only indirectly through feedback. BRD-006.
- **Discovery quality gate**: Articles must pass specificity, source credibility, freshness, deduplication, and existing validator criteria before entering the candidate pool. Small number of high-quality results preferred over large number of borderline ones. BRD-006.
- **Discovery and personalization**: Feedback on discovery articles feeds the existing source-scoring ranker unchanged. A separate soft topic-weight layer biases (but does not eliminate) topics based on cumulative feedback. Architect determines implementation. BRD-006.
