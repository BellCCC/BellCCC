// ═══════════════════════════════════════════════════════════
// engine.js — 领益智造 HR 审批链匹配引擎 v2
//
// 什么时候改这里：
//   ① 新增流程类型          → 改 FLOW_RULE_MAP
//   ② 新增组织属性维度       → 改 buildContext()
//   ③ 新增特殊条件值逻辑     → 改 matchVal() / matchRegion()
//   ④ 改 R/A/C/I 的合并方式  → 改 computeChain()
//
// 条件值在数据库里的格式（jsonb对象）：
//   精确匹配：  "三级组织"
//   包含列表：  {"in": ["一级组织","二级组织"]}
//   排除列表：  {"not": ["运营"]}
//   区域包含：  {"contains": "华东"}
//   数据量：    {"gte": 10000}
//   通配：      字段不存在 = Any，全部通过
// ═══════════════════════════════════════════════════════════

const FLOW_RULE_MAP = {
  'org_adjust': 'HR_ORG_SET',
  'pos_change': 'HR_ORG_POS',
  'attendance': 'HR_SSC_TIME',
  'it_req':     'HR_DIGI_WF_01',
  'it_perm':    'HR_DIGI_WF_02',
};

const SKIP_COND_KEYS = ['L1', 'L2', 'L3'];

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

function computeChain(org, flowKey, rules) {
  const ctx = buildContext(org);
  const flowPrefix = FLOW_RULE_MAP[flowKey] || '';
  const flowRules = flowPrefix ? rules.filter(r => r.rule_id && r.rule_id.startsWith(flowPrefix)) : rules;

  const matched = flowRules.filter(rule => {
    const cond = rule.conditions || {};
    return Object.entries(cond).every(([k, v]) => {
      if (SKIP_COND_KEYS.includes(k)) return true;
      if (k === 'region') return matchRegion(v, ctx['region']);
      return matchVal(v, ctx[k]);
    });
  }).filter(r => r.role_key);

  const allR = matched.filter(r => r.raci === 'R');
  const allA = matched.filter(r => r.raci === 'A');
  const allC = matched.filter(r => r.raci === 'C');
  const allI = matched.filter(r => r.raci === 'I');

  const R = allR.length ? [allR.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  const A = allA.length ? [allA.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  const C = allC.sort((a,b) => a.order_num - b.order_num);
  const I = allI.sort((a,b) => a.order_num - b.order_num);

  return [...R, ...C, ...A, ...I];
}
