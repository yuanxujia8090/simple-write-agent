/** 本地风格包解析结果；正文只在运行时内存中，不写回 git 跟踪路径。 */
export type StyleProfile = {
  /** 风格 id（目录名）或 path 形式的短名 */
  id: string;
  /** 风格包根目录（绝对路径） */
  rootDir: string;
  /** 实际读入的入口文件绝对路径 */
  entryPath: string;
  /** 入口文件全文 */
  bodyText: string;
};
