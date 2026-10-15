---
title: 'Twill AI assistance and official skill'
description: 'Install the official Twill AI skill, choose your agent setup and download verified instructions for syntax, tooling and application development.'
---

<script setup>
import { withBase } from 'vitepress';
</script>

# AI assistance

Give your coding agent the official **twill** skill to write, review, debug or migrate Twill applications. It teaches the language's actual syntax, TS/JS boundaries, resource ownership, performance costs, framework setup and validation workflow. It uses published features by default and asks the agent to verify support before using source prototypes.

## Install

Run from your **application root** with the open [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add swiftuijs/twill --skill twill
```

Choose your coding agent and installation scope when prompted. The CLI supports Codex, Claude Code, Cursor and other Agent Skills clients. Installing the skill supplies instructions; install the [compiler and project tools](./getting-started.md) separately.

Select an agent explicitly:

::: code-group

```sh [Codex]
npx skills add swiftuijs/twill --skill twill --agent codex
```

```sh [Claude Code]
npx skills add swiftuijs/twill --skill twill --agent claude-code
```

:::

Project installation is the default. Add `--global` if you want the skill available across projects. A project installation can be committed with your application so the team shares the instructions. Inspect installed skills with `npx skills list`; update them with `npx skills update`.

The website also supports discovery by compatible installers:

```sh
npx skills add https://twill.evecalm.com --skill twill
```

Both installation sources deliver the same official skill. You can inspect its [source on GitHub](https://github.com/swiftuijs/twill/blob/main/skills/twill/SKILL.md).

## Manual installation

<a :href="withBase('/skills/twill/SKILL.md')" download="SKILL.md">Download the official SKILL.md</a> and place it in a skill directory recognized by your agent. The skill is self-contained; no scripts or extra references need to be copied.

| Agent       | Project path                    | User-wide path                    |
| ----------- | ------------------------------- | --------------------------------- |
| Codex       | `.agents/skills/twill/SKILL.md` | `~/.agents/skills/twill/SKILL.md` |
| Claude Code | `.claude/skills/twill/SKILL.md` | `~/.claude/skills/twill/SKILL.md` |

Restart or reload the agent session if it does not discover the new skill. Other clients may use different skill directories or activation controls; follow their documentation.

## Use it in a task

Ask the agent to use the skill explicitly, or let a supporting client select it for Twill work. For example:

> Use the twill skill. Migrate `src/readDocument.ts` to `.twill`, keeping its public API and existing imports working. Use guard for the missing-resource path and defer for owned cleanup. Preserve asynchronous error behavior, then run the project checker and relevant tests.

For a review:

> Use the twill skill to review this module's nullish behavior, cleanup lifetime, switch exhaustiveness and generated-code costs. Check it with the installed toolchain and explain any failing cases.

The skill helps the agent choose a suitable syntax and verify its result. Your application's requirements, local instructions and tests still guide the work. A build or playground result does not replace `twill check`, and installing a skill does not make an unreleased language feature available.

## Keep project expectations visible

You can add a small reminder to your application's `AGENTS.md`:

```md
For .twill/.twillx work, use the installed twill skill.
Use the project's installed Twill toolchain and distinguish released syntax from source prototypes.
Run twill check and relevant application tests before completing language changes.
```

The Twill repository maintains the skill alongside its language and tooling contracts. Update your installed copy when you update the toolchain. See [getting started](./getting-started.md), [practical patterns](./patterns.md) and [compatibility](./readiness.md) for the full application guides.
