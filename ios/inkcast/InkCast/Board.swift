import CoreGraphics
import Foundation

/// A point in normalized board space: x, y in 0...1 over the 16:9 frame; p = pressure 0...1.
struct InkPoint {
    var x: CGFloat
    var y: CGFloat
    var p: CGFloat

    var json: [Double] { [round4(x), round4(y), round4(p)] }
}

enum BoardShape {
    case ink([InkPoint])
    case line(CGPoint, CGPoint)
    case polygon([CGPoint])
    case ellipse(center: CGPoint, rx: CGFloat, ry: CGFloat)
}

struct BoardObject: Identifiable {
    let id: String
    var color: String
    /// Stroke width as a fraction of the frame width.
    var width: CGFloat
    var shape: BoardShape

    var json: [String: Any] {
        var o: [String: Any] = ["id": id, "color": color, "width": round4(width)]
        switch shape {
        case .ink(let pts):
            o["kind"] = "ink"; o["pts"] = pts.map(\.json)
        case .line(let a, let b):
            o["kind"] = "line"; o["pts"] = [a, b].map(pointJSON)
        case .polygon(let pts):
            o["kind"] = "poly"; o["pts"] = pts.map(pointJSON)
        case .ellipse(let c, let rx, let ry):
            o["kind"] = "ellipse"
            o["cx"] = round4(c.x); o["cy"] = round4(c.y); o["rx"] = round4(rx); o["ry"] = round4(ry)
        }
        return o
    }

    init(id: String, color: String, width: CGFloat, shape: BoardShape) {
        self.id = id; self.color = color; self.width = width; self.shape = shape
    }

    init?(json o: [String: Any]) {
        guard let id = o["id"] as? String, let kind = o["kind"] as? String else { return nil }
        let color = o["color"] as? String ?? "#FFFFFF"
        let width = CGFloat(o["width"] as? Double ?? 0.004)
        let pts = (o["pts"] as? [[Double]]) ?? []
        let cg = pts.compactMap { $0.count >= 2 ? CGPoint(x: $0[0], y: $0[1]) : nil }
        let shape: BoardShape
        switch kind {
        case "ink":
            shape = .ink(pts.compactMap { $0.count >= 2 ? InkPoint(x: $0[0], y: $0[1], p: $0.count > 2 ? $0[2] : 0.5) : nil })
        case "line" where cg.count == 2:
            shape = .line(cg[0], cg[1])
        case "poly":
            shape = .polygon(cg)
        case "ellipse":
            shape = .ellipse(
                center: CGPoint(x: o["cx"] as? Double ?? 0, y: o["cy"] as? Double ?? 0),
                rx: CGFloat(o["rx"] as? Double ?? 0), ry: CGFloat(o["ry"] as? Double ?? 0))
        default:
            return nil
        }
        self.init(id: id, color: color, width: width, shape: shape)
    }
}

/// The iPad's copy of the board, plus the tool state. Mirrors every change to the hub.
final class Board: ObservableObject {
    static let colors = ["#FFFFFF", "#FFD60A", "#FF453A", "#32D74B", "#0A84FF", "#BF5AF2"]
    static let widths: [CGFloat] = [0.0025, 0.0042, 0.0075]

    @Published var color = Board.colors[1]
    @Published var widthIndex = 1
    /// Hold the pen still at the end of a stroke to snap it into a clean shape.
    @Published var smartShapes = true
    @Published var fingerDraws: Bool = {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }()

    var width: CGFloat { Board.widths[widthIndex] }

    private(set) var objects: [BoardObject] = [] {
        didSet { onObjectsChanged?() }
    }
    var onObjectsChanged: (() -> Void)?

    let hub: Hub

    init(hub: Hub) {
        self.hub = hub
        hub.onMessage = { [weak self] msg in self?.handle(msg) }
    }

    // MARK: Strokes (called by the canvas)

    func beginStroke(id: String, first: InkPoint) {
        hub.send(["t": "stroke:begin", "id": id, "color": color, "width": round4(width), "pts": [first.json]])
    }

    func appendPoints(id: String, _ pts: [InkPoint]) {
        guard !pts.isEmpty else { return }
        hub.send(["t": "stroke:points", "id": id, "pts": pts.map(\.json)])
    }

    func endStroke(id: String, points: [InkPoint], color: String, width: CGFloat) {
        objects.append(BoardObject(id: id, color: color, width: width, shape: .ink(points)))
        hub.send(["t": "stroke:end", "id": id])
    }

    /// Replace an in-progress stroke with a recognized shape (same id, so it keeps its z-order).
    func commitShape(id: String, shape: BoardShape, color: String, width: CGFloat) {
        let obj = BoardObject(id: id, color: color, width: width, shape: shape)
        objects.append(obj)
        hub.send(["t": "object:set", "obj": obj.json])
    }

    func undo() {
        guard let last = objects.popLast() else { return }
        hub.send(["t": "object:remove", "id": last.id])
    }

    func clear() {
        objects.removeAll()
        hub.send(["t": "clear"])
    }

    // MARK: Hub messages

    private func handle(_ msg: [String: Any]) {
        guard msg["t"] as? String == "scene" else { return }
        let remote = (msg["objects"] as? [[String: Any]] ?? []).compactMap(BoardObject.init(json:))
        if remote.isEmpty && !objects.isEmpty {
            // The hub restarted; push our board back up.
            hub.send(["t": "scene:replace", "objects": objects.map(\.json)])
        } else {
            objects = remote
        }
    }
}

func round4(_ v: CGFloat) -> Double { (Double(v) * 10_000).rounded() / 10_000 }
private func pointJSON(_ p: CGPoint) -> [Double] { [round4(p.x), round4(p.y)] }
