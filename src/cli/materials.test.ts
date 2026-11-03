import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppError } from "../shared/errors.js";
import {
  deriveTopic,
  loadMaterialsFromFiles,
  materialsForStart,
} from "./materials.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "writing-agent-materials-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadMaterialsFromFiles", () => {
  it("读到本地素材正文", async () => {
    const file = join(root, "notes.md");
    await writeFile(file, "# 标题\n\n正文一段。\n", "utf8");
    const loaded = loadMaterialsFromFiles(["notes.md"], root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.text).toContain("正文一段");
    expect(materialsForStart(loaded)[0]).toContain("来源：notes.md");
  });

  it("缺文件时给出可读路径", () => {
    expect(() => loadMaterialsFromFiles(["./nope.md"], root)).toThrow(AppError);
    try {
      loadMaterialsFromFiles(["./nope.md"], root);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain("找不到素材文件");
      expect((error as AppError).message).toContain("nope.md");
    }
  });

  it("全部空白拒绝启动", async () => {
    await writeFile(join(root, "empty.md"), "  \n\t\n", "utf8");
    expect(() => loadMaterialsFromFiles(["empty.md"], root)).toThrow(/内容为空/);
  });
});

describe("deriveTopic", () => {
  it("显式 topic 优先", async () => {
    await writeFile(join(root, "a.md"), "hello", "utf8");
    const loaded = loadMaterialsFromFiles(["a.md"], root);
    expect(deriveTopic("显式话题", loaded)).toBe("显式话题");
  });

  it("无 topic 时用文件名", async () => {
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "跨端同步.md"), "内容", "utf8");
    const loaded = loadMaterialsFromFiles(["sub/跨端同步.md"], root);
    expect(deriveTopic(undefined, loaded)).toBe("跨端同步");
  });
});
