// SPDX-License-Identifier: MIT

import { Badge, Button, Checkbox, Separator, Text } from '@radix-ui/themes'

export function RadixThemesPilot() {
  return (
    <>
      <Badge>Current</Badge>
      <Button>Save</Button>
      <Checkbox aria-label="Remember me" />
      <Separator />
      <Text>Saved preferences</Text>
    </>
  )
}
