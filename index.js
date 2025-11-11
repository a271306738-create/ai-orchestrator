import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Render 会传 PORT，没传就用 3000，本地也能跑
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== 通用：调用 OpenAI ======
async function callLLM(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，请在 Render 环境变量里配置。");
  }

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "你是一个智能助理，擅长自动规划和优化主播的生意决策。"
        },
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

  return res.data.choices[0].message.content.trim();
}

// ====== 路由 1：首页，证明服务活着 ======
app.get("/", (req, res) => {
  res.send("AI Orchestrator 正在运行 🚀 ，访问 /demo 看示例。");
});

// ====== 路由 2：多角色 Demo（你现在最需要的） ======
// GET https://你的域名/demo 直接在浏览器看结果
app.get("/demo", async (req, res) => {
  const goal =
    "为一个搞笑帅哥人设、粉丝主要是20-30岁女生的抖音带货直播间，设计3个适合的爆款方向，并说明选品逻辑和直播切入点。";

  try {
    // 三个“虚拟员工”的思考
    const prompts = [
      {
        name: "选品分析师",
        text:
          `你是选品分析师。目标：${goal}\n` +
          "从成本、毛利、复购率、供应链稳定性角度给出建议，用要点列出来。"
      },
      {
        name: "内容策划",
        text:
          `你是内容策划。目标：${goal}\n` +
          "给每个方向设计1句短视频钩子 + 1句直播间话术，口语化。"
      },
      {
        name: "风控老板",
        text:
          `你是风控兼老板。目标：${goal}\n` +
          "筛掉不靠谱方案，只保留你认为最有机会赚到真金白银的2-3条，并解释风险点。"
      }
    ];

    const steps = [];
    for (const p of prompts) {
      const out = await callLLM(p.text);
      steps.push({ agent: p.name, output: out });
    }

    // 最后由“总负责人”综合
    const summaryPrompt =
      "下面是团队不同角色的建议，请你作为总负责人，整理成一份可执行的行动方案，控制在600字以内，用123分点写清楚要做什么：\n\n" +
      JSON.stringify(steps, null, 2);

    const finalPlan = await callLLM(summaryPrompt);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(
      "【目标】\n" +
        goal +
        "\n\n【各角色输出】\n" +
        steps
          .map(
            (s) => `—— ${s.agent} ——\n${s.output}\n`
          )
          .join("\n") +
        "\n【总负责人给你的执行方案】\n" +
        finalPlan +
        "\n"
    );
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .send("出错了：" + (err.response?.data?.error?.message || err.message));
  }
});

// ====== 启动服务 ======
app.listen(PORT, () => {
  console.log(`AI Orchestrator running on port ${PORT}`);
});
