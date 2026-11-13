# WorkBuddy Remote - WorkBuddy 本地任务独立远程客户端
Swift + AppKit + WebKit + JavaScript + marked + DOMPurify + esbuild + Web Crypto + Node.js 22+ + Python 3

<directory>
lib/ - 通道凭证、SDK 装载和远程命令验证 (0 子目录)
MacApp/ - AppKit 原生窗口、受限 UI 桥和 WebKit 自主登录 (0 子目录)
ui/ - 对照本机 WorkBuddy 的内置界面，按接口能力裁剪入口并净化消息 (1 子目录: assets)
tests/ - 协议边界与凭证保护测试 (0 子目录)
docs/ - 验证报告与协议边界 (0 子目录)
work/ - 私有取证、临时凭证与构建缓存，不进入版本控制
</directory>
<config>
README.md - 使用说明与独立客户端边界
verify.command - macOS 一键只读验证入口
build.command - 编译并本机签名独立 macOS App
package.json / package-lock.json - UI 构建与锁定的 Markdown、安全净化依赖
.gitignore - 排除私有工作数据、构建产物和缓存
</config>

MacApp 通过自己的 WebKit 会话自主登录，内置 UI 不加载远程脚本，凭证不会传入 UI；运行时只依赖 macOS。
wire.mjs 已通过真实只读列表请求；bootstrap 和 channel.mjs 仅用于实验取证。
凭证和原始会话数据保存在指定工作目录，报告只输出统计。
任何发消息测试仅针对本工具新建的隔离会话，默认仅验证读取。
