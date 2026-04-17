// ═══════════════════════════════════════════════════════════
// engine.js — 领益智造 HR 审批链匹配引擎 v3
//
// 什么时候改这里：
//   ① 新增流程类型          → 改 FLOW_RULE_MAP
//   ② 新增组织属性维度       → 改 buildContext()
//   ③ 新增特殊条件值逻辑     → 改 matchVal() / matchRegion()
//   ④ 改 R/A/C/I 的合并方式  → 改 computeChain()
//
// context 的两个来源：
//   ① org 固定属性（数据库orgs表）：L4=层级, L5=类型, region=区域
//   ② 发起人填写的额外条件（extraContext）：如 L3=申请范围, is_sensitive=是否敏感
//
// L3 的特殊处理：
//   - extraContext 里有 L3 → 用发起人填的值匹配（如申请范围：全集团/跨部门/部门内）
//   - extraContext 里没有 L3 → 跳过（L3此时是流程分类名称，如"组织架构设置"）
// ═══════════════════════════════════════════════════════════

const FLOW_RULE_MAP = {
  'org_adjust': 'HR_ORG_SET',
  'pos_change': 'HR_ORG_POS',
  'attendance': 'HR_SSC_TIME',
  'it_req':     'HR_DIGI_WF_01',
  'it_perm':    'HR_DIGI_WF_02',
};

// 永远跳过的流程分类维度（已通过rule_id前缀过滤）
const ALWAYS_SKIP = ['L1', 'L2'];

function buildContext(org) {
  return {
    'L4':     org.grade,
    'L5':     org.type,
    'region': org.region,
  };
}

function matchVal(ruleVal, inputVal) {
  if (ruleVal === undefined || ruleVal === null) return true;
  if (inputVal === undefined || inputVal === null) return false;
  if (typeof ruleVal === 'string') return ruleVal === inputVal;
  if (ruleVal.not) return !ruleVal.not.includes(inputVal);
  if (ruleVal.in)  return ruleVal.in.includes(inputVal);
  if (ruleVal.gte) return parseFloat(inputVal) >= ruleVal.gte;
  return false;
}

function matchRegion(ruleRegion, inputRegion) {
  if (!ruleRegion || ruleRegion === 'Any') return true;
  if (ruleRegion === '集团总部') return true;
  if (!inputRegion || inputRegion === 'Any') return false;
  if (typeof ruleRegion === 'object' && ruleRegion.contains) return inputRegion.includes(ruleRegion.contains);
  if (typeof ruleRegion === 'object' && ruleRegion.not) return !ruleRegion.not.includes(inputRegion);
  if (typeof ruleRegion === 'string') return inputRegion === ruleRegion || inputRegion.includes(ruleRegion);
  return false;
}

function computeChain(org, flowKey, rules, extraContext = {}) {
  // 合并 org固定属性 + 发起人额外条件
  const ctx = { ...buildContext(org), ...extraContext };

  // Step 1: 按流程前缀过滤
  const flowPrefix = FLOW_RULE_MAP[flowKey] || '';
  const flowRules = flowPrefix
    ? rules.filter(r => r.rule_id && r.rule_id.startsWith(flowPrefix))
    : rules;

  // Step 2: DMN 决策表匹配
  const matched = flowRules.filter(rule => {
    const cond = rule.conditions || {};
    return Object.entries(cond).every(([k, v]) => {
      // L1/L2 永远跳过
      if (ALWAYS_SKIP.includes(k)) return true;

      // L3 特殊处理：
      //   发起人填了 → 用填的值匹配
      //   发起人没填 → 跳过（L3此时是流程名称，不参与匹配）
      if (k === 'L3') {
        if (extraContext.L3) return matchVal(v, extraContext.L3);
        return true; // 没填则跳过
      }

      // region 用专门函数
      if (k === 'region') return matchRegion(v, ctx['region']);

      // 其他维度
      return matchVal(v, ctx[k]);
    });
  }).filter(r => r.role_key);

  // Step 3: 分组
  const allR = matched.filter(r => r.raci === 'R');
  const allA = matched.filter(r => r.raci === 'A');
  const allC = matched.filter(r => r.raci === 'C');
  const allI = matched.filter(r => r.raci === 'I');

  // R: unique — 取 order_num 最大的一条
  const R = allR.length ? [allR.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  // A: unique — 取 order_num 最大的一条
  const A = allA.length ? [allA.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  // C: collect — order 从小到大
  const C = allC.sort((a,b) => a.order_num - b.order_num);
  // I: collect — order 从小到大
  const I = allI.sort((a,b) => a.order_num - b.order_num);

  return [...R, ...C, ...A, ...I];
}
