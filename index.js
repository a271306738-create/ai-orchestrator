import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { Octokit } from "@octokit/rest";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== OpenAI 基础配置 =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

if (!OPENAI_API_KEY) {
  console.warn("⚠️ 未检测到 OPENAI_API_KEY，所有调用 OpenAI 的接口将报错。");
}

// ===== GitHub / auto-dev 配置 =====
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const GITHUB_DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH || "main";
// 要让 auto-dev 改的目标文件名（默认本文件叫 index.js）
const GITHUB_TARGET_FILE = process.env.GITHUB_TARGET_FILE || "index.js";

const octokit =
  GITHUB_TOKEN && GITHUB_REPO_OWNER && GITHUB_REPO_NAME
    ? new Octokit({ auth: GITHUB_TOKEN })
    : null;

if (!octokit) {
  console.warn(
    "⚠️ 未完整配置 GitHub 环境变量（GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME），/auto-dev 功能不可用。"
  );
}

// ===== OpenAI 通用调用 =====
async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY 环境变量");
  }

  try {
    const res = await axios.post(
      `${OPENAI_BASE_URL}/chat/completions`,
      {
        model: "gpt-4o-mini",
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const choice = res.data?.choices?.[0]?.message?.content;
    if (!choice) {
      throw new Error("OpenAI 未返回有效内容");
    }
    return choice.trim();
  } catch (err) {
    const detail = err.response?.data || err.message || String(err);
    console.error("❌ OpenAI 调用出错：", detail);
    throw new Error(
      typeof detail === "string"
        ? detail
        : detail.error?.message || "OpenAI 调用失败"
    );
  }
}

// ===== 简易长期记忆（内存版） =====
let orchestratorMemory = [];

function buildMemoryPrompt() {
  if (!orchestratorMemory.length) return "";
  return (
    "以下是该老板的长期设定和偏好，在回答任何问题时都应默认遵守：\n" +
    orchestratorMemory.map((m, i) => `${i + 1}. ${m}`).join("\n") +
    "\n"
  );
}

function tryUpdateMemoryFromHistory(history) {
  if (!Array.isArray(history) || !history.length) return;
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

// ===== auto-dev：根据 patch 创建 PR（只改标记区） =====
async function createAutoDevPR(patch, title, body) {
  if (!octokit) {
    throw new Error("未配置 GitHub 自动开发所需环境变量");
  }

  const { filePath, markerStart, markerEnd, newContent } = patch;

  if (!filePath || !markerStart || !markerEnd || !newContent) {
    throw new Error("patch 对象缺少必要字段");
  }

  // 1. 获取主分支最新 commit
  let baseSha;
  try {
    const { data: baseRef } = await octokit.git.getRef({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      ref: `heads/${GITHUB_DEFAULT_BRANCH}`,
    });
    baseSha = baseRef.object.sha;
  } catch (e) {
    console.error("获取主分支失败：", e);
    throw new Error("获取主分支失败，请检查 GITHUB_DEFAULT_BRANCH 是否正确");
  }

  // 2. 创建新分支
  const branchName = `auto-dev-${Date.now()}`;
  try {
    await octokit.git.createRef({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (e) {
    console.error("创建分支失败：", e);
    throw new Error("创建 auto-dev 分支失败，可能是权限或命名问题");
  }

  // 3. 获取要修改的文件内容
  let fileData;
  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      path: filePath,
      ref: GITHUB_DEFAULT_BRANCH,
    });
    fileData = data;
  } catch (e) {
    console.error("读取目标文件失败：", e);
    throw new Error(
      `读取文件失败：${filePath}，请确认文件路径是否正确（当前默认 ${GITHUB_TARGET_FILE}）`
    );
  }

  if (Array.isArray(fileData)) {
    throw new Error("给定路径是目录不是文件");
  }

  const original = Buffer.from(fileData.content, "base64").toString("utf8");

  const startIndex = original.indexOf(markerStart);
  const endIndex = original.indexOf(markerEnd);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("未找到指定的 markerStart 或 markerEnd，请确认注释是否存在且完全匹配");
  }

  const before = original.slice(0, startIndex + markerStart.length);
  const after = original.slice(endIndex);

  const updated = `${before}
${newContent.trim()}
${after}`;

  // 4. 在新分支更新文件
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      path: filePath,
      message: title,
      content: Buffer.from(updated, "utf8").toString("base64"),
      branch: branchName,
      sha: fileData.sha,
    });
  } catch (e) {
    console.error("更新文件失败：", e);
    throw new Error("更新文件失败，请检查 GitHub 权限与内容格式");
  }

  // 5. 创建 PR
  try {
    const { data: pr } = await octokit.pulls.create({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      title,
      head: branchName,
      base: GITHUB_DEFAULT_BRANCH,
      body,
    });
    return pr.html_url;
  } catch (e) {
    console.error("创建 PR 失败：", e);
    throw new Error("创建 PR 失败，请检查仓库权限与分支配置");
  }
}

// ===== 首页：控制台（含 AUTO-DEV 标记区） =====
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
      border:1px solid:#111827;
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
    <!-- === AUTO-DEV UI START === -->
    <h1>AI Orchestrator 控制台 🚀</h1>
    <p class="desc">
      我是你的「模板研发总监 + 技术顾问」。在这里让我帮你：直播话术模板、选品 SOP、AI 子代理分工、流程文档、功能路线图等。<br/>
      使用技巧：<br/>
      · 输入「记住：xxx」写入长期记忆（如「记住：主账号是XXX」）。<br/>
      · 输入「/auto-dev + 需求」我会生成修改本页面 UI 的补丁，并自动在 GitHub 提交 PR（需正确配置 GitHub 环境变量）。
    </p>

    <div id="chat"></div>
    <textarea id="input" rows="3" placeholder="输入你的指令，Enter 发送，Shift+Enter 换行"></textarea>
    <button id="send">发送</button>
    <p><small>对话只存在本页，刷新会清空；长期记忆由「记住：」指令单独保存（当前为内存版 Demo）。</small></p>
    <!-- === AUTO-DEV UI END === -->
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

        if (!res.ok) {
          const msg = data?.detail || data?.error || '服务器错误';
          append('assistant', '出错了：' + msg);
          return;
        }

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

// ===== /chat：对话 + 记忆 + auto-dev =====
app.post("/chat", async (req, res) => {
  try {
    const clientHistory = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    const last = clientHistory[clientHistory.length - 1];
    const lastText =
      last && typeof last.content === "string" ? last.content.trim() : "";

    // 处理记忆写入（记住：xxx）
    tryUpdateMemoryFromHistory(clientHistory);

    // 如果没有最后一句话，直接给个提示
    if (!lastText) {
      const reply =
        "请直接告诉我你现在最想标准化或自动化的一件事情，我会帮你拆方案。";
      return res.json({ reply });
    }

    // 处理 /auto-dev 指令：让 AI 生成 patch，并自动创建 PR
    if (lastText.startsWith("/auto-dev")) {
      const demand =
        lastText.replace("/auto-dev", "").trim() ||
        "请基于当前项目，对 AUTO-DEV UI 区块做一次合理改造，并生成对应的补丁。";

      let patchAnswer;
      try {
        patchAnswer = await callOpenAI([
          {
            role: "system",
            content:
              "你是这个项目的『AI 开发工程师』。" +
              "请根据用户需求，生成一个 JSON 对象（不要任何多余文字），字段为：" +
              `{ "filePath": "${GITHUB_TARGET_FILE}", ` +
              "\"markerStart\": \"<!-- === AUTO-DEV UI START === -->\", " +
              "\"markerEnd\": \"<!-- === AUTO-DEV UI END === -->\", " +
              "\"newContent\": \"这里填入新的 HTML 片段（不含 marker 本身）\" }。" +
              "newContent 内部的换行和引号请转义为合法 JSON 字符串。" +
              "只允许修改 marker 包裹的区域，禁止动其他代码。"
          },
          { role: "user", content: demand }
        ]);
      } catch (e) {
        return res.json({
          reply: "❌ auto-dev 调用 OpenAI 失败：" + e.message
        });
      }

      let patch;
      try {
        const jsonMatch = patchAnswer.match(/\{[\s\S]*\}/);
        patch = JSON.parse(jsonMatch ? jsonMatch[0] : patchAnswer);
      } catch (e) {
        console.error("解析 auto-dev JSON 失败：", e, patchAnswer);
        return res.json({
          reply:
            "【auto-dev 提示】AI 没按 JSON 格式返回 patch，请重试或收紧提示词。原始输出：\n" +
            patchAnswer
        });
      }

      try {
        const prUrl = await createAutoDevPR(
          patch,
          "AI auto-dev: UI update",
          `Auto-generated patch based on demand: ${demand}`
        );

        return res.json({
          reply:
            "✅ 已根据你的指令生成自动开发 PR，请到 GitHub 审核合并：\n" +
            prUrl
        });
      } catch (e) {
        console.error("创建 auto-dev PR 失败：", e.message);
        return res.json({
          reply:
            "❌ auto-dev 执行失败：" +
            e.message +
            "。\n请检查环境变量和标记注释是否存在（GITHUB_TOKEN / 仓库路径 / 注释文本）。"
        });
      }
    }

    // 默认：模板研发总监 + 技术负责人
    const messages = [
      {
        role: "system",
        content:
          buildMemoryPrompt() +
          "你是一个高级『模板研发总监 + 技术负责人 + 业务顾问』，服务对象是一位做直播电商与多项目的老板。" +
          "你的职责：1）设计标准化模板（直播话术、选品 SOP、AI 子代理职责、流程文档）；" +
          "2）提出可实现的系统功能和 API 设计；" +
          "3）涉及真实资金、账号或写操作的建议标记为【需要人工确认】并说明风险；" +
          "输出要求：结构清晰、可执行、语言简洁。"
      },
      ...clientHistory
    ];

    const reply = await callOpenAI(messages);
    return res.json({ reply });
  } catch (err) {
    console.error("Chat 出错：", err);
    res.status(500).json({
      error: "Chat 出错",
      detail:
        err.response?.data?.error?.message ||
        err.message ||
        "未知错误，请检查服务端日志",
    });
  }
});

// ===== /demo：功能路线图示例 =====
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
          "你是 AI Orchestrator 项目的技术负责人，熟悉当前系统结构。" +
          "请提出 3-7 个下一步可以实现的功能，每个包含：名称、作用、API 路径、是否涉及敏感操作。"
      }
    ]);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("【Orchestrator 功能建议】\n" + reply + "\n");
  } catch (err) {
    console.error("demo 出错：", err);
    res
      .status(500)
      .send(
        "获取功能建议出错：" +
          (err.response?.data?.error?.message || err.message || "未知错误")
      );
  }
});

// ===== 健康检查（给 Render / 监控用） =====
app.get("/health", (req, res) => {
  res.send("ok");
});

// ===== 启动服务 =====
app.listen(PORT, () => {
  console.log(`✅ AI Orchestrator running on port ${PORT}`);
});
