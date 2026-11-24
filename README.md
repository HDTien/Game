# Đấu Súng Online

Game bắn súng top-down đối kháng chạy hoàn toàn trên trình duyệt: **chơi online với bạn bè (1vs1, 2vs2, 3vs3)**, đấu Bot, hoặc 2 người chung 1 máy. Không cần backend.

## Chạy

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # xuất ra thư mục dist/ (web tĩnh)
```

## Tính năng

- **Online P2P** (WebRTC qua PeerJS): tạo phòng → gửi mã 5 ký tự / link mời → bạn bè vào phòng. Chọn 1vs1 / 2vs2 / 3vs3, đổi đội, thêm bot vào chỗ trống. Người rời giữa trận được bot thay thế.
- **Đấu Bot** 1vs1 / 2vs2 / 3vs3 (đồng đội cũng là bot), 3 mức độ khó
- **2 người · 1 máy**
- 5 súng × 4 **chế độ súng** (Magnum, Bắn loạt, Giảm thanh, Đạn chì, Nòng cưa, Đạn nảy, Xuyên tường…). Mỗi chế độ là đánh đổi, không chế độ nào mạnh hơn tuyệt đối → công bằng khi chơi online
- Vật phẩm trên bản đồ, xu, cấp độ, 10 thành tựu, lịch sử trận
- Âm thanh & nhạc nền tổng hợp bằng WebAudio

## Cách online hoạt động

```
Người chơi ──phím bấm (60/giây)──▶  CHỦ PHÒNG  ──trạng thái trận (30/giây)──▶ Người chơi
                                   chạy World
```

- Máy chủ phòng chạy mô phỏng trận đấu và quyết định mọi thứ (chống gian lận cơ bản).
- Người chơi tự **dự đoán** chuyển động của mình để không thấy trễ, và **nội suy** vị trí người khác cho mượt.
- PeerJS chỉ dùng máy chủ công cộng miễn phí để "giới thiệu" 2 máy với nhau; dữ liệu trận đi thẳng giữa các máy.
- Hạn chế: chủ phòng phải giữ tab mở; một số mạng (4G, mạng công ty) chặn P2P — cần thêm máy chủ TURN nếu muốn hỗ trợ.

## Cấu trúc

```
src/
├── game/            # Logic thuần, không phụ thuộc DOM
│   ├── world.ts     # mô phỏng trận (2 đội, tick 60Hz, input → event), moveStep dùng chung cho dự đoán
│   ├── weapons.ts   # súng + chế độ súng
│   ├── bot.ts, nav.ts, map.ts, collision.ts, pickups.ts, constants.ts
├── net/
│   ├── protocol.ts  # định dạng tin nhắn, nén input/snapshot
│   ├── host.ts      # chủ phòng: sảnh chờ, hàng đợi input, phát snapshot
│   └── client.ts    # người vào phòng: kết nối + ClientWorld (dự đoán & nội suy)
├── progression.ts   # xu, cấp, chế độ súng, thành tựu
├── armory.ts        # giao diện Kho vũ khí
├── render.ts, input.ts, sound.ts, music.ts, storage.ts
└── main.ts          # menu, phòng online, vòng lặp game
```

## Deploy miễn phí

Build ra web tĩnh (`dist/`) → GitHub Pages / Netlify / Vercel / Cloudflare Pages. Sau khi deploy, gửi link cho bạn bè là chơi online được.
