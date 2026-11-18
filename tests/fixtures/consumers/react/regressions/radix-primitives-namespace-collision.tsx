// SPDX-License-Identifier: MIT

import * as Tabs from '@radix-ui/react-tabs'

export function RadixNamespaceCollision() {
  return (
    <Tabs.Root>
      <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
    </Tabs.Root>
  )
}
