import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ================== OpenAI 通用调用 ==================

async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY 环境变量");
  }

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    console.log("OpenAI 调用成功");
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI 调用出错：", err.response?.data || err.message);
    throw err;
  }
}

// ================== 简易长期记忆（内存版 Demo） ==================
// 真正上线可以换成数据库；这里先证明机制。

// 只存「你明确要求记住的东西」
let orchestratorMemory = [];

/**
 * 从记忆生成一段提示词，加到 system prompt 里
 */
function buildMemoryPrompt() {
  if (!orchestratorMemory.length) return "";
  return (
    "以下是该老板的长期设定和偏好，在回答任何问题时都应默认遵守：\n" +
    orchestratorMemory.map((m, i) => `${i + 1}. ${m}`).join("\n") +
    "\n"
  );
}

/**
 * 解析“记住：xxx”指令，把 xxx 写入长期记忆
 * 用法示例：
 *   记住：主账号是杰尼龟龟，粉丝 20-30 岁女性为主，风格要搞笑真诚。
 */
function tryUpdateMemoryFromHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return;

  const last = history[history.length - 1];
  if (!last || typeof last.content !== "string") return;

  const text = last.content.trim();
  if (text.startsWith("记住：") || text.startsWith("记住:")) {
    const note = text.replace(/^记住[:：]/, "").trim();
    if (note) {
      orchestratorMemory.push(note);
      console.log("✅ 已写入长期记忆：", note);
    }
  }
}

// ================== 首页：控制台 UI ==================

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>AI Orchestrator 控制台</title>
  <style>
    body {
      font-family: -apple-system,BlinkMacSystemFont,system-ui;
      margin:0;
      padding:0;
      background:#020817;
      color:#e5e7eb;
    }
    .wrap {
      max-width:800px;
      margin:0 auto;
      padding:20px;
    }
    h1 {
      font-size:22px;
      margin-bottom:6px;
    }
    p.desc {
      font-size:13px;
      color:#9ca3af;
      margin:0 0 12px 0;
    }
    #chat {
      border-radius:10px;
      padding:10px;
      background:#020817;
      height:460px;
      overflow-y:auto;
      font-size:14px;
      border:1px solid #111827;
    }
    .msg {
      margin-bottom:8px;
      line-height:1.5;
      white-space:pre-wrap;
    }
    .user {
      color:#38bdf8;
    }
    .ai {
      color:#a5b4fc;
    }
    #input {
      width:100%;
      box-sizing:border-box;
      margin-top:8px;
      padding:8px;
      border-radius:8px;
      border:1px solid:#111827;
      background:#020817;
      color:#e5e7eb;
      font-size:14px;
      outline:none;
    }
    #input::placeholder {
      color:#6b7280;
    }
    #send {
      margin-top:6px;
      padding:8px 16px;
      border-radius:999px;
      border:none;
      background:#38bdf8;
      color:#020817;
      font-weight:600;
      cursor:pointer;
      font-size:14px;
    }
    #send:disabled {
      opacity:.5;
      cursor:default;
    }
    small {
      color:#6b7280;
      font-size:10px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>AI Orchestrator 控制台 🚀</h1>
    <p class="desc">
      我是你的「模板研发总监 + 技术顾问」。在这里让我帮你：直播话术模板、选品 SOP、AI 子代理分工、流程文档、功能路线图等。<br/>
      提示：输入「记住：xxx」可以写入长期记忆，比如「记住：主账号是杰尼龟龟，粉丝以 20-30 岁女生为主」。
    </p>

    <div id="chat"></div>
    <textarea id="input" rows="3" placeholder="输入你的指令，Enter 发送，Shift+Enter 换行"></textarea>
    <button id="send">发送</button>
    <p><small>对话只存在本页，刷新会清空；长期记忆由「记住：」指令单独保存（当前为内存版 Demo，服务重启会清空）。 · /demo 可查看功能路线图示例。</small></p>
  </div>

  <script>
    const chatEl = document.getElementById('chat');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    let history = [];

    function append(role, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
      div.textContent = (role === 'user' ? '你：' : 'Orchestrator：') + text;
      chatEl.appendChild(div);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    async function send() {
      const text = inputEl.value.trim();
      if (!text) return;

      append('user', text);
      history.push({ role: 'user', content: text });
      inputEl.value = '';
      inputEl.focus();

      sendBtn.disabled = true;
      const thinking = document.createElement('div');
      thinking.className = 'msg ai';
      thinking.textContent = 'Orchestrator：思考中...';
      chatEl.appendChild(thinking);
      chatEl.scrollTop = chatEl.scrollHeight;

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history })
        });
        const data = await res.json();

        chatEl.removeChild(thinking);

        const reply = data.reply || '（没有返回内容，请检查服务端日志）';
        append('assistant', reply);
        history.push({ role: 'assistant', content: reply });
      } catch (e) {
        chatEl.removeChild(thinking);
        append('assistant', '出错了：' + (e.message || '未知错误'));
      } finally {
        sendBtn.disabled = false;
      }
    }

    sendBtn.onclick = send;
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    append(
      'assistant',
      '我是你的 AI 模板研发总监。先说一件你最想标准化或自动化的事情，我帮你拆成步骤和可实现的功能。'
    );
  </script>
</body>
</html>`);
});

// ================== /chat：带长期记忆的助手 ==================

app.post("/chat", async (req, res) => {
  try {
    const clientHistory = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    const last = clientHistory[clientHistory.length - 1];
    const lastText =
      last && typeof last.content === "string"
        ? last.content.trim()
        : "";

    // 1）如果是「记住：xxx」，写入长期记忆，然后继续正常回答
    if (lastText.startsWith("记住：") || lastText.startsWith("记住:")) {
      const note = lastText.replace(/^记住[:：]/, "").trim();
      if (note) {
        orchestratorMemory.push(note);
        console.log("✅ 已写入长期记忆：", note);
      }
      // 不单独返回提示，让下面的正常逻辑一起跑，这样它会带着新记忆回答
    }

    // 2）如果是 "/auto-dev" 指令，切换成开发工程师模式
    if (lastText.startsWith("/auto-dev")) {
      const demand = lastText.replace("/auto-dev", "").trim() || 
        "请基于当前 AI Orchestrator 项目（Express + /chat + /demo + 控制台页面），提出下一步可以自动化实现的功能和 UI 改造方案，并给出对应的代码修改建议。";

      const devReply = await callOpenAI([
        {
          role: "system",
          content:
            buildMemoryPrompt() +
            "你是这个项目的『AI 开发工程师 + 架构师』。" +
            "目标：根据老板的指令，帮当前项目设计可以直接落地的改动，包括新增接口、修改 index.js、调整前端 UI、增加长期记忆存储等。" +
            "必须输出清晰的：改动说明、涉及的文件路径、关键代码片段（用```标记）。" +
            "禁止擅自执行部署或转账等高风险操作，如有敏感操作，标记为【需要人工确认】。"
        },
        ...clientHistory
      ]);

      console.log("✅ Auto-dev reply:", devReply);
      return res.json({ reply: devReply });
    }

    // 3）默认：作为「模板研发总监 + 技术负责人」正常对话
    const messages = [
      {
        role: "system",
        content:
          buildMemoryPrompt() +
          "你是一个高级『模板研发总监 + 技术负责人 + 业务顾问』，服务对象是一位做直播电商与多项目的老板。" +
          "你的职责：1）帮他设计标准化模板（直播话术、选品 SOP、AI 子代理职责、流程文档）；" +
          "2）同时作为 AI Orchestrator 项目的技术负责人，主动提出可以实现的新功能、接口设计和代码补丁草稿；" +
          "3）所有会影响真实资金、账号安全、外部系统写操作的功能，必须标记为【需要人工确认】并给出风险说明；" +
          "输出要求：结构清晰、可执行、语言简洁，不要废话。"
      },
      ...clientHistory
    ];

    const reply = await callOpenAI(messages);
    console.log("✅ Chat reply:", reply);
    res.json({ reply });
  } catch (err) {
    console.error("Chat 出错：", err.response?.data || err.message);
    res.status(500).json({
      error: "Chat 出错",
      detail: err.response?.data?.error?.message || err.message
    });
  }
});

    console.error("Chat 出错：", err.response?.data || err.message);
    res.status(500).json({
      error: "Chat 出错",
      detail: err.response?.data?.error?.message || err.message
    });
  }
});

// ================== /demo：功能路线图示例 ==================

app.get("/demo", async (req, res) => {
  try {
    const reply = await callOpenAI([
      {
        role: "system",
        content: "你是一个说话简短的助手。"
      },
      {
        role: "user",
        content:
          "你是 AI Orchestrator 项目的技术负责人，熟悉当前系统：Express + /chat + /demo 的基础结构。" +
          "根据这些，提出 3-7 个下一步可以实现的功能，用于帮助直播电商老板：" +
          "包括选品决策、话术生成、数据分析、多代理协作等。" +
          "每个功能包含：名称、作用、对应的 API 路径设计、是否涉及敏感操作（如资金/账号/数据写入）。"
      },
      {
        role: "user",
        content:
          "请输出一个「功能路线图」，按优先级排序，格式清晰，方便我选择要先实现哪几个。"
      }
    ]);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("【Orchestrator 功能建议】\n" + reply + "\n");
  } catch (err) {
    console.error("demo 出错：", err.response?.data || err.message);
    res
      .status(500)
      .send(
        "获取功能建议出错： " +
          (err.response?.data?.error?.message || err.message)
      );
  }
});

// ================== 启动服务 ==================

app.listen(PORT, () => {
  console.log(`AI Orchestrator running on port ${PORT}`);
});
