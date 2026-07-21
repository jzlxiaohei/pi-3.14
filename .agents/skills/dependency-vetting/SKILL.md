---
name: dependency-vetting
description: Vet third-party libraries, packages, frameworks, UI kits, agent skills, MCP servers, plugins, CLIs, SaaS tools, or other dependencies before recommending or installing them. Use when asked to recommend, compare, choose, install, add, replace, or evaluate any external dependency（选型、技术选型、引入依赖、挑库、对比库）, especially for production, team, security-sensitive, frontend, build, auth, payment, data, or long-lived project use.
---

# Dependency Vetting

## Overview

Default to mature, maintained, boring choices. Treat new or tiny projects as experimental unless there is strong official backing, unique fit, or very low blast radius.

## Workflow

1. **Classify the decision.** Identify the dependency type, project context, blast radius, and whether the user needs production reliability or exploration.
2. **Gather current evidence.** Browse or query primary sources when facts can change: official docs, GitHub, package registry, security advisories, changelog, and release notes.
3. **Score each candidate.** Use the rubric below. Prefer evidence over vibes.
4. **Compare alternatives.** Include the mainstream default and at least one credible alternative when available.
5. **Recommend conservatively.** If evidence is weak, say so and mark the candidate experimental or not recommended.
6. **State install guidance only after vetting.** Do not provide install commands for high-risk or low-confidence choices unless the user explicitly asks to experiment.

## Evidence Checklist

Collect as many as are relevant:

- Official status: official project, ecosystem-maintained, company-backed, or individual/community.
- Age and release history: first release, latest release, release cadence, semver/tag discipline.
- Maintenance: recent commits, issue response, PR activity, bus factor, maintainer count.
- Adoption: stars/forks as weak signals, package downloads, dependent packages, real companies/projects, ecosystem mentions.
- Quality: docs, examples, tests, CI, TypeScript/types, migration guides, changelog.
- Compatibility: framework versions, runtime support, bundle size, SSR/RSC/Esm/CJS, browser support.
- Security and supply chain: license, known advisories, install scripts, transitive dependencies, maintainer trust, provenance.
- Fit: whether it solves the actual job better than built-ins or established alternatives.

## Rubric

Use these labels:

- **Production default**: established, actively maintained, broad adoption, clear releases, strong docs/tests, reasonable security posture.
- **Production acceptable**: maintained and credible, but with narrower adoption or some tradeoffs. State tradeoffs.
- **Project-specific pick**: good only because of this project's constraints. Explain the constraint.
- **Experimental**: new, small, single-maintainer, no releases, limited adoption, or sparse issue history. Use only for low-risk trials.
- **Not recommended**: stale, abandoned, unclear license, weak security posture, poor fit, suspicious package, or better mainstream option exists.

Suggested scorecard:

- Maturity: 1-5
- Maintenance: 1-5
- Adoption: 1-5
- Documentation: 1-5
- Security/supply-chain risk: low/medium/high
- Fit for this use case: weak/okay/strong

## Hard Gates

Default to **not recommended** or **experimental** when any of these are true:

- No license or incompatible license.
- No release/tag history for a code dependency meant for production.
- No meaningful commits or maintainer activity in the last year, unless the project is complete and stable.
- Security-sensitive area with low adoption or unknown maintainers: auth, crypto, payments, secrets, sandboxing, database migrations, CI/CD, package publishing.
- Requires running opaque install scripts or remote code without a strong trust signal.
- README is mostly marketing and lacks usage docs, examples, or API references.
- Single-maintainer low-star project proposed as a default for team or long-lived use.

## Low-Risk Exceptions

It is acceptable to mention a young or small project when all are true:

- The user asked for experimental/community options.
- The dependency is pure docs, prompts, static templates, or read-only guidance.
- The blast radius is low and it can be removed easily.
- The answer clearly labels it as experimental and gives a safer mainstream alternative.

## Output Format

For short answers:

```text
Recommendation: use / avoid / experimental
Why: ...
Risks: ...
Better default: ...
```

For comparisons:

```text
Verdict: ...

| Candidate | Recommendation | Maturity | Maintenance | Adoption | Risk | Fit |
|---|---|---:|---:|---:|---|---|

Notes:
- ...

Install:
- Provide commands only for the recommended or explicitly experimental choices.
```

## Recommendation Discipline

- Do not over-index on stars alone. Treat stars, forks, and downloads as adoption signals, not proof of quality.
- Do not recommend a tiny project as "mature" because its README is persuasive.
- Do not hide uncertainty. If evidence is thin, say it.
- Prefer official docs and package registries over blog posts.
- For AI-provider SDKs, Lark, cloud, security, legal, financial, or medical dependencies, verify current official sources before advising.
- When the user's use case is personal/prototyping, allow more experimentation, but label it plainly.
