# Data Analyst AI Agent (Hệ thống Phân tích BI Thông minh)

Ứng dụng web tích hợp Trợ lý Trí tuệ Nhân tạo (AI Agent) hỗ trợ doanh nghiệp tự động hóa toàn diện quy trình xử lý dữ liệu:
1. **Kiểm định & Tiền xử lý Dữ liệu:** Kiểm tra định dạng bảng, lọc dữ liệu thông minh qua trao đổi AI tự nhiên (xóa hàng, chọn vùng miền, lọc kênh bán, đổi tên cột...).
2. **Làm sạch Dữ liệu HITL (Human-in-the-Loop):** Tự động phát hiện lỗi số liệu, ngày tháng, chính tả, giá trị rỗng và làm sạch với cơ chế duyệt thủ công/tự động.
3. **Phân tích Đa chiều & Dashboard Trực quan:** Biểu đồ doanh thu, xu hướng thời gian, tỷ trọng danh mục và đồng hồ đo chỉ số KPI.
4. **Báo cáo Chiến lược & Xuất PDF:** Tự động tạo báo cáo phân tích chuyên sâu cho doanh nghiệp và hỗ trợ lưu báo cáo dạng PDF.

---

## Cấu trúc Dự án

```
web AI/
├── api/
│   └── index.py            # Serverless entrypoint cho Vercel (/api/*)
├── static/
│   ├── app.js              # Logic giao diện & tương tác AI
│   ├── index.html          # Giao diện ứng dụng chính
│   ├── slides.html         # Slide thuyết trình giải pháp
│   └── styles.css          # Giao diện pastel sky blue & layout chuẩn
├── .gitignore              # Bỏ qua file rác, cache và môi trường ảo
├── app.py                  # Backend FastAPI (Data Cleaning, BI & AI Engine)
├── index.html              # Trang chủ ứng dụng
├── README.md               # Tài liệu dự án
├── requirements.txt        # Danh sách thư viện Python cần thiết
└── vercel.json             # Cấu hình định tuyến triển khai Vercel
```

---

## Hướng dẫn Chạy Local

### 1. Cài đặt thư viện
```bash
pip install -r requirements.txt
```

### 2. Khởi chạy máy chủ
```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```
Mở trình duyệt truy cập: `http://localhost:8000`

---

## Hướng dẫn Đẩy lên Git & Vercel

### Đẩy lên Git
```bash
git init
git add .
git commit -m "feat: complete Data Analyst AI Agent system"
git branch -M main
git remote add origin <URL_REPO_CUA_BAN>
git push -u origin main
```

### Triển khai lên Vercel
1. Truy cập [vercel.com](https://vercel.com) và bấm **Add New Project**.
2. Chọn kho lưu trữ Git vừa đẩy lên.
3. Vercel sẽ tự động nhận diện cấu hình `vercel.json` và `requirements.txt`. Bấm **Deploy**.
