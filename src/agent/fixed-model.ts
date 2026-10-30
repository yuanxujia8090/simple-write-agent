/**
 * 固定模型适配器：按阶段返回脚本化结果，不联网、不读取真实凭据、不调用真实模型。
 * 本阶段只用它验证编排图与门禁衔接，内容不代表真实生成质量。
 */
import type {
  CreativeBriefContent,
  DraftContent,
  FactReportContent,
  MaterialBatchContent,
  OutlineContent,
  ThesisContent,
} from "../domain/types.js";

export type BriefInput = { topic: string };

export type MaterialsInput = { topic: string; supplied: string[] };

export type ThesisInput = { brief: CreativeBriefContent; materials: MaterialBatchContent };

export type OutlineInput = { brief: CreativeBriefContent; thesis: ThesisContent };

export type DraftInput = { outline: OutlineContent; thesis: ThesisContent };

export type FactReportInput = { draft: DraftContent };

export type FinalInput = { draft: DraftContent; factReport: FactReportContent };

export type FinalBody = { title: string; markdown: string };

/**
 * 模型端口：编排图只依赖这组方法，真实模型接入时替换实现即可。
 * 一律返回 Promise：脚本化结果同步返回，真实模型天然异步。
 */
export type WritingModel = {
  brief(input: BriefInput): Promise<CreativeBriefContent>;
  materials(input: MaterialsInput): Promise<MaterialBatchContent>;
  thesis(input: ThesisInput): Promise<ThesisContent>;
  outline(input: OutlineInput): Promise<OutlineContent>;
  draft(input: DraftInput): Promise<DraftContent>;
  factReport(input: FactReportInput): Promise<FactReportContent>;
  final(input: FinalInput): Promise<FinalBody>;
};

export const FIXED_TITLE = "把知识库从收藏夹变成工作台";

/** 草稿里没有来源支撑的断言，事实核查报告会要求降级，终稿改写成保留怀疑的表述。 */
export const FIXED_UNSUPPORTED_CLAIM =
  "多数知识管理工具都提供双向链接，所以结构可以自然长出来。";

export const FIXED_DOWNGRADED_CLAIM =
  "有观点认为，知识管理工具的双向链接能让结构自然长出来；这一点尚未核实，本文不作为结论。";

export const FIXED_BRIEF: CreativeBriefContent = {
  topic: FIXED_TITLE,
  audience: "积累了不少笔记、但整理成本越来越高的独立开发者",
  purpose: "让读者判断哪些知识值得维护、哪些应该放手，最后留下能反复调用的少量内容",
  constraints: ["不出现真实公司或个人信息", "不推荐具体付费工具", "每节给一个当天可执行的动作"],
  tone: "克制、具体、少形容词",
};

export const FIXED_MATERIALS: MaterialBatchContent = {
  items: [
    {
      name: "清理记录：三百条收藏删到四十条",
      sourcePath: null,
      note: "只按「最近三个月是否打开过」二分，不逐条判断价值",
    },
    {
      name: "三次真实查找的复盘",
      sourcePath: null,
      note: "三次查找都指向同一类结论：失败案例和边界条件，而不是资料清单",
    },
    {
      name: "写作模板草稿",
      sourcePath: null,
      note: "开头留三条素材位，结尾留三条新结论位，用来把整理绑回写作现场",
    },
  ],
};

export const FIXED_THESIS: ThesisContent = {
  candidates: [
    {
      id: "c1",
      claim: "知识库的成本在维护而不是收集，取舍标准应换成未来三个月会不会调用",
      reasoning:
        "从一条笔记真实的注意力成本出发，把「有没有价值」换成「会不会被调用」，再用过去三个月的调用记录代替对未来的猜测",
      relationToBrief: "直接回应「整理成本越来越高」的痛点，并给出可当天执行的取舍标准",
    },
    {
      id: "c2",
      claim: "先写三个复用场景，再决定知识库里存什么",
      reasoning: "用场景反推素材形状，形状之外的即使有价值也不进主库，避免结构先行",
      relationToBrief: "把「整理」从分类动作改成需求驱动的筛选动作",
    },
    {
      id: "c3",
      claim: "整理应该前移到写作现场，用产出验收素材",
      reasoning: "只处理当前要引用的素材，用掉即完成去留判断，让整理有验收标准",
      relationToBrief: "给出把整理和产出绑在一起的操作方式，回答「为什么整理完还是用不上」",
    },
  ],
  recommendedId: "c1",
  rationale:
    "c1 覆盖读者最痛的一步（不断做无用判断），其余两条可以作为它的落地方法放在后半部分，不必并列成三个主张",
  risks: [
    "「三个月会不会调用」对刚起步的读者偏严，可能显得像在劝人少积累",
    "缺少长期调用数据时，读者容易把标准当成主观感觉",
  ],
};

export const FIXED_OUTLINE: OutlineContent = {
  title: FIXED_TITLE,
  chapters: [
    {
      heading: "先把收藏和工作台分开",
      goal: "区分积累和取用两个动作，给出场景标签与暂存区的分工",
    },
    {
      heading: "维护成本决定取舍",
      goal: "把「有没有价值」换成「会不会被调用」，并说明例外：证伪记录要留下",
    },
    {
      heading: "用复用场景反推存什么",
      goal: "用三个具体场景确定素材形状，说明场景之外的内容不进主库",
    },
    {
      heading: "把整理动作前移到写作现场",
      goal: "把整理嵌进写作，用写作模板保证库和产出不脱节",
    },
    {
      heading: "今天就能做的三个动作",
      goal: "给出当天可执行的三步，并说明只有一个小时时先做哪一步",
    },
    {
      heading: "收尾：把标准写成一句话",
      goal: "收束全文：知识库的价值在于打开就能开始工作",
    },
  ],
};

export const FIXED_DRAFT_MARKDOWN = `# 把知识库从收藏夹变成工作台

收藏夹解决的是「先存下来」，工作台解决的是「现在就用」。这两个动作的代价不同：前者只要一次点击，后者要求你在写之前就知道自己要找什么、找到之后放在哪里、下次还能不能找回来。多数人只在积累，却按工作台的标准要求自己，于是知识库越做越重。

重不是内容多，而是每次打开都要重新做一次判断：这条要不要看、那条要不要留。判断次数比内容条数更消耗人。

## 一、先把收藏和工作台分开

收藏是原料，工作台是工具。原料可以不整理，工具必须顺手。把两者混在一起，最常见的后果是：每次打开笔记软件，先看到几百条「待读」，然后关掉。

一个可执行的区分办法是给每条笔记打一个使用场景标签：写文章用、做决定用、跟人解释用。三条都落不上的，直接放进「暂存」，不参与检索，也不参与整理。暂存区的唯一规则是到期清理，不续命。标签不要超过三个，也不要求每条都打——分类越细，维护越贵，最后没人维护。

这样做的收益不是笔记变少，而是你在需要的时候只需要看几十条，而不是几百条。检索范围小了，才有耐心把结果读完。

还有一层收益容易被忽略：分开之后，「今天想读点什么」和「今天要写点什么」变成了两个入口。前一个入口可以随便逛，后一个入口只放已经能用的东西。混在一起时，你永远在逛，永远开不了工。

迁移不需要一次做完。规则可以简单到只搬用过的东西：过去三个月调用过一次的，搬进工作台；其余的留在收藏区。搬完你会发现工作台小得让人不安，这恰恰是它可用的原因。

## 二、维护成本决定取舍

一条笔记的真实成本不是记录它的那十秒，而是它此后每次出现在检索结果里、每次被你犹豫要不要删除、每次在整理时占用注意力。按这个口径算，一条一年没被调用过的笔记，成本远高于它当初带来的收益。

所以取舍的标准可以换成一句话：**这条内容，我未来三个月内会不会主动调用一次？** 答不上来的，就不该进入检索层。

需要澄清的是，判断「会不会调用」不需要预测未来。你只需要回看过去三个月实际调用过什么，把那个范围复制到未来。历史行为比自我评估可靠。

${FIXED_UNSUPPORTED_CLAIM}

这条标准有一个例外：证伪性的记录要留下。你曾经判断错的地方、被数据推翻的假设，即使暂时用不上，也值得单独放一页。它们的作用是防止重复犯错，不是提供素材，所以不参与按期清理。

还有一种常见的自我安慰：等我整理完就开始写。整理是没有终点的，因为它没有验收标准；写作有。用写作来验收整理，判断会快很多。

## 三、用复用场景反推存什么

先写下三个具体场景，再决定存什么。比如：

- 给团队讲一次跨端同步的坑，需要三个失败案例和对应的修复动作；
- 回答「为什么不用现成的方案」，需要一段对比结论和两条边界条件；
- 写一篇复盘，需要时间线、关键决策和当时的判断依据。

这三个场景需要的素材有明确形状：案例、结论、时间线。形状之外的内容，即使看起来很有价值，也不进入主库。所谓主库，就是你写东西时会打开的那个地方，它不需要大。场景也要写得足够具体，具体到看见一条素材时能判断它有没有用。

按场景反推还有一个副作用：你会发现自己缺的不是更多素材，而是把素材组织成结论的那一步。那一步只能靠写，不能靠收集。收集给人「已经在推进」的错觉，写作才会暴露你还不知道什么。

## 四、把整理动作前移到写作现场

整理最大的问题是它和产出脱节。你在周末花两个小时分类，分类完没有任何东西被使用，下次需要时还是靠搜索。整理成了独立的仪式，而不是写作的一部分。

更省力的做法是把整理嵌进写作：写到一个需要引用的地方，才去处理那条素材，处理完立刻用掉。用掉之后，这条素材的去留也就有了答案——被引用过的留下，找不到出处的删掉，需要补充的加一条待办。

可以把这个动作写进你的写作模板：每篇开头留一行「本文要用到的三条素材」，结尾留一行「本篇新沉淀的三条结论」。前者强制你从库里取，后者保证库里有东西进来。模板不解决写作质量，但能保证知识库和写作不脱节。

这样做一篇文章可能只整理十几条，但每一条都经过了真实使用的检验。一年下来，库里的内容基本都是被调用过的。反过来，先整理再写作，你会在整理阶段做大量没有验证的猜测，等到真正写作时发现一半用不上。

## 五、今天就能做的三个动作

第一，把当前收藏按「最近三个月是否打开过」分成两堆，没打开的那堆整体移到暂存，不逐条看。逐条看会让你陷入「这条以后可能有用」的循环。

第二，写下你最近三次真实查找的内容，看它们有什么共同点。共同点就是你的复用场景，其余场景暂时不用为它设计结构。

第三，下一次写作时，只允许自己从库里取三条素材。取不够就说明库的结构不对，而不是库不够大。取够了却写不动，说明问题在写作本身，也不该由知识库来背。

如果你只有一个小时，先做第一步。删掉不用的内容，收益通常大于再学一套整理方法，而且它不会给你留下新的待办。

## 收尾

知识库的价值不在于装了多少，而在于你打开它的时候能不能直接开始工作。把收藏和工作台分开，按维护成本取舍，用复用场景反推库存，把整理放回写作现场，这四步不需要新工具，只需要你少存一点、多用一点。
`;

export const FIXED_DRAFT: DraftContent = {
  title: FIXED_TITLE,
  markdown: FIXED_DRAFT_MARKDOWN,
};

export const FIXED_FACT_REPORT: FactReportContent = {
  items: [
    {
      fact: "作者过去一年在收藏区留下了三百多条未再打开的链接",
      source: null,
      kind: "personal_experience",
      verifyStatus: "unverified",
      reasonCode: "unverifiable",
    },
    {
      fact: "只保留最近三个月打开过的内容，可以让需要时的检索结果变短",
      source: null,
      kind: "opinion",
      verifyStatus: "unverified",
      reasonCode: null,
    },
    {
      fact: "分类层级越细，维护成本越高",
      source: "固定样例来源：整理习惯记录（虚构）",
      kind: "external_fact",
      verifyStatus: "verified",
      reasonCode: null,
    },
    {
      fact: FIXED_UNSUPPORTED_CLAIM,
      source: null,
      kind: "external_fact",
      verifyStatus: "unverified",
      reasonCode: "missing_source",
    },
  ],
  downgrades: [{ fact: FIXED_UNSUPPORTED_CLAIM, reasonCode: "missing_source" }],
};

/** 降级清单里的断言在终稿中的改写文本；没有登记的断言保持原样。 */
const DOWNGRADE_REWRITES: Record<string, string> = {
  [FIXED_UNSUPPORTED_CLAIM]: FIXED_DOWNGRADED_CLAIM,
};

export const fixedModel: WritingModel = {
  async brief({ topic }) {
    return { ...FIXED_BRIEF, topic };
  },
  async materials({ supplied }) {
    if (supplied.length === 0) {
      return FIXED_MATERIALS;
    }
    return {
      items: [
        ...FIXED_MATERIALS.items,
        ...supplied.map((text, index) => ({
          name: `本地素材 ${index + 1}`,
          sourcePath: null,
          note: text,
        })),
      ],
    };
  },
  async thesis() {
    return FIXED_THESIS;
  },
  async outline() {
    return FIXED_OUTLINE;
  },
  async draft() {
    return FIXED_DRAFT;
  },
  async factReport() {
    return FIXED_FACT_REPORT;
  },
  async final({ draft, factReport }) {
    const markdown = factReport.downgrades.reduce(
      (text, entry) => text.replace(entry.fact, DOWNGRADE_REWRITES[entry.fact] ?? entry.fact),
      draft.markdown,
    );
    return { title: draft.title, markdown };
  },
};
