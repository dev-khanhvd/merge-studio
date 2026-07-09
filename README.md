# Merge Studio — 3-Way Merge & Conflict Resolver

Trình merge 3 chiều và conflict resolver Git cho VS Code, clone lại toàn bộ tính năng/giao diện từ [GitStudioHQ/merge-studio](https://github.com/GitStudioHQ/merge-studio).

VS Code chưa từng có một merge editor thật sự. Merge Studio là merge editor đó: ba cột **của bạn (yours)** bên trái, **kết quả (result)** sẽ commit ở giữa, **của họ (theirs)** bên phải. Nhận một bên chỉ với một click, hoặc tự sửa kết quả — không cần rời khỏi editor.

## Tính năng

### Three-pane merge editor (Monaco)

- Ba cột **yours / result / theirs** nối với nhau bằng ribbon màu và mũi tên accept, dựng trên Monaco Editor.
- Xử lý từng thay đổi độc lập: apply (≫ / ≪), append (Ctrl-click), hoặc ignore (✕).
- Áp dụng toàn bộ thay đổi không xung đột cùng lúc (trái / phải / tất cả), kèm "magic wand" cho các đoạn giống hệt nhau.
- **Undo/redo với lịch sử thao tác có tên** — toolbar, dropdown lịch sử, phím tắt.
- Ribbon cong nối các thay đổi giữa các cột, khung rõ ràng quanh các xung đột thật.
- Điều hướng thay đổi (F7 / Shift+F7), cuộn đồng bộ, chế độ whitespace, fallback cho file lớn.

### Conflicts dashboard

- Tự động mở ngay khi merge / rebase / cherry-pick / revert tạo ra conflict.
- Mỗi file conflict có action **Accept Yours · Accept Theirs · Merge…**, kèm badge cho các trường hợp đặc biệt (deleted by them, added by both, …).
- File đã resolve vẫn hiển thị trong danh sách — đánh dấu xanh, có nhãn cách đã resolve.
- **Hold-to-undo** trên file đã resolve: giữ nút để chạy `git checkout -m`, khôi phục lại conflict gốc.
- **Cancel Merge** hủy thao tác và khôi phục trạng thái trước khi merge (merge, rebase, cherry-pick, revert).
- Thanh tiến trình, ngữ cảnh nhánh (`yours ⟵ theirs`), nút cảnh báo ở status bar khi còn conflict.

### Side-by-side diff

- So sánh hai file bất kỳ, hoặc một file với `HEAD` — qua menu chuột phải trong Explorer hoặc lệnh `Merge Studio: Compare`.
- Căn hàng chính xác từng dòng, highlight thay đổi trong dòng (intra-line).
- Re-diff trực tiếp khi bạn sửa cột bên phải.
- Dùng chung ribbon, màu sắc, điều hướng với merge editor.

### Hand-off sang JetBrains IDE

Đặt `jbMerge.conflictResolver: "jetbrains"` (hoặc `jbMerge.diffTool: "jetbrains"`) để Merge Studio mở merge/diff trực tiếp trong IDE JetBrains đã cài (WebStorm, PyCharm, IntelliJ IDEA, PhpStorm, GoLand, CLion, Rider, RubyMine, DataGrip), tự động dò tìm qua `PATH`.

## Settings

| Setting | Mặc định | Mô tả |
| --- | --- | --- |
| `jbMerge.conflictResolver` | `webview` | `webview` = merge editor tích hợp, `jetbrains` = mở IDE thật |
| `jbMerge.diffTool` | `embedded` | Tool cho lệnh **Compare**: `embedded` hoặc `jetbrains` (fallback nếu không tìm thấy IDE) |
| `jbMerge.autoOpen` | `true` | Tự động mở file conflict bằng resolver đã chọn |
| `jbMerge.preferredIde` | `auto` | IDE JetBrains dùng để hand-off (`auto` chọn cái đầu tiên tìm thấy) |
| `jbMerge.jetbrainsPath` | `""` | Đường dẫn tường minh tới launcher JetBrains (ghi đè auto-detect) |

## Chạy thử (development)

```bash
npm install
npm run watch     # build extension + webview, tự rebuild khi sửa code
```

Mở thư mục `merge-studio` trong VS Code, nhấn `F5` để mở **Extension Development Host**. Chạy lệnh **Merge Studio: Open Getting Started** để xem tour có sẵn conflict mẫu, không cần setup repo.

```bash
npm run check-types   # type-check TypeScript
npm test               # unit test logic thuần (diff/merge engine, git ops)
```

## Đóng gói

```bash
npm run package             # build production (esbuild --production)
npx @vscode/vsce package    # tạo file .vsix
```

Cài thử bằng:

```bash
code --install-extension merge-studio-<version>.vsix
```

## Kiến trúc

| Thành phần | Vai trò |
| --- | --- |
| `src/extension.ts` | Activation, đăng ký command, auto-open routing, watcher conflict |
| `src/conflictsPanel.ts` | Webview "Conflicts dashboard" |
| `src/mergeEditorProvider.ts` | `CustomTextEditorProvider` host webview merge editor |
| `src/git/` | Git service, merge ops (accept side / abort), abort flow |
| `src/jetbrains/` | Dò tìm và gọi IDE JetBrains đã cài |
| `src/engine/` | Diff / merge model thuần logic, có unit test |
| `webview/` | Front-end: Monaco panes, ribbons, decorations, undo history |

## Yêu cầu

VS Code **1.85+**, **git** trong `PATH`, và extension Git tích hợp sẵn phải bật. Merge Studio hoạt động trên repo trên đĩa (không hỗ trợ virtual workspace).

## License

[MIT](LICENSE)
