# Pilot consumer fixtures

These files are original MIT-licensed catalogue examples. They are static
inputs for the React, Swift and Compose language packs. This repository checks
their registry identities without installing upstream packages or running the
Wax packs.

The React `*-unsupported.tsx` files cover alternate package names, shadcn
bases and workspace aliases, and Radix umbrella imports, short exports and
namespace-member JSX. These references have no matching pilot registry
identity. The positive fixtures exercise every symbol in the corresponding
revision 1 registry.

The Radix namespace fixture uses a binding outside the registry's canonical
symbols. Wax Phase 1 can classify `<Tabs.Root>` as `Tabs` when the namespace
binding is named `Tabs` and comes from `@radix-ui/react-tabs`. The exact
collision is preserved in [the Phase 4 regression fixture](react/regressions/radix-primitives-namespace-collision.tsx).
The expected result for the two elements is zero resolved catalogue usages. [Wax Phase 1 React resolver](https://github.com/Daio-io/wax/blob/c24e3298eb0fc3dde60d56664265dd3f4870013f/engine/crates/wax-lang-react/src/extract.rs#L1378).
