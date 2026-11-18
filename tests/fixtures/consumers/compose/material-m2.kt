// SPDX-License-Identifier: MIT

package fixture.materialm2

import androidx.compose.material.Button
import androidx.compose.material.Card
import androidx.compose.material.Checkbox
import androidx.compose.material.Switch
import androidx.compose.material.Text
import androidx.compose.runtime.Composable

@Composable
fun Material2Pilot() {
    Card {
        Text("Preferences")
        Button(onClick = {}) { Text("Save") }
        Checkbox(checked = false, onCheckedChange = {})
        Switch(checked = true, onCheckedChange = {})
    }
}
