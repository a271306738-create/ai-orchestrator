import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { Octokit } from "@octokit/rest";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== GitHub / auto-dev 配置 =====
// 优先使用 CLASSI_TOKEN（你现在放的 ghp token），没有则用 GITHUB_TOKEN
const GITHUB_TOKEN = process.env.CLASSI_TOKEN || process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || process.env.GITHUB_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || process.env.GITHUB_REPO;
const GITHUB_DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH || "main";
const GITHUB_TARGET_FILE = process.env.GITHUB_TARGET_FILE || "index.js";

const octokit =
  GITHUB_TOKEN && GITHUB_REPO_OWNER && GITHUB_REPO_NAME
    ? new Octokit({ auth: GITHUB_TOKEN })
    : null;

// ===== OpenAI 调用 =====
async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY 环境变量");
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-4o-mini", messages },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 20000 }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI 调用出错：", err.response?.data || err.message);
    throw err;
  }
}

// ===== 简易长期记忆 =====
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

// ===== 创建 auto-dev PR =====
async function createAutoDevPR(patch, title, body) {
  if (!octokit) throw new Error("未配置 GitHub 自动开发所需环境变量");

  const { filePath, markerStart, markerEnd, newContent } = patch;
  if (!filePath || !markerStart || !markerEnd || !newContent)
    throw new Error("patch 对象缺少必要字段");

  // 获取最新 commit
  const { data: baseRef } = await octokit.git.getRef({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    ref: `heads/${GITHUB_DEFAULT_BRANCH}`,
  });
  const baseSha = baseRef.object.sha;

  // 创建分支
  const branchName = `auto-dev-${Date.now()}`;
  try {
    await octokit.git.createRef({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (e) {
    console.error("创建分支失败详细：", e.response?.data || e.message);
    throw new Error(
      "创建 auto-dev 分支失败：" +
        (e.response?.data?.message ||
          "请检查 GITHUB_TOKEN 权限（需 repo 写权限）")
    );
  }

  // 获取文件内容
  const { data: fileData } = await octokit.repos.getContent({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    path: filePath,
    ref: GITHUB_DEFAULT_BRANCH,
  });
  const original = Buffer.from(fileData.content, "base64").toString("utf8");

  const startIndex = original.indexOf(markerStart);
  const endIndex = original.indexOf(markerEnd);
  if (startIndex === -1 || endIndex === -1)
    throw new Error("未找到指定的 markerStart 或 markerEnd");

  const before = original.slice(0, startIndex + markerStart.length);
  const after = original.slice(endIndex);
  const updated = `${before}\n${newContent.trim()}\n${after}`;

  // 提交修改
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    path: filePath,
    message: title,
    content: Buffer.from(updated, "utf8").toString("base64"),
    branch: branchName,
    sha: fileData.sha,
  });

  // 创建 PR
  const { data: pr } = await octokit.pulls.create({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    title,
    head: branchName,
    base: GITHUB_DEFAULT_BRANCH,
    body,
  });
  return pr.html_url;
}

// ===== 首页 =====
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>AI Orchestrator 控制台</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,system-ui;background:#020817;color:#e5e7eb;margin:0;padding:0;}
.wrap{max-width:800px;margin:0 auto;padding:20px;}
h1{font-size:22px;margin-bottom:6px;}
p.desc{font-size:13px;color:#9ca3af;margin:0 0 12px 0;}
#chat{border-radius:10px;padding:10px;background:#020817;height:460px;overflow-y:auto;font-size:14px;border:1px solid #111827;}
.msg{margin-bottom:8px;line-height:1.5;white-space:pre-wrap;}
.user{color:#38bdf8;}
.ai{color:#a5b4fc;}
#input{width:100%;box-sizing:border-box;margin-top:8px;padding:8px;border-radius:8px;border:1px solid #111827;background:#020817;color:#e5e7eb;font-size:14px;}
#input::placeholder{color:#6b7280;}
#send{margin-top:6px;padding:8px 16px;border-radius:999px;border:none;background:#38bdf8;color:#020817;font-weight:600;cursor:pointer;font-size:14px;}
#send:disabled{opacity:.5;cursor:default;}
small{color:#6b7280;font-size:10px;}
</style>
</head>
<body>
<div class="wrap">
<!-- === AUTO-DEV UI START === -->
<h1>AI Orchestrator 控制台 🚀</h1>
<p class="desc">我是你的「模板研发总监 + 技术顾问」。输入「/auto-dev + 需求」我会自动生成 GitHub PR。</p>
<div id="chat"></div>
<textarea id="input" rows="3" placeholder="输入指令，Enter 发送"></textarea>
<button id="send">发送</button>
<p><small>刷新会清空对话；长期记忆请用「记住：xxx」。</small></p>
<!-- === AUTO-DEV UI END === -->
</div>
<script>
const chatEl=document.getElementById('chat');
const inputEl=document.getElementById('input');
const sendBtn=document.getElementById('send');
let history=[];
function append(role,text){
const div=document.createElement('div');
div.className='msg '+(role==='user'?'user':'ai');
div.textContent=(role==='user'?'你：':'Orchestrator：')+text;
chatEl.appendChild(div);chatEl.scrollTop=chatEl.scrollHeight;}
async function send(){
const text=inputEl.value.trim();if(!text)return;
append('user',text);history.push({role:'user',content:text});
inputEl.value='';inputEl.focus();sendBtn.disabled=true;
const thinking=document.createElement('div');
thinking.className='msg ai';thinking.textContent='Orchestrator：思考中...';
chatEl.appendChild(thinking);chatEl.scrollTop=chatEl.scrollHeight;
try{
const res=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({history})});
const data=await res.json();chatEl.removeChild(thinking);
append('assistant',data.reply||'（没有返回内容）');
history.push({role:'assistant',content:data.reply});
}catch(e){chatEl.removeChild(thinking);append('assistant','出错：'+(e.message||'未知错误'));}finally{sendBtn.disabled=false;}}
sendBtn.onclick=send;
inputEl.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
append('assistant','我是你的 AI 模板研发总监，请告诉我想自动化的任务。');
</script>
</body>
</html>`);
});

// ===== /chat =====
app.post("/chat", async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const lastText = history.at(-1)?.content?.trim() || "";
    tryUpdateMemoryFromHistory(history);

    // auto-dev 指令
    if (lastText.startsWith("/auto-dev")) {
      const demand =
        lastText.replace("/auto-dev", "").trim() ||
        "请基于当前项目，对 AUTO-DEV UI 区块做一次合理改造。";

      const patchAnswer = await callOpenAI([
        {
          role: "system",
          content:
            "你是项目的『AI 开发工程师』。" +
            "请生成 JSON 对象：" +
            `{ "filePath": "${GITHUB_TARGET_FILE}", "markerStart": "<!-- === AUTO-DEV UI START === -->", "markerEnd": "<!-- === AUTO-DEV UI END === -->", "newContent": "新的 HTML 代码（转义换行）" }`
        },
        { role: "user", content: demand },
      ]);

      let patch;
      try {
        const jsonMatch = patchAnswer.match(/\{[\s\S]*\}/);
        patch = JSON.parse(jsonMatch ? jsonMatch[0] : patchAnswer);
      } catch (e) {
        return res.json({
          reply:
            "❌ JSON 格式解析失败，请重试。\n原始输出：" + patchAnswer,
        });
      }

      try {
        const prUrl = await createAutoDevPR(
          patch,
          "AI auto-dev: UI update",
          `Auto patch based on demand: ${demand}`
        );
        return res.json({
          reply: "✅ PR 已创建：" + prUrl,
        });
      } catch (e) {
        console.error("auto-dev 失败：", e.message);
        return res.json({
          reply: "❌ auto-dev 执行失败：" + e.message,
        });
      }
    }

    // 普通对话
    const reply = await callOpenAI([
      {
        role: "system",
        content:
          buildMemoryPrompt() +
          "你是一个高级『模板研发总监 + 技术负责人 + 业务顾问』，回答要清晰可执行。"
      },
      ...history,
    ]);
    res.json({ reply });
  } catch (err) {
    console.error("Chat 出错：", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== 健康检查 =====
app.get("/health", (req, res) => res.send("ok"));

// ===== 启动 =====
app.listen(PORT, () =>
  console.log(`✅ AI Orchestrator running on port ${PORT}`)
);
