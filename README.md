# Đấu Súng 1vs1

Game bắn súng top-down đối kháng 1vs1 chạy hoàn toàn trên trình duyệt. Không cần backend; dữ liệu lưu trong `localStorage`.

## Chạy

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # xuất ra thư mục dist/ (web tĩnh)
```

## Tính năng

- **Đấu với Bot** (Dễ / Thường / Khó) – bot biết tìm đường, né đạn, đón đầu, chọn súng theo khoảng cách
- **2 người · 1 máy** – chung bàn phím
- 5 súng: Pistol, SMG, Shotgun, Rifle, Sniper · nạp đạn · lướt (dash)
- **Tiến trình** (khi đấu Bot): kiếm xu + XP, lên cấp, nâng cấp từng súng lên cấp 5 (cần xu + điều kiện: cấp người chơi, số lần hạ gục bằng súng đó), mở khóa Rifle/Sniper bằng thành tích, 9 thành tựu
- **Vật phẩm trên bản đồ**: máu, giáp, sát thương x1.5, tốc độ, đầy đạn — xuất hiện theo cặp đối xứng
- Âm thanh & nhạc nền tổng hợp bằng WebAudio (không cần file): tiếng súng riêng từng loại, âm thanh nổi trái/phải theo vị trí, âm vật phẩm, nhạc menu + nhạc chiến đấu, phím `M` tắt tiếng
- 3 bản đồ đối xứng: Nhà kho, Mê cung, Cột trụ
- Thắng 3 round để thắng trận, mỗi round 90 giây
- Lưu hồ sơ, cài đặt, lịch sử 100 trận gần nhất, thống kê (K/D, tỉ lệ thắng, độ chính xác)
- Xuất / nhập dữ liệu ra file JSON để sao lưu hoặc chuyển máy

## Cấu trúc

```
src/
├── game/            # Logic thuần, không phụ thuộc DOM
│   ├── constants.ts # thông số chung
│   ├── weapons.ts   # bảng thông số súng
│   ├── map.ts       # bản đồ
│   ├── collision.ts # va chạm, tầm nhìn
│   ├── world.ts     # mô phỏng trận đấu (tick cố định 60Hz, nhận input → sinh event)
│   ├── nav.ts       # lưới tìm đường BFS cho bot
│   └── bot.ts       # AI
├── input.ts         # bàn phím / chuột → PlayerInput
├── render.ts        # vẽ Canvas, hiệu ứng, HUD
├── sound.ts         # âm thanh tổng hợp WebAudio
├── storage.ts       # DataStore + LocalStore (localStorage)
└── main.ts          # UI menu, vòng lặp game
```

## Deploy miễn phí

Build ra web tĩnh (`dist/`), có thể đưa lên **GitHub Pages**, **Netlify**, **Vercel** hoặc **Cloudflare Pages** mà không tốn phí.

## Hướng phát triển

- **Online 1vs1 không cần server riêng:** kết nối P2P bằng WebRTC (ví dụ PeerJS). `World` chỉ nhận input nên có thể đồng bộ bằng cách gửi input qua mạng.
- **Có backend + MongoDB:** viết `ApiStore` implement `DataStore` trong `storage.ts`. Game và UI không phải sửa.
