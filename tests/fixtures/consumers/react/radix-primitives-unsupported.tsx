// SPDX-License-Identifier: MIT

import { Root, Trigger } from '@radix-ui/react-dialog'
import * as TabsPrimitives from '@radix-ui/react-tabs'
import { Dialog } from 'radix-ui'

export function UnsupportedRadixImports() {
  return (
    <>
      <Root><Trigger>Short alias</Trigger></Root>
      <TabsPrimitives.Root><TabsPrimitives.Trigger value="settings">Namespace member</TabsPrimitives.Trigger></TabsPrimitives.Root>
      <Dialog.Root><Dialog.Trigger>Umbrella import</Dialog.Trigger></Dialog.Root>
    </>
  )
}
