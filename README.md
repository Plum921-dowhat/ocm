# OCM — An Open-source Classroom Management System 智慧教室管理系统

An integrated smart-classroom system covering courses, timetables, classroom bookings, attendance, lesson observation and IoT devices. It consists of one Go backend, a React (Ant Design) web console and a WeChat mini-program, plus a device-side IoT SDK and an optional monitoring stack.

课堂管理一体的智慧教室系统:课程 / 课表 / 教室预约 / 考勤 / 听课评课 / 物联网设备,三端一体——**Go 后端** + **Web 控制台**(React + Ant Design) + **微信小程序**,外加 IoT 设备侧 SDK 与可选监控栈。

The full documentation (deployment, contracts, per-client guides) is built locally from `docs/` with Docusaurus 3: `cd docs && npm ci && npm start` serves it at http://localhost:3000.

完整文档(部署、契约、各端指南)由 `docs/` 下的 Docusaurus 3 站点本地构建:`cd docs && npm ci && npm start` 后访问 http://localhost:3000。

## Quick Start 快速开始

```bash
git clone <repo> ocm && cd ocm
# development stack: postgres + backend (air hot reload) + web (vite)
# 开发全栈:postgres + backend(air 热重载) + web(vite)
docker compose up -d
```

The web console is served at http://localhost:5173; the default development credentials are `admin` / `admin123`.
For production deployment and the IoT / observability overlays, see `docs/docs/guide/getting-started.mdx`.

Web 控制台地址为 http://localhost:5173,开发环境默认账号为 `admin` / `admin123`。
生产部署、IoT 与监控 overlay 参见 `docs/docs/guide/getting-started.mdx`。

## Repository Map 仓库地图

| Directory | Contents |
|---|---|
| `backend/` | Go backend (`net/http` ServeMux + PostgreSQL 17, idempotent migrations) |
| `web/` | Web console (React 19 + Vite + Ant Design, TypeScript strict) |
| `miniapp/` | WeChat mini-program (glass-easel + TDesign, WebView by default) |
| `iot/` | Device-side SDK and simulator (second Go module; MQTT contract in `iot/spec/spec.md`) |
| `docs/` | Documentation site (Docusaurus) |
| `deploy/` | Deployment configuration (mosquitto, observability) |
| `agents/` | Reference material shared by AI coding tools (lessons and technology evaluations) |

| 目录 | 内容 |
|---|---|
| `backend/` | Go 后端(`net/http` ServeMux + PostgreSQL 17,幂等迁移) |
| `web/` | Web 控制台(React 19 + Vite + Ant Design,TypeScript strict) |
| `miniapp/` | 微信小程序(glass-easel + TDesign,默认 WebView) |
| `iot/` | 设备侧 SDK 与模拟器(第二个 Go module,MQTT 契约见 `iot/spec/spec.md`) |
| `docs/` | 文档站(Docusaurus) |
| `deploy/` | 部署配置(mosquitto、observability) |
| `agents/` | AI 编程工具共享参考(实战教训与技术选型记录) |
