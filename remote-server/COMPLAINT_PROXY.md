# 客诉系统保留路由说明

## 必须保留的约定

`obs-audio-remote` 除了 OBS 音频服务，还承担公网入口 `https://obs.huaweilive.top:8088/complaint` 的反向代理。

- 公网路径：`/complaint` 和 `/complaint/*`
- 内部上游：`http://complaint-tool:8010`
- 转发时必须去掉 `/complaint` 前缀
- 环境变量：`COMPLAINT_PROXY_URL`，默认为 `http://complaint-tool:8010`
- `complaint-tool` 容器必须加入 `obs-audio-remote_default` Docker 网络

这不是 OBS 的废弃兼容代码。删除该路由会导致：

1. Windows 客诉客户端无法打开。
2. 手机二维码复制页无法访问。
3. 客户端自动更新与安装包下载返回 404。

## 更新 OBS 服务时

1. 不要用旧版 `src/server.mjs` 覆盖服务器现版。
2. 保留 `proxyComplaint()` 及 `requestListener` 中的 `/complaint` 分支。
3. 运行 `npm test`；其中 `keeps the reserved complaint route...` 用例必须通过。
4. 发布后同时验证 OBS 和客诉系统，不能只检查 `/health`。

```bash
curl -fsS https://obs.huaweilive.top:8088/health
curl -fsS https://obs.huaweilive.top:8088/complaint/api/server-info
curl -fsS https://obs.huaweilive.top:8088/complaint/updates/latest.yml
```

## 部署边界

- 只修改或重启 `obs-audio-remote` 和 `complaint-tool`。
- 不要修改、重启或重建任何 `access-*` 容器；它们是独立的门禁系统。
- 客诉数据只保存在 `complaint-tool` 的 `/data`，OBS 更新不得删除该目录或数据卷。

## 故障判断

- `/health` 正常但 `/complaint/*` 返回 `{"error":"not_found"}`：OBS 代理路由被覆盖。
- `/complaint/*` 返回 `complaint_service_unavailable`：检查 `complaint-tool` 健康状态和 Docker 网络。
- Windows 客户端报无法连接：先检查上述公网 URL，不要在客户端中绕过 HTTPS 证书验证。
