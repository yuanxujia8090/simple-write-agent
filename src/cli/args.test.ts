import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./args.js";
import { AppError } from "../shared/errors.js";

describe("parseCliArgs", () => {
  it("无参数时得到全部默认值", () => {
    const options = parseCliArgs([]);
    expect(options.help).toBe(false);
    expect(options.files).toEqual([]);
    expect(options.fast).toBe(false);
    expect(options.yes).toBe(false);
  });

  it("解析 --yes", () => {
    expect(parseCliArgs(["--yes"]).yes).toBe(true);
  });

  it("解析话题、工作目录与快速模式", () => {
    const options = parseCliArgs(["--topic", "跨端同步", "--cwd", "./x", "--fast"]);
    expect(options.topic).toBe("跨端同步");
    expect(options.cwd).toBe("./x");
    expect(options.fast).toBe(true);
  });

  it("--file 可重复指定", () => {
    const options = parseCliArgs(["--file", "a.md", "--file", "b.txt"]);
    expect(options.files).toEqual(["a.md", "b.txt"]);
  });

  it("支持 -h 与 -v 短参数", () => {
    expect(parseCliArgs(["-h"]).help).toBe(true);
    expect(parseCliArgs(["-v"]).version).toBe(true);
  });

  it("未知参数给出可读用法错误", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(AppError);
    try {
      parseCliArgs(["--nope"]);
    } catch (error) {
      expect((error as AppError).code).toBe("USAGE");
      expect((error as AppError).message).toContain("--nope");
      expect((error as AppError).hint).toContain("--help");
    }
  });

  it("拒绝位置参数并提示用 --topic", () => {
    try {
      parseCliArgs(["run"]);
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain("run");
      expect((error as AppError).hint).toContain("--topic");
    }
  });

  it("缺少参数值时报用法错误", () => {
    expect(() => parseCliArgs(["--topic"])).toThrow(AppError);
  });
});

  it("解析 --style", () => {
    const options = parseCliArgs(["--style", "demo"]);
    expect(options.style).toBe("demo");
  });

