# Codex Workflow for This Project

## Principle

不要把 Codex 當成一次完成整個系統的魔法工具。把它當成 junior-to-mid engineer：你要給它清楚的 issue、規格、測試與驗收條件。

## Recommended loop

```text
1. Define one small clinical/product problem.
2. Add or identify fake fixture.
3. Write expected output or failing test.
4. Ask Codex to implement smallest change.
5. Ask Codex to run tests/lint/typecheck.
6. Review diff.
7. Convert new bug into regression test.
```

## Task size guide

好的 Codex 任務：

- 「新增 code status 缺漏提示，並加 golden test」
- 「修正 Cr trend 顯示方向，避免 2.1 <- 1.4 被反向」
- 「將 AI output 改為 JSON schema validation，失敗時 fallback」
- 「把 renderer 從 summarizer 拆開，不改 UI」

不好的 Codex 任務：

- 「幫我把整個 patient list 做好」
- 「讓輸出更像醫師想要」
- 「把所有 bug 修掉」
- 「重構整個專案」

## Recommended first five PRs

1. Add `AGENTS.md` and clinical spec docs.
2. Add fake patient fixtures and first golden test.
3. Add normalized patient schema.
4. Add deterministic renderer independent from AI.
5. Add AI JSON contract with validation and fallback.
