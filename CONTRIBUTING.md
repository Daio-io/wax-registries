# Contributing to the catalogue

Use Git and Node 24. Run the checks from a clone.

```sh
npm ci
npm test
npm run generate -- --check
npm run validate -- --base origin/main
git diff --check
```

Generation and validation run from evidence checked in with the catalogue.
After dependency installation they work offline, including on a machine without
Wax, upstream packages or an upstream build toolchain.

## Prepare a revision

1. Pick the upstream commit and record the package coordinates, import paths,
   release lines and upstream channel in `sources/<id>.json`. Record a
   package version only when pinned source evidence supports it. A commit
   pilot documents that commit's source coverage.
2. Preserve the raw evidence files under
   `sources/evidence/<id>/<upstream-commit>/` at their original paths. Update
   the manifest's file allowlist and SHA-256 digests. Include the upstream
   license and notices with the evidence. Curate exact public components with
   their declaration paths, import names and documentation links. Record
   uncovered components, token gaps and any experimental or deprecated surface.
   For React packages, include the upstream `package.json` and public entrypoint.
   If the package points to compiled files, record the corresponding source
   entrypoint. The shadcn pilot pins the original Radix-base files directly.
3. Run `npm run generate -- --source <id> --revision <n>` with the next
   integer revision for that system. A correction to metadata, provenance or
   curation also creates a revision. All languages for a system move together.
   Identical inputs and output do not need a new revision.
4. Review the index and generated changes, run the checks above and open a
   pull request with the upstream evidence and the reason for the revision.

Keep every previous index entry, revision tree and its evidence byte for byte.
Recommend a newer compatible revision or document deprecation in a new revision.
If an upstream change removes support for an existing release line, document
the new line and keep the older revision available by its original Git path.
Bundle revisions are independent of upstream versions and Wax versions.

The generator's Git commit and checksums are part of provenance. When updating
the generator, commit the tooling before generating any new revision. Merge
using a GitHub merge commit to keep every referenced generator commit in the
default branch history. Clone with full history for provenance verification.
When changing generated output, retain the recipe used by existing revisions
so validation can still reproduce their historical bytes.

The schemas are exact copies from the Wax commit named in
`schemas/wax-contract-pin.json`. A schema upgrade goes through its own review
with new upstream hashes and a compatible minimum engine version. PR validation
uses a read-only token and has no automatic merge step.
