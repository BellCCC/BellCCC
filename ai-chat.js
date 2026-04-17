// ═══════════════════════════════════════════════════════════
// ai-chat.js — HR 审批 AI 问询模块
//
// 使用方式：
//   在 index.html 的 </body> 前加两行：
//   <div id="ai-chat-widget"></div>
//   <script src="ai-chat.js"></script>
//
// 以后接自训练模型：
//   只需要改 AIChatWidget.callModel() 这一个函数
//   把 fetch 地址换成你自己的模型 API 即可
//   输出格式保持：{ intent: "流程名称 或 null", reply: "回复文字" }
// ═══════════════════════════════════════════════════════════

const AIChatWidget = {

  // ── 配置 ──────────────────────────────────────────────
  config: {
    // 挂载到哪个容器
    mountId: 'ai-chat-widget',
    // 欢迎语
    welcome: '你好！我是 HR 审批助手。请告诉我你想发起什么审批，或直接在右侧目录中选择。',
    // 可识别的流程列表（和 CATALOG 里的 name 对应）
    flows: ['组织架构调整','岗位变更管理','考勤管理','系统需求管理','用户权限管理'],
  },

  // ── 初始化 ─────────────────────────────────────────────
  init() {
    const mount = document.getElementById(this.config.mountId);
    if (!mount) return;

    // 注入样式
    this.injectStyles();

    // 渲染 HTML
    mount.innerHTML = `
      <div class="acw-wrap">
        <div class="acw-intent" id="acw-intent" style="display:none">
          <div class="acw-intent-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E07820" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div style="flex:1">
            <div class="acw-intent-lbl">AI 识别意图</div>
            <div class="acw-intent-val" id="acw-intent-val">—</div>
          </div>
          <div class="acw-intent-tag">已识别</div>
        </div>
        <div class="acw-box">
          <div class="acw-msgs" id="acw-msgs"></div>
          <div class="acw-inp">
            <input id="acw-input" placeholder="描述你要发起的审批，如：我要调整组织架构…" />
            <button onclick="AIChatWidget.send()">发送</button>
          </div>
        </div>
      </div>`;

    // 绑定回车
    document.getElementById('acw-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.send();
    });

    // 显示欢迎语
    this.addMsg(this.config.welcome, 'sys');
  },

  // ── 注入样式 ───────────────────────────────────────────
  injectStyles() {
    if (document.getElementById('acw-styles')) return;
    const style = document.createElement('style');
    style.id = 'acw-styles';
    style.textContent = `
      .acw-wrap{display:flex;flex-direction:column;gap:12px;flex:1}
      .acw-intent{background:#fff;border-radius:14px;border:1px solid rgba(0,0,0,0.07);padding:11px 14px;display:flex;align-items:center;gap:12px;flex-shrink:0}
      .acw-intent-icon{width:34px;height:34px;border-radius:9px;background:#FFF7ED;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .acw-intent-lbl{font-size:11px;color:#94A3B8;font-weight:500;margin-bottom:2px}
      .acw-intent-val{font-size:14px;font-weight:600;color:#0F172A}
      .acw-intent-tag{font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px;background:#FFF7ED;color:#9B4D08;border:1px solid rgba(224,120,32,0.2);flex-shrink:0}
      .acw-box{background:#fff;border-radius:14px;border:1px solid rgba(0,0,0,0.07);box-shadow:0 1px 4px rgba(0,0,0,0.06);display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:180px}
      .acw-msgs{flex:1;padding:14px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:280px}
      .acw-msg{max-width:90%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.55;font-family:inherit}
      .acw-msg.sys{align-self:flex-start;background:#F8F9FB;color:#64748B;border:1px solid rgba(0,0,0,0.07);border-bottom-left-radius:3px}
      .acw-msg.user{align-self:flex-end;background:linear-gradient(135deg,#FF6B35,#E07820);color:#fff;border-bottom-right-radius:3px}
      .acw-msg.ai{align-self:flex-start;background:#EFF6FF;color:#1E40AF;border:1px solid #BFDBFE;border-bottom-left-radius:3px}
      .acw-inp{border-top:1px solid rgba(0,0,0,0.07);display:flex;flex-shrink:0}
      .acw-inp input{flex:1;border:none;outline:none;padding:11px 14px;font-size:13px;color:#0F172A;background:transparent;font-family:inherit}
      .acw-inp input::placeholder{color:#94A3B8}
      .acw-inp button{padding:11px 18px;background:none;border:none;border-left:1px solid rgba(0,0,0,0.07);cursor:pointer;color:#E07820;font-size:13px;font-weight:600;font-family:inherit}
      .acw-inp button:hover{background:#FFF7ED}
      .acw-dots span{animation:acw-blink 1.2s ease-in-out infinite}
      .acw-dots span:nth-child(2){animation-delay:.2s}
      .acw-dots span:nth-child(3){animation-delay:.4s}
      @keyframes acw-blink{0%,80%,100%{opacity:.15}40%{opacity:1}}
    `;
    document.head.appendChild(style);
  },

  // ── 消息操作 ───────────────────────────────────────────
  addMsg(text, cls) {
    const box = document.getElementById('acw-msgs');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'acw-msg ' + cls;
    d.textContent = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  },

  addLoading() {
    const box = document.getElementById('acw-msgs');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'acw-msg ai'; d.id = 'acw-loading';
    d.innerHTML = '<span class="acw-dots"><span>●</span><span>●</span><span>●</span></span>';
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  },

  rmLoading() {
    const e = document.getElementById('acw-loading');
    if (e) e.remove();
  },

  // ── 识别意图后高亮流程 ─────────────────────────────────
  applyIntent(intentName) {
    // 找对应的流程 key
    if (typeof CATALOG === 'undefined') return;
    let foundKey = null;
    CATALOG.forEach(g => g.items.forEach(i => {
      if (i.name === intentName) foundKey = i.key;
    }));
    if (!foundKey) return;

    // 更新选中状态
    if (typeof selectedKey !== 'undefined') {
      window.selectedKey = foundKey;
      if (typeof extraCtx !== 'undefined') window.extraCtx = {};
    }

    // 打开对应分组
    if (typeof openGroups !== 'undefined') {
      CATALOG.forEach(g => { if (g.items.find(i => i.key === foundKey)) openGroups.add(g.name); });
    }

    // 刷新目录
    if (typeof renderCatalog === 'function') renderCatalog();

    // 更新发起按钮
    const btn = document.getElementById('proceed-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg> 发起「' + intentName + '」';
    }

    // 显示意图条
    const strip = document.getElementById('acw-intent');
    const val = document.getElementById('acw-intent-val');
    if (strip) strip.style.display = 'flex';
    if (val) val.textContent = intentName;
  },

  // ── 调用模型（只需改这里接自训练模型）─────────────────
  async callModel(userText) {
    // ══ 接入点 ══════════════════════════════════════════
    // 现在用 Claude API 做 demo
    // 以后换成自训练模型：
    //   const res = await fetch('https://你的模型地址/predict', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ text: userText })
    //   });
    //   const data = await res.json();
    //   return { intent: data.intent, reply: data.reply };
    // ════════════════════════════════════════════════════
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: '你是领益智造HR审批系统助手。根据用户描述识别想发起哪种审批。可选：' + this.config.flows.join('、') + '。先输出简短确认（≤20字），再输出JSON：{"intent":"流程名称"}，用```json```包裹。识别不出来intent填null。',
        messages: [{ role: 'user', content: userText }]
      })
    });
    const data = await res.json();
    const raw = data.content?.map(i => i.text || '').join('') || '';
    const jm = raw.match(/```json\s*([\s\S]*?)```/);
    const reply = raw.replace(/```json[\s\S]*?```/g, '').trim();
    let intent = null;
    if (jm) { try { intent = JSON.parse(jm[1]).intent; } catch(e) {} }
    return { intent, reply: reply || '好的，已收到。' };
  },

  // ── 发送消息 ───────────────────────────────────────────
  async send() {
    const el = document.getElementById('acw-input');
    const txt = el.value.trim();
    if (!txt) return;
    el.value = '';
    this.addMsg(txt, 'user');
    this.addLoading();
    try {
      const { intent, reply } = await this.callModel(txt);
      this.rmLoading();
      this.addMsg(reply, 'ai');
      if (intent) this.applyIntent(intent);
    } catch(e) {
      this.rmLoading();
      this.addMsg('网络异常，请重试，或直接在右侧选择流程。', 'ai');
    }
  }
};

// 页面加载完自动初始化
document.addEventListener('DOMContentLoaded', () => AIChatWidget.init());
