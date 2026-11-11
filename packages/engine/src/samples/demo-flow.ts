import type { Condition } from "../flow/condition.ts";
import { cond } from "../flow/condition.ts";
import type { CompletionMode, FlowDefinition, NodeDefinition } from "../flow/definition.ts";

/**
 * 示例流程 示例流程模板（项目类工作项）。
 * 节点键与原模板一致（例如「需求评审」的键是 end，「立项提案」是 doing），按键对应，不按名称。
 * 没有卡点的自动节点（兼容性测试、产品成本确认、安规送检）在原模板里由外部条件推动，这里按“到达即完成”处理。
 */
export const F = {
  needPhaseOut: "是否需要旧型号退市评估",
  needLaunchPlan: "是否需要上市推广计划",
  needResearch: "是否需要用户调研",
  needVideo: "是否需要宣传视频",
  designFrozen: "设计是否冻结",
  needCert: "是否需要认证",
  linkedModel: "关联型号",
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
  n("doing", "立项提案", ["start"], {
    mode: "allConfirm",
    roles: ["NPD", "财务BP负责人", "开发"],
    gate: cond.notEmpty(F.linkedModel),
    stage: CONCEPT,
  });
  n("state_51", "财务分析（立项）", ["doing"], { roles: ["财务BP"], stage: CONCEPT });
  n("end", "需求评审", ["state_51"], { mode: sub, stage: CONCEPT });
  n("state_1", "量产预排期", ["end"], { roles: ["开发"], stage: PLAN });
  n("state_53", "旧型号退市清单", ["end"], { roles: ["DP"], visible: phaseOut });
  n("state_54", "旧型号物料盘点-生产", ["state_53"], { roles: ["PC"], visible: phaseOut });
  n("state_55", "旧型号物料盘点-采购", ["state_53"], { roles: ["采购-结构件"], visible: phaseOut });
  n("state_56", "旧型号物料盘点-物料", ["state_53"], { roles: ["MP"], visible: cond.equal(F.needLaunchPlan, "是") });
  n("state_0", "旧型号退市风险评估", ["state_54", "state_55", "state_56"], {
    roles: ["PC", "采购-结构件"],
    visible: phaseOut,
    stage: PLAN,
  });
  n("state_2", "项目评审", ["state_1", "state_0"], { mode: sub, stage: PLAN });
  n("state_3", "原型机试用", ["state_2"], { mode: sub, stage: DEV });
  n("state_16", "结构与包装开发", ["state_2"], { mode: sub, stage: DEV });
  n("state_59", "外观设计需求提交", ["state_2"], { mode: "allConfirm", roles: ["NPD"] });
  n("state_60", "模具预算", ["state_2"], { roles: ["财务BP"] });
  n("state_4", "物料成本初步核算", ["state_3"], { roles: ["采购-元器件"], stage: PLAN });
  n("state_5", "试产测试", ["state_3"], { mode: sub, stage: DEV });
  n("state_19", "兼容性测试（自动完成）", ["state_16"], { mode: "auto", stage: DEV });
  n("design_freeze", "设计冻结", ["state_5"], { mode: "auto", gate: cond.equal(F.designFrozen, "Y"), stage: DEV });
  n("state_24", "产品成本确认（自动完成）", ["state_19"], { mode: "auto", stage: DEV });
  n("safety_test", "安规送检", ["state_19"], { mode: "auto", stage: DEV });
  n("state_7", "物料预成本核算", ["design_freeze"], { roles: ["采购-元器件"], stage: DEV });
  n("state_9", "元器件供货周期评估", ["design_freeze"], { roles: ["采购-元器件"], stage: DEV });
  n("reliability_test", "可靠性测试", ["design_freeze"], { mode: sub, stage: DEV });
  n("performance_test", "性能测试", ["design_freeze"], { mode: sub, stage: DEV });
  n("state_20", "定价与首批备货量提报", ["state_24"], { roles: ["TM"], stage: DEV });
  n("state_25", "概念测试", ["state_24"], { roles: ["洞察"], visible: cond.equal(F.needResearch, "是") });
  n("filing", "备案", ["safety_test"], { mode: "auto", gate: cond.equal(F.needCert, "是") });
  n("state_23", "财务分析", ["state_20"], { roles: ["财务BP"], stage: DEV });
  n("state_46", "上市推广计划制定（如有）", ["state_20"], {
    roles: ["GTM"],
    visible: cond.equal(F.needLaunchPlan, "是"),
    stage: LAUNCH,
  });
  n("state_57", "产品尺寸确认", ["state_20"], { roles: ["NPD"] });
  n("state_21", "质量标准签发", ["filing"], { roles: ["质量"], stage: DEV });
  n("state_26", "上市评审", ["state_23"], { mode: sub });
  n("state_58", "外箱规格确认", ["state_57"], { roles: ["物流负责人"] });
  n("state_27", "销售渠道上架方式", ["state_26"], { roles: ["TM"], stage: LAUNCH });
  n("state_29", "体验用户反馈收集", ["state_26"], { roles: ["媒介"], stage: LAUNCH });
  n("state_28", "物料入库", ["state_26"], { roles: ["PC"], stage: LAUNCH });
  n("state_30", "产品规格书输出", ["state_26"], { roles: ["NPD"], stage: LAUNCH });
  n("state_44", "各渠道上市前确认", ["state_26"], { roles: ["TM"], stage: LAUNCH });
  n("state_52", "成品入库", ["state_28"], { roles: ["DP"] });
  n("state_31", "产品文档撰写", ["state_30"], { mode: sub, stage: LAUNCH });
  n("state_37", "常见问题整理", ["state_30"], { roles: ["GTM"], stage: LAUNCH });
  n("state_40", "宣传图片素材", ["state_30"], { mode: sub, stage: LAUNCH });
  n("state_42", "宣传视频制作", ["state_30"], { mode: sub, visible: cond.equal(F.needVideo, "是"), stage: LAUNCH });
  n("state_36", "媒体沟通稿", ["state_31"], { roles: ["媒介"], stage: LAUNCH });
  n("state_43", "对外资料法务审核", ["state_42", "state_40"], { roles: ["法务", "GTM"], stage: LAUNCH });
  n("state_45", "各渠道上架", ["state_44", "state_43"], { roles: ["TM"], stage: LAUNCH });
  n("state_47", "售后监控", ["state_45"], { roles: ["GTM"], stage: REVIEW });

  return { key: "standard", version: 1, nodes, edges };
}

export const demoFlow = build();

/** 每个有负责角色的节点，用角色名当用户 id 做负责人，便于测试里按角色确认。 */
export const ownersByRole: Record<string, string[]> = Object.fromEntries(
  demoFlow.nodes.filter((n) => n.ownerRoles.length > 0).map((n) => [n.key, [...n.ownerRoles]]),
);
