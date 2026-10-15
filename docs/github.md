---
title: 'Twill syntax highlighting on GitHub'
description: 'Understand GitHub rendering of Twill files, current highlighting support and practical options for sharing readable source examples.'
---

# GitHub language detection and highlighting

GitHub uses [Linguist](https://github.com/github-linguist/linguist) to classify source files and select highlighting grammars. Installing the Twill VSIX changes your editor; it does not install a grammar on GitHub.

## Highlighting now

Add these lines to the root `.gitattributes` in each repository containing Twill source, then commit and push the file:

```text
*.twill linguist-language=TypeScript
*.twillx linguist-language=TSX
```

The patterns also apply to files in subdirectories, subject to more specific attribute overrides. GitHub's [documented language overrides](https://github.com/github-linguist/linguist/blob/main/docs/overrides.md) select the existing TypeScript and TSX grammars. Their names are registered in [Linguist's language definitions](https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml).

This provides base-language highlighting without changing our extensions. Twill-specific constructs such as `defer`, `guard` and trailing-closure parameter headers use whatever the TypeScript grammar recognizes; this is not the dedicated Twill grammar. Language statistics classify these files as TypeScript (TSX belongs to that language group), rather than a new Twill language. Normal vendored, documentation and generated-file exclusions still apply.

Markdown fences do not inherit `.gitattributes`. Use `typescript` or `tsx` fences for now. A `twill` fence or `linguist-language=Twill` cannot install an unregistered language or grammar.

Check local Git attributes with:

```sh
git check-attr linguist-language -- src/main.twill src/view.twillx
```

This verifies attribute selection, not GitHub's rendered page. GitHub controls deployment and refresh timing.

## Recognition status

Twill is not registered as a separate GitHub language. The TypeScript/TSX overrides above are the supported setup today; use `typescript` or `tsx` in GitHub Markdown fences.

Official recognition requires an upstream Linguist review, sufficient public adoption and GitHub deployment. See [Linguist's language policy](https://github.com/github-linguist/linguist/blob/main/CONTRIBUTING.md#adding-a-language) for the requirements. A dedicated Twill grammar in VS Code does not change this status.
