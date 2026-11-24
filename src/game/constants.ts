export const W = 1280;
export const H = 720;
export const TICK = 1 / 60;

export const PLAYER_R = 16;
export const PLAYER_SPEED = 220;
export const MAX_HP = 100;

export const DASH_DIST = 150;
export const DASH_TIME = 0.15;
export const DASH_CD = 3;
export const SWITCH_DELAY = 0.25;

export const ROUNDS_TO_WIN = 3;
export const MAX_ROUNDS = 9; // chặn trận kéo dài vô hạn nếu hòa liên tục
export const ROUND_TIME = 90;
export const COUNTDOWN = 3;
export const ROUND_END_DELAY = 2.5;

export type Team = 0 | 1;
/** Mỗi đội 3 sắc độ cho 3 người chơi. */
export const TEAM_COLORS: [string[], string[]] = [
  ['#4cc9f0', '#4895ef', '#72efdd'],
  ['#f72585', '#ff6b6b', '#ff9e00'],
];
export const TEAM_NAMES: [string, string] = ['Đội Xanh', 'Đội Đỏ'];
export const MAX_TEAM_SIZE = 3;
