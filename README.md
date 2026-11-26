# Wax public registries

This catalogue stores generated registry JSON for Wax scans. Each published
registry is pinned to an upstream release tag and commit. Find its paths,
hashes and provenance in the [catalogue index](catalog/index.json).

## shadcn/ui

The [React registry](systems/shadcn/releases/4.23.0/.wax/registries/react.json)
contains source evidence and signatures for 356 components from the Radix base at
[`shadcn@4.23.0`](https://github.com/shadcn-ui/ui/releases/tag/shadcn%404.23.0).
The [provenance](systems/shadcn/releases/4.23.0/provenance.json) records the
upstream commit. This registry covers stock `@/components/ui/<file>` imports.

It also has 39 Tailwind v4 theme tokens, such as `bg-primary` and `rounded-lg`.
The shadcn CLI generates theme CSS at init, so discovery reads the `globals.css`
block in the upstream
[manual installation guide](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/content/docs/installation/manual.mdx?plain=1#L72-L196).
That block uses the default neutral base colour. Wax `0.12` matches Tailwind
utility classes against these tokens.

Run a scan from your app with Wax and the React pack installed. Point
`--root` at your app's source directory.

```sh
wax scan --language react --root src \
  --design-system https://raw.githubusercontent.com/Daio-io/wax-registries/main/systems/shadcn/releases/4.23.0/.wax/registries/react.json
```

If you installed `public-shadcn-r1` before the correction, update its pinned
snapshot by refreshing the catalogue and reinstalling revision 1.

```sh
wax registry find shadcn
wax registry delete public-shadcn-r1
wax registry install --version 1 shadcn
```

## Neobrutalism Components

The [React registry](systems/neobrutalism/releases/d9bc689/.wax/registries/react.json)
contains source evidence and signatures for 342 components and 27 Tailwind v4
theme tokens from
[`ekmas/neobrutalism-components`](https://github.com/ekmas/neobrutalism-components).
Upstream publishes no release tags, so this release is pinned to commit
[`d9bc689`](https://github.com/ekmas/neobrutalism-components/commit/d9bc68914485a1d7761c7c48a7d10c23844e8468).
It covers stock `@/components/ui/<file>` imports installed with the shadcn CLI.
The tokens come from the `@theme inline` block in `src/styling/globals.css`.
The [catalogue index](catalog/index.json) lists the components that discovery
misses.

```sh
wax scan --language react --root src \
  --design-system https://raw.githubusercontent.com/Daio-io/wax-registries/main/systems/neobrutalism/releases/d9bc689/.wax/registries/react.json
```

To regenerate it, follow the shadcn/ui steps below with these inputs. Clone
the upstream with a full checkout and check out the pinned commit. Set
`source_root=src/components/ui`, skip `combobox.tsx` and `data-table.tsx`,
and pass `--design-system neobrutalism --name 'Neobrutalism Components'`.
Copy `src/styling/*.css` to the same path in the projection and pass
`--root src/styling`. Token evidence already uses upstream paths.

## Regenerate a registry

Use Wax CLI and React pack `0.12.0-alpha1` for this release. The projection gives
Wax one package name per file so it records the path used by shadcn consumers.
After discovery, map the reported paths back to the pinned upstream checkout.

```sh
scratch=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse --branch 'shadcn@4.23.0' \
  https://github.com/shadcn-ui/ui.git "$scratch/upstream"
source_root=apps/v4/registry/bases/radix/ui
git -C "$scratch/upstream" sparse-checkout set "$source_root"
test "$(git -C "$scratch/upstream" rev-parse HEAD)" = 96da9cc7f1aa10580a3741664e2a77c721206c00 || exit 1
WAX_HOME="$scratch/wax-home" wax language install react@0.12.0-alpha1

for source in "$scratch/upstream/$source_root/"*.tsx; do
  file=${source##*/}
  name=${file%.tsx}
  module="$scratch/projection/ui/$name"
  mkdir -p "$module"
  cp "$source" "$module/$file"
  printf '{"name":"@/components/ui/%s"}\n' "$name" > "$module/package.json"
done

docs=apps/v4/content/docs/installation/manual.mdx
git -C "$scratch/upstream" sparse-checkout add "$docs"
mkdir -p "$scratch/projection/styles"
sed -n 72,196p "$scratch/upstream/$docs" > "$scratch/projection/styles/globals.css"

WAX_HOME="$scratch/wax-home" wax registry discover \
  --repo-root "$scratch/projection" --design-system shadcn --name 'shadcn/ui' \
  --language react --root ui --root styles --dry-run > "$scratch/discovered-react.json"

python3 - "$scratch" "$source_root" <<'PY'
import json
from pathlib import Path
import sys

scratch, source_root = map(Path, sys.argv[1:])
registry = json.loads((scratch / "discovered-react.json").read_bytes())
for component in registry["components"]:
    evidence = component["details"]["source_evidence"]
    evidence["path"] = (source_root / Path(evidence["path"]).name).as_posix()
for token in registry.get("tokens", []):
    evidence = token["details"]["source_evidence"]
    evidence["path"] = "apps/v4/content/docs/installation/manual.mdx"
    evidence["start_line"] += 71
    evidence["end_line"] += 71
(scratch / "react.json").write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n")
PY
```

Publish new releases in new directories. Commit the generated registry,
definition and provenance JSON, and add the release to the index. Keep older
release directories available at their original paths.
