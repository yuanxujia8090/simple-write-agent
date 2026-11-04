# simple-write-agent

本地运行的公众号长文写作 Agent：从话题或 `.txt`/`.md` 素材开始，经过研究、论点、大纲、草稿和审查，导出 Markdown 主稿与同源 HTML。

当前状态（2026-11-04）：启动检查、配置/工作目录、首条写作闭环、HTML 导出、持久化、CLI 素材→主稿、本地多风格加载已具备；终端里逐道门禁人工确认（批准/修改/拒绝），非终端或 `--yes` 自动批准；结构化模型调用不再依赖 `response_format`；默认用 Bing RSS 做一次兜底搜索（`--no-search` 关闭，会把话题发给 bing.com）。不带 `--file`/`--topic` 只打印启动检查。协作顺序为：**先实现、阶段留证、完成后学习**。

```bash
npm install                  # 安装依赖
npm run dev -- --help        # 开发模式查看帮助
# 素材→成稿（无 API Key 时用固定模型，不联网）；终端里逐道门禁确认
npm run dev -- --file ./notes.md --topic "测" --fast
# 一路自动批准，适合脚本
npm run dev -- --file ./notes.md --topic "测" --fast --yes
npm run typecheck            # 类型检查
npm test                     # 单元测试
npm run build                # 构建到 dist/
node dist/cli.js --help      # 运行构建产物
npm run exp:t0               # 暂停恢复与提交一致性实验（固定数据，不联网）
npm run replay               # 重放写作闭环（固定数据）：--scenario basic|revise|reject
```

全局命令 `writing-agent` 需要 `npm link` 或全局安装构建产物；本仓库暂不执行这类会改动全局环境的操作。

- [开发前阅读入口与有效决策](docs/README.md)
- [需求与验收](docs/wiki/01-prd-writing-agent.md)
- [实际实施顺序与任务清单](docs/plan/00-plan.md)
- [开发准备审查与待验证问题](docs/design/2026-10-29-development-readiness-review.md)
- [项目协作规则](agents.md) · [领域术语](CONTEXT.md)

下一步：用 `.env.local` 里的真实 provider 跑一次端到端（`bai` / `deepseek-v4.1-flash`），再决定是否补 Ink TUI、斜杠命令与搜索提供方。阶段记录见 [阶段方案索引](docs/design/README.md) 与 [变更时间线](docs/changes/02-changelog.md)。
