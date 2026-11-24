import type { Rect } from './map';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Chuẩn hóa hiệu 2 góc về [-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Đẩy hình tròn ra khỏi hình chữ nhật. Trả về true nếu có va chạm. */
export function resolveCircleRect(p: { x: number; y: number }, r: number, w: Rect): boolean {
  const cx = clamp(p.x, w.x, w.x + w.w);
  const cy = clamp(p.y, w.y, w.y + w.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x += (dx / d) * (r - d);
    p.y += (dy / d) * (r - d);
    return true;
  }
  // Tâm nằm trong hình chữ nhật: đẩy theo trục gần nhất
  const left = p.x - w.x, right = w.x + w.w - p.x, top = p.y - w.y, bottom = w.y + w.h - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = w.x - r;
  else if (m === right) p.x = w.x + w.w + r;
  else if (m === top) p.y = w.y - r;
  else p.y = w.y + w.h + r;
  return true;
}

/** Liang–Barsky: tham số t∈[0,1] nơi đoạn thẳng chạm hình chữ nhật, hoặc null. */
export function segmentRect(x1: number, y1: number, x2: number, y2: number, w: Rect): number | null {
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - w.x, w.x + w.w - x1, y1 - w.y, w.y + w.h - y1];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0;
}

/** Tham số t∈[0,1] nơi đoạn thẳng chạm hình tròn, hoặc null. */
export function segmentCircle(
  x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number,
): number | null {
  const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function lineOfSight(ax: number, ay: number, bx: number, by: number, walls: Rect[]): boolean {
  for (const w of walls) if (segmentRect(ax, ay, bx, by, w) !== null) return false;
  return true;
}
