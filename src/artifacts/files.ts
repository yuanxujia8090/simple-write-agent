/** 文件产物写入适配器：大纲、主稿、Markdown 导出共用同一套命名、换名与原子写入规则。 */

import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type {
  ExportMarkdownInput,
  FileWriter,
  WriteDraftInput,
  WriteHtmlInput,
  WriteOutlineInput,
  WrittenFile,
} from "../domain/files.js";
import { AppError } from "../shared/errors.js";
import { hashContent } from "../shared/hash.js";

const MAX_SLUG_CODE_POINTS = 60;
const MAX_RENAME_ATTEMPTS = 50;
const OUTLINE_DIR = "outlines";
const ARTICLE_DIR = "articles";
const OUTLINE_EXTENSION = ".outline.md";
const MARKDOWN_EXTENSION = ".md";
const HTML_EXTENSION = ".html";

const KEPT_CHARS = /[\p{L}\p{M}\p{N}-]/u;
const REPEATED_HYPHENS = /-{2,}/gu;
const EDGE_SEPARATORS = /^[-.]+|[-.]+$/gu;

/** 标题 → 文件名标识：保留中文与字母数字，其余字符折叠为单个 `-`。 */
export function slugify(title: string): string {
  const cleaned = Array.from(title, (char) => (KEPT_CHARS.test(char) ? char : "-"))
    .join("")
    .replace(REPEATED_HYPHENS, "-")
    .replace(EDGE_SEPARATORS, "");

  const codePoints = Array.from(cleaned);
  const truncated =
    codePoints.length > MAX_SLUG_CODE_POINTS
      ? codePoints.slice(0, MAX_SLUG_CODE_POINTS).join("")
      : cleaned;
  const trimmed = truncated.replace(EDGE_SEPARATORS, "");

  return trimmed === "" ? "untitled" : trimmed;
}

export function createFileWriter(): FileWriter {
  return {
    writeOutline(input: WriteOutlineInput): WrittenFile {
      const root = requireWorkspaceRoot(input.workspaceRoot);
      const dir = join(root, OUTLINE_DIR);
      const content = ensureTrailingNewline(input.markdown);
      return writeArtifact({
        workspaceRoot: root,
        dir,
        title: input.title,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        content,
        fileNameFor: (slug) => `${slug}${OUTLINE_EXTENSION}`,
      });
    },

    writeDraft(input: WriteDraftInput): WrittenFile {
      const root = requireWorkspaceRoot(input.workspaceRoot);
      const dir = join(root, ARTICLE_DIR);
      const content = ensureTrailingNewline(input.markdown);
      return writeArtifact({
        workspaceRoot: root,
        dir,
        title: input.title,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        content,
        fileNameFor: (slug) => `${slug}${MARKDOWN_EXTENSION}`,
      });
    },

    exportMarkdown(input: ExportMarkdownInput): WrittenFile {
      const root = requireWorkspaceRoot(input.workspaceRoot);
      const dir =
        input.outputDir === undefined
          ? join(root, ARTICLE_DIR)
          : isAbsolute(input.outputDir)
            ? input.outputDir
            : resolve(root, input.outputDir);
      const content = ensureTrailingNewline(input.markdown);

      // 导出终稿到本会话自己的主稿路径：替换它（内容以终稿为准）。
      if (input.replacePath !== undefined && input.outputDir === undefined) {
        const target = resolve(input.replacePath);
        ensureDirectory(dirname(target));
        writeAtomically(target, content);
        return {
          path: target,
          slug: basename(target).replace(new RegExp(`${MARKDOWN_EXTENSION}$`), ""),
          hash: hashContent(content),
        };
      }

      return writeArtifact({
        workspaceRoot: root,
        dir,
        title: input.title,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        content,
        fileNameFor: (slug) => `${slug}${MARKDOWN_EXTENSION}`,
      });
    },

    writeHtml(input: WriteHtmlInput): WrittenFile {
      const root = requireWorkspaceRoot(input.workspaceRoot);

      // 重新导出时替换本会话自己的 HTML，保持与 Markdown 同 slug。
      if (input.replacePath !== undefined) {
        const target = resolve(input.replacePath);
        ensureDirectory(dirname(target));
        writeAtomically(target, input.html);
        return {
          path: target,
          slug: basename(target).replace(new RegExp(`${HTML_EXTENSION}$`), ""),
          hash: hashContent(input.html),
        };
      }

      return writeArtifact({
        workspaceRoot: root,
        dir: join(root, ARTICLE_DIR),
        title: input.title,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        content: input.html,
        fileNameFor: (slug) => `${slug}${HTML_EXTENSION}`,
      });
    },

    /** 与写入时同一套指纹算法（含结尾换行规则），用于外部编辑检测。 */
    readHash(path: string): string | null {
      try {
        return hashContent(readFileSync(path, "utf8"));
      } catch (error) {
        if (isErrno(error, "ENOENT")) {
          return null;
        }
        throw asWriteError(error, path);
      }
    },
  };
}

type WriteArtifactOptions = {
  workspaceRoot: string;
  dir: string;
  title: string;
  slug?: string;
  content: string;
  fileNameFor: (slug: string) => string;
};

function writeArtifact(options: WriteArtifactOptions): WrittenFile {
  const baseSlug = slugify(options.slug ?? options.title);
  ensureDirectory(options.dir);

  const contentHash = hashContent(options.content);
  for (let renameIndex = 0; renameIndex <= MAX_RENAME_ATTEMPTS; renameIndex += 1) {
    const slug = renameIndex === 0 ? baseSlug : `${baseSlug}-${renameIndex + 1}`;
    const filePath = join(options.dir, options.fileNameFor(slug));
    const existing = statIfExists(filePath);

    if (existing === null) {
      writeAtomically(filePath, options.content);
      return { path: filePath, slug, hash: contentHash };
    }
    if (existing.isDirectory()) {
      throw new AppError(
        "VALIDATION",
        `目标路径已被目录占用：${filePath}`,
        "换一个标题或显式指定 --slug，或移走同名目录后重试",
      );
    }
    if (hashContent(readExisting(filePath)) === contentHash) {
      return { path: filePath, slug, hash: contentHash };
    }
  }

  throw new AppError(
    "VALIDATION",
    `文件名冲突超过 ${MAX_RENAME_ATTEMPTS} 次：${baseSlug}`,
    "换一个标题或显式指定 --slug",
  );
}

/** 先写同目录临时文件再 rename，避免进程中断留下半截文件。 */
function writeAtomically(filePath: string, content: string): void {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.tmp-${randomBytes(6).toString("hex")}`,
  );
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o644, flag: "wx" });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    removeIfExists(temporaryPath);
    throw asWriteError(error, filePath);
  }
}

function ensureDirectory(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
  } catch (error) {
    throw asWriteError(error, dir);
  }
}

function requireWorkspaceRoot(workspaceRoot: string): string {
  const root = resolve(workspaceRoot);
  let stats;
  try {
    stats = statSync(root);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new AppError(
        "VALIDATION",
        `工作目录不存在：${root}`,
        "检查 --cwd 路径，或先初始化工作目录",
      );
    }
    throw asWriteError(error, root);
  }
  if (!stats.isDirectory()) {
    throw new AppError(
      "VALIDATION",
      `工作目录不是目录：${root}`,
      "检查 --cwd 路径是否指向一个目录",
    );
  }
  return root;
}

function readExisting(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    throw asWriteError(error, filePath);
  }
}

function statIfExists(filePath: string): Stats | null {
  try {
    return statSync(filePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return null;
    }
    throw asWriteError(error, filePath);
  }
}

function removeIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // 清理失败不覆盖原始错误。
  }
}

function ensureTrailingNewline(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function asWriteError(error: unknown, path: string): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (isErrno(error, "EACCES") || isErrno(error, "EPERM")) {
    return new AppError("RUNTIME", `没有写入权限：${path}`, "检查目录权限或换一个工作目录");
  }
  if (isErrno(error, "EROFS")) {
    return new AppError("RUNTIME", `文件系统只读：${path}`, "换一个可写的工作目录");
  }
  if (isErrno(error, "ENOSPC")) {
    return new AppError("RUNTIME", `磁盘空间不足：${path}`, "清理磁盘后重试");
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new AppError("RUNTIME", `写入文件失败：${path}`, detail);
}
