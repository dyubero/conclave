# Changelog

All notable changes to **conclave** are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-06-09

### Changed
- **Documentation in English.** `README.md`, `SKILL.md`, and the plugin/marketplace descriptions are now written in English for an international audience. The runtime stays bilingual (en/es, auto-detected) — output is rendered in the user's language as before.
- **Bilingual triggers.** The skill now activates on English trigger phrases (`"let's hold a conclave about…"`, `"set up a debate between models to decide…"`) in addition to the existing Spanish ones.

### Added
- `plugin.json` now declares `homepage`, `repository`, `license`, and `keywords` for a richer marketplace listing.
- This `CHANGELOG.md`.

## [1.2.2] — earlier

- "In progress" state while the conclave is still deliberating (instead of a misleading "No consensus" shown from the start).

## [1.2.1] — earlier

- "Thinking" indicators in the live view for in-flight agents.

## [1.2.0] — earlier

- Live view (`conclave-live.mjs`): a viewer that fills in in real time while the conclave debates.

## [1.1.0] — earlier

- In-depth answer + audit veto (engine); TL;DR, a11y and print (UI).

## [1.0.2] — earlier

- Capitalized the creative debater → Ali-10.
