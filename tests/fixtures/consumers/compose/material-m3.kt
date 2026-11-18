// SPDX-License-Identifier: MIT

package fixture.materialm3

import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun Material3Pilot() {
    Card {
        Text("Preferences")
        Button(onClick = {}) { Text("Save") }
        Checkbox(checked = false, onCheckedChange = {})
        Switch(checked = true, onCheckedChange = {})
    }
}
