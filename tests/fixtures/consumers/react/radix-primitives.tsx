// SPDX-License-Identifier: MIT

import { Checkbox, CheckboxIndicator } from '@radix-ui/react-checkbox'
import { Dialog, DialogContent, DialogTrigger } from '@radix-ui/react-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@radix-ui/react-tabs'

export function RadixPrimitivesPilot() {
  return (
    <>
      <Checkbox aria-label="Subscribe"><CheckboxIndicator>✓</CheckboxIndicator></Checkbox>
      <Dialog>
        <DialogTrigger>Settings</DialogTrigger>
        <DialogContent>Account settings</DialogContent>
      </Dialog>
      <Tabs defaultValue="account">
        <TabsList aria-label="Sections">
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Your account</TabsContent>
      </Tabs>
    </>
  )
}
