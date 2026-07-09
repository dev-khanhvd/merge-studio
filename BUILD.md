# Hướng dẫn Build & Cài đặt Merge Studio

Extension VS Code: three-pane merge editor (Monaco), conflicts dashboard, side-by-side diff, và hand-off sang JetBrains IDE.

## Yêu cầu

- **Node.js** ≥ 18 (kèm npm)
- **VS Code** ≥ 1.85.0
- **Git** có trong PATH (extension gọi `git` qua CLI)

## 1. Cài dependencies

```bash
cd merge-studio
npm install
```

## 2. Build (esbuild)

```bash
npm run compile
```

Kết quả build (extension host + webview, bao gồm Monaco) nằm trong thư mục `dist/`. Khi phát triển, dùng chế độ watch để tự build lại khi sửa code:

```bash
npm run watch
```

> Mã nguồn front-end nằm trong `webview/` (TypeScript, dùng Monaco Editor) — được esbuild bundle vào `dist/webview/main.js`, khác với bản cũ dùng JS thuần không build step.

## 3. Chạy thử ở chế độ phát triển (F5)

1. Mở thư mục `merge-studio` bằng VS Code.
2. Nhấn **F5** (hoặc Run → Start Debugging). VS Code sẽ chạy build task (`watch`) rồi mở cửa sổ **Extension Development Host** với extension đã nạp sẵn.
3. Trong cửa sổ mới, chạy lệnh **Merge Studio: Open Getting Started** để xem tour có sẵn conflict mẫu, hoặc mở một repo Git đang có conflict thật để test.
4. Sau khi sửa code (`src/` hoặc `webview/`), esbuild watch tự rebuild — nhấn **Ctrl+R** (Reload Window) trong cửa sổ Development Host để nạp lại.

## 4. Type-check & test

```bash
npm run check-types   # tsc --noEmit trên extension + test
npm test               # unit test logic thuần (diff/merge engine, git ops, markers…)
```

## 5. Đóng gói thành file .vsix

```bash
npm run package
```

Lệnh này chạy `esbuild.js --production` (qua `vscode:prepublish`) rồi `vsce package`, tạo file `merge-studio-<version>.vsix` ở thư mục gốc. Nếu thiếu `vsce`:

```bash
npx @vscode/vsce package
```

## 6. Cài file .vsix vào VS Code

**Cách 1 — dòng lệnh:**

```bash
code --install-extension merge-studio-<version>.vsix
```

**Cách 2 — giao diện:**

1. Mở VS Code → view **Extensions** (`Ctrl+Shift+X`).
2. Bấm menu `…` góc trên phải → **Install from VSIX…**
3. Chọn file `.vsix` → Reload khi được hỏi.

**Gỡ cài đặt:**

```bash
code --uninstall-extension local-dev.merge-studio
```

## 7. Sử dụng nhanh

| Thao tác | Cách làm |
|---|---|
| Xem file conflict | Conflicts dashboard tự mở khi merge/rebase/cherry-pick tạo conflict, hoặc lệnh **Merge Studio: Resolve Conflicts…** |
| Mở merge editor cho 1 file | Click **Merge…** trên file trong dashboard, hoặc icon merge ở SCM view |
| Điều hướng thay đổi trong merge/diff editor | `F7` / `Shift+F7` |
| Nhận toàn bộ Yours/Theirs cho 1 file | Nút **Accept Yours** / **Accept Theirs** trong dashboard |
| Hoàn tác 1 file đã resolve | Giữ nút (hold-to-undo) trên file đó trong dashboard |
| Hủy merge đang dở | Nút **Cancel Merge** trong dashboard |
| So sánh file với HEAD hoặc file khác | Chuột phải file trong Explorer → **Merge Studio: Compare** |
| Mở trong JetBrains IDE | Đặt `jbMerge.conflictResolver`/`jbMerge.diffTool` = `jetbrains` trong Settings |

## Xử lý sự cố

- **`esbuild` không chạy được** → chạy `npm install` lại; script dùng esbuild cục bộ trong `node_modules`.
- **Dashboard/merge editor trống** → workspace phải là repo Git và có file ở trạng thái unmerged (`git diff --name-only --diff-filter=U` phải ra kết quả).
- **Hand-off JetBrains không hoạt động** → kiểm tra IDE đã cài và nằm trong `PATH`, hoặc set `jbMerge.jetbrainsPath` trỏ thẳng tới launcher.
- **`git add` / merge ops không chạy** → kiểm tra `git` có trong PATH của VS Code (mở terminal tích hợp gõ `git --version`).
