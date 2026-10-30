/**
 * 重放命令入口：
 * `npm run replay -- [--workspace <目录>] [--scenario basic|revise|reject] [--mode normal|fast]
 *   [--db <库文件>] [--theme <主题.json>] [--model mock|env]`
 */
import { parseArgs } from "node:util";
import { homedir } from "node:os";

import { loadLocalEnvFile } from "../config/env-file.js";
import { loadConfig } from "../config/index.js";
import { defaultWorkspace, formatResult, runReplay, type ReplayScenario } from "./replay.js";

async function main(): Promise<number> {
  let values: {
    workspace?: string;
    scenario?: string;
    mode?: string;
    db?: string;
    theme?: string;
    model?: string;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        workspace: { type: "string" },
        scenario: { type: "string" },
        mode: { type: "string" },
        db: { type: "string" },
        theme: { type: "string" },
        model: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values;
  } catch (error) {
    process.stderr.write(`参数无法识别：${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(
      "用法：npm run replay -- [--workspace <目录>] [--scenario basic|revise|reject] [--mode normal|fast] [--db <库文件>]\n",
    );
    return 1;
  }

  if (values.help) {
    process.stdout.write(
      [
        "写作闭环重放（固定模型结果，不联网）",
        "",
        "用法：npm run replay -- [选项]",
        "",
        "  --workspace <目录>   产物写入目录；默认在系统临时目录新建一个",
        "  --scenario <名称>    basic（全部批准，默认）| revise（论点修改一次）| reject（终稿拒绝一次）",
        "  --mode <模式>        normal（默认，5 道门禁）| fast（只保留论点和终稿）",
        "  --db <库文件>        写入 SQLite 库文件；不传则只用内存，进程退出即丢",
        "  --theme <主题.json>  公众号 HTML 样式主题；不传用内置默认主题",
        "  --model <来源>       mock（默认，脚本化固定结果）| env（读取 .env.local 的真实模型）",
      ].join("\n") + "\n",
    );
    return 0;
  }

  const scenario = values.scenario ?? "basic";
  if (scenario !== "basic" && scenario !== "revise" && scenario !== "reject") {
    process.stderr.write(`未知场景：${scenario}；可选 basic、revise、reject\n`);
    return 1;
  }

  const modeValue = values.mode ?? "normal";
  if (modeValue !== "normal" && modeValue !== "fast") {
    process.stderr.write(`未知模式：${modeValue}；可选 normal、fast\n`);
    return 1;
  }

  const modelValue = values.model ?? "mock";
  if (modelValue !== "mock" && modelValue !== "env") {
    process.stderr.write(`未知模型来源：${modelValue}；可选 mock、env\n`);
    return 1;
  }

  // 真实模型：先读 .env.local，再按「环境变量 > config.json > 默认值」取配置。
  const env: Record<string, string | undefined> = { ...process.env };
  let modelConfig: ReturnType<typeof loadConfig>["model"] | undefined;
  if (modelValue === "env") {
    try {
      loadLocalEnvFile({ cwd: process.cwd(), env });
      modelConfig = loadConfig({ homeDir: homedir(), env }).model;
    } catch (error) {
      process.stderr.write(`模型配置读取失败：${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  const workspaceRoot = values.workspace ?? defaultWorkspace();
  try {
    const result = await runReplay({
      workspaceRoot,
      scenario: scenario as ReplayScenario,
      mode: modeValue,
      ...(values.db === undefined ? {} : { dbPath: values.db }),
      ...(values.theme === undefined ? {} : { themePath: values.theme }),
      ...(modelValue === "env" ? { model: "env" as const } : {}),
      ...(modelConfig === undefined ? {} : { modelConfig }),
    });
    process.stdout.write(`${formatResult(result)}\n`);
    if (result.status !== "exported") {
      process.stderr.write(`重放未走到导出：${result.error ?? result.status}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    process.stderr.write(`重放失败：${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main();
