# Wax public registries

This catalogue stores generated registry JSON for Wax scans. Each published
registry is pinned to an upstream release tag and commit. Find its paths,
hashes and provenance in the [catalogue index](catalog/index.json).

## shadcn/ui

The [React registry](systems/shadcn/releases/4.23.0/.wax/registries/react.json)
contains 353 components from the Radix base at
[`shadcn@4.23.0`](https://github.com/shadcn-ui/ui/releases/tag/shadcn%404.23.0).
The [provenance](systems/shadcn/releases/4.23.0/provenance.json) records the
upstream commit. This registry covers stock `@/components/ui/<file>` imports.

Run a scan from your app with Wax and the React pack installed. Point
`--root` at your app's source directory.

```sh
wax scan --language react --root src \
  --design-system https://raw.githubusercontent.com/Daio-io/wax-registries/main/systems/shadcn/releases/4.23.0/.wax/registries/react.json
```

## Regenerate a registry

Use Wax CLI and React pack `0.10.2-alpha.1` for this release. Work in a
temporary directory. The projection gives Wax one package name per file so
it records the path used by shadcn consumers.

```sh
scratch=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse --branch 'shadcn@4.23.0' \
  https://github.com/shadcn-ui/ui.git "$scratch/upstream"
source_root=apps/v4/registry/bases/radix/ui
git -C "$scratch/upstream" sparse-checkout set "$source_root"
test "$(git -C "$scratch/upstream" rev-parse HEAD)" = 96da9cc7f1aa10580a3741664e2a77c721206c00 || exit 1
WAX_HOME="$scratch/wax-home" wax language install react@0.10.2-alpha.1

for source in "$scratch/upstream/$source_root/"*.tsx; do
  file=${source##*/}
  name=${file%.tsx}
  module="$scratch/projection/ui/$name"
  mkdir -p "$module"
  cp "$source" "$module/$file"
  printf '{"name":"@/components/ui/%s"}\n' "$name" > "$module/package.json"
done

WAX_HOME="$scratch/wax-home" wax registry discover \
  --repo-root "$scratch/projection" --design-system shadcn --name 'shadcn/ui' \
  --language react --root ui --force --dry-run > "$scratch/react.json"
```

Publish new releases in new directories. Commit the generated registry,
definition and provenance JSON, and add the release to the index. Keep older
release directories available at their original paths.
