import SwiftUI

struct DeckView: View {
    @ObservedObject var board: Board
    @ObservedObject var hub: Hub
    @State private var showSettings = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                section("Ink") {
                    HStack(spacing: 8) {
                        ForEach(Board.colors, id: \.self) { c in
                            Circle()
                                .fill(Color(UIColor(hex: c)))
                                .frame(width: 28, height: 28)
                                .overlay(Circle().stroke(.white, lineWidth: board.color == c ? 3 : 0).padding(-3))
                                .onTapGesture { board.color = c }
                        }
                    }
                    HStack(spacing: 8) {
                        ForEach(Board.widths.indices, id: \.self) { i in
                            DeckButton(active: board.widthIndex == i) { board.widthIndex = i } label: {
                                Capsule().frame(width: 28, height: [3, 5, 9][i])
                            }
                        }
                    }
                    DeckButton(active: board.smartShapes, tint: .purple) { board.smartShapes.toggle() } label: {
                        Label("Smart shapes", systemImage: "wand.and.stars")
                    }
                    HStack(spacing: 8) {
                        DeckButton { board.undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                        DeckButton(tint: .red) { board.clear() } label: { Label("Clear", systemImage: "trash") }
                    }
                }
                section("Scenes") {
                    if !hub.obs.connected {
                        Text(hub.isConnected ? "OBS not connected" : "Hub not connected")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(hub.obs.scenes, id: \.self) { scene in
                        DeckButton(active: scene == hub.obs.current, tint: .blue) {
                            hub.send(["t": "obs:scene", "name": scene])
                        } label: { Text(scene).lineLimit(1) }
                    }
                }
                section("Output") {
                    DeckButton(active: hub.obs.recording, tint: .red) { hub.send(["t": "obs:toggleRecord"]) } label: {
                        Label(hub.obs.recording ? "Recording" : "Record", systemImage: "record.circle")
                    }
                    DeckButton(active: hub.obs.streaming, tint: .red) { hub.send(["t": "obs:toggleStream"]) } label: {
                        Label(hub.obs.streaming ? "Live" : "Go live", systemImage: "dot.radiowaves.left.and.right")
                    }
                    DeckButton(active: hub.obs.muted, tint: .orange) { hub.send(["t": "obs:toggleMute"]) } label: {
                        Label(hub.obs.muted ? "Mic muted" : "Mic on", systemImage: hub.obs.muted ? "mic.slash" : "mic")
                    }
                }
            }
            .padding(14)
        }
        .background(Color(white: 0.11))
        .sheet(isPresented: $showSettings) { SettingsView(board: board, hub: hub) }
    }

    private var header: some View {
        HStack {
            Circle().fill(hub.isConnected ? (hub.obs.connected ? .green : .yellow) : .red).frame(width: 9, height: 9)
            Text(hub.status.label).font(.footnote).lineLimit(1)
            Spacer()
            Button { showSettings = true } label: { Image(systemName: "gearshape") }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            content()
        }
    }
}

struct DeckButton<L: View>: View {
    var active = false
    var tint: Color = .accentColor
    let action: () -> Void
    @ViewBuilder let label: () -> L

    var body: some View {
        Button(action: action) {
            label()
                .font(.callout.weight(.medium))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 10).fill(active ? tint : Color(white: 0.2)))
                .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsView: View {
    @ObservedObject var board: Board
    @ObservedObject var hub: Hub
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Auto-discover (Bonjour)", text: $hub.manualHost)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("Hub address")
                } footer: {
                    Text("Leave blank to find the Mac automatically, or enter an IP like 192.168.1.20 (port 7420 by default).")
                }
                Section {
                    Toggle("Draw with finger", isOn: $board.fingerDraws)
                } footer: {
                    Text("Off = Pencil only, so your palm and fingers never draw. Double-tap the Pencil to undo; squeeze (Pencil Pro) toggles smart shapes.")
                }
                Button("Reconnect") { hub.restart() }
            }
            .navigationTitle("Settings")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
