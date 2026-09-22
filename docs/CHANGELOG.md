# 施工日志

## 2026-09-23 · 手机摄像头连接电脑

- 目标：同一 Wi-Fi 下手机采集视频，电脑实时显示视频与手部追踪结果。
- 关联 Spec：[手机摄像头连接电脑](specs/phone-camera.md)、[手指追踪](specs/finger-tracking.md)。
- 内容：新增二维码配对、随机会话令牌、PeerJS/WebRTC 视频直连、电脑识别、手机镜头选择、控制心跳、超时和退出清理；保留本机摄像头及演示。同步修正跨设备隐私说明。
- 文件：`index.html`、`remote-camera.js`、`vendor/`、`package.json`、`package-lock.json`、`scripts/vendor.cjs`、`tests/`、`playwright.config.cjs`、`.gitignore`、README 和两个 Spec。保留上次部署任务未提交的文档更新。
- 文档：README 沿用项目结构与 Spec 索引，更新使用步骤、依赖和测试方式；不重复建立结构或索引文件。
- 验证：10 项 Playwright 测试通过，使用真实 WebRTC + 本地信令 + 合成视频，识别采用测试替身；覆盖视频到达、镜像、错误/重复令牌、授权拒绝、异步取消、停止释放、切后台、过期、服务超时和本机回归。首次发现提前关闭拒绝通道导致对端等待，已修复并通过复验。公网检查 `npm run test:public` 使用真实公共配对服务及真实 MediaPipe，640×480 合成视频传输、无手检测和停止释放通过；电脑与 390px 手机截图已检查。JavaScript 语法、ID 唯一性、静态文件和文档相对链接检查通过。
- 限制：手机扫码/权限/路由器互通、iOS、真实手部精度及长期性能仍待验证，不宣称性能达标；尚未发布本次功能。

## 2026-09-22 · 开启 GitHub Pages 手机测试入口

- 目标：提供可在手机系统浏览器打开的 HTTPS 网站。
- 授权与配置：用户明确选择将 `LLLikoCode/finger-lab` 公开并开启 Pages；已将仓库改为公开，发布来源设为 `main` 分支 `/ (root)`，默认域名强制 HTTPS。
- 关联 Spec：[手机网页手指追踪](specs/finger-tracking.md)；页面功能和行为约定不变，无需修改 Spec。文件结构和 Spec 索引不变。
- 涉及文件：`README.md`、`docs/CHANGELOG.md`；远端仓库可见性和 Pages 设置。未修改应用代码。
- 验证：GitHub 设置页确认发布配置，公开 API 确认仓库 `private=false`；首次部署状态 `completed/success`。https://lllikocode.github.io/finger-lab/ 返回 HTTP 200 且包含正确页面标题；浏览器页面加载正常，点击“先看演示”后显示演示标识、21 个关键点及捏合/弯曲反馈。文档差异与本地相对链接检查通过。
- 部署记录：https://github.com/LLLikoCode/finger-lab/actions/runs/35691868371 。
- README 已补充已验证的在线入口、部署来源及验证范围。真实手机摄像头、识别准确度与性能仍需真机测试。本次文档更新仅保存在本地，未提交或推送；线上应用来自已有提交 `96d482b`。

## 2026-09-22 · 整理项目并提交 GitHub

- 目标：为已有“指间”网页建立独立 GitHub 仓库并提交源码。
- 关联 Spec：[手机网页手指追踪](specs/finger-tracking.md)。无外部任务编号。
- 修改内容：保留现有网页行为；新增忽略规则、功能 Spec 和施工日志，在 README 补充项目结构及 Spec 索引。功能 Spec 为既有实现的文档补记，本次未增加追踪功能。
- 涉及文件：`.gitignore`、`README.md`、`docs/specs/finger-tracking.md`、`docs/CHANGELOG.md`；`index.html` 随项目首次纳入版本管理。
- 验证：JavaScript 语法、HTML ID 唯一性、文档相对链接有效性、文件清单和常见凭证模式检查通过。仅进行静态检查，未重跑浏览器和真机验证。
- 提交/上传：本条随 GitHub 首次提交纳入版本管理；仓库地址及最终提交编号以 Git 远端和历史为准，远端推送结果另行核验。
- 已知限制：本次不部署网站，不重新进行摄像头或真机测试；手机使用仍需 HTTPS。真实设备兼容性、准确度、延迟与发热待验证。

## 历史基线 · 2026-09-18（2026-09-22 补记）

- 目标：建立手机网页手指追踪原型。
- 内容及文件：`index.html` 实现单文件界面、摄像头追踪、演示动画与错误提示；`README.md` 说明运行和依赖。
- 关联 Spec：[手机网页手指追踪](specs/finger-tracking.md) 为本次整理时补建。
- 历史验证：JavaScript 语法、HTML ID、桌面及 390px 视口、演示模式、组件与模型可达性、合成视频初始化和无手检测、视频轨道释放、模拟拒绝权限提示。依据为现有 README 和本会话执行结果，并非本次重新运行。
- 未验证：真实手部、镜头切换、iOS Safari、手机处理帧率和端到端延迟、长时间温升及手机网络。
