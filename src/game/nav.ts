import { W, H, PLAYER_R } from './constants';
import type { GameMap } from './map';

const CELL = 20;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** Lưới dẫn đường: BFS từ mục tiêu ra toàn bản đồ, bot đi theo ô có giá trị nhỏ dần. */
export class NavGrid {
  readonly cols = Math.ceil(W / CELL);
  readonly rows = Math.ceil(H / CELL);
  readonly blocked: Uint8Array;

  constructor(map: GameMap) {
    this.blocked = new Uint8Array(this.cols * this.rows);
    const m = PLAYER_R + 3;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
        for (const w of map.walls) {
          if (cx > w.x - m && cx < w.x + w.w + m && cy > w.y - m && cy < w.y + w.h + m) {
            this.blocked[r * this.cols + c] = 1;
            break;
          }
        }
      }
    }
  }

  cellOf(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
    return r * this.cols + c;
  }

  private canStep(c: number, r: number, dc: number, dr: number): boolean {
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) return false;
    if (this.blocked[nr * this.cols + nc]) return false;
    // Không cắt góc khi đi chéo
    if (dc && dr && (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c])) return false;
    return true;
  }

  field(tx: number, ty: number): Int32Array {
    const f = new Int32Array(this.cols * this.rows).fill(-1);
    const start = this.cellOf(tx, ty);
    f[start] = 0;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi], c = i % this.cols, r = (i / this.cols) | 0;
      for (const [dc, dr] of DIRS) {
        if (!this.canStep(c, r, dc, dr)) continue;
        const ni = (r + dr) * this.cols + (c + dc);
        if (f[ni] !== -1) continue;
        f[ni] = f[i] + 1;
        queue.push(ni);
      }
    }
    return f;
  }

  /** Góc di chuyển theo trường khoảng cách, hoặc null nếu kẹt. */
  direction(f: Int32Array, x: number, y: number): number | null {
    const i = this.cellOf(x, y), c = i % this.cols, r = (i / this.cols) | 0;
    let best = -1, bestV = f[i] >= 0 ? f[i] : Infinity;
    for (const [dc, dr] of DIRS) {
      if (!this.canStep(c, r, dc, dr)) continue;
      const ni = (r + dr) * this.cols + (c + dc);
      if (f[ni] >= 0 && f[ni] < bestV) { bestV = f[ni]; best = ni; }
    }
    if (best < 0) return null;
    const tx = (best % this.cols) * CELL + CELL / 2, ty = ((best / this.cols) | 0) * CELL + CELL / 2;
    return Math.atan2(ty - y, tx - x);
  }
}
