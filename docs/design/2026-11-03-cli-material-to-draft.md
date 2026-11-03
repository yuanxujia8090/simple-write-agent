# 阶段方案：CLI 素材→主稿最小路径

- 日期：2026-11-03
- 状态：已实现（T4）
- 关联计划：`hermes-out/CEO-复盘/plans/2026-11-03-my-write-agent.md` §2.1 / §3
- 关联已有：`2026-10-29-first-writing-loop.md`（graph/replay）、`2026-10-30-model-adapter.md`、`2026-10-30-persistence-file-protection.md`、`2026-11-03-multi-style-loader.md`
- 目标一句话：一条 CLI 给素材（可选话题 + 风格）能接到现有编排，产出主稿 Markdown（及已有 HTML 导出能力）

## 1. 目标

阶段结束后，用户用**已有 flags**（补 DX/帮助与主路径接线，而非新子命令）从本地 `.txt`/`.md` 素材启动创作主路径，接到现有 `GraphRunner` / replay 同源编排；可选 `--style`；导出主稿路径可预期。

## 2. 范围

### 包含

- 主命令体验：`npm run dev -- --file <素材> [--topic …] [--style …] [--fast] [--output-dir …]`
- 读 `--file` 列表为材料内容，交给 `runner.start({ topic, materials })`（与 `src/cli/replay.ts` 同源类型）
- 无 TUI 时的最小推进策略（见下「门禁」）
- 帮助文案与根 README / docs 入口对齐「素材→成稿」一条可复制命令（编码阶段改文案；本 design 先定命令形）
- 失败时中文错误：缺文件、空素材、未配置模型等沿用 `AppError`

### 不包含

- 完整 Ink TUI / 斜杠命令（T13）
- 搜索提供方完美化（T9）
- 搬迁 v7 工作流状态机进本仓
- 本阶段编码（T1 只设计；实现属 T4，风格属 T3）

### 已知简化

| 事项 | 做法 | 后续 |
| --- | --- | --- |
| 门禁确认 | 无 TUI 时：`--fast` 路径自动批准非关键点；或提供 `--yes`/`--approve-all`（若实现选一个名字，优先复用 replay 决策语义）专门给非交互跑通 | T13 再做人机确认卡 |
| 话题缺省 | 仅有 `--file` 无 `--topic`：用首个素材文件名（去扩展名）或素材首行标题作 topic | 可再优化 |
| 真实模型 | 沿用 `.env.local` + model-adapter；未配置则明确失败 | 本机烟测 |
| 与 replay 关系 | **不**新造第二套图；CLI 主路径调用同一 `createGraphRunner` | 保持单一编排 |

## 3. 数据流

```text
parseCliArgs
  → 读 files[] 为 materials[]（path + text；编码 utf-8）
  → 可选 resolveStyle（见 multi-style-loader）
  → loadConfig / resolveWorkspace / 开会话（持久化已有能力）
  → createGraphRunner({ service, files, model, … })
  → runner.start({ topic, materials })
  → 按门禁策略 submit decision 直至 exported
  → 打印 articles/<slug>.md（及 .html）路径与指纹
```

现状缺口（已核）：`src/cli/main.ts` 目前只打印启动概览，**尚未**调用 `GraphRunner`；`--file` 仅出现在描述行。`replay.ts` 已 `start({ topic, materials: MATERIALS })`。最小路径 = 把 replay 的启动/推进接线迁到（或抽共享函数供）`main` 的非 help/version 分支。

## 4. 关键规则

1. `--file` 路径不存在或不可读：USAGE/IO 错误，列出哪个路径失败。
2. 全部素材读出后正文皆空：拒绝启动。
3. 无 `--file` 且无 `--topic`：保持现有「打印概览 / 欢迎」行为，不假装已创作。
4. 模型未配置且非固定/replay 模式：沿用 config warnings → 硬失败（与 model-adapter 一致）。
5. 导出遇外部改稿：沿用 persistence 文件保护，不覆盖。
6. 风格解析失败：见 multi-style-loader；不继续静默无风格跑完却声称「已按风格写作」。

## 5. 验证方法（可复现；编码后执行）

| 验证 | 命令 / 步骤 | 通过标准 |
| --- | --- | --- |
| 帮助含素材示例 | `npm run dev -- --help`（Mac/合格 Node） | 文案含 `--file` 与一条素材→成稿示例；若已实现则含 `--style` |
| 非交互跑通 | `npm run dev -- --file <fixture.md> --topic "测" --fast …`（门禁策略按实现） | 退出码 0；`articles/` 下出现主稿 |
| 缺文件 | `--file ./nope.md` | 非 0；stderr 含路径 |
| 与 replay 同源 | 同 fixture 材料对比阶段顺序 | 阶段序列一致（行为），不绑定私有函数名 |
| 回归 | `npm run typecheck` && `npm test` && `npm run replay` | 既有路径不破 |
| 风格联调 | 配 `~/.writing-agent/styles/demo/profile.md` + `--style demo` | 上下文含 profile（T3 后） |

**环境注意**：与 multi-style-loader 相同——box 上勿假装已 `npm install`；Mac Node >=22 + 原生构建链验证。

## 6. 任务拆分（编码阶段）

| 编号 | 任务 | 产出 | commit 示例 |
| --- | --- | --- | --- |
| C1 | 抽「读 materials + start/推进」供 main/replay 共用 | 小模块或函数 | 可与 C2 同 commit 若仍是同一功能面 |
| C2 | main 接线素材→exported + 非交互门禁 | `main.ts` + 测试 | `feat: CLI 素材创作主路径` |
| C3 | help/README 一条命令 DX | `help.ts`、根 README 过时句修正 | 可并入 C2 **或** 单独 `docs:`——若含代码行为必须以功能 commit 为主 |

纪律：一功能一中文 commit；无 design 不编码（本文件即门槛）。

## 7. 实际结果

CLI `runCli` 在存在 `--file`/`--topic` 时读素材、装配 GraphRunner（无 Key 用 fixedModel）、非交互自动批准至 exported；帮助与根 README 含一条 ` --file ./notes.md --topic "测" --fast` 示例。验证见 hermes-out T4 证据。

## 8. Subtract / 懒惰协议

- 不新增 `writing-agent write` 子命令，除非现有 flags 证实不够。
- 不复制 graph；只补 CLI → runner 最后一公里。
- 不在本仓嵌入 v7 步骤树；职责见 T0 证据表。
