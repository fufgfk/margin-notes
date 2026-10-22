# 发布准备检查记录

日期：2026-10-22。范围为发布材料、元数据和本地 VSIX；没有修改阅读逻辑，没有使用真实平台账号，没有上传 Marketplace。

## 已完成

- 原创 256×256 PNG 图标，已人工查看生成图像；源绘制脚本保存在 scripts/render-icon.swift。
- Preview 标记、搜索关键词、市场横幅配色，以及指向 fufgfk/margin-notes 的仓库、主页和反馈元数据。
- 重整 README；补充 PRIVACY、SUPPORT、CHANGELOG 和第三方许可及版权文本。
- 保留 patchright-core 包内 ThirdPartyNotices 和三个内联组件许可文件；附加 Patchright 和 Playwright 许可文本。
- 新增本地发布指南；没有配置长期发布凭据。
- 创建 GitHub 私有仓库，核对登录身份为 fufgfk。发布前须决定是否公开。
- TypeScript 检查和 vsce 打包通过。运行依赖 npm audit --omit=dev 未报告已知漏洞；这不覆盖全部内联代码，也不是完整安全审计。
- VSIX 检查必需文件、排除开发缓存、测试宿主、浏览器 profile、Cookie 数据库和 .env；扫描私钥、常见 GitHub/npm token 格式及本机用户名路径，未发现命中。此类模式扫描不能保证没有所有种类的敏感数据。

## 交付包

margin-notes-0.5.3-marketplace-prep.vsix 是本地候选材料包，不是新功能版本，不自动安装，也未发布。正式上传前需确定真实 publisher，并分配高于已发布版本的新版本号。

## 仍需完成

1. 账号持有人注册 Marketplace 发布者，确认实际 ID；local-margin 仍只是本地标识。
2. 决定仓库公开可见性和正式的安全反馈方式，检查公开页面、README 链接及维护者联系方式。
3. 添加合成内容或脱敏的真实使用截图。目前只准备了原创图标，没有把真实账号截图上传到仓库或包中。
4. 官网验证知乎后续评论分页、逐条展开回复及文章流程；当前仅有历史单篇回答的一级评论实测。
5. 实机验证 Windows/Linux，或在发布介绍继续明确兼容性范围。
6. 公开前检查目标网站当前规则和市场要求；不能承诺“账号不会被限制”或“保证防检测”。

本次只检查发布准备的配置和内容，没有重复运行产品完整浏览器测试；最近一次代码验证是 2026-10-10 的 63 项测试及 VS Code 宿主测试。正式发布前按 PUBLISHING.md 重新运行完整检查。
