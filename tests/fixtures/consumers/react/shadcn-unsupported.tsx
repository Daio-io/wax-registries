// SPDX-License-Identifier: MIT

import { Button as BaseButton } from '@/components/base/button'
import { Button } from '@example/ui'
import { Button as WorkspaceButton } from '@workspace/ui/button'

export function UnsupportedButtonImports() {
  return (
    <>
      <BaseButton>Other base</BaseButton>
      <Button>Unrelated package</Button>
      <WorkspaceButton>Workspace alias</WorkspaceButton>
    </>
  )
}
