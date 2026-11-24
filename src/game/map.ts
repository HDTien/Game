import { W, H } from './constants';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
/** pickupGroups: mỗi nhóm là 1 điểm giữa map hoặc 1 cặp điểm đối xứng → vật phẩm luôn công bằng. */
export interface GameMap { id: string; name: string; walls: Rect[]; spawns: [Point, Point]; pickupGroups: Point[][] }

const T = 20;
const border = (): Rect[] => [
  { x: 0, y: 0, w: W, h: T },
  { x: 0, y: H - T, w: W, h: T },
  { x: 0, y: 0, w: T, h: H },
  { x: W - T, y: 0, w: T, h: H },
];

/** Đối xứng tâm để 2 bên công bằng tuyệt đối. */
const pair = (x: number, y: number): Point[] => [{ x, y }, { x: W - x, y: H - y }];

const mirror = (rs: Rect[]): Rect[] =>
  rs.flatMap((r) => [r, { x: W - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h }]);

export const MAPS: GameMap[] = [
  {
    id: 'warehouse',
    name: 'Nhà kho',
    walls: [
      ...border(),
      ...mirror([
        { x: 200, y: 140, w: 40, h: 170 },
        { x: 200, y: 420, w: 150, h: 40 },
        { x: 400, y: 20, w: 40, h: 170 },
        { x: 430, y: 540, w: 170, h: 40 },
        { x: 520, y: 230, w: 50, h: 50 },
      ]),
      { x: 610, y: 310, w: 60, h: 100 },
    ],
    spawns: [{ x: 80, y: 360 }, { x: W - 80, y: 360 }],
    pickupGroups: [pair(640, 255), pair(300, 600), pair(120, 120)],
  },
  {
    id: 'maze',
    name: 'Mê cung',
    walls: [
      ...border(),
      ...mirror([
        { x: 180, y: 20, w: 40, h: 200 },
        { x: 180, y: 360, w: 40, h: 200 },
        { x: 340, y: 180, w: 200, h: 40 },
        { x: 340, y: 500, w: 40, h: 200 },
        { x: 480, y: 340, w: 40, h: 180 },
      ]),
      { x: 560, y: 340, w: 160, h: 40 },
    ],
    spawns: [{ x: 80, y: 80 }, { x: W - 80, y: H - 80 }],
    pickupGroups: [pair(640, 290), pair(420, 120), pair(100, 640)],
  },
  {
    id: 'pillars',
    name: 'Cột trụ',
    walls: [
      ...border(),
      ...mirror([
        { x: 280, y: 160, w: 60, h: 60 },
        { x: 280, y: 500, w: 60, h: 60 },
        { x: 480, y: 330, w: 60, h: 60 },
        { x: 610, y: 150, w: 60, h: 60 },
      ]),
    ],
    spawns: [{ x: 80, y: 360 }, { x: W - 80, y: 360 }],
    pickupGroups: [[{ x: 640, y: 360 }], pair(310, 360), pair(640, 80)],
  },
];
