/** 文件产物写入端口：大纲、主稿、导出都走同一套原子写入与命名规则。 */

export type WrittenFile = {
  path: string;
  slug: string;
  /** 与数据库版本记录对比用的内容指纹。 */
  hash: string;
};

export type WriteOutlineInput = {
  workspaceRoot: string;
  title: string;
  markdown: string;
  /** 显式指定文件名（不含扩展名）；不传则从标题生成。 */
  slug?: string;
};

export type WriteDraftInput = {
  workspaceRoot: string;
  title: string;
  markdown: string;
  slug?: string;
};

export type ExportMarkdownInput = {
  workspaceRoot: string;
  title: string;
  markdown: string;
  slug?: string;
  /** 绝对路径直接使用；相对路径按工作目录解析。 */
  outputDir?: string;
  /**
   * 允许覆盖的路径：本会话自己的主稿文件。
   * 导出终稿时替换这份主稿（内容以终稿为准），其他既有文件仍然不覆盖。
   */
  replacePath?: string;
};

export interface FileWriter {
  writeOutline(input: WriteOutlineInput): WrittenFile;
  writeDraft(input: WriteDraftInput): WrittenFile;
  exportMarkdown(input: ExportMarkdownInput): WrittenFile;
}
