# 安全模型

## 凭据

- API 密钥只存入 Windows Credential Manager，不写入 SQLite、日志、项目目录或备份包。
- 切换模型协议或端点时清除已保存云端密钥，禁止“改地址后借用旧密钥”。

## 出站请求（SSRF）

模型与榜单请求统一走 `electron/netguard.ts`：拒绝私网/保留地址/带凭据 URL，DNS 结果含任一私网地址即拒绝，重定向手动跟随且每跳复检，禁止跳回本机或跨来源（除非显式允许并复检）。

### 出站代理（可选，默认关闭）

- 一个全局开关，作用于全部 netguard 出站（模型调用 + 番茄公开页/榜单抓取）；不读取系统代理/PAC/环境变量，不作用于 `electron-updater`。
- 代理地址校验与目的地校验分离：代理端点允许本机/私网（`parseProxyUrl`），目标 URL 仍逐跳走 `assertPublicHttpUrlSyntax`，字面量本机/私网地址在任何配置下都拒绝。
- 代理凭据只进 Windows Credential Manager（`cn.local.fanqie.novelstudio/outbound-proxy`），不写库、不写日志、不进备份；UI 明确提示“密钥会经代理转发，请只填写可信代理”。
- 走代理后目的地由代理解析，M27 的“固定已校验 IP”不再覆盖目的地。缓解：每跳请求前做一次本地预解析，解析到私网即拒绝；**本地解析失败时按代理放行**（DNS 污染/被墙正是使用代理的场景），并记 `netguard.proxy.dns_unresolved` 日志。这是已接受的残余风险。
- 不支持自定义 CA/MITM 代理（不做 CA 导入，证书校验失败即报错，不静默降级 TLS）；`socks4` 不支持，SOCKS5 在 undici 中标记为 experimental。

### 本地模型端点（逐条显式豁免）

- 仅当来源显式勾选“本地端点”时启用：只接受 `http(s)://` + **字面量**回环/RFC1918 地址，不接受域名（防 DNS rebinding）、跳过 DNS、禁止重定向、仅该来源生效。
- 目标仍必须通过 `assertLocalEndpointUrl`；本地端点不走代理 dispatcher，也不放宽任何其它来源。
- 与代理例外一样，只放宽“连接目标”，不放宽业务侧的数据边界。

## 数据与隐私

- 研究样本与创作数据物理隔离；语义拆书上云前脱敏角色/地点并单独征得同意。
- 原创度比对使用本地汉字指纹，不上传正文。

## 备份与恢复

- 加密备份：scrypt 派生 + AES-256-GCM，文件数/总字节/清单路径均有安全上限，`../` 与绝对路径条目直接拒绝。
- 自动更新前强制创建加密快照；安装始终由用户确认，恢复需人工确认，避免覆盖唯一工作区。
- `electron-updater` 直连项目固定的 GitHub Releases（`netguard` 的既定例外）：仅 GET `latest.yml` 与安装包，源地址不可配置，不上传任何创作数据；未打包运行或设置 `NOVEL_STUDIO_DISABLE_AUTO_UPDATE=1` 时不发起检查。

## 日志与诊断

- 桌面日志为 JSON Lines，写盘前脱敏密钥、Bearer、URL 凭据与用户目录。
- 诊断 ZIP 只含 system/health/application.log，不含正文或数据库。

