import SwiftUI

@main
struct InkCastApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var hub: Hub
    @StateObject private var board: Board
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let hub = Hub()
        _hub = StateObject(wrappedValue: hub)
        _board = StateObject(wrappedValue: Board(hub: hub))
    }

    var body: some View {
        HStack(spacing: 0) {
            // The canvas is exactly 16:9 so iPad coordinates map 1:1 onto the stream frame.
            InkCanvas(board: board)
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(Color(white: 0.09))
                .overlay(Rectangle().stroke(Color(white: 0.25), lineWidth: 1))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(12)
            DeckView(board: board, hub: hub)
                .frame(width: 240)
        }
        .background(Color.black)
        .preferredColorScheme(.dark)
        .persistentSystemOverlays(.hidden)
        .defersSystemGestures(on: .all)
        .onAppear { hub.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { hub.reconnectIfNeeded() }
        }
    }
}
