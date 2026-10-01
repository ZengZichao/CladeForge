## Summary
What changed and why.

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Docs / refactor

## Checklist
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes (this is what `tauri build` runs)
- [ ] Docs updated if needed — user-facing text provided in both English and 中文
- [ ] Rust side compiled and tested if touched: `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Rust side lint-clean if touched: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
      (CI runs clippy with `-D warnings`, so a warning fails the build — this is not optional)

## Generative AI
State whether a generative-AI tool produced any part of this change, and for what (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- [ ] No
- [ ] Yes — tool, and which parts:

---

## 摘要
改了什么，以及为什么。

## 变更类型
- [ ] 缺陷修复
- [ ] 新功能
- [ ] 文档 / 重构

## 检查清单
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] `npm run build` 通过（`tauri build` 走的正是它）
- [ ] 如需要，已同步更新文档——面向用户的文案须同时提供英文与中文
- [ ] 若改动了 Rust 侧，已通过 `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 若改动了 Rust 侧，已通过 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
      （CI 用 `-D warnings` 运行 clippy，出现警告即构建失败——此项不是可选项）

## 生成式 AI
请说明本次变更是否有生成式 AI 工具参与、参与了哪些部分（见 [CONTRIBUTING_ZH.md](../CONTRIBUTING_ZH.md)）。
- [ ] 否
- [ ] 是——所用工具，以及参与的部分：
