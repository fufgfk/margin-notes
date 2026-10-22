# 第三方软件说明

Margin 自有代码使用根目录 LICENSE 中的 MIT 许可。下列软件保留各自的许可和版权；本说明不将第三方软件重新许可为 MIT。

## patchright-core 1.63.0

- 项目：https://github.com/Kaliiiiiiiiii-Vinyzu/patchright
- npm 包声明：Apache-2.0。
- 包内版权头、ThirdPartyNotices.txt 及 lib/*.LICENSE 均保留在分发的 node_modules/patchright-core 中。
- 附加的许可文本：[third_party/patchright-LICENSE.txt](third_party/patchright-LICENSE.txt)，取自上游 main 的 LICENSE，获取日期 2026-10-22。未修改安装的依赖代码。

## Playwright 衍生代码与内联依赖

Patchright 基于 Microsoft Playwright。随包补充 [Playwright LICENSE](third_party/playwright-LICENSE.txt) 和 [NOTICE](third_party/playwright-NOTICE.txt)，来源为 microsoft/playwright 的 v1.63.0 标签。

内联库的完整名称、版权和许可位于 patchright-core 的 lib/utilsBundle.js.LICENSE、lib/serverRegistry.js.LICENSE 和 lib/webp_codec.LICENSE 中。分发时应保留这些文件及包内 ThirdPartyNotices.txt；不能只依据 npm 顶层依赖树判断完整许可或安全状态。

Chrome、Edge、VS Code 以及平台官网内容不随本扩展重新许可。图标为本项目原创几何图形，不使用平台官方标识。
