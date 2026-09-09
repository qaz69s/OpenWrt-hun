# OpenWrt-hun

OpenWrt 25.12 (apk) 两包结构：**hun**（mihomo TUN 模式代理守护进程，预编译二进制）+ **luci-app-hun**（LuCI 管理界面）。

mihomo 是 Go 编写的 Clash Meta 内核：https://github.com/MetaCubeX/mihomo

## 模式说明

hun 运行 mihomo **TUN 模式**：由 mihomo 自己创建 `utun` 设备并管理策略路由
（`auto-route: true` + `auto-detect-interface: true`），**只代理路由器本机
流量**——LAN 客户端不受影响。需要整网透明代理时不要用此包（参考 horse/joey 等
eBPF 方案，或 mihomo + nftables hijack 架构）。

## 包结构

- `hun/` — 守护进程包，从 GitHub Releases 下载预编译 `mihomo`（musl 静态，
  资产 `mihomo-linux-<amd64|arm64>-vX.Y.Z.gz`），安装为 `/usr/bin/mihomo`，
  运行目录 `/etc/hun/`（配置 + geo 数据软链 + cache.db），带 procd init 脚本
  和 UCI 配置
- `luci-app-hun/` — LuCI 界面包（overview 单页三标签：控制 / 配置 / 日志 +
  rpcd handler），布局克隆自 OpenWrt-horse

## 编译

把两个目录放进 OpenWrt buildroot 的 `package/new/`（或 feed 内），然后：

```sh
make package/hun/compile
make package/luci-app-hun/compile
```

产物在 `bin/packages/<arch>/`，安装：

```sh
apk add hun luci-app-hun
```

依赖：`ca-bundle kmod-tun v2ray-geoip v2ray-geosite`（geoip.dat/geosite.dat
自动软链到 `/usr/share/hun/` 和运行目录 `/etc/hun/`）。

## 版本

`hun/Makefile` 中 `MIHOMO_VERSION` 默认 `latest`（每次构建查询 GitHub，
跳过 `Prerelease-Alpha` 等 prerelease 取最新正式 tag，如 v1.19.30；查询失败
回退 v1.19.30）。可命令行覆盖锁版：

```sh
make package/hun/compile MIHOMO_VERSION=v1.19.21
```

## 架构支持

| OpenWrt ARCH | mihomo 资产 | 说明 |
|---|---|---|
| x86_64 | `mihomo-linux-amd64-vX.Y.Z.gz` | |
| aarch64 | `mihomo-linux-arm64-vX.Y.Z.gz` | |

## 使用

1. 安装后 LuCI → 服务 → Hun：**启动** 即以默认配置跑 TUN（默认规则
   国内直连、其余走 `Select`，而 `Select` 默认只有 DIRECT = 纯直连兜底，
   不会误代理）
2. 在「配置」标签页编辑 `/etc/hun/config.yaml`：加 `proxies` /
   `proxy-providers`（订阅），把节点挂到 `Select` 策略组，保存自动重启生效
3. 状态页「面板」按钮打开 mihomo 仪表盘（需先配置 `external-ui` 并把
   metacubexd 解压到 `/etc/hun/ui`）

## 说明

- mihomo `-v` 输出形如 `Mihomo Meta v1.19.30 linux amd64 ...`（`--version`
  不支持）；LuCI 状态页版本号取 semver
- mihomo 无 SIGHUP 配置重载，LuCI「保存配置」走 restart（连接会瞬断，
  配置保存是低频操作可接受）
- 日志经 init 重定向到 `/var/log/hun.log`，LuCI 日志页已按 logfmt 解析
- 本机调试入口：`curl http://127.0.0.1:9090/version`（管理 API 默认只监听回环）
