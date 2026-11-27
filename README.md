# 📈 Radar Thị Trường

App theo dõi **sản phẩm bán chạy** và **xu hướng** tại Việt Nam. Chạy miễn phí bằng GitHub:
- **GitHub Actions** tự thu thập dữ liệu mỗi sáng lúc 6:00 giờ VN.
- **GitHub Pages** hiển thị dashboard, mở được trên máy tính và điện thoại.

## Dữ liệu lấy từ đâu

| Nguồn | Cách lấy | Ghi chú |
|---|---|---|
| Tiki | Tự động | Top bán chạy theo từ khóa, có số đã bán, giá, đánh giá |
| Google Trends | Tự động | Các tìm kiếm đang nổi ở VN trong ngày |
| Shopee, TikTok Shop, Lazada, Facebook | Nút mở nhanh + nhập tay | Các sàn này chặn lấy dữ liệu tự động. Dán số liệu vào `data/manual.csv` |

**Bán/ngày**: app so số "đã bán" của từng sản phẩm giữa các ngày để tìm hàng đang **tăng nhanh**. Từ ngày thứ 2 trở đi mới có số này.

**Điểm hot (0–100)**: 60% tốc độ bán, 30% tổng đã bán, 10% đánh giá. Điểm chấm riêng trong từng từ khóa.

## Đổi ngành hàng và từ khóa
Sửa file `config.json`. Có thể sửa ngay trên GitHub: mở file, bấm ✏️, rồi Commit. Dữ liệu sẽ tự chạy lại sau khi lưu.

## Nhập số liệu Shopee/TikTok bằng tay
Mở `data/manual.csv` và thêm mỗi sản phẩm một dòng:
```
nen_tang,tu_khoa,ten_san_pham,gia,da_ban,ban_moi_ngay,link,ngay
Shopee,nồi chiên không dầu,Nồi chiên Lock&Lock 5.2L,1290000,25000,180,https://shopee.vn/...,2026-11-27
```
Nếu tên sản phẩm có dấu phẩy thì đặt tên trong ngoặc kép `"..."`.

## Chạy trên máy
```
node scripts/collect.mjs
node scripts/serve.mjs
```
Sau đó mở http://localhost:8080

## Nguồn hàng Trung Quốc
Mỗi từ khóa có bản dịch tiếng Anh/Trung trong `config.json` → `tu_khoa_nguon_hang` sẽ được tìm thêm trên:
- **AliExpress** (tự động): hàng TQ bán lẻ chạy nhất, có số đã bán.
- **Made-in-China** (tự động): giá sỉ từ xưởng và MOQ.
- **1688, Taobao, Douyin, Alibaba** (nút mở nhanh): các trang này chặn lấy tự động.

Dashboard so giá bán ở VN (Tiki) với giá lẻ và giá sỉ TQ (quy đổi theo `ty_gia_usd_vnd`).

## Đăng nhập
Dữ liệu dashboard được mã hóa bằng tài khoản/mật khẩu lấy từ GitHub Secrets `ADMIN` (tài khoản) và `ADMIN2` (mật khẩu).
