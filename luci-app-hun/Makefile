# This is free software, licensed under the GNU AFFERO GENERAL PUBLIC LICENSE v3.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-hun
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI app for Hun
LUCI_DEPENDS:=+luci-base +hun
LUCI_PKGARCH:=all

PKG_LICENSE:=AGPL-3.0

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/install
	$(call Package/$(PKG_NAME)/install/Default,$(1))

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/luci.hun $(1)/usr/libexec/rpcd/luci.hun

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-hun.json $(1)/usr/share/rpcd/acl.d/luci-app-hun.json

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-hun.json $(1)/usr/share/luci/menu.d/luci-app-hun.json

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/90_hun $(1)/etc/uci-defaults/90_hun
endef

# call BuildPackage - OpenWrt buildroot signature
