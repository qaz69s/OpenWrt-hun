#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
#
# 下载 mihomo release 二进制（gzip 单文件），解压到 PKG_BUILD_DIR
#
# Usage: download-mihomo.sh <MIHOMO_ARCH> <MIHOMO_VERSION> <DL_DIR> <PKG_BUILD_DIR>
#
# MIHOMO_ARCH:   amd64 | arm64（对应 OpenWrt ARCH x86_64 / aarch64）
# MIHOMO_VERSION: release tag，如 v1.19.30（由 Makefile 解析期确定）
#
# 资产示例: https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-v1.19.30.gz

set -e

MIHOMO_ARCH="$1"
MIHOMO_VERSION="$2"
DL_DIR="$3"
PKG_BUILD_DIR="$4"

[ -n "$MIHOMO_ARCH" ] && [ -n "$MIHOMO_VERSION" ] || {
	echo "download-mihomo: 缺少参数（arch/version）" >&2
	exit 1
}

mkdir -p "${DL_DIR}" "${PKG_BUILD_DIR}"

ASSET="mihomo-linux-${MIHOMO_ARCH}-${MIHOMO_VERSION}.gz"
URL="https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${ASSET}"

# 下载（缓存命中则跳过）
if [ ! -f "${DL_DIR}/${ASSET}" ]; then
	echo "download-mihomo: 下载 ${URL}"
	curl -fsSL --retry 3 -o "${DL_DIR}/${ASSET}.tmp" "${URL}"
	mv "${DL_DIR}/${ASSET}.tmp" "${DL_DIR}/${ASSET}"
fi

# 解压（set -e 保证 curl/tar 失败时构建直接报错，不会静默产出坏包）
echo "download-mihomo: 解压 ${ASSET} -> mihomo"
gunzip -c "${DL_DIR}/${ASSET}" > "${PKG_BUILD_DIR}/mihomo"
chmod 0755 "${PKG_BUILD_DIR}/mihomo"
echo "download-mihomo: 完成"
