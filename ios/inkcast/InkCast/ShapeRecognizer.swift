import CoreGraphics

enum RecognizedShape: Equatable {
    case line(CGPoint, CGPoint)
    case polygon([CGPoint])
    case ellipse(center: CGPoint, rx: CGFloat, ry: CGFloat)
}

/// Geometric shape snapping for single strokes, in view (isotropic) coordinates.
/// Deterministic and instant, which matters live. Returns nil to keep the stroke as ink.
enum ShapeRecognizer {
    static func recognize(_ raw: [CGPoint]) -> RecognizedShape? {
        let pts = resample(raw, spacing: 3)
        guard pts.count >= 5 else { return nil }
        let length = pathLength(pts)
        let box = boundingBox(pts)
        let diag = hypot(box.width, box.height)
        guard length > 24, diag > 16 else { return nil }
        let start = pts[0], end = pts[pts.count - 1]
        let chord = distance(start, end)

        // Straight line: endpoints far apart and nothing strays far from the chord.
        let maxDeviation = pts.map { perpendicularDistance($0, start, end) }.max() ?? 0
        if chord > 0.85 * length && maxDeviation < max(0.06 * chord, 5) {
            return snapLine(start, end)
        }

        // Everything else must be a closed loop.
        guard chord < max(0.25 * diag, 18) else { return nil }

        let corners = cornerPoints(pts, diag: diag)
        if corners.count == 3 { return .polygon(corners) }
        if corners.count == 4 { return .polygon(squareUp(corners)) }

        if ellipseDeviation(pts, box) < 0.14 {
            var rx = box.width / 2, ry = box.height / 2
            if abs(rx - ry) / max(rx, ry) < 0.12 { rx = (rx + ry) / 2; ry = rx } // near-circle → circle
            return .ellipse(center: CGPoint(x: box.midX, y: box.midY), rx: rx, ry: ry)
        }
        return nil
    }

    // MARK: Shape cleanup

    /// Snap near-horizontal / near-vertical lines to the axis.
    static func snapLine(_ a: CGPoint, _ b: CGPoint) -> RecognizedShape {
        let angle = abs(atan2(b.y - a.y, b.x - a.x)) // 0...π
        let tolerance: CGFloat = 7 * .pi / 180
        if angle < tolerance || angle > .pi - tolerance {
            let y = (a.y + b.y) / 2
            return .line(CGPoint(x: a.x, y: y), CGPoint(x: b.x, y: y))
        }
        if abs(angle - .pi / 2) < tolerance {
            let x = (a.x + b.x) / 2
            return .line(CGPoint(x: x, y: a.y), CGPoint(x: x, y: b.y))
        }
        return .line(a, b)
    }

    /// Quadrilaterals with roughly axis-aligned edges become a clean rectangle.
    static func squareUp(_ q: [CGPoint]) -> [CGPoint] {
        let tolerance: CGFloat = 14 * .pi / 180
        let aligned = (0..<4).allSatisfy { i in
            let a = q[i], b = q[(i + 1) % 4]
            let angle = abs(atan2(b.y - a.y, b.x - a.x)).truncatingRemainder(dividingBy: .pi / 2)
            return angle < tolerance || angle > .pi / 2 - tolerance
        }
        guard aligned else { return q }
        let box = boundingBox(q)
        return [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY),
                CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY)]
    }

    /// Vertices of a closed stroke after simplification, with near-straight and near-duplicate vertices removed.
    static func cornerPoints(_ pts: [CGPoint], diag: CGFloat) -> [CGPoint] {
        var poly = douglasPeucker(pts, epsilon: 0.045 * diag)
        if poly.count > 2, distance(poly[0], poly[poly.count - 1]) < 0.25 * diag { poly.removeLast() }
        var changed = true
        while changed && poly.count > 3 {
            changed = false
            for i in 0..<poly.count {
                let n = poly.count
                let prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n]
                if turnAngle(prev, cur, next) < 0.45 || distance(prev, cur) < 0.12 * diag {
                    poly.remove(at: i)
                    changed = true
                    break
                }
            }
        }
        return poly
    }

    /// Mean |r − 1| of the points against the ellipse inscribed in the bounding box. ~0.05 for a decent circle.
    static func ellipseDeviation(_ pts: [CGPoint], _ box: CGRect) -> CGFloat {
        let rx = max(box.width / 2, 1), ry = max(box.height / 2, 1)
        let total = pts.reduce(CGFloat(0)) { sum, p in
            let dx = (p.x - box.midX) / rx, dy = (p.y - box.midY) / ry
            return sum + abs(sqrt(dx * dx + dy * dy) - 1)
        }
        return total / CGFloat(pts.count)
    }

    // MARK: Geometry

    static func resample(_ pts: [CGPoint], spacing: CGFloat) -> [CGPoint] {
        guard var prev = pts.first else { return [] }
        var out = [prev]
        var carry: CGFloat = 0
        for p in pts.dropFirst() {
            var d = distance(prev, p)
            var from = prev
            while carry + d >= spacing {
                let t = (spacing - carry) / d
                let q = CGPoint(x: from.x + t * (p.x - from.x), y: from.y + t * (p.y - from.y))
                out.append(q)
                d -= spacing - carry
                from = q
                carry = 0
            }
            carry += d
            prev = p
        }
        if let last = pts.last, distance(out[out.count - 1], last) > 0.5 { out.append(last) }
        return out
    }

    static func douglasPeucker(_ pts: [CGPoint], epsilon: CGFloat) -> [CGPoint] {
        guard pts.count > 2 else { return pts }
        var keep = [Bool](repeating: false, count: pts.count)
        keep[0] = true; keep[pts.count - 1] = true
        var stack = [(0, pts.count - 1)]
        while let (lo, hi) = stack.popLast() {
            guard hi > lo + 1 else { continue }
            var maxD: CGFloat = 0, index = lo
            for i in (lo + 1)..<hi {
                let d = perpendicularDistance(pts[i], pts[lo], pts[hi])
                if d > maxD { maxD = d; index = i }
            }
            if maxD > epsilon {
                keep[index] = true
                stack.append((lo, index)); stack.append((index, hi))
            }
        }
        return pts.enumerated().filter { keep[$0.offset] }.map(\.element)
    }

    /// 0 when a→b→c is straight, π when it doubles back.
    static func turnAngle(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGFloat {
        let v1 = CGVector(dx: b.x - a.x, dy: b.y - a.y), v2 = CGVector(dx: c.x - b.x, dy: c.y - b.y)
        let m = hypot(v1.dx, v1.dy) * hypot(v2.dx, v2.dy)
        guard m > 0 else { return 0 }
        return acos(max(-1, min(1, (v1.dx * v2.dx + v1.dy * v2.dy) / m)))
    }

    static func perpendicularDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let len = distance(a, b)
        guard len > 0 else { return distance(p, a) }
        return abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len
    }

    static func pathLength(_ pts: [CGPoint]) -> CGFloat {
        zip(pts, pts.dropFirst()).reduce(0) { $0 + distance($1.0, $1.1) }
    }

    static func boundingBox(_ pts: [CGPoint]) -> CGRect {
        let xs = pts.map(\.x), ys = pts.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return .zero }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(b.x - a.x, b.y - a.y) }
}
