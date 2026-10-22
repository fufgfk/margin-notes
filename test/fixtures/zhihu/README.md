# 知乎离线测试
这些测试使用合成的 HTML/JSON，不来自用户账号，不证明当前知乎官网结构兼容。
2026-10-10 公开访问 https://www.zhihu.com/ 和 question/19550225 返回 403；https://zhuanlan.zhihu.com/ 重定向至官网安全验证页。
官网 URL 路径与静态资源域还需要在手动登录的专用浏览器中确认，联调时记录实际差异，不能把合成 fixture 当作线上结果。
