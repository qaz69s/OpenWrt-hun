# SPDX-License-Identifier: GPL-3.0-only
#
# Copyright (C) 2026 OpenWrt-hun contributors

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/package.mk

PKG_NAME    := hun
# mihomo 引擎版本：默认每次构建都查询 GitHub 获取最新正式 release。
# 可通过命令行覆盖为固定 tag（可复现构建）：
#   make package/hun/compile MIHOMO_VERSION=v1.19.21
# 注意：mihomo 的 releases 列表第一项是 "Prerelease-Alpha"（prerelease），
# 查询时跳过 prerelease 取最新正式 tag。查询失败回退 v1.19.30。
MIHOMO_VERSION ?= latest
ifeq ($(MIHOMO_VERSION),latest)
MIHOMO_LATEST := $(shell v=$$(curl -fsSL --retry 2 --connect-timeout 5 'https://api.github.com/repos/MetaCubeX/mihomo/releases?per_page=10' 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(next((r["tag_name"] for r in d if not r.get("prerelease") and r["tag_name"].startswith("v")), ""))' 2>/dev/null); [ -n "$$v" ] && echo "$$v" || echo v1.19.30)
MIHOMO_VERSION := $(MIHOMO_LATEST)
endif
# apk 版本号要求每段以数字开头，字母段不能独立或紧跟点（0.0.1.beta.29、
# 0.0.1.beta29 都非法，实测 apk mkpkg 拒绝）。v1.19.30 -> 1.19.30。
PKG_VERSION := $(shell echo '$(MIHOMO_VERSION)' | sed -E 's/^v//; s/\.([a-zA-Z]+)\.([0-9]+)$$/_\1\2/')
PKG_RELEASE := 1

PKG_LICENSE    := GPL-3.0-only
PKG_MAINTAINER := OpenWrt-hun contributors

# ── 架构映射：OpenWrt ARCH → mihomo release 资产架构段 ──────────────
# 不支持架构在 Build/Prepare 报错（不在解析期 $(error)，ARCH 可能为空）
ifeq ($(ARCH),x86_64)
  MIHOMO_ARCH := amd64
else ifeq ($(ARCH),aarch64)
  MIHOMO_ARCH := arm64
else
  MIHOMO_ARCH :=
endif

define Package/hun
  SECTION  := net
  CATEGORY := Network
  SUBMENU  := Web Servers/Proxies
  TITLE    := Hun - mihomo TUN mode proxy
  URL      := https://github.com/MetaCubeX/mihomo
  DEPENDS  := +ca-bundle +kmod-tun +v2ray-geoip +v2ray-geosite
endef

define Package/hun/description
  Prebuilt Mihomo (Clash Meta core, Go) installed as /usr/bin/mihomo
  with a procd init script and UCI config. Runs in TUN mode with
  auto-route managed by mihomo itself (proxies the router's own
  traffic only). Install luci-app-hun for the web interface.
endef

define Package/hun/conffiles
/etc/hun/config.yaml
/etc/config/hun
endef

define Build/Prepare
	[ -n "$(MIHOMO_ARCH)" ] || { \
		echo "Hun: 不支持的架构 $(ARCH)，支持：x86_64 aarch64" >&2; \
		exit 1; \
	}
	$(CURDIR)/files/download-mihomo.sh "$(MIHOMO_ARCH)" "$(MIHOMO_VERSION)" "$(DL_DIR)" "$(PKG_BUILD_DIR)"
endef

define Build/Compile
endef

define Package/hun/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mihomo $(1)/usr/bin/mihomo

	$(INSTALL_DIR) $(1)/etc/hun
	$(INSTALL_CONF) $(CURDIR)/files/hun.yaml $(1)/etc/hun/config.yaml

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/hun.config $(1)/etc/config/hun

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/hun.init $(1)/etc/init.d/hun

	$(INSTALL_DIR) $(1)/usr/share/hun
	$(LN) ../v2ray/geoip.dat $(1)/usr/share/hun/geoip.dat
	$(LN) ../v2ray/geosite.dat $(1)/usr/share/hun/geosite.dat
endef

define Package/hun/postinst
#!/bin/sh
[ -z "$${IPKG_INSTROOT}" ] && {
	[ -x /etc/init.d/hun ] && /etc/init.d/hun enable 2>/dev/null || true
}
exit 0
endef

define Package/hun/prerm
#!/bin/sh
[ -z "$${IPKG_INSTROOT}" ] && {
	[ -x /etc/init.d/hun ] && {
		/etc/init.d/hun stop    2>/dev/null || true
		/etc/init.d/hun disable 2>/dev/null || true
	}
}
exit 0
endef

$(eval $(call BuildPackage,hun))
