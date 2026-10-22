# Margin 首次发布指南

本文件面向维护者。当前仍是本地构建，尚未上传市场；保留 `local-margin.margin-notes` 标识，不改变已安装扩展的更新关系。

## 发布者 ID 是什么

发布者是在 Visual Studio Marketplace 注册的身份，与 GitHub 用户名独立。示例：发布者 ID `fufgfk` + 扩展名 `margin-notes`，完整扩展 ID 为 `fufgfk.margin-notes`。

先在 https://marketplace.visualstudio.com/manage 注册发布者，确认 ID 可用并归自己所有，再修改 package.json 的 publisher。不要仅因为 GitHub 用户名为 fufgfk 就直接填写。

变更 publisher 会改变完整扩展 ID，VS Code 会将其视为另一个扩展；现有本地版的 globalStorage 和登录 profile 不会自动迁移。首次公开版应说明这是单独安装并需重新登录，不复制浏览器凭据。卸载旧版前先按 PRIVACY.md 清理旧会话。

## 待完成事项

- [x] 已创建私有仓库 https://github.com/fufgfk/margin-notes ，身份和可见性已核对。
- [ ] 检查源码和历史，确认哪些内容适合公开。仓库初始建议设为私有。
- [x] 已配置 repository、homepage、bugs 和反馈地址；仓库公开前这些链接仅授权成员可访问。
- [ ] 注册并核对 Marketplace 发布者 ID。
- [ ] 把示意内容或脱敏截图加入 README；不能使用真实账号私信、凭据或未获授权的第三方图片。
- [ ] 验证 Windows/Linux 安装及浏览器路径；如果没有实测，继续明确标注未验证。
- [ ] 官网复核知乎评论后续分页、逐条展开回复及文章；当前实测不能替代这些流程。
- [ ] 发布前再次检查目标网站的当前规则、平台名称使用方式及市场要求；不宣传保证防检测。
- [ ] 用公开仓库原始 HTTPS URL 配置隐私政策入口，并检查市场预览页所有链接。

## 本地检查

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run test:host
npm audit --omit=dev
npm run package
```

单独检查 VSIX 的文件清单，保留 README、LICENSE、CHANGELOG、PRIVACY、SUPPORT、原创 PNG 图标和第三方许可。不能包含 .env、私钥、token、浏览器 profile、开发测试宿主或真实账号抓包。npm audit 的顶层结果不覆盖依赖中所有内联组件，也不证明不存在未知漏洞。

本次准备不更改产品功能、不升级运行依赖、不自动安装新构建。发布内容若和现有 0.5.3 不同，正式上传前分配新版本号并更新 CHANGELOG；不要覆盖已有版本号。

## GitHub 仓库与身份

GitHub 仓库创建需要已登录的 GitHub 身份。推荐在本机终端运行 `gh auth login --hostname github.com --git-protocol https --web`，由账号持有人确认授权。不要在聊天、脚本、仓库或日志中写入令牌。

授权后，先运行 `gh api user --jq .login` 确认是 fufgfk，再创建空私有仓库：

```sh
gh repo create fufgfk/margin-notes --private --description 'Experimental text reader for Xiaohongshu and Zhihu in desktop VS Code'
```

创建仓库不等于已提交或已上传代码。推送前必须检查暂存区；不得未经检查把整个现有开发历史推到公开仓库。不要通过收集浏览器 Cookie 为 CLI 获取身份。

## 上传市场（后续单独执行）

首次发布可以在 Publisher 管理页面选择 New extension → Visual Studio Code，再上传已检查的 VSIX。首次注册或接受发布协议由账号持有人完成。也可以使用官方 vsce 的认证发布流程。

截至检查日期 2026-10-22，官方文档提示 Azure DevOps global PAT 将于 2026-12-01 退役。自动化发布应按当时官方文档选用支持的身份认证方式，不把长期令牌写进仓库。

发布前核对发布者、完整扩展 ID、版本、描述、可见性和隐私政策；实际上传需用户明确决定。本准备任务不执行市场发布。

## 官方参考

- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/api/references/extension-manifest
