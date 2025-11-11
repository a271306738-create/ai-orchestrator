import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 调用 OpenAI 接口
async function callLLM(prompt) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "你是一个智能助理，擅长自动规划和优化。" },
        { role: "user", content: prompt }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
  return res.data.choices[0].message.content;
}

// 简单AI流程：规划 -> 写初稿 -> 优化
app.post("/run-task", async (req, res) => {
  const prompt = req.body.prompt;
  if (!prompt) return res.status(400).json({ error: "缺少 prompt" });

  try {
    const plan = await callLLM(`请列出这个任务的步骤：${prompt}`);
    const draft = await callLLM(`根据以下计划写一份完整输出：${plan}`);
    const final = await callLLM(`润色这份内容，使其更专业：${draft}`);
    res.json({ plan, draft, final });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "AI执行出错" });
  }
});

app.get("/", (req, res) => {
  res.send("AI Orchestrator 正在运行 🚀");
});

app.listen(PORT, () => console.log(`AI后台运行在端口 ${PORT}`));
