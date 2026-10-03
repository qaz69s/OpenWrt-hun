include $(TOPDIR)/rules.mk

PKG_NAME:=hun
# mihomo 引擎版本（git tag）。kun 同款源码编译模式：默认锁 v1.19.30，
# 可命令行覆盖（需与 LDFLAGS 版本一致）：
#   make package/hun/compile MIHOMO_VERSION=v1.19.21
MIHOMO_VERSION ?= v1.19.31
PKG_VERSION := $(shell echo '$(MIHOMO_VERSION)' | sed -E 's/^v//')
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-only
PKG_MAINTAINER:=OpenWrt-hun contributors

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/MetaCubeX/mihomo.git
PKG_SOURCE_VERSION:=$(MIHOMO_VERSION)
# Note: PKG_MIRROR_HASH should be set with actual hash for security
# PKG_MIRROR_HASH:=skip is a security risk and should only be used during development
# Run: find . -name '.git' -type d -delete && tar czf - . | sha256sum
# Then update PKG_MIRROR_HASH with the real hash

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1

GO_PKG:=github.com/metacubex/mihomo
GO_PKG_LDFLAGS_X:=$(GO_PKG)/constant.Version=$(MIHOMO_VERSION)
GO_PKG_TAGS:=with_gvisor

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/hun
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=Hun - mihomo TUN mode proxy (source build)
  DEPENDS:=$(GO_ARCH_DEPENDS) +ca-bundle +kmod-tun +v2ray-geoip +v2ray-geosite
  URL:=https://github.com/MetaCubeX/mihomo
endef

define Package/hun/description
  Mihomo (Clash Meta core, Go) compiled from source via golang-package.mk
  (GO_ARCH_DEPENDS = per-arch cross compile), installed as /usr/bin/mihomo
  with a procd init script and UCI config. Runs in TUN mode with auto-route
  managed by mihomo itself (proxies the router's own traffic only).
  Install luci-app-hun for the web interface.
endef

define Package/hun/conffiles
/etc/hun/config.yaml
/etc/config/hun
endef

define Build/Prepare
	$(Build/Prepare/Default)
	$(RM) -r $(PKG_BUILD_DIR)/rules/logic_test
endef

define Package/hun/install
	$(call GoPackage/Package/Install/Bin,$(PKG_INSTALL_DIR))

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/mihomo $(1)/usr/bin/mihomo

	$(INSTALL_DIR) $(1)/etc/hun
	$(INSTALL_CONF) ./files/hun.yaml $(1)/etc/hun/config.yaml

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/hun.config $(1)/etc/config/hun

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/hun.init $(1)/etc/init.d/hun

	$(INSTALL_DIR) $(1)/usr/share/hun
	$(LN) ../v2ray/geoip.dat $(1)/usr/share/hun/geoip.dat
	$(LN) ../v2ray/geosite.dat $(1)/usr/share/hun/geosite.dat
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

$(eval $(call GoBinPackage,hun))
$(eval $(call BuildPackage,hun))
