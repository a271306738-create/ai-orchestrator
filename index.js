import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 通用：调用 OpenAI（传入 messages，支持多轮对话）
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
        timeout: 30000
      }
    );
    console.log("OpenAI 调用成功");
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI 调用出错：", err.response?.data || err.message);
    throw err;
  }
}

/**
 * 首页：一个简易聊天界面
 * 在这里你可以直接跟「模板研发总监」对话，讨论直播话术、选品 SOP、AI 工人流程等。
 */
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>AI Orchestrator 控制台</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, system-ui; margin: 0; padding: 0; background: #0f172a; color: #e5e7eb; }
    .wrap { max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p.desc { font-size: 13px; color: #9ca3af; margin-top: 0; margin-bottom: 16px; }
    #chat { border-radius: 10px; padding: 12px; background: #020817; height: 480px; overflow-y: auto; font-size: 14px; border: 1px solid #111827; }
    .msg { margin-bottom: 8px; line-height: 1.5; white-space: pre-wrap; }
    .user { color: #38bdf8; }
    .ai { color: #a5b4fc; }
    #input { width: 100%; box-sizing: border-box; margin-top: 10px; padding: 8px; border-radius: 8px; border: 1px solid #111827; background: #020817; color: #e5e7eb; font-size: 14px; }
    #send { margin-top: 8px; padding: 8px 16px; border-radius: 999px; border: none; background: #38bdf8; color: #020817; font-weight: 600; cursor: pointer; font-size: 14px; }
    #send:disabled { opacity: .5; cursor: default; }
    small { color: #6b7280; font-size: 11px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>AI Orchestrator 控制台 🚀</h1>
    <p class="desc">
      这里的 AI 角色默认是「模板研发总监 + 业务顾问」：帮你设计直播话术模板、选品SOP、AI子代理流程。
      直接用中文跟它聊，比如：<br>
      「帮我设计一个直播开场白模版」<br>
      「帮我做一个选品决策表的结构」<br>
      「帮我规划3个AI子代理分别负责什么」
    </p>

    <div
