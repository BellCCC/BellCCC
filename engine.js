// ═══════════════════════════════════════════════════════════
// engine.js — 领益智造 HR 审批链匹配引擎 v4
//
// 修改指南：
//   新增流程类型    → 改 FLOW_RULE_MAP
//   新增组织属性    → 改 buildOrgContext()
//   新增匹配语法    → 改 matchVal() / matchRegion()
//   改合并顺序      → 改 computeChain()
//
// conditions 的 key（中文语义，和数据库完全一致）：
//   事项大类 / 流程类型 / 流程子类        ← 流程分类维度，通过rule_id前缀过滤
//   组织级别 / 组织类型 / 所属区域        ← 组织自带属性（orgs表）
//   是否涉及敏感数据 / 数据量             ← 发起人填写
//   是否涉及制度变更 / 是否存在前置审批单  ← 发起人填写
//   跨部门 / 变更参数类型                 ← 发起人填写
//
// 条件值格式（jsonb对象）：
//   精确匹配：  "三级组织"
//   包含列表：  {"in": ["一级组织","二级组织"]}
//   排除列表：  {"not": ["运营"]}
//   区域包含：  {"contains": "华东"}
//   数值比较：  {"gte": 10000}
//   通配：      条件key不存在 = Any，直接通过
// ═══════════════════════════════════════════════════════════

// 流程key → 数据库rule_id前缀
const FLOW_RULE_MAP = {
  'org_adjust': 'HR_ORG_SET',
  'pos_change': 'HR_ORG_POS',
  'attendance': 'HR_SSC_TIME',
  'it_req':     'HR_DIGI_WF_01',
  'it_perm':    'HR_DIGI_WF_02',
};

// 永远跳过的维度（已通过rule_id前缀过滤，不需要再匹配）
const FLOW_DIM_KEYS = ['事项大类', '流程类型', '流程子类'];

// 组织固定属性 → context key 映射
function buildOrgContext(org) {
  return {
    '组织级别': org.grade,
    '组织类型': org.type,
    '所属区域': org.region,
  };
}

// 单个条件匹配
// ruleVal: 数据库存的值（字符串或对象）
// inputVal: 实际值（字符串）
function matchVal(ruleVal, inputVal) {
  if (ruleVal === undefined || ruleVal === null) return true;   // 规则无此条件 = 通配
  if (inputVal === undefined || inputVal === null) return false; // 有条件但无实际值 = 不匹配
  if (typeof ruleVal === 'string') return ruleVal === inputVal;  // 精确匹配
  if (ruleVal.not) return !ruleVal.not.includes(inputVal);      // 排除列表
  if (ruleVal.in)  return ruleVal.in.includes(inputVal);        // 包含列表
  if (ruleVal.gte) return parseFloat(inputVal) >= ruleVal.gte;  // 数值比较
  return false;
}

// 区域匹配（有特殊逻辑）
function matchRegion(ruleRegion, inputRegion) {
  if (!ruleRegion || ruleRegion === 'Any') return true;
  if (ruleRegion === '集团总部') return true;          // 集团总部 = 对所有区域生效
  if (!inputRegion || inputRegion === 'Any') return false;
  if (typeof ruleRegion === 'object') {
    if (ruleRegion.contains) return inputRegion.includes(ruleRegion.contains);
    if (ruleRegion.not)      return !ruleRegion.not.includes(inputRegion);
    if (ruleRegion.in)       return ruleRegion.in.includes(inputRegion);
  }
  if (typeof ruleRegion === 'string') {
    return inputRegion === ruleRegion || inputRegion.includes(ruleRegion);
  }
  return false;
}

// 主函数：计算审批链
// org         — 目标组织 { grade, type, region, path }
// flowKey     — 流程key（如 'org_adjust'）
// rules       — 数据库全部 approval_rules
// extraCtx    — 发起人填写的额外条件 { 是否涉及敏感数据: "涉及敏感", 流程子类: "跨部门", ... }
function computeChain(org, flowKey, rules, extraCtx = {}) {
  // 合并两部分context
  const ctx = { ...buildOrgContext(org), ...extraCtx };

  // Step 1: 按流程前缀过滤
  const prefix = FLOW_RULE_MAP[flowKey] || '';
  const flowRules = prefix
    ? rules.filter(r => r.rule_id && r.rule_id.startsWith(prefix))
    : rules;

  // Step 2: DMN 决策表匹配 — conditions里每个key都满足才算命中
  const matched = flowRules.filter(rule => {
    const cond = rule.conditions || {};
    return Object.entries(cond).every(([k, v]) => {
      // 流程分类维度跳过（已通过前缀过滤）
      if (FLOW_DIM_KEYS.includes(k)) return true;
      // 所属区域用专门函数
      if (k === '所属区域') return matchRegion(v, ctx['所属区域']);
      // 其他维度：ctx里有值就匹配，没值说明发起人未填（对于非必填项，跳过）
      const actual = ctx[k];
      if (actual === undefined) return true; // 发起人未填该条件 = 跳过此维度
      return matchVal(v, actual);
    });
  }).filter(r => r.role_key);

  // Step 3: 按RACI分组
  const allR = matched.filter(r => r.raci === 'R');
  const allA = matched.filter(r => r.raci === 'A');
  const allC = matched.filter(r => r.raci === 'C');
  const allI = matched.filter(r => r.raci === 'I');

  // R: unique — order_num最大的一条
  const R = allR.length ? [allR.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  // A: unique — order_num最大的一条
  const A = allA.length ? [allA.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  // C: collect — order_num从小到大
  const C = allC.sort((a,b) => a.order_num - b.order_num);
  // I: collect — order_num从小到大
  const I = allI.sort((a,b) => a.order_num - b.order_num);

  // 顺序：R → C → A → I
  return [...R, ...C, ...A, ...I];
}
