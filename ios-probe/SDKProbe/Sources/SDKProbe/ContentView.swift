import SwiftUI

struct ContentView: View {
    @AppStorage("count") private var count = 0
    @AppStorage("note") private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Count: \(count)")
                .accessibilityIdentifier("counter-value")
            Button("Increment") {
                if count < Int.max {
                    count += 1
                }
            }
            .accessibilityIdentifier("increment")
            TextField("Enter a note", text: $note)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("note")
        }
        .padding()
    }
}
