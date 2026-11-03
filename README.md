# simple-write-agent

本地运行的公众号长文写作 Agent：从话题或 `.txt`/`.md` 素材开始，经过研究、论点、大纲、草稿和审查，导出 Markdown 主稿与同源 HTML。

当前状态（2026-11-03）：启动检查、配置/工作目录、首条写作闭环（固定模型）、HTML 导出、持久化能力与本地多风格加载已具备；CLI 可用 `--file` 从素材非交互跑到主稿 Markdown。不带 `--file`/`--topic` 只打印启动检查。协作顺序为：**先实现、阶段留证、完成后学习**。

```bash
npm install                  # 安装依赖
npm run dev -- --help        # 开发模式查看帮助
# 素材→成稿（无 API Key 时用固定模型，不联网）
npm run dev -- --file ./notes.md --topic "测" --fast
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

下一步：持久化与文件保护（SQLite 落库、跨进程恢复、外部编辑检测）。阶段记录见 [启动与关键机制验证](docs/design/2026-10-29-bootstrap-checkpoint-experiments.md)、[首条写作闭环](docs/design/2026-10-29-first-writing-loop.md) 及对应 [变更记录](docs/changes/2026-10-29-first-writing-loop.md)。
