# Merge Studio — 3-Way Merge & Conflict Resolver

Visual 3-way merge editor và Git conflict resolver cho VS Code, lấy cảm hứng từ Merge Studio / GitStudio.

## Tính năng

- **Status bar + Tree View**: hiện số file đang conflict (dựa trên `git diff --diff-filter=U`), click để xem danh sách trong sidebar "Merge Studio".
- **3-way Merge Editor (Webview)**: mở 1 file conflict sẽ hiện toàn bộ nội dung file, mỗi conflict block được render thành card 3 cột **Current (Local) / Base (Ancestor, nếu có) / Incoming (Remote)** kèm nhãn thật lấy từ git (HEAD, tên nhánh, hash ancestor).
  - Accept Current / Accept Base / Accept Incoming / Accept Both / Edit Manually / Revert cho từng conflict.
  - "Final Result Preview" ở cuối trang: xem trước toàn bộ file sau khi resolve, có thể sửa tay trực tiếp trước khi lưu.
  - Save hoặc Save && Mark Resolved (tự động `git add` file sau khi lưu nếu không còn marker).
- **Accept All Current / Accept All Incoming**: áp dụng cho 1 file đang mở hoặc toàn bộ workspace.
- **Mark as Resolved**: `git add` nhanh cho 1 file từ Tree View.
- **Next/Prev Conflict**: điều hướng giữa các conflict trong merge editor (`Alt+F8` / `Shift+Alt+F8`).
- Tự động refresh khi có thay đổi ở `.git/MERGE_HEAD`, `.git/index`, hoặc khi lưu file.

## Chạy thử (development)

```bash
npm install
npm run compile   # hoặc npm run watch
```

Trong VS Code, mở thư mục `merge-studio` và nhấn `F5` để mở **Extension Development Host**. Mở một repo git đang có conflict trong cửa sổ đó để test.

## Đóng gói

```bash
npm run package   # tạo file .vsix bằng @vscode/vsce
```

Cài thử bằng `code --install-extension merge-studio-0.1.0.vsix`.

## Kiến trúc

```
src/
  extension.ts          # activation, đăng ký command, watcher
  conflictParser.ts      # parse conflict marker (hỗ trợ diff3 base section)
  gitHelper.ts            # wrapper git CLI (rev-parse, diff --diff-filter=U, add)
  conflictScanner.ts      # quét toàn workspace tìm file đang conflict
  conflictTreeProvider.ts # TreeDataProvider cho sidebar
  statusBarController.ts  # status bar item
  mergeEditorPanel.ts      # WebviewPanel quản lý state resolve/save của 1 file
media/
  main.js / main.css       # UI webview (vanilla JS, không build step)
```
