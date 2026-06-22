# 多仓库发布变更影响分析平台

## 项目简介

本项目是一个基于 Node.js + Express + SQLite 的 Web 应用，用于多仓库场景下的发布变更影响分析与发布验收管理。平台支持：

- **多维度影响分析**：文件路径、服务依赖、API 调用链、数据库表引用的跨服务影响传播分析
- **6 维风险评分模型**：基于风险等级、跨服务影响、数据库变更、需求关联、公共接口、未确认项的综合风险评估
- **发布验收流程**：待确认事项的批量确认、退回流转、处理意见和负责人管理
- **可视化看板**：发布单风险概览、确认进度、负责人分布、依赖拓扑图
- **审计追踪**：完整的操作记录，支持按变更追溯所有确认/退回历史

---

## 目录结构

```
gsb-0046/
├── package.json              # 依赖与脚本配置
├── package-lock.json         # 依赖锁定文件
├── .gitignore                # 忽略规则（排除 node_modules/数据库/日志等）
├── server.js                 # Express 应用入口
├── README.md                 # 本文档
│
├── db/
│   └── index.js              # sql.js 封装（跨平台 SQLite 纯 JS 实现）
│
├── routes/                   # Express 路由层
│   ├── releases.js           # 发布单 CRUD + 变更导入
│   ├── changes.js            # 变更 CRUD + 批量操作 + 进度统计 + 操作记录
│   ├── impact.js             # 影响分析子接口
│   ├── statistics.js         # 概览/看板/筛选选项接口
│   ├── repositories.js       # 仓库管理
│   └── services.js           # 服务管理 + 依赖图
│
├── services/
│   └── impactAnalyzer.js     # 核心影响分析 + 6 维评分 + 拓扑 + 进度统计
│
├── scripts/                  # 数据库与校验脚本
│   ├── initDb.js             # 数据库初始化（支持 --reset 重置）
│   ├── seedData.js           # 幂等种子数据导入
│   ├── verifyData.js         # 数据量与完整性校验
│   └── lint.js               # 源码语法检查（排除 node_modules）
│
├── tests/
│   └── apiTest.js            # API 自动化测试（自动启停服务 + 40+ 用例）
│
├── public/
│   └── index.html            # 前端 SPA（风险看板/确认清单/操作审计）
│
└── data/                     # 运行时数据库目录（.gitignore，自动创建）
```

---

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 14.0.0 | 推荐 LTS 版本（16/18/20） |
| npm | >= 6.14.0 | 随 Node.js 自带 |

**无其他系统级依赖**：数据库使用 sql.js（纯 JavaScript SQLite 实现），无需本地安装 SQLite 或任何原生编译工具。

---

## 安装步骤

### 从空目录克隆后的完整命令序列

```bash
# 1. 克隆项目（或解压源码包）
git clone <repository-url> gsb-0046
cd gsb-0046

# 2. 干净安装依赖（使用 package-lock.json 锁定版本）
npm ci

# 3. 初始化并重置数据库（清空所有表结构与数据）
npm run reset

# 4. 写入种子示例数据（幂等，可重复执行）
npm run seed

# 5. 校验数据量与完整性
npm run verify

# 6. 启动服务（默认端口 3000）
npm start
```

启动后访问：<http://localhost:3000>

---

## 数据库说明

### 数据文件位置

- **数据库文件**：`data/app.db`
- **自动创建**：首次启动或运行 `npm run reset` 时自动创建 `data/` 目录
- **跨平台兼容**：使用 sql.js 纯 JS 实现，Windows/macOS/Linux 通用

### 数据库命令

| 命令 | 说明 | 幂等性 |
|------|------|--------|
| `npm run init-db` | 初始化表结构（保留现有数据） | ✅ 可重复执行 |
| `npm run reset` | 重置数据库（删除文件 + 重建所有表） | ✅ 可重复执行 |
| `npm run seed` | 写入种子示例数据 | ✅ 可重复执行，不会重复插入 |
| `npm run verify` | 校验数据量与表完整性 | ✅ 只读操作 |

### 种子数据规模

| 数据类型 | 数量 | 说明 |
|----------|------|------|
| 代码仓库 | 4 | user-service / order-service / payment-service / gateway |
| 微服务 | 8 | 含用户、订单、支付、网关、商品、库存、通知、搜索 |
| 发布单 | 3 | 含不同状态的示例发布单 |
| 变更记录 | 26 | 覆盖文件变更、服务依赖、API、数据库表引用 |
| 服务依赖 | 11 | 完整的服务间调用依赖图 |
| API 定义 | 14 | RESTful 接口定义 |
| API 调用关系 | 8 | 跨服务 API 调用链 |
| 数据库表 | 10 | 业务表定义 |
| 表引用关系 | 8 | 变更涉及的数据库表引用 |

---

## 启动方式

### 开发/生产启动

```bash
# 默认端口 3000
npm start

# 指定端口启动
PORT=8080 npm start
```

启动成功后输出：
```
Database initialized successfully
Server running on port 3000
Health check: http://localhost:3000/api/health
```

### 健康检查

```bash
curl http://localhost:3000/api/health
```

响应：
```json
{ "status": "ok", "message": "发布变更影响分析平台运行正常" }
```

---

## 风险评分模型

### 6 维评分规则

| 评分维度 | 权重 | 评分规则 |
|----------|------|----------|
| 风险等级 | 25 | high=25, medium=12, low=3 |
| 跨服务影响 | 15 | 存在跨服务影响得 15 分 |
| 数据库表变更 | 15 | 涉及任意数据库表得 15 分 |
| 缺少关联需求 | 10 | 未关联需求 ID 得 10 分 |
| 公共接口影响 | 8 | 影响公共 API 得 8 分 |
| 未确认影响项 | 5 | 存在未确认项得 5 分 |

- **原始满分**：78 分
- **最终输出**：归一化到百分制（× 100 / 78）
- **等级划分**：>=70 高风险 / 40-69 中风险 / <40 低风险

### 接口返回字段

```json
{
  "risk_score": 85,
  "risk_level": "high",
  "score_details": { "risk_level": 25, "cross_service": 15, ... },
  "risk_reasons": ["变更风险等级为高", "存在 3 个跨服务影响", ...],
  "suggestions": ["建议回归测试所有关联服务接口", "请补充需求关联", ...]
}
```

---

## 验证命令

### 一键完整验证（推荐）

```bash
npm run validate
```

该命令按顺序执行：
1. `lint` - 源码语法检查
2. `reset` - 数据库重置
3. `seed` - 种子数据写入
4. `verify` - 数据完整性校验
5. `test-api` - API 自动化测试

### 单项验证

#### 1. 源码语法检查

```bash
npm run lint
```

- 仅扫描源码目录：`routes/`, `services/`, `db/`, `scripts/`, `tests/`
- **排除**：`node_modules/`, `data/`, `reports/`, `cache/` 等
- 有语法错误时以非 0 状态码退出

#### 2. 数据完整性校验

```bash
npm run verify
```

校验项：
- 9 张核心表存在
- 数据量满足最低要求（>=4 仓库、>=8 服务、>=20 变更）
- 外键引用完整性（变更的 release_id/service_id/repository_id 均存在）

#### 3. API 自动化测试

```bash
npm run test-api
```

**特性**：
- 自动启动服务（测试端口 3099，与默认 3000 隔离）
- 自动检测服务状态，最长等待 15 秒
- 测试完成后自动终止服务进程
- 覆盖 40+ 测试用例，12 大测试类别

**测试覆盖范围**：

| 测试类别 | 覆盖内容 |
|----------|----------|
| 健康检查 | /api/health 接口 |
| 仓库管理 | 列表/创建/详情/数量校验 |
| 服务管理 | 列表/依赖图/创建/数量校验 |
| 发布单管理 | 列表/创建/详情/数量校验 |
| 变更导入与筛选 | 3 条变更导入 + 7 种筛选维度 |
| 影响计算与评分 | 6 维评分字段完整性校验 |
| 批量确认与退回 | batch-confirm/reject/reset + 进度统计 |
| 组合筛选查询 | 多维度组合筛选验证 |
| 统计看板 | overview/dashboard/release-board/filter-options |
| 操作记录审计 | 操作记录字段与时间戳校验 |
| E2E 完整流程 | 创建发布单→导入变更→评分→确认→进度 100% |
| 数据完整性 | 仓库/服务/变更数量达标验证 |

---

## 核心 HTTP 接口

### 发布单管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/releases` | 发布单列表 |
| POST | `/api/releases` | 创建发布单 |
| GET | `/api/releases/:id` | 发布单详情 |
| POST | `/api/releases/:id/import-changes` | 导入变更到发布单 |

### 变更管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/changes` | 变更列表（支持多维筛选） |
| POST | `/api/changes` | 创建变更 |
| GET | `/api/changes/:id` | 变更详情 |
| POST | `/api/changes/:id/confirm` | 确认单条变更 |
| POST | `/api/changes/:id/reject` | 退回单条变更 |
| POST | `/api/changes/:id/unconfirm` | 取消确认 |
| POST | `/api/changes/batch-confirm` | 批量确认 |
| POST | `/api/changes/batch-reject` | 批量退回 |
| POST | `/api/changes/batch-reset` | 批量重置状态 |
| GET | `/api/changes/confirmation-progress/:releaseId` | 按发布单查看确认进度 |
| GET | `/api/changes/operations/:changeId` | 单条变更操作记录 |

### 影响分析

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/impact/analyze/:releaseId` | 完整影响分析 + 风险评分 |
| GET | `/api/impact/topology/:releaseId` | 依赖拓扑图 |
| GET | `/api/impact/progress/:releaseId` | 确认进度统计 |
| GET | `/api/impact/files/:releaseId` | 文件路径影响 |
| GET | `/api/impact/services/:releaseId` | 服务依赖影响 |
| GET | `/api/impact/database/:releaseId` | 数据库表影响 |

### 统计看板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/statistics/overview` | 全局概览统计 |
| GET | `/api/statistics/dashboard` | 仪表盘聚合数据 |
| GET | `/api/statistics/release-board` | 发布单维度看板 |
| GET | `/api/statistics/releases-filter-options` | 筛选器下拉选项 |

### 仓库与服务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/repositories` | 仓库列表 |
| POST | `/api/repositories` | 创建仓库 |
| GET | `/api/services` | 服务列表 |
| GET | `/api/services/dependencies` | 服务依赖图 |
| POST | `/api/services` | 创建服务 |

---

## 常见故障排查

### 1. `npm ci` 失败

**现象**：安装时报错或卡住

**排查步骤**：
```bash
# 检查 Node.js 版本
node --version   # 需要 >= 14.0.0

# 检查 npm 版本
npm --version    # 需要 >= 6.14.0

# 清理缓存后重试
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### 2. 数据库文件被锁定

**现象**：重置数据库时报 EBUSY 或文件占用错误

**解决**：
- 确保没有其他 Node 进程正在访问 `data/app.db`
- 手动关闭所有运行中的 `node server.js` 进程
- Windows 下重启终端后重试 `npm run reset`

### 3. 端口被占用

**现象**：启动时提示 `Port 3000 is already in use`

**解决**：
```bash
# 指定其他端口启动
PORT=3001 npm start

# 或查找并关闭占用进程
# Windows:
netstat -ano | findstr :3000
taskkill /PID <进程ID> /F

# Linux/macOS:
lsof -i :3000
kill -9 <PID>
```

### 4. API 测试服务启动超时

**现象**：`npm run test-api` 报 "Server failed to start within timeout"

**排查**：
- 确认 3099 端口未被占用
- 检查 `node --version` >= 14
- 手动运行 `node server.js` 查看是否有报错输出
- 设置更长超时：`TEST_TIMEOUT=30000 npm run test-api`

### 5. 种子数据重复执行报错

**现象**：理论上不会发生，seed 脚本已做幂等处理

**应急处理**：
```bash
# 先重置再导入
npm run reset
npm run seed
```

---

## 数据与运行产物

### 已排除在源码交付之外

以下目录/文件已通过 `.gitignore` 排除，**不会**作为源码交付：

| 路径 | 说明 |
|------|------|
| `node_modules/` | npm 依赖目录（通过 `npm ci` 生成） |
| `data/` | 运行时数据库目录（通过 reset/seed 生成） |
| `*.db, *.sqlite, *.sqlite3` | 各类数据库文件 |
| `*.log` | npm 调试日志与运行日志 |
| `reports/` | 报告输出目录 |
| `cache/` | 缓存目录 |
| `.temp/`, `tmp/` | 临时文件目录 |
| `coverage/` | 测试覆盖率输出 |

### 清理所有运行产物

```bash
# Windows PowerShell
Remove-Item -Recurse -Force node_modules, data, reports, cache -ErrorAction SilentlyContinue
Remove-Item -Force *.log, *.db, *.pid -ErrorAction SilentlyContinue

# Linux/macOS
rm -rf node_modules data reports cache *.log *.db *.pid
```

---

## 快速命令速查

| 目标 | 命令 |
|------|------|
| 干净安装依赖 | `npm ci` |
| 重置数据库 | `npm run reset` |
| 写入示例数据 | `npm run seed` |
| 校验数据 | `npm run verify` |
| 语法检查 | `npm run lint` |
| 启动服务（3000） | `npm start` |
| API 自动化测试 | `npm run test-api` |
| 一键完整验证 | `npm run validate` |

---

## License

内部项目
