import SwiftUI
import UIKit

struct InkCanvas: UIViewRepresentable {
    let board: Board
    func makeUIView(context: Context) -> InkCanvasView { InkCanvasView(board: board) }
    func updateUIView(_ view: InkCanvasView, context: Context) {}
}

/// Pencil input surface. Committed objects are rasterized into one cached image;
/// only the live stroke is redrawn per touch event.
final class InkCanvasView: UIView, UIPencilInteractionDelegate {
    private struct ActiveStroke {
        let id: String
        let color: String
        let width: CGFloat
        var points: [CGPoint] = []      // view space
        var pressures: [CGFloat] = []
        var snapped = false
    }

    private let board: Board
    private let committedView = UIImageView()
    private let liveView = LiveStrokeView()
    private var active: ActiveStroke?
    private var holdTimer: DispatchWorkItem?
    private var holdAnchor: CGPoint = .zero
    private var lastSize: CGSize = .zero
    private lazy var canvasFeedback = UICanvasFeedbackGenerator(view: self)

    /// How long the pen must stay still before a stroke snaps to a shape.
    private let holdDelay: TimeInterval = 0.45
    private let holdSlop: CGFloat = 4

    init(board: Board) {
        self.board = board
        super.init(frame: .zero)
        isMultipleTouchEnabled = false
        backgroundColor = .clear
        for v in [committedView, liveView] as [UIView] {
            v.isUserInteractionEnabled = false
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            v.frame = bounds
            addSubview(v)
        }
        let pencil = UIPencilInteraction(delegate: self)
        addInteraction(pencil)
        board.onObjectsChanged = { [weak self] in self?.renderCommitted() }
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != lastSize {
            lastSize = bounds.size
            renderCommitted()
        }
    }

    // MARK: Touches

    private func accepts(_ touch: UITouch) -> Bool {
        touch.type == .pencil || board.fingerDraws
    }

    private func pressure(_ t: UITouch) -> CGFloat {
        guard t.maximumPossibleForce > 0, t.force > 0 else { return 0.5 }
        return min(1, t.force / t.maximumPossibleForce * 2)
    }

    private func normalized(_ p: CGPoint, _ pressure: CGFloat) -> InkPoint {
        InkPoint(x: p.x / bounds.width, y: p.y / bounds.height, p: pressure)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard active == nil, let t = touches.first, accepts(t) else { return }
        let p = t.location(in: self), pr = pressure(t)
        active = ActiveStroke(id: Self.makeID(), color: board.color, width: board.width, points: [p], pressures: [pr])
        board.beginStroke(id: active!.id, first: normalized(p, pr))
        armHold(at: p)
        updateLive()
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard var stroke = active, !stroke.snapped, let t = touches.first, accepts(t) else { return }
        var batch: [InkPoint] = []
        for c in event?.coalescedTouches(for: t) ?? [t] {
            let p = c.location(in: self), pr = pressure(c)
            stroke.points.append(p)
            stroke.pressures.append(pr)
            batch.append(normalized(p, pr))
        }
        active = stroke
        board.appendPoints(id: stroke.id, batch)
        if let last = stroke.points.last, ShapeRecognizer.distance(last, holdAnchor) > holdSlop {
            armHold(at: last)
        }
        updateLive()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        finishStroke()
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        finishStroke()
    }

    private func finishStroke() {
        holdTimer?.cancel()
        guard let stroke = active else { return }
        active = nil
        if !stroke.snapped {
            let pts = zip(stroke.points, stroke.pressures).map { normalized($0, $1) }
            board.endStroke(id: stroke.id, points: pts, color: stroke.color, width: stroke.width)
        }
        updateLive()
    }

    // MARK: Hold-to-snap

    private func armHold(at p: CGPoint) {
        holdTimer?.cancel()
        holdAnchor = p
        guard board.smartShapes else { return }
        let work = DispatchWorkItem { [weak self] in self?.trySnap() }
        holdTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + holdDelay, execute: work)
    }

    private func trySnap() {
        guard var stroke = active, !stroke.snapped,
              let shape = ShapeRecognizer.recognize(stroke.points) else { return }
        stroke.snapped = true
        active = stroke
        board.commitShape(id: stroke.id, shape: normalized(shape), color: stroke.color, width: stroke.width)
        if let last = stroke.points.last { canvasFeedback.pathCompleted(at: last) } // Pencil Pro haptic
        updateLive()
    }

    private func normalized(_ s: RecognizedShape) -> BoardShape {
        let w = bounds.width, h = bounds.height
        let n = { (p: CGPoint) in CGPoint(x: p.x / w, y: p.y / h) }
        switch s {
        case .line(let a, let b): return .line(n(a), n(b))
        case .polygon(let pts): return .polygon(pts.map(n))
        case .ellipse(let c, let rx, let ry): return .ellipse(center: n(c), rx: rx / w, ry: ry / h)
        }
    }

    // MARK: Pencil gestures

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        board.undo()
    }

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if squeeze.phase == .ended { board.smartShapes.toggle() }
    }

    // MARK: Rendering

    private func updateLive() {
        if let s = active, !s.snapped {
            liveView.stroke = (s.points, s.pressures, UIColor(hex: s.color), s.width * bounds.width)
        } else {
            liveView.stroke = nil
        }
        liveView.setNeedsDisplay()
    }

    private func renderCommitted() {
        let size = bounds.size
        guard size.width > 0, size.height > 0 else { return }
        let objects = board.objects
        committedView.image = UIGraphicsImageRenderer(size: size).image { ctx in
            for o in objects { BoardRenderer.draw(o, in: ctx.cgContext, size: size) }
        }
    }

    private static func makeID() -> String {
        String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)).lowercased()
    }
}

private final class LiveStrokeView: UIView {
    var stroke: (points: [CGPoint], pressures: [CGFloat], color: UIColor, width: CGFloat)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ rect: CGRect) {
        guard let s = stroke, let ctx = UIGraphicsGetCurrentContext() else { return }
        BoardRenderer.strokeInk(s.points, s.pressures, width: s.width, color: s.color.cgColor, in: ctx)
    }
}

/// Mirrors overlay/index.html so the iPad and the stream look the same.
enum BoardRenderer {
    static func pressureFactor(_ p: CGFloat) -> CGFloat { 0.35 + 0.65 * p }

    static func draw(_ o: BoardObject, in ctx: CGContext, size: CGSize) {
        let color = UIColor(hex: o.color).cgColor
        let px = { (p: CGPoint) in CGPoint(x: p.x * size.width, y: p.y * size.height) }
        let width = o.width * size.width
        switch o.shape {
        case .ink(let pts):
            strokeInk(pts.map { px(CGPoint(x: $0.x, y: $0.y)) }, pts.map(\.p), width: width, color: color, in: ctx)
        case .line(let a, let b):
            strokeShape(width: width, color: color, in: ctx) {
                ctx.move(to: px(a)); ctx.addLine(to: px(b))
            }
        case .polygon(let pts):
            strokeShape(width: width, color: color, in: ctx) {
                ctx.addLines(between: pts.map(px)); ctx.closePath()
            }
        case .ellipse(let c, let rx, let ry):
            strokeShape(width: width, color: color, in: ctx) {
                let center = px(c), w = rx * size.width, h = ry * size.height
                ctx.addEllipse(in: CGRect(x: center.x - w, y: center.y - h, width: 2 * w, height: 2 * h))
            }
        }
    }

    private static func strokeShape(width: CGFloat, color: CGColor, in ctx: CGContext, path: () -> Void) {
        ctx.saveGState()
        ctx.setStrokeColor(color)
        ctx.setLineWidth(width * 0.8)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.beginPath()
        path()
        ctx.strokePath()
        ctx.restoreGState()
    }

    /// Midpoint quadratic smoothing with per-segment pressure width.
    static func strokeInk(_ pts: [CGPoint], _ pressures: [CGFloat], width: CGFloat, color: CGColor, in ctx: CGContext) {
        guard let first = pts.first else { return }
        ctx.saveGState()
        defer { ctx.restoreGState() }
        ctx.setStrokeColor(color)
        ctx.setFillColor(color)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        if pts.count == 1 {
            let r = width * pressureFactor(pressures[0]) / 2
            ctx.fillEllipse(in: CGRect(x: first.x - r, y: first.y - r, width: 2 * r, height: 2 * r))
            return
        }
        var from = first
        for i in 1..<pts.count {
            let isLast = i == pts.count - 1
            let to = isLast ? pts[i] : CGPoint(x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2)
            ctx.beginPath()
            ctx.move(to: from)
            ctx.addQuadCurve(to: to, control: pts[i])
            ctx.setLineWidth(width * pressureFactor((pressures[i - 1] + pressures[i]) / 2))
            ctx.strokePath()
            from = to
        }
    }
}

extension UIColor {
    convenience init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                  blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
