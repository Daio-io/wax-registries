// SPDX-License-Identifier: MIT

import Astryx
import SwiftUI

struct AstryxSwiftPilot: View {
    var body: some View {
        Astryx.Card {
            Astryx.Heading("Preferences", level: .h1)
            Astryx.Text("Choose what to save")
            Astryx.Avatar("Example Person")
            Astryx.Button(label: "Save")
        }
    }
}
