---
name: ev-release
description: |
  Releases a new version of sowel-recipe-ev-charge-smart. Use when the user asks to "release", "tag", "publish" the recipe, or says "créer une release", "publier", "tagger".
  Version bump via PR, tag on main, GitHub release with the tarball, then the registry hash bump in the core repo (spec 089).
disable-model-invocation: true
argument-hint: "<version> (e.g. 0.2.0)"
---

# sowel-recipe-ev-charge-smart — release workflow

Release version: $ARGUMENTS

Main is protected (PR required, linear history). A release is a **PR merge followed by a tag on main**.

## Step 1: Version

Semver, from `$ARGUMENTS`; if absent, read `package.json`, suggest the next minor, ask to confirm.

## Step 2: Pre-flight

```bash
git checkout main && git pull
git status --porcelain      # must be empty
npm run validate
```

## Step 3: Release PR

```bash
git checkout -b release/v<version>
# Bump "version" in package.json AND manifest.json (release.yml refuses a mismatch)
# Add a `## v<version>` entry to CHANGELOG.md (what changed, for whom)
git add package.json package-lock.json manifest.json CHANGELOG.md
git commit -m "release: v<version>"
git push -u origin release/v<version>
gh pr create --title "release: v<version>" --body "Version bump for v<version>"
```

Present the PR and **wait for explicit approval before merging**.

## Step 4: Tag on main

```bash
git checkout main && git pull
git log -1                       # must be "release: v<version>"
git tag v<version> && git push origin v<version>
gh run watch                     # release.yml builds and publishes the tarball
```

## Step 5: Registry hash in the core (MANDATORY — spec 089)

Installs of the new version fail with `ChecksumMismatchError` until the registry in `mchacher/sowel` carries the new SHA256:

```bash
cd ../sowel && git checkout main && git pull
node scripts/backfill-registry-sha256.mjs
bash scripts/check-registry-bump.sh
git checkout -b chore/registry-ev-charge-smart-<version>
git add plugins/registry.json
git commit -m "chore(registry): bump ev-charge-smart to <version>"
git push -u origin chore/registry-ev-charge-smart-<version>
gh pr create --title "chore(registry): bump ev-charge-smart to <version>" --body "Registry hash for sowel-recipe-ev-charge-smart v<version>"
```

If the recipe is not yet in the registry (first release), add its entry (`type: "recipe"`) with `owner` and `sha256`, see the core's `CLAUDE.md`, "Plugin supply chain security". Until it is, install it through a personal source (spec 136).
