// ═══════════════════════════════════════════════════════════
// engine.js — 领益智造 HR 审批链匹配引擎
//
// 什么时候改这里：
//   ① 新增流程类型          → 改 FLOW_RULE_MAP
//   ② 新增组织属性维度       → 改 buildContext()
//   ③ 新增特殊条件值逻辑     → 改 matchCond()
//   ④ 改 R/A/C/I 的合并方式  → 改 computeChain()
// ═══════════════════════════════════════════════════════════


// ── 1. 流程 key → 数据库 rule_id 前缀 ──────────────────────
//
// 前端选择的流程 key（如 org_adjust）对应数据库里哪些规则。
// 匹配时只拿 rule_id 以这个前缀开头的规则来计算审批链。
//
// 新增流程时：在这里加一行，格式：'前端key': 'DB里的rule_id前缀'
//
const FLOW_RULE_MAP = {
  'org_adjust': 'HR_ORG_SET',    // 组织架构调整
  'pos_change': 'HR_ORG_POS',    // 岗位变更管理
  'attendance': 'HR_SSC_TIME',   // 考勤管理
  'it_req':     'HR_DIGI_WF_01', // 系统需求管理
  'it_perm':    'HR_DIGI_WF_02', // 用户权限管理
};


// ── 2. 哪些条件 key 是流程分类维度，匹配时跳过 ─────────────
//
// 这些 key 的值（如"组织架构设置"）是流程名称，不是 org 属性，
// 已经通过 FLOW_RULE_MAP 的前缀过滤处理了，不需要再匹配。
//
// 如果以后数据库加了新的流程分类字段，在这里加进来。
//
const SKIP_COND_KEYS = ['L1', 'L2', 'L3'];


// ── 3. 哪些区域值等同于"全匹配"（不限区域）─────────────────
//
// 规则里写"集团总部"表示这条规则对所有区域都生效，
// 和写"Any"效果一样。
//
const ANY_REGION_VALUES = ['集团总部', 'Any', ''];


// ── 4. 把 org 对象转成条件匹配用的 context ──────────────────
//
// org 对象的字段：{ grade, type, region, path }
// 数据库条件里的 key 名：L4, L5, 区域, 所属区域
//
// 如果以后新增了组织属性（比如"编制数量"），在这里加映射：
//   '编制数量': org.headcount
//
function buildContext(org) {
  return {
    'L4':     org.grade,   // 组织层级：一级组织 / 二级组织 / 三级组织 / 四级组织 / 五级及以下组织
    'L5':     org.type,    // 组织类型：运营 / 职能 / 商务
    '区域':   org.region,  // 所属区域：中国区 / 国际区 / 华东区
    '所属区域': org.region,
  };
}


// ── 5. 单个条件值的匹配逻辑 ─────────────────────────────────
//
// condVal：数据库里存的条件值（字符串），支持以下格式：
//   精确匹配：  "三级组织"
//   包含列表：  ["一级组织", "二级组织"]
//   排除列表：  not ["运营"]   或   Not ["运营"]
//   区域包含：  contains(所属区域, "华东")
//   通配：      Any / 集团总部 / 空
//
// actual：org 的实际值（字符串）
//
// 如果以后要支持新的匹配语法（比如 ">= 50"），在这里加。
//
function matchCond(condVal, actual) {
  if (!condVal || condVal === '') return true;
  const s = String(condVal).trim();

  // 通配符
  if (s === 'Any') return true;
  if (ANY_REGION_VALUES.includes(s)) return true;

  // not ["a", "b"] 排除列表
  if (/^[Nn]ot\s*\[/.test(s)) {
    const inner = s.replace(/^[Nn]ot\s*\[/, '').replace(/\]$/, '');
    const vals = inner.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    return !vals.includes(actual);
  }

  // ["a", "b"] 包含列表
  if (s.startsWith('[')) {
    const vals = s.replace(/^\[|\]$/g, '').split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    return vals.includes(actual);
  }

  // contains(field, "华东") — 区域包含判断
  if (s.includes('contains(')) {
    const m = s.match(/contains\([^,]+,\s*["'](.+?)["']\)/);
    if (m) return actual.includes(m[1]);
  }

  // 精确匹配
  return s === actual;
}


// ── 6. 主函数：计算审批链 ────────────────────────────────────
//
// 输入：
//   org      — 目标组织对象 { grade, type, region, path }
//   flowKey  — 前端流程 key（如 'org_adjust'）
//   rules    — 从数据库拿到的全部 approval_rules 数组
//
// 输出：
//   审批链步骤数组，每个元素是原始 rule 对象加上 raci 字段
//   顺序：R（唯一） → C（全收集，order_num从小到大） → A（唯一） → I（全收集，order_num从小到大）
//
// R/A 为什么唯一：同一条件下只有一个人负责发起/批准，取 order_num 最大的那条
// C/I 为什么收集：咨询和知会可以有多人，全部纳入，按序号排
//
function computeChain(org, flowKey, rules) {
  const ctx = buildContext(org);

  // Step 1: 按流程前缀过滤
  const flowPrefix = FLOW_RULE_MAP[flowKey] || '';
  const flowRules = flowPrefix
    ? rules.filter(r => r.rule_id && r.rule_id.startsWith(flowPrefix))
    : rules;

  // Step 2: 条件匹配
  const matched = flowRules.filter(rule => {
    const cond = rule.conditions || {};
    return Object.entries(cond).every(([k, v]) => {
      if (SKIP_COND_KEYS.includes(k)) return true; // 流程维度跳过
      const actual = ctx[k];
      if (actual === undefined) return true;        // 未知维度（如敏感数据）暂不过滤
      return matchCond(v, actual);
    });
  }).filter(r => r.role_key); // 必须有角色

  // Step 3: 按 RACI 分组
  const allR = matched.filter(r => r.raci === 'R');
  const allA = matched.filter(r => r.raci === 'A');
  const allC = matched.filter(r => r.raci === 'C');
  const allI = matched.filter(r => r.raci === 'I');

  // R: unique — 取 order_num 最大的一条
  const R = allR.length ? [allR.sort((a, b) => b.order_num - a.order_num)[0]] : [];

  // A: unique — 取 order_num 最大的一条
  const A = allA.length ? [allA.sort((a, b) => b.order_num - a.order_num)[0]] : [];

  // C: collect — 全收集，order_num 从小到大
  const C = allC.sort((a, b) => a.order_num - b.order_num);

  // I: collect — 全收集，order_num 从小到大
  const I = allI.sort((a, b) => a.order_num - b.order_num);

  // Step 4: 合并，顺序 R → C → A → I
  return [...R, ...C, ...A, ...I];
}
