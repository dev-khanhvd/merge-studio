# Hướng dẫn Build & Cài đặt Merge Studio

Extension VS Code: trình merge 3 chiều (Local | Result | Server) và resolver conflict Git.

## Yêu cầu

- **Node.js** ≥ 18 (kèm npm)
- **VS Code** ≥ 1.85.0
- **Git** có trong PATH (extension gọi `git` qua CLI)

## 1. Cài dependencies

```bash
cd merge-studio
npm install
```

## 2. Build (compile TypeScript)

```bash
npm run compile
```

Kết quả biên dịch nằm trong thư mục `out/`. Khi phát triển, dùng chế độ watch để tự compile lại khi sửa code:

```bash
npm run watch
```

> Lưu ý: các file trong `media/` (main.js, diff.js, mergeLayout.js, main.css) là JavaScript/CSS thuần chạy trong webview, không cần build — sửa xong chỉ cần reload webview/extension.

## 3. Chạy thử ở chế độ phát triển (F5)

1. Mở thư mục `merge-studio` bằng VS Code.
2. Nhấn **F5** (hoặc Run → Start Debugging). VS Code sẽ compile rồi mở cửa sổ **Extension Development Host** với extension đã nạp sẵn.
3. Trong cửa sổ mới, mở một repo Git đang có conflict → icon **Merge Studio** xuất hiện ở Activity Bar, liệt kê các file conflict.
4. Sau khi sửa code extension (`src/`), nhấn **Ctrl+R** (Reload Window) trong cửa sổ Development Host để nạp lại.

## 4. Đóng gói thành file .vsix

```bash
npm run package
```

Lệnh này chạy `vsce package` (tự động compile trước qua `vscode:prepublish`) và tạo file `merge-studio-0.1.0.vsix` ở thư mục gốc.

Nếu `vsce` báo thiếu, chạy trực tiếp:

```bash
npx @vscode/vsce package
```

> Nếu vsce cảnh báo thiếu `repository` hoặc `LICENSE`, có thể thêm cờ `--allow-missing-repository` hoặc bổ sung các trường đó vào `package.json`.

## 5. Cài file .vsix vào VS Code

**Cách 1 — dòng lệnh:**

```bash
code --install-extension merge-studio-0.1.0.vsix
```

**Cách 2 — giao diện:**

1. Mở VS Code → view **Extensions** (`Ctrl+Shift+X`).
2. Bấm menu `…` góc trên phải → **Install from VSIX…**
3. Chọn file `merge-studio-0.1.0.vsix` → Reload khi được hỏi.

**Gỡ cài đặt:**

```bash
code --uninstall-extension local-dev.merge-studio
```

## 6. Sử dụng nhanh

| Thao tác | Cách làm |
|---|---|
| Xem file conflict | Icon Merge Studio ở Activity Bar |
| Mở merge editor | Click file trong danh sách, hoặc icon merge trên item |
| Conflict tiếp/trước | `Alt+F8` / `Shift+Alt+F8` (khi panel merge đang active) |
| Nhận toàn bộ Local/Incoming | Nút `✔ Local` / `✔ Server` trên toolbar, hoặc các lệnh `Merge Studio: Accept All …` trong Command Palette |
| Lưu & đánh dấu resolved | Nút **Apply** (tự động `git add` khi hết conflict) |

## Xử lý sự cố

- **`tsc` không tìm thấy** → chạy `npm install` lại; script dùng TypeScript cục bộ trong `node_modules`.
- **Panel Merge Studio trống** → workspace phải là repo Git và có file ở trạng thái unmerged (`git diff --name-only --diff-filter=U` phải ra kết quả).
- **`git add` không chạy khi Apply** → kiểm tra `git` có trong PATH của VS Code (mở terminal tích hợp gõ `git --version`).
