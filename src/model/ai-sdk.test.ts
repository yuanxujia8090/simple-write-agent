/**
 * 模型输出取值的边界测试：不联网，只验证「从真实模型常见的脏输出里取出对象」这条路径。
 * 结构化调用的重试与 zod 校验依赖同一函数，故这里覆盖围栏、前后说明、坏 JSON、非对象顶层。
 */
import { describe, expect, it } from "vitest";

import { extractJsonObject } from "./ai-sdk.js";

describe("extractJsonObject", () => {
  it("直接返回纯 JSON 对象", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥掉 ```json 代码围栏", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("剥掉不带语言标记的围栏", () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("忽略对象前后的说明文字", () => {
    const text = '好的，结果如下：\n{"a":1,"b":[2]}\n以上。';
    expect(extractJsonObject(text)).toEqual({ a: 1, b: [2] });
  });

  it("对象里含嵌套结构时按最后一个 } 收口", () => {
    expect(extractJsonObject('说明 {"a":{"b":2}} 尾巴')).toEqual({ a: { b: 2 } });
  });

  it("没有对象时给出可读错误", () => {
    expect(() => extractJsonObject("抱歉，我无法完成")).toThrow(/没有 JSON 对象/);
  });

  it("JSON 语法坏掉时给出可读错误", () => {
    expect(() => extractJsonObject('{"a":1,}')).toThrow(/JSON 无法解析/);
  });

  it("括号没闭合时按「没有对象」处理，不猜截断位置", () => {
    expect(() => extractJsonObject('{"a":')).toThrow(/没有 JSON 对象/);
  });

  it("顶层是数组时报错，避免把列表当阶段产物", () => {
    expect(() => extractJsonObject("[1,2]")).toThrow(/没有 JSON 对象/);
  });

  it("顶层是 null 时报错", () => {
    expect(() => extractJsonObject("null")).toThrow(/没有 JSON 对象/);
  });
});
