/**
 * 从 LangGraph 的 SQLite 保存器取稳定 checkpoint，序列化后再交给业务事务写入（ADR 0012）。
 * 只读 `getTuple()`，不改保存器的写入路径；序列化用保存器自己的 serde，格式随版本走。
 */
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

import type { CheckpointPort, PreparedCheckpoint } from "../domain/store.js";

export function createSaverCheckpointPort(saver: SqliteSaver): CheckpointPort {
  return {
    async prepare(threadId: string): Promise<PreparedCheckpoint | null> {
      const tuple = await saver.getTuple({
        configurable: { thread_id: threadId, checkpoint_ns: "" },
      });
      if (tuple === undefined) {
        return null;
      }
      const checkpoint = tuple.checkpoint as Checkpoint;
      const metadata = tuple.metadata as CheckpointMetadata;
      const [checkpointType, checkpointBlob] = await saver.serde.dumpsTyped(checkpoint);
      const [metadataType, metadataBlob] = await saver.serde.dumpsTyped(metadata);
      if (checkpointType !== metadataType) {
        throw new Error("checkpoint 与 metadata 的序列化类型不一致，拒绝写入");
      }
      return {
        threadId,
        checkpointNs: tuple.config.configurable?.checkpoint_ns ?? "",
        checkpointId: checkpoint.id,
        parentCheckpointId: tuple.parentConfig?.configurable?.checkpoint_id ?? null,
        type: checkpointType,
        checkpoint: checkpointBlob,
        metadata: metadataBlob,
      };
    },
  };
}
