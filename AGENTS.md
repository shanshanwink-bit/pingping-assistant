# AGENTS.md

## 项目

- 微信原生小程序；根目录的 `app.*`、项目配置与 `sitemap.json` 保持原位。
- 页面只处理展示与交互，共享业务逻辑放 `utils/`，自有服务端能力放 `server/`。

## 目录

- `pages/` 页面；`custom-tab-bar/` 自定义导航；`assets/` 静态资源。
- `server/` 自有云服务器 API、MySQL 迁移、Nginx 与 systemd 配置。
- `docs/product/` 需求文档；`docs/guides/` 使用与部署说明。
- `tests/` 自动化测试；`outputs/` 预览或导出产物。

## 修改

- 修改页面时同步检查同目录的 `.js`、`.json`、`.wxml`、`.wxss`。
- 优先复用 `utils/` 与现有样式；不要提交密钥、真实 AppID 或用户数据。

## 验证

- 运行 `node --test tests/*.test.js`。
- 服务端变更在 `server/` 运行 `npm run check`，部署前确认数据库迁移与 `/api/v1/health`。
- 页面或配置变更还需在微信开发者工具中编译检查。
