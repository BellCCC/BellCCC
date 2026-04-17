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
//   ① org 固定属性（从数据库orgs表读）：L4=层级, L5=类型, region=区域
//   ② 发起人填写的额外条件（extraContext）：L3=申请范围, is_sensitive=是否敏感, 等
// ═══════════════════════════════════════════════════════════

const FLOW_RULE_MAP = {
  'org_adjust': 'HR_ORG_SET',
  'pos_change': 'HR_ORG_POS',
  'attendance': 'HR_SSC_TIME',
  'it_req':     'HR_DIGI_WF_01',
  'it_perm':    'HR_DIGI_WF_02',
};

const SKIP_COND_KEYS = ['L1', 'L2'];

// org固定属性映射
function buildContext(org) {
  return {
    'L4':     org.grade,   // 组织层级
    'L5':     org.type,    // 组织类型
    'region': org.region,  // 所属区域
  };
}

// 单个条件匹配
function matchVal(ruleVal, inputVal) {
  if (ruleVal === undefined || ruleVal === null) return true;
  if (inputVal === undefined || inputVal === null) return false;
  if (typeof ruleVal === 'string') return ruleVal === inputVal;
  if (ruleVal.not) return !ruleVal.not.includes(inputVal);
  if (ruleVal.in)  return ruleVal.in.includes(inputVal);
  if (ruleVal.gte) return parseFloat(inputVal) >= ruleVal.gte;
  return false;
}

// 区域匹配（有特殊逻辑）
function matchRegion(ruleRegion, inputRegion) {
  if (!ruleRegion || ruleRegion === 'Any') return true;
  if (ruleRegion === '集团总部') return true;
  if (!inputRegion || inputRegion === 'Any') return false;
  if (typeof ruleRegion === 'object' && ruleRegion.contains) return inputRegion.includes(ruleRegion.contains);
  if (typeof ruleRegion === 'object' && ruleRegion.not) return !ruleRegion.not.includes(inputRegion);
  if (typeof ruleRegion === 'string') return inputRegion === ruleRegion || inputRegion.includes(ruleRegion);
  return false;
}

// 主函数：计算审批链
// org         — 目标组织 { grade, type, region, path }
// flowKey     — 流程 key（如 'org_adjust'）
// rules       — 数据库全部 approval_rules
// extraContext — 发起人填写的额外条件 { L3: "跨部门", is_sensitive: "涉及敏感", ... }
function computeChain(org, flowKey, rules, extraContext = {}) {
  // 合并两部分 context
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
      if (SKIP_COND_KEYS.includes(k)) return true;
      if (k === 'region') return matchRegion(v, ctx['region']);
      // L3 在部分流程里是发起人选的（如申请范围），优先用extraContext里的值
      return matchVal(v, ctx[k]);
    });
  }).filter(r => r.role_key);

  // Step 3: 分组
  const allR = matched.filter(r => r.raci === 'R');
  const allA = matched.filter(r => r.raci === 'A');
  const allC = matched.filter(r => r.raci === 'C');
  const allI = matched.filter(r => r.raci === 'I');

  // R: unique
  const R = allR.length ? [allR.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  // A: unique
  const A = allA.length ? [allA.sort((a,b) => b.order_num - a.order_num)[0]] : [];
  // C: collect, order从小到大
  const C = allC.sort((a,b) => a.order_num - b.order_num);
  // I: collect, order从小到大
  const I = allI.sort((a,b) => a.order_num - b.order_num);

  return [...R, ...C, ...A, ...I];
}
