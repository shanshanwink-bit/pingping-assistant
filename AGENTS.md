# AGENTS.md

## 项目

- 本仓库包含微信原生小程序、Vue 3 管理后台和自有服务器 API；根目录的 `app.*`、项目配置与 `sitemap.json` 保持原位。
- 小程序页面只处理展示与交互，共享业务逻辑放 `utils/`。
- 管理后台前端放 `admin/`；Go 管理后台 API 放 `server-go/`；原有 Node.js 小程序 API 与兼容能力放 `server/`。
- 小程序、管理后台与服务端共享同一业务口径和 MySQL 数据，不在前端复制服务端权限或库存规则。

## 目录

- `pages/` 页面；`custom-tab-bar/` 自定义导航；`assets/` 静态资源。
- `admin/` Vue 3 管理后台；`server-go/` Go 管理后台 API。
- `server/` 原有 Node.js API、共享 MySQL 迁移及兼容层。
- `docs/product/` 需求文档；`docs/guides/` 使用与部署说明。
- `tests/` 自动化测试；`outputs/` 预览或导出产物。

## 分层

### 小程序

- `pages/` 只包含页面状态、事件绑定和渲染适配；可复用业务计算、校验、同步与鉴权放 `utils/`。
- 页面之间不得通过复制函数共享逻辑；出现第二次复用时立即提取到 `utils/`。

### Vue 管理后台

- `admin/src/App.vue` 只负责应用壳、路由入口和全局状态装配，不承载完整业务页面。
- 页面级组件放 `admin/src/views/`；布局放 `admin/src/components/layout/`；跨页面通用组件放 `admin/src/components/common/`；领域组件放对应模块目录。
- HTTP 请求统一放 `admin/src/services/`，组合式状态与交互逻辑放 `admin/src/composables/`，纯格式化与校验函数放 `admin/src/utils/`。
- 设计令牌放 `admin/src/styles/tokens.css`，布局与通用组件样式按文件拆分；页面专属样式随页面组件维护。
- 组件不得直接拼接 API 地址、解析数据库字段或实现服务端权限判断。
- 后台会话统一由 `admin/src/services/api.js` 和 `admin/src/composables/useAuth.js` 管理；页面不得自行读写或复制登录令牌逻辑。
- 登录页只负责采集账号密码和展示错误；是否允许登录、角色和权限结果均以 Go API 返回为准。
- 收到 `401` 时清理本地会话并返回登录页；退出登录必须同时调用服务端注销接口和清理浏览器令牌。
- `员工与权限` 页面修改成员后必须重新读取服务端结果，不以本地乐观状态代替服务端最终权限。

### Go 服务端

- 当前可执行入口为 `server-go/main.go`，只完成配置读取、依赖装配和服务启动；新增其他可执行程序时放 `server-go/cmd/`。
- HTTP 路由与参数转换放 `server-go/internal/httpapi/`；业务规则放 `internal/service/`；MySQL 访问放 `internal/repository/`；领域结构放 `internal/domain/`；配置放 `internal/config/`。
- Handler 不写 SQL，Repository 不处理 HTTP，Service 不依赖具体路由或响应格式。
- 跨层依赖方向固定为 `http -> service -> repository`；禁止反向引用和循环依赖。
- 数据库迁移放 `server/migrations/`，每个迁移只表达一个可回滚、可核对的变更意图。

### 后台鉴权与权限

- 管理后台使用独立账号和会话，不复用小程序微信令牌；API 前缀固定为 `/admin-api/v1`。
- 密码只保存 PBKDF2-SHA256 摘要；服务端会话只保存随机令牌的 SHA-256 摘要，不记录明文密码或明文令牌。
- 除登录和健康检查外，管理 API 默认要求 Bearer 会话；每次请求重新校验账号状态、角色和权限，使停用与权限回收立即生效。
- 权限判断只在 `server-go/internal/service/` 完成；Vue 页面可以按权限隐藏入口，但不得把前端隐藏当作安全边界。
- 店主账号不可被普通管理员降级或停用，也不得停用当前登录账号；修改角色、状态或细粒度权限必须写入服务端审计记录。
- 后台角色模板为 `owner`、`admin`、`finance`、`clerk`；新增权限项时同步更新迁移默认值、服务端白名单、前端权限文案和测试。
- 初始化管理员密码属于部署凭据，不得写入 `AGENTS.md`、README、产品文档、日志或前端源码；首次登录后应立即重置。

## 文件规模

- 优先按职责拆分，不以“先写进一个文件、以后再整理”为默认做法。
- 新增或明显扩展的 `.js`、`.ts`、`.vue`、`.go` 文件接近 300 行时应拆分；CSS 文件接近 400 行时应按令牌、布局、组件或页面拆分。
- 单个函数尽量控制在 50 行以内；同时负责取数、业务判断和渲染/响应时必须拆分。
- Vue 单文件组件应保持单一页面或单一组件职责；列表、筛选器、指标卡、弹窗和表格应拆为独立组件。
- Go 文件按领域与职责命名，避免使用持续膨胀的 `main.go`、`handlers.go`、`utils.go` 或 `common.go`。
- 修改已有大文件时，若本次新增会继续扩大其职责，先完成相关部分的最小拆分再实现功能。

## 修改

- 修改页面时同步检查同目录的 `.js`、`.json`、`.wxml`、`.wxss`。
- 优先复用 `utils/` 与现有样式；不要提交密钥、真实 AppID 或用户数据。
- 管理后台修改需同步检查对应 view、组件、service、composable 与样式文件，避免只改视觉或只改请求层。
- API 字段变化必须同步检查 Vue 管理后台、小程序兼容层、MySQL 迁移和相关测试。
- 登录、退出、员工或权限变化必须同步检查 `admin_accounts`、`admin_roles`、`admin_sessions`、审计记录和现有会话失效行为。
- 不得在前端加入演示账号、默认密码、生产令牌或绕过鉴权的 fallback；API 不可用时应显示明确错误状态。

## 验证

- 运行 `node --test tests/*.test.js`。
- 服务端变更在 `server/` 运行 `npm run check`，部署前确认数据库迁移与 `/api/v1/health`。
- 管理后台在 `admin/` 运行 `pnpm build`；Go 服务在 `server-go/` 运行 `go test ./...` 和 `go build ./...`。
- 后台鉴权变更至少验证：未登录访问返回 `401`、管理员登录、`/auth/me`、员工与角色读取、退出后原令牌再次访问返回 `401`。
- 员工权限变更至少验证：店主保护、停用账号拒绝登录、无 `system.staff.manage` 权限返回 `403`、角色默认权限与成员例外权限一致。
- 页面或配置变更还需在微信开发者工具中编译检查。

## 管理后台部署

- 线上入口为 `http://106.13.176.125/admin/`，Nginx 将 `/admin-api/` 转发至 `127.0.0.1:3001`；正式长期使用前应配置 HTTPS。
- Vue 构建产物部署到 `/var/www/admin/`；Go 二进制部署到 `/opt/pingping-admin-api/pingping-admin-api`；systemd 服务名为 `pingping-admin-api`。
- 管理 API 与 Node API 共用服务器环境文件 `/etc/pingping-assistant-api.env` 和 MySQL 数据库，但使用独立会话表。
- 数据库迁移按 `001`、`002`、`003` 及后续编号顺序执行；不得跳过迁移、重复重置生产管理员或直接修改线上表结构。
- 部署前依次完成前端构建、Go 测试和 Go 构建；上线前备份 MySQL、`/var/www/admin/`、Go 二进制和 systemd 配置。
- 切换后检查 `/admin-api/v1/health`、后台 HTML 与哈希资源、登录/员工权限/退出流程，并确认 `nginx`、`mysql`、`pingping-admin-api` 均为 `active`。
- 发布包只上传到服务器 `/tmp`，部署完成后清理临时包和解压目录；备份保留在 `/var/backups/pingping-admin-<timestamp>` 以便回滚。

## Git 发布

- 本仓库为个人项目；用户要求提交或推送时，默认直接提交并推送到 `main`，无需新建功能分支或 Pull Request，除非用户明确要求。
- Git 提交信息使用英文，保持简短并准确概括变更。
