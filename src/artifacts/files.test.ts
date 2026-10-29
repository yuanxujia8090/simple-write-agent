import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppError } from "../shared/errors.js";
import { hashContent } from "../shared/hash.js";
import { createFileWriter, slugify } from "./files.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "writing-agent-files-"));
  roots.push(root);
  return root;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function entryNames(dir: string): string[] {
  return readdirSync(dir).sort();
}

function captureAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("预期抛出 AppError，但函数正常返回");
}

function tempFilesIn(dir: string): string[] {
  return entryNames(dir).filter((name) => name.includes(".tmp-"));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("slugify", () => {
  it("保留中文与字母数字", () => {
    expect(slugify("我的第一篇文章")).toBe("我的第一篇文章");
    expect(slugify("Agent 工程 2026")).toBe("Agent-工程-2026");
  });

  it("空白折叠为单个连字符", () => {
    expect(slugify("Hello   World\tTest\nAgain")).toBe("Hello-World-Test-Again");
  });

  it("清理路径与文件名非法字符", () => {
    expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("清理控制字符与非文件名安全字符（如 emoji）", () => {
    expect(slugify("a\u0000b\u0007c\u001fd")).toBe("a-b-c-d");
    expect(slugify("a😀b")).toBe("a-b");
  });

  it("超长按 Unicode 码点截断到 60", () => {
    expect(Array.from(slugify("中".repeat(70)))).toHaveLength(60);
    expect(slugify("中".repeat(70))).toBe("中".repeat(60));
  });

  it("截断不切坏代理对", () => {
    const slug = slugify("a" + "😀".repeat(70) + "b");
    expect(slug).toBe("a-b");
    expect(slug.includes("\uFFFD")).toBe(false);
    for (let index = 0; index < slug.length; index += 1) {
      const code = slug.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = slug.charCodeAt(index + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        index += 1;
      }
    }
  });

  it("去掉首尾连字符与点号", () => {
    expect(slugify(".标题.")).toBe("标题");
    expect(slugify("--标题--")).toBe("标题");
    expect(slugify(" - 标题 - ")).toBe("标题");
  });

  it("空结果回退 untitled", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("///")).toBe("untitled");
    expect(slugify("...")).toBe("untitled");
    expect(slugify("😀😀")).toBe("untitled");
  });
});

describe("writeOutline", () => {
  it("写入 outlines/<slug>.outline.md 并返回路径、slug 与 hash", () => {
    const root = makeRoot();
    const markdown = "# 大纲\n\n## 第一节\n";

    const written = createFileWriter().writeOutline({
      workspaceRoot: root,
      title: "我的文章",
      markdown,
    });

    expect(written.path).toBe(join(root, "outlines", "我的文章.outline.md"));
    expect(written.slug).toBe("我的文章");
    expect(written.hash).toBe(hashContent(markdown));
    expect(readText(written.path)).toBe(markdown);
    expect(readText(written.path).endsWith("\n")).toBe(true);
  });

  it("缺少末尾换行时补一个换行，且数到内容一致", () => {
    const root = makeRoot();

    const written = createFileWriter().writeOutline({
      workspaceRoot: root,
      title: "无换行",
      markdown: "# 大纲",
    });

    const content = readText(written.path);
    expect(content).toBe("# 大纲\n");
    expect(written.hash).toBe(hashContent(content));
    expect(content.endsWith("\n\n")).toBe(false);
  });

  it("显式 slug 优先于标题", () => {
    const root = makeRoot();

    const written = createFileWriter().writeOutline({
      workspaceRoot: root,
      title: "标题",
      slug: "custom-slug",
      markdown: "x\n",
    });

    expect(written.slug).toBe("custom-slug");
    expect(written.path).toBe(join(root, "outlines", "custom-slug.outline.md"));
  });
});

describe("writeDraft", () => {
  it("写入 articles/<slug>.md", () => {
    const root = makeRoot();

    const written = createFileWriter().writeDraft({
      workspaceRoot: root,
      title: "草稿 标题",
      markdown: "正文\n",
    });

    expect(written.path).toBe(join(root, "articles", "草稿-标题.md"));
    expect(readText(written.path)).toBe("正文\n");
  });
});

describe("exportMarkdown", () => {
  it("默认导出到 articles", () => {
    const root = makeRoot();

    const written = createFileWriter().exportMarkdown({
      workspaceRoot: root,
      title: "导出标题",
      markdown: "内容\n",
    });

    expect(written.path).toBe(join(root, "articles", "导出标题.md"));
    expect(readText(written.path)).toBe("内容\n");
  });

  it("绝对 outputDir 直接使用", () => {
    const root = makeRoot();
    const outside = makeRoot();

    const written = createFileWriter().exportMarkdown({
      workspaceRoot: root,
      title: "绝对",
      markdown: "内容\n",
      outputDir: outside,
    });

    expect(written.path).toBe(join(outside, "绝对.md"));
    expect(readText(written.path)).toBe("内容\n");
  });

  it("相对 outputDir 按 workspaceRoot 解析并递归创建目录", () => {
    const root = makeRoot();

    const written = createFileWriter().exportMarkdown({
      workspaceRoot: root,
      title: "相对",
      markdown: "内容\n",
      outputDir: join("dist", "nested", "markdown"),
    });

    expect(written.path).toBe(join(root, "dist", "nested", "markdown", "相对.md"));
    expect(statSync(join(root, "dist", "nested", "markdown")).isDirectory()).toBe(true);
  });

  it("提供 replacePath 时覆盖本会话主稿，而不是另存 -2", () => {
    const root = makeRoot();
    const writer = createFileWriter();
    const draft = writer.writeDraft({ workspaceRoot: root, title: "主稿", markdown: "草稿正文\n" });

    const exported = writer.exportMarkdown({
      workspaceRoot: root,
      title: "主稿",
      markdown: "终稿正文\n",
      replacePath: draft.path,
    });

    expect(exported.path).toBe(draft.path);
    expect(readText(draft.path)).toBe("终稿正文\n");
    expect(entryNames(join(root, "articles"))).toEqual(["主稿.md"]);
    expect(exported.hash).toBe(hashContent("终稿正文\n"));
  });

  it("显式 outputDir 时 ignore replacePath，按目标目录正常换名", () => {
    const root = makeRoot();
    const outside = makeRoot();
    const writer = createFileWriter();
    const draft = writer.writeDraft({ workspaceRoot: root, title: "主稿", markdown: "草稿正文\n" });
    writer.exportMarkdown({
      workspaceRoot: root,
      title: "主稿",
      markdown: "第一版终稿\n",
      replacePath: draft.path,
    });

    const exported = writer.exportMarkdown({
      workspaceRoot: root,
      title: "主稿",
      markdown: "第二版终稿\n",
      outputDir: outside,
      replacePath: draft.path,
    });

    expect(exported.path).toBe(join(outside, "主稿.md"));
    expect(readText(draft.path)).toBe("第一版终稿\n");
  });

  it("导出也统一补末尾换行", () => {
    const root = makeRoot();

    const written = createFileWriter().exportMarkdown({
      workspaceRoot: root,
      title: "裸文本",
      markdown: "没有换行",
    });

    expect(readText(written.path)).toBe("没有换行\n");
    expect(written.hash).toBe(hashContent("没有换行\n"));
  });
});

describe("原子写入", () => {
  it("成功后不残留临时文件", () => {
    const root = makeRoot();

    createFileWriter().writeDraft({ workspaceRoot: root, title: "原子", markdown: "正文\n" });

    expect(entryNames(join(root, "articles"))).toEqual(["原子.md"]);
  });

  it("换名写入也不残留临时文件", () => {
    const root = makeRoot();
    const writer = createFileWriter();
    writer.writeDraft({ workspaceRoot: root, title: "原子", markdown: "第一版\n" });
    writer.writeDraft({ workspaceRoot: root, title: "原子", markdown: "第二版\n" });

    const dir = join(root, "articles");
    expect(tempFilesIn(dir)).toEqual([]);
    expect(entryNames(dir)).toEqual(["原子-2.md", "原子.md"]);
  });

  it("写入失败时不残留临时文件", () => {
    const root = makeRoot();
    mkdirSync(join(root, "articles", "占用.md"), { recursive: true });

    captureAppError(() =>
      createFileWriter().writeDraft({ workspaceRoot: root, title: "占用", markdown: "正文\n" }),
    );

    expect(tempFilesIn(join(root, "articles"))).toEqual([]);
  });
});

describe("换名与幂等", () => {
  it("同内容重跑复用同一路径", () => {
    const root = makeRoot();
    const writer = createFileWriter();

    const first = writer.writeDraft({ workspaceRoot: root, title: "重跑", markdown: "相同\n" });
    const second = writer.writeDraft({ workspaceRoot: root, title: "重跑", markdown: "相同\n" });

    expect(second.path).toBe(first.path);
    expect(second.slug).toBe("重跑");
    expect(second.hash).toBe(first.hash);
    expect(entryNames(join(root, "articles"))).toEqual(["重跑.md"]);
  });

  it("同内容重跑在补换行后仍然幂等", () => {
    const root = makeRoot();
    const writer = createFileWriter();

    const first = writer.writeDraft({ workspaceRoot: root, title: "补换行", markdown: "相同" });
    const second = writer.writeDraft({ workspaceRoot: root, title: "补换行", markdown: "相同" });

    expect(second.path).toBe(first.path);
    expect(entryNames(join(root, "articles"))).toEqual(["补换行.md"]);
  });

  it("不同内容换名为 -2、-3", () => {
    const root = makeRoot();
    const writer = createFileWriter();

    writer.writeDraft({ workspaceRoot: root, title: "连载", markdown: "一\n" });
    const second = writer.writeDraft({ workspaceRoot: root, title: "连载", markdown: "二\n" });
    const third = writer.writeDraft({ workspaceRoot: root, title: "连载", markdown: "三\n" });

    expect(second.slug).toBe("连载-2");
    expect(second.path).toBe(join(root, "articles", "连载-2.md"));
    expect(third.slug).toBe("连载-3");
    expect(entryNames(join(root, "articles"))).toEqual(["连载-2.md", "连载-3.md", "连载.md"]);
  });

  it("显式 slug 同样遵守换名规则", () => {
    const root = makeRoot();
    const writer = createFileWriter();

    const first = writer.exportMarkdown({
      workspaceRoot: root,
      title: "标题",
      slug: "fixed",
      markdown: "一\n",
    });
    const second = writer.exportMarkdown({
      workspaceRoot: root,
      title: "标题",
      slug: "fixed",
      markdown: "二\n",
    });

    expect(first.slug).toBe("fixed");
    expect(second.slug).toBe("fixed-2");
    expect(second.path).toBe(join(root, "articles", "fixed-2.md"));
  });

  it("冲突超过 50 次抛 VALIDATION", () => {
    const root = makeRoot();
    const dir = join(root, "articles");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "撞名.md"), "基准\n", "utf8");
    for (let index = 2; index <= 51; index += 1) {
      writeFileSync(join(dir, `撞名-${index}.md`), `占位 ${index}\n`, "utf8");
    }

    const error = captureAppError(() =>
      createFileWriter().writeDraft({ workspaceRoot: root, title: "撞名", markdown: "新内容\n" }),
    );

    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain("撞名");
    expect(entryNames(dir)).toHaveLength(51);
  });
});

describe("错误处理", () => {
  it("workspaceRoot 不存在抛 VALIDATION", () => {
    const root = makeRoot();
    const missing = join(root, "missing");

    const error = captureAppError(() =>
      createFileWriter().writeDraft({ workspaceRoot: missing, title: "标题", markdown: "正文\n" }),
    );

    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain("工作目录不存在");
    expect(error.hint).toBeTruthy();
  });

  it("workspaceRoot 是文件抛 VALIDATION", () => {
    const root = makeRoot();
    const file = join(root, "not-a-dir.txt");
    writeFileSync(file, "x", "utf8");

    const error = captureAppError(() =>
      createFileWriter().writeOutline({ workspaceRoot: file, title: "标题", markdown: "正文\n" }),
    );

    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain("不是目录");
  });

  it("目标被目录占用抛 VALIDATION 且不写入", () => {
    const root = makeRoot();
    const dir = join(root, "articles");
    mkdirSync(join(dir, "占用.md"), { recursive: true });

    const error = captureAppError(() =>
      createFileWriter().writeDraft({ workspaceRoot: root, title: "占用", markdown: "正文\n" }),
    );

    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain("目录占用");
    expect(entryNames(dir)).toEqual(["占用.md"]);
  });

  it(
    "目录不可写抛 RUNTIME",
    { skip: typeof process.getuid === "function" && process.getuid() === 0 },
    () => {
      const root = makeRoot();
      const dir = join(root, "articles");
      mkdirSync(dir, { recursive: true, mode: 0o500 });

      try {
        const error = captureAppError(() =>
          createFileWriter().writeDraft({ workspaceRoot: root, title: "只读", markdown: "正文\n" }),
        );
        expect(error.code).toBe("RUNTIME");
        expect(error.message).toContain("权限");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
