import type { Condition } from "../flow/condition.ts";
import { cond } from "../flow/condition.ts";
import type { CompletionMode, FlowDefinition, NodeDefinition } from "../flow/definition.ts";

/**
 * OEM v289 示例流程模板（项目类工作项）。
 * 节点键与原模板一致（例如「需求评审」的键是 end，「需求立项提案」是 doing），按键对应，不按名称。
 * 没有卡点的自动节点（相容性测试、产品成本确认、安评送检）在原模板里由外部条件推动，这里按“到达即完成”处理。
 */
export const F = {
  needPhaseOut: "是否需要迭代老品下市物料风险评估",
  needLaunchPlan: "是否需要产品上市计划",
  needConceptTest: "是否需要概念测试",
  needVideo: "是否需要视频拍摄制作",
  formulaLocked: "配方是否锁定",
  needFiling: "是否需要备案",
  linkedSku: "关联需求SKU流程",
} as const;

const CONCEPT = "概念阶段";
const PLAN = "计划阶段";
const DEV = "开发阶段";
const LAUNCH = "上市阶段";
const REVIEW = "复盘阶段";

interface Opts {
  mode?: CompletionMode;
  roles?: string[];
  visible?: Condition;
  gate?: Condition;
  stage?: string;
}

function build(): FlowDefinition {
  const nodes: NodeDefinition[] = [];
  const edges: { from: string; to: string }[] = [];
  const n = (key: string, name: string, preds: string[], o: Opts = {}) => {
    nodes.push({
      key,
      name,
      completion: o.mode ?? "singleConfirm",
      ownerRoles: o.roles ?? [],
      ...(o.visible && { visibility: o.visible }),
      ...(o.gate && { gate: o.gate }),
      ...(o.stage && { stageOnArrival: o.stage }),
    });
    for (const from of preds) edges.push({ from, to: key });
  };

  const phaseOut = cond.equal(F.needPhaseOut, "是");
  const sub = "subItemDriven" as const;

  n("start", "开始", [], { mode: "auto", roles: ["NPD"], stage: CONCEPT });
  n("doing", "需求立项提案", ["start"], {
    mode: "allConfirm",
    roles: ["NPD", "财务BP负责人", "开发"],
    gate: cond.notEmpty(F.linkedSku),
    stage: CONCEPT,
  });
  n("state_51", "财务分析（需求立项）", ["doing"], { roles: ["财务BP"], stage: CONCEPT });
  n("end", "需求评审", ["state_51"], { mode: sub, stage: CONCEPT });
  n("state_1", "产品入库预排期", ["end"], { roles: ["开发"], stage: PLAN });
  n("state_53", "迭代下市成品清单", ["end"], { roles: ["DP"], visible: phaseOut });
  n("state_54", "迭代下市物料盘点-PC", ["state_53"], { roles: ["PC"], visible: phaseOut });
  n("state_55", "迭代下市物料盘点-战采", ["state_53"], { roles: ["战略采购-包材成品"], visible: phaseOut });
  n("state_56", "迭代下市物料盘点-MP", ["state_53"], { roles: ["MP"], visible: cond.equal(F.needLaunchPlan, "是") });
  n("state_0", "迭代老品下市物料风险评估", ["state_54", "state_55", "state_56"], {
    roles: ["PC", "战略采购-包材成品"],
    visible: phaseOut,
    stage: PLAN,
  });
  n("state_2", "项目评审", ["state_1", "state_0"], { mode: sub, stage: PLAN });
  n("state_3", "产品料体试用", ["state_2"], { mode: sub, stage: DEV });
  n("state_16", "内外包开发", ["state_2"], { mode: sub, stage: DEV });
  n("state_59", "包装设计Brief提交", ["state_2"], { mode: "allConfirm", roles: ["NPD"] });
  n("state_60", "财务模具预算", ["state_2"], { roles: ["财务BP"] });
  n("state_4", "配方成本初步核算", ["state_3"], { roles: ["战略采购-原料"], stage: PLAN });
  n("state_5", "放大样测试", ["state_3"], { mode: sub, stage: DEV });
  n("state_19", "相容性测试（自动完成）", ["state_16"], { mode: "auto", stage: DEV });
  n("formulalocked", "配方锁定", ["state_5"], { mode: "auto", gate: cond.equal(F.formulaLocked, "Y"), stage: DEV });
  n("state_24", "产品成本确认（自动完成）", ["state_19"], { mode: "auto", stage: DEV });
  n("apsj", "安评送检", ["state_19"], { mode: "auto", stage: DEV });
  n("state_7", "配方预成本核算", ["formulalocked"], { roles: ["战略采购-原料"], stage: DEV });
  n("state_9", "配方原料可供周期评估", ["formulalocked"], { roles: ["战略采购-原料"], stage: DEV });
  n("wdxtest", "稳定性测试", ["formulalocked"], { mode: sub, stage: DEV });
  n("gxtest", "功效测试", ["formulalocked"], { mode: sub, stage: DEV });
  n("state_20", "产品价格机制及首单量提报", ["state_24"], { roles: ["TM"], stage: DEV });
  n("state_25", "概念测试", ["state_24"], { roles: ["洞察"], visible: cond.equal(F.needConceptTest, "是") });
  n("filing", "备案", ["apsj"], { mode: "auto", gate: cond.equal(F.needFiling, "是") });
  n("state_23", "财务分析", ["state_20"], { roles: ["财务BP"], stage: DEV });
  n("state_46", "产品上市360计划制定（如有）", ["state_20"], {
    roles: ["GTM"],
    visible: cond.equal(F.needLaunchPlan, "是"),
    stage: LAUNCH,
  });
  n("state_57", "产品尺寸确认", ["state_20"], { roles: ["NPD"] });
  n("state_21", "标准签发", ["filing"], { roles: ["质量合规"], stage: DEV });
  n("state_26", "上市评审", ["state_23"], { mode: sub });
  n("state_58", "纸箱编码确认", ["state_57"], { roles: ["物流部负责人"] });
  n("state_27", "产品链接承接方式", ["state_26"], { roles: ["TM"], stage: LAUNCH });
  n("state_29", "达人试用反馈收集", ["state_26"], { roles: ["媒介"], stage: LAUNCH });
  n("state_28", "原料入库", ["state_26"], { roles: ["PC"], stage: LAUNCH });
  n("state_30", "产品fact sheet知识库输出", ["state_26"], { roles: ["NPD"], stage: LAUNCH });
  n("state_44", "各渠道机制上市前确认", ["state_26"], { roles: ["TM"], stage: LAUNCH });
  n("state_52", "成品到仓入库", ["state_28"], { roles: ["DP"] });
  n("state_31", "产品资料撰写", ["state_30"], { mode: sub, stage: LAUNCH });
  n("state_37", "产品Q&A撰写及知识库录入", ["state_30"], { roles: ["GTM"], stage: LAUNCH });
  n("state_40", "产品平面素材", ["state_30"], { mode: sub, stage: LAUNCH });
  n("state_42", "视频拍摄制作", ["state_30"], { mode: sub, visible: cond.equal(F.needVideo, "是"), stage: LAUNCH });
  n("state_36", "KOL Brief产品介绍/KOL Brief撰稿需求", ["state_31"], { roles: ["媒介"], stage: LAUNCH });
  n("state_43", "所有对外资料法务审核", ["state_42", "state_40"], { roles: ["法务", "GTM"], stage: LAUNCH });
  n("state_45", "各渠道新品上架", ["state_44", "state_43"], { roles: ["TM"], stage: LAUNCH });
  n("state_47", "客诉监控", ["state_45"], { roles: ["GTM"], stage: REVIEW });

  return { key: "oem", version: 289, nodes, edges };
}

export const oemFlow = build();

/** 每个有负责角色的节点，用角色名当用户 id 做负责人，便于测试里按角色确认。 */
export const ownersByRole: Record<string, string[]> = Object.fromEntries(
  oemFlow.nodes.filter((n) => n.ownerRoles.length > 0).map((n) => [n.key, [...n.ownerRoles]]),
);
