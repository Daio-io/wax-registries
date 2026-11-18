// SPDX-License-Identifier: MIT

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'

export function ShadcnPilot() {
  return (
    <Card>
      <Badge>Current</Badge>
      <Button>Save</Button>
      <Checkbox aria-label="Remember me" />
      <Separator />
    </Card>
  )
}
