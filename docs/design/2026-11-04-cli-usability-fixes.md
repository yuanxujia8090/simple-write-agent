# 阶段方案：真实模型兼容、确认卡与工作区卫生

- 日期：2026-11-04
- 关联决策：无新增 ADR；沿用 ADR 0003（两类门禁）、ADR 0012（确认与 checkpoint 同事务）
- 关联计划：`docs/plan/00-plan.md` §1.3「补齐已确认产品能力」
- 起因：2026-11-04 项目评估发现三项阻塞：真实模型在 bai/deepseek-v4.1-flash 上启动即失败；门禁全自动批准，人没有否决权；工作区有未跟踪目录与重复证据包。

## 1. 目标

阶段结束后用户能多做三件事：

1. 配置真实模型后，用主力 provider（`bai/deepseek-v4.1-flash`）跑完整创作链路，不再因 `response_format` 报错退出。
2. 在终端逐道门禁看到确认卡并选择「批准 / 修改 / 拒绝」，而不是只能自动批准。
3. `git status` 不再出现本地运行状态目录，自测证据只保留一份可读副本。

## 2. 范围

**包含**

- `src/model/ai-sdk.ts`：结构化调用改为「普通文本生成 + JSON 提取 + zod 校验 + 一次纠错重试」，不再传 `response_format`。
- `src/cli/auto-run.ts`：门禁决策可注入，默认仍是自动批准。
- `src/cli/main.ts`、`src/cli/args.ts`、`src/cli/help.ts`：新增 `--yes`；stdin 是终端且未给 `--yes` 时逐道门禁交互确认；非终端（管道、测试、CI）保持自动批准，行为不变。
- `.gitignore`：忽略 `.writing-agent/`（工作目录标记与本地状态）。
- 删除重复证据包 `_selftest_2026-11-03/evidence.tgz`（内容与 `evidence/` 下 6 个文件相同）。

**不包含**

- Ink TUI、欢迎页、会话列表、`/list` `/resume` `/note` `/idea` `/profile` `/style 提炼`。
- 搜索提供方、`profile.db`、素材快照、研究预算。
- `--output-dir` 生效（本轮仅保留现状与帮助文本一致）。
- 单实例锁接入启动流程。

## 3. 数据流与关键规则

### 3.1 结构化调用

```text
阶段 prompt
  ↓ + JSON Schema（zod → JSON Schema）
generateText（不带 response_format / json_object）
  ↓ 纯文本
extractJsonObject：去代码围栏 → 取首个 { 到末个 } → JSON.parse
  ↓
zod safeParse 通过 → 返回对象
  ↓ 失败
把「解析错误 + 上次输出」回灌，重试一次；仍失败则抛可读 AppError
```

- 只重试一次，避免把一次坏输出放大成费用与延迟。
- 失败信息带上 schema 名与首个字段错误，便于判断是模型能力问题还是提示词问题。
- 不降低既有校验强度：对象仍必须通过同一份 zod schema。

### 3.2 确认卡

```text
auto-run 循环
  ↓ 每道门禁
confirm(gate) 存在？ ── 否 → 自动批准（现状）
  ↓ 是
打印确认卡：阶段、推荐、依据、风险、备选项、preview
  ↓ 读一行
y / 回车 → approve      m <反馈> → modify      n <反馈> → reject
```

- 交互只在 `process.stdin.isTTY && process.stdout.isTTY` 且未给 `--yes` 时启用。
- 输入无法识别时重问，不默认批准，避免误按回车推进。
- `modify` / `reject` 必须有反馈文本，空反馈按未识别处理。
- 拒绝后仍按 ADR 0005 回到父阶段；流程不改。

## 4. 失败处理

| 失败点 | 行为 |
| --- | --- |
| 模型输出非 JSON | 一次纠错重试，仍失败给「模型未按 JSON 输出」提示与阶段名 |
| JSON 通过语法、不通过 zod | 同上；错误信息带首个字段路径 |
| 用户中断输入（Ctrl+C / 关闭 stdin） | 抛出可读错误，进程以现有错误码退出，不静默批准 |
| 无 TTY | 走自动批准，日志「非交互：门禁自动批准」保持原样 |

## 5. 验证方法

```bash
npm run typecheck
npm test
npm run build
npm run dev -- --help                       # 含 --yes 说明
npm run dev -- --file ./_selftest_2026-11-03/素材-本地AI写作工具.md --topic "测" --fast
git status --short                          # 无 .writing-agent/ 与 evidence.tgz
```

真实模型验证需要 `.env.local` 里的 provider 凭据，属本轮外部条件；若本机可用，用同一 `--file` 命令再跑一次，期望 `创作结果：exported`。

## 6. 实际结果（2026-11-04 收尾）

- 结构化调用改造：`src/model/ai-sdk.ts` 用 `generateText` + JSON Schema 提示 + `extractJsonObject` + zod 校验，失败重试一次；不再传 `response_format`。
- 确认卡：`src/cli/confirm.ts` 实现卡片渲染、决策解析、readline 交互；`auto-run` 接受可注入的 `confirm`，`main` 在终端且未给 `--yes` 时启用。
- 卫生：`.gitignore` 增加 `.writing-agent/`；删除与 `evidence/` 内容逐字相同的 `evidence.tgz`。
- 验证：`npm run typecheck` 通过；`npm test` 23 文件 263 用例通过；`npm run build` 通过；`--help` 含 `--yes`；固定模型 `--file ... --fast` 退出码 0 并导出 Markdown/HTML；伪终端（`script`）手测两道确认卡后 `创作结果：exported`。
- 与方案偏差：无。新增两项计划外但必要的测试：`src/model/ai-sdk.test.ts`（脏输出解析）与 `src/model/ai-sdk.integration.test.ts`（本地假服务证明请求体没有 `response_format`）。
- 未验证：真实 provider（bai / deepseek-v4.1-flash）端到端调用需要付费凭据，本轮没有凭据，留待用户用 `.env.local` 自行跑；离线证据只能证明“不再发 `response_format`、能解析脏输出”，不能证明该模型一定按 JSON 输出。

