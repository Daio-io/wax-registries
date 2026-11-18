# Wax public design-system catalogue

This repository publishes design-system definitions and language registries for
[Wax](https://github.com/Daio-io/wax). Start with [the catalogue index](catalog/index.json).
The catalogue is distributed through Git. Clone it with
`git clone https://github.com/Daio-io/wax-registries.git`.

Each entry names a system, a positive bundle revision and a Git subdirectory.
The definition, registries and provenance paths are relative to that directory,
and each has a SHA-256 digest. Use the commit of the catalogue snapshot when
reading those paths. A revision stays at the same path and its bytes are retained
indefinitely.

## Revision 1 pilots

| System | Language | Import coverage |
| --- | --- | --- |
| Radix Primitives | React | Canonical named exports from the Dialog, Checkbox and Tabs packages |
| Radix Themes | React | Button, Badge, Text, Checkbox and Separator from `@radix-ui/themes` |
| shadcn/ui | React | Radix-base Button, Badge, Card, Checkbox and Separator at `@/components/ui/<file>` |
| Astryx | React, Swift | React core Button, Badge, Text, Card and Avatar. Experimental Swift Button, Text, Card, Avatar and Heading from module `Astryx` |
| Material 2 | Compose | Button, Text, Card, Checkbox and Switch from `androidx.compose.material` |
| Material 3 | Compose | Button, Text, Card, Checkbox and Switch from `androidx.compose.material3` |

The pilots cover the listed components at exact source commits. Each revision's
provenance records package versions where evidenced, supported lines and gaps.
Styling and theme tokens, richer component metadata and remaining components are
outside this pilot. Radix umbrella imports, short `Root` and `Trigger` exports
and namespace-member usage remain gaps. For shadcn/ui, a matching import path
identifies the convention. A project may have edited its copied component. Other
bases and workspace aliases require separate coverage. Astryx Android has no
catalogue entry. The Lit-based Material Web and UIKit-based Material
Components for iOS are also outside catalogue coverage. Both projects are in
maintenance mode. [Material Web](https://github.com/material-components/material-web),
[Material Components for iOS](https://github.com/material-components/material-components-ios).

For a new selection, prefer the latest revision within the supported upstream
line that matches your imports. Keep existing selections pinned. Consult
per-revision provenance for deprecation or a replacement and opt in explicitly
to the Astryx React beta and experimental Swift module.

The bundle contract first landed in
[Wax Phase 1](https://github.com/Daio-io/wax/commit/c24e3298eb0fc3dde60d56664265dd3f4870013f).
The catalogue uses `0.11.0-alpha.1` as the prospective minimum release. Until a
release contains the bundle contract, use a Wax build that includes that commit.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the Node 24 validation and revision
workflow and [NOTICE](NOTICE) for upstream attribution.
