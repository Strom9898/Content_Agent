# 小红书内容 Agent

一个基于 FastAPI、LangChain/LangGraph、Vue 3 和 PostgreSQL 的人机协同内容工作流 MVP。
工作流使用 LangGraph Checkpointer 持久化，可在服务重启后继续人工选题和审核。

## 已实现流程

1. 输入原始选题，模型生成 3 个选题方向。
2. 人工选择方向，模型生成文章初稿。
3. 人工审核；不通过则携带反馈重新生成并保留版本。
4. 审核通过后生成标题、摘要、标签和配图提示词。
5. 预留 RAG、图片生成和小红书发布适配接口。

默认使用模拟模型和 SQLite，开箱即可运行。生产环境可切换 PostgreSQL 和 OpenAI 兼容模型。
SQLite 模式使用内存 Checkpointer；PostgreSQL 模式使用 `PostgresSaver`。

## 本地启动

```powershell
Copy-Item .env.example .env
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

另开终端：

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

访问 `http://localhost:5173`，API 文档位于 `http://localhost:8000/docs`。

## PostgreSQL

```powershell
docker compose up -d postgres
```

将 `.env` 中数据库地址改为：

```env
DATABASE_URL=postgresql+psycopg://xhs:xhs@localhost:5432/xhs_agent
```

也兼容 `postgresql+asyncpg://...` 配置，应用会为同步 SQLAlchemy 和
LangGraph Checkpointer 自动转换成 psycopg 连接。首次启动会自动执行
`PostgresSaver.setup()`，创建并迁移 checkpoint 表。

每个项目 ID 同时作为 LangGraph 的 `thread_id`。工作流在两个位置调用
`interrupt()`：

1. 生成三个方向后等待人工选择。
2. 生成或重写文章后等待人工审核。

接口通过 `Command(resume=...)` 恢复原线程；审核不通过会回到文章审核中断点，
通过后才生成最终发布包。

## 查询当前阶段

业务阶段可通过项目详情查看：

```text
GET /api/projects/{project_id}
```

LangGraph checkpoint 的精确阶段可通过以下接口查看：

```text
GET /api/projects/{project_id}/workflow-state
```

常见 `phase`：

- `waiting_topic_selection`：已经生成选题，等待人工选择。
- `waiting_article_review`：已经生成或重写文章，等待人工审核。
- `processing`：工作流节点正在处理。
- `completed`：流程执行完成。

响应中的 `next_nodes` 是 LangGraph 下一步节点，`checkpoint_id` 是当前持久化
checkpoint，`waiting_for_human` 表示是否停在人工介入节点。

## 登录与历史记录

项目使用 JWT Bearer Token 鉴权，密码通过 PBKDF2-SHA256 加盐哈希保存。

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

注册和登录请求：

```json
{
  "username": "demo_user",
  "password": "password123"
}
```

登录后访问项目接口需要携带：

```text
Authorization: Bearer <access_token>
```

`GET /api/projects` 只返回当前账号的历史记录。前端点击记录后使用项目 ID
重新读取项目；项目 ID 同时也是 LangGraph `thread_id`，因此可以继续对应的
选题选择、文章审核或最终发布稿节点。

未通过审核时填写的 `Review.feedback` 会作为当前用户的长期写作偏好保存。
创建新项目时，系统会把最近的审核偏好注入 Graph State，并用于生成初稿和重写，
但这些偏好不属于 checkpoint，也不会与其他用户共享。可通过以下接口查看或清空：

```text
GET    /api/memories/review-feedback
DELETE /api/memories/review-feedback
```

生产部署前请在 `.env` 中设置至少 32 字节的随机密钥：

```env
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRE_MINUTES=10080
```

旧版本创建、没有 `user_id` 的历史项目不会自动分配给新账号，以免造成数据泄露。

## 接入真实模型

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4.1-mini
```

模型适配器位于 `backend/app/services/content_generator.py`。RAG 接口位于
`backend/app/rag/retriever.py`，后续可实现基于 pgvector 的检索器，并在各生成节点调用。

## 测试

```powershell
cd backend
python -m pytest
```
