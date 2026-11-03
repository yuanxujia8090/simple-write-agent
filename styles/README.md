# 本地写作风格包

本目录**不**存放私人风格正文。真人语气、完整风格指南请装到本机目录，由 CLI 在运行时读取（见设计：`docs/design/2026-11-03-multi-style-loader.md`）。`--style` 加载实现属后续任务；此处只约定路径与包结构。

## 推荐安装位置

```text
~/.writing-agent/styles/<style-id>/
  profile.md          # 优先入口
  SKILL.md            # 若无 profile.md 则用此文件
  banned-words.txt    # 可选
  samples/            # 可选样例，可不解析
```

也可把包放在仓外任意目录，之后用路径引用（实现后）：`--style /绝对或相对/路径/到包目录`。

## 最小包内容

- 至少有一份入口：`profile.md` **或** `SKILL.md`（实现时优先读 `profile.md`）。
- 内容建议：精简写作约束 +（可选）指向你本机风格真源的路径说明；**不要**把完整私人指南复制进本 git 仓的 `styles/`。
- 仓内允许提交的只有：
  - `styles/README.md`（本说明）
  - `styles/_example/`（无私人语气的骨架，可复制到 `~/.writing-agent/styles/<id>/` 再改）

## 从骨架开始

```bash
mkdir -p ~/.writing-agent/styles/demo
cp -R styles/_example/* ~/.writing-agent/styles/demo/
# 编辑 ~/.writing-agent/styles/demo/profile.md 后，再用 CLI --style demo（待 T3）
```

## Git 忽略规则

`.gitignore` 已忽略 `styles/*`，并显式保留 `styles/README.md` 与 `styles/_example/**`。工作树里若误放了 `style-guide*.md` 副本也会被忽略。自检：

```bash
touch styles/secret.md
git check-ignore -v styles/secret.md   # 应显示被 styles/* 忽略
git check-ignore -v styles/README.md   # 应无输出（不被忽略）
rm styles/secret.md
```

## 与真源 / v7 的边界

- 文风真源若在 Obsidian 等仓外路径：Agent **只读**；不要把全文 commit 进本仓。
- 本仓不内嵌 v7 skill 树；批注与风格迭代归同级反馈技能，不在此目录执行。
