# 参与开发

## 环境

- Node ≥ 20（只有开发、测试和打包需要；普通使用者不需要）
- Python 3（只有 `tools/` 下的本地识别服务需要，且仅支持 Apple 芯片的 macOS）

## 常用命令

```bash
npm test                                   # 51 项行为测试
npm run test:stream                        # 本地识别服务接口测试
bash tools/start-whisper.sh --check        # 检查本地识别环境
```

扩展没有构建步骤：`chrome://extensions` → 刷新卡片 → 刷新视频页即可。

## 代码结构

- `extension/background.js`：翻译调度、语音调度、缓存、快捷键
- `extension/content/engine.js`：实时配音引擎（翻译排期、对齐、原声闪避）
- `extension/shared/`：设置默认值、字幕解析、术语匹配、语音识别适配
- `tools/`：本地识别服务、构建脚本、测试

## 提交前请确认

1. `npm test` 全绿。新增行为请补测试，测试是 `node:test`，不需要额外依赖。
2. **不要提交真实 API key、连接口令、真实字幕或私人视频地址。**
3. 不要提交 `share/`、`node_modules/`、`tools/.venv/`、模型文件和截图。
4. 单条提交尽量只做一件事，提交信息说明「为什么」而不是只写「改了什么」。

## 许可证

本项目采用 MPL-2.0。你修改的项目文件在分发时需要继续以 MPL-2.0 提供对应源码，并保留许可与[第三方资料说明](THIRD_PARTY_NOTICES.md)。术语数据另有来源授权，不要为了清理而删掉提供机关和来源。

## 提 issue

请附：Chrome 版本、操作系统、出问题的网站类型、复现步骤，以及控制台的报错。不要附真实字幕和密钥。
