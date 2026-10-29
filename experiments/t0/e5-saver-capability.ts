import { readFile } from "node:fs/promises";

import Database from "better-sqlite3";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

import { buildDraftGraph, initialDraftState } from "./e1-interrupt-resume.js";
import {
  countRows,
  makeExperimentResult,
  makeTempWorkspace,
  type Check,
  type ExperimentResult,
} from "./shared.js";

const SAVER_DTS_URL = new URL(
  "../../node_modules/@langchain/langgraph-checkpoint-sqlite/dist/index.d.ts",
  import.meta.url,
);
const SAVER_PACKAGE_URL = new URL(
  "../../node_modules/@langchain/langgraph-checkpoint-sqlite/package.json",
  import.meta.url,
);

async function readConstructorSignature(): Promise<string> {
  const source = await readFile(SAVER_DTS_URL, "utf8");
  const match = /constructor\([^)]*\)/.exec(source);
  if (match === null) {
    throw new Error("未在 SqliteSaver 类型声明中找到 constructor 签名");
  }
  return match[0].replace("Database$1", "Database");
}

async function readSaverVersion(): Promise<string> {
  const raw = await readFile(SAVER_PACKAGE_URL, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error("读取 SqliteSaver 包版本失败");
  }
  const version = (parsed as { version: unknown }).version;
  return typeof version === "string" ? version : "unknown";
}

export type E5Evidence = {
  saverVersion: string;
  constructorSignature: string;
  acceptsExternalDatabase: boolean;
  exposesConnection: boolean;
  exposesTransactionMethod: boolean;
  putIsAsync: boolean;
  putWritesIsAsync: boolean;
  fromConnStringExists: boolean;
  checkpointRowsAtPause: number;
  writeRowsAtPause: number;
  checkpointRowsAfterResume: number;
  nodeExecutionLog: string[];
};

export type E5Result = ExperimentResult & { evidence: E5Evidence };

export async function runE5(): Promise<E5Result> {
  const workspace = await makeTempWorkspace("t0-e5-");
  const db = new Database(workspace.path("capability.sqlite"));

  try {
    const saverVersion = await readSaverVersion();
    const constructorSignature = await readConstructorSignature();
    const saver = new SqliteSaver(db);

    const acceptsExternalDatabase = saver.db === db;
    const exposesTransactionMethod = "transaction" in saver;
    const exposesConnection =
      acceptsExternalDatabase && typeof saver.db.transaction === "function";
    const putIsAsync = saver.put.constructor.name === "AsyncFunction";
    const putWritesIsAsync = saver.putWrites.constructor.name === "AsyncFunction";
    const fromConnStringExists = typeof SqliteSaver.fromConnString === "function";

    // interrupt() 写入时机：同一个 saver 与图实例，观察暂停点前后落盘情况与节点重跑。
    const nodeExecutionLog: string[] = [];
    const graph = buildDraftGraph(saver, nodeExecutionLog);
    const config = { configurable: { thread_id: "e5-interrupt-timing" } };
    await graph.invoke(initialDraftState, config);
    const paused = await graph.getState(config);
    const checkpointRowsAtPause = countRows(db, "checkpoints");
    const writeRowsAtPause = countRows(db, "writes");
    await graph.invoke(new Command({ resume: { decision: "defer" } }), config);
    const checkpointRowsAfterResume = countRows(db, "checkpoints");
    const gateRuns = nodeExecutionLog.filter((entry) => entry === "confirmGate").length;
    const generateRuns = nodeExecutionLog.filter((entry) => entry === "generate").length;

    const checks: Check[] = [
      {
        label: "构造参数签名",
        pass:
          constructorSignature.includes("db: Database") &&
          constructorSignature.includes("serde?: SerializerProtocol"),
        detail: `${constructorSignature}（@langchain/langgraph-checkpoint-sqlite ${saverVersion}）`,
      },
      {
        label: "是否接受外部 better-sqlite3 Database 实例",
        pass: acceptsExternalDatabase,
        detail: `new SqliteSaver(db).db === db → ${acceptsExternalDatabase}；另有静态 SqliteSaver.fromConnString()（存在=${fromConnStringExists}）`,
      },
      {
        label: "是否暴露底层连接/事务方法",
        pass: exposesConnection && !exposesTransactionMethod,
        detail: `公开 saver.db（${typeof saver.db.transaction === "function" ? "带 transaction()" : "无 transaction()"}）；saver 自身有 transaction 方法=${exposesTransactionMethod}`,
      },
      {
        label: "put/putWrites 是否同步可嵌入事务",
        pass: putIsAsync && putWritesIsAsync,
        detail: `put async=${putIsAsync} putWrites async=${putWritesIsAsync} → 不能直接嵌入 better-sqlite3 的同步 db.transaction()`,
      },
      {
        label: "interrupt() 写入时机",
        pass: checkpointRowsAtPause >= 1 && paused.next.length === 1 && paused.next[0] === "confirmGate",
        detail: `暂停时 next=${JSON.stringify(paused.next)}；checkpoints=${checkpointRowsAtPause} 行、writes=${writeRowsAtPause} 行（interrupt 在任务边界把已完成节点的写入落盘）`,
      },
      {
        label: "恢复时重跑中断节点",
        pass: generateRuns === 1 && gateRuns === 2,
        detail: `节点执行序列=${JSON.stringify(nodeExecutionLog)}；恢复后 checkpoints=${checkpointRowsAfterResume} 行（生成节点不重跑，门禁节点从头重跑）`,
      },
    ];

    const evidence: E5Evidence = {
      saverVersion,
      constructorSignature,
      acceptsExternalDatabase,
      exposesConnection,
      exposesTransactionMethod,
      putIsAsync,
      putWritesIsAsync,
      fromConnStringExists,
      checkpointRowsAtPause,
      writeRowsAtPause,
      checkpointRowsAfterResume,
      nodeExecutionLog,
    };

    const result = makeExperimentResult({
      id: "E5",
      title: "SqliteSaver 能力与 interrupt 写入时机",
      expected:
        "记录锁定版本的实际 API：构造参数、外部连接、事务方法暴露情况、异步写入与 interrupt 落盘时机",
      actual: `版本 ${saverVersion}；构造 ${constructorSignature}；外部 Database=${acceptsExternalDatabase}；saver.transaction=${exposesTransactionMethod}；put async=${putIsAsync}；暂停时 checkpoints=${checkpointRowsAtPause} writes=${writeRowsAtPause}；恢复后 checkpoints=${checkpointRowsAfterResume}；节点序列=${JSON.stringify(nodeExecutionLog)}`,
      conclusion: resultPass(checks)
        ? "SqliteSaver 可复用外部连接且有公开的 saver.db，但唯一写入口 put()/putWrites() 是异步的，且 setup() 内含 PRAGMA（必须事务外先触发）；同事务写 checkpoint 需要业务侧自己预序列化后插入 checkpoints 表"
        : "能力记录与实测不符，见失败项",
      checks,
    });

    return { ...result, evidence };
  } finally {
    db.close();
    await workspace.cleanup();
  }
}

function resultPass(checks: readonly Check[]): boolean {
  return checks.every((check) => check.pass);
}
