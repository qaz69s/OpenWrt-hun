'use strict';
'require fs';
'require rpc';
'require poll';
'require ui';
'require baseclass';

var NAME = 'hun';
var LOG  = '/var/log/hun.log';

var SVG_PAUSE     = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx=".5"/><rect x="9.5" y="2" width="3.5" height="12" rx=".5"/></svg>';
var SVG_PLAY      = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>';
var SVG_SORT_DESC = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="10" y2="8"/><line x1="2" y1="12" x2="6" y2="12"/></svg>';
var SVG_SORT_ASC  = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="6" y2="4"/><line x1="2" y1="8" x2="10" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>';
var SVG_TRASH     = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 3.5 4 14 4"/><path d="M13 4l-.867 9.5H3.867L3 4"/><path d="M6.5 7v5m3-5v5"/><path d="M5.5 4V3a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v1"/></svg>';

var LEVEL_CFG = {
	error: { tagBg: '#c0392b', rowBgDark: 'rgba(192,57,43,.09)', rowBgLight: 'rgba(192,57,43,.07)', border: '#c0392b',    textColor: '' },
	warn:  { tagBg: '#e67e22', rowBgDark: 'rgba(230,126,34,.09)', rowBgLight: 'rgba(230,126,34,.07)', border: '#e67e22',    textColor: '' },
	info:  { tagBg: '#2980b9', rowBgDark: '',                      rowBgLight: '',                      border: 'transparent', textColor: '' },
	debug: { tagBg: '#7f8c8d', rowBgDark: '',                      rowBgLight: '',                      border: 'transparent', textColor: null },
};
var LEVEL_LABEL = { error: 'E', warn: 'W', info: 'I', debug: 'D' };

var clearLogRpc = rpc.declare({ object: 'luci.' + NAME, method: 'clearLog', expect: { result: false } });

function lineLevel(raw) {
	var lm = raw.match(/\blevel="?([a-zA-Z]+)"?\b/);
	if (lm) {
		var ll = lm[1].toLowerCase();
		if (ll === 'warning') ll = 'warn';
		if (ll === 'err' || ll === 'fatal') ll = 'error';
		if (LEVEL_CFG[ll]) return ll;
	}

	// tracing_subscriber 默认 fmt 输出：时间戳 + 大写 LEVEL + target(::)
	// 例：2026-07-23T12:00:00.123456Z  INFO mihomo_core::control::connection: ...
	var tm = raw.match(/(?:^|\s)(TRACE|DEBUG|INFO|WARN|ERROR)\s+[A-Za-z0-9_]+::/);
	if (tm) {
		var tl = tm[1].toLowerCase();
		if (tl === 'trace') tl = 'debug';
		return tl;
	}

	var u = raw.toUpperCase();
	if (u.indexOf('[ERROR]') !== -1 || u.indexOf('ERROR:') !== -1) return 'error';
	if (u.indexOf('[WARN]')  !== -1 || u.indexOf('WARN:')  !== -1) return 'warn';
	if (u.indexOf('[DEBUG]') !== -1 || u.indexOf('DEBUG:') !== -1) return 'debug';
	return 'info';
}

function parseLogfmt(raw) {
	if (!raw || raw.indexOf('=') === -1) return null;
	if (raw.indexOf('msg=') === -1 && raw.indexOf('time=') === -1) return null;

	var o = {};
	var i = 0;
	var len = raw.length;

	while (i < len) {
		while (i < len && raw.charCodeAt(i) <= 32) i++;
		if (i >= len) break;

		var ks = i;
		while (i < len && raw[i] !== '=' && raw.charCodeAt(i) > 32) i++;
		if (i >= len || raw[i] !== '=') {
			while (i < len && raw.charCodeAt(i) > 32) i++;
			continue;
		}

		var key = raw.slice(ks, i);
		i++;

		var val = '';
		if (raw[i] === '"') {
			i++;
			var sb = '';
			var esc = false;
			while (i < len) {
				var ch = raw[i];
				if (esc) {
					sb += ch;
					esc = false;
					i++;
					continue;
				}
				if (ch === '\\') {
					esc = true;
					i++;
					continue;
				}
				if (ch === '"') break;
				sb += ch;
				i++;
			}
			val = sb;
			if (i < len && raw[i] === '"') i++;
		} else {
			var vs = i;
			while (i < len && raw.charCodeAt(i) > 32) i++;
			val = raw.slice(vs, i);
		}

		o[key] = val;
	}

	return o;
}

// 解析 tracing_subscriber 默认 fmt 输出（mihomo 实际格式）：
//   2026-07-23T12:00:00.123456Z  INFO mihomo_core::control::connection: 消息 outbound=proxy dialer=node1
// 提取时间戳、等级、target 之后的正文，以及尾部追加的 key=value 字段。
function parseTracing(raw) {
	var m = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\S*)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+[A-Za-z0-9_]+(?:::[A-Za-z0-9_]+)*:\s*([\s\S]*)$/);
	if (!m) return null;

	var fields = {};
	var rest = String(m[3] || '').replace(/\s+$/, '');

	// 从尾部反复提取 key=value 字段（消息本身可能含 "="，故用 $ 锚定从右往左剥）
	var kvRe = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|\S+)$/;
	var hit;
	while (rest && (hit = rest.match(kvRe))) {
		var val = hit[2];
		if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') val = val.slice(1, -1);
		fields[hit[1]] = val;
		rest = rest.slice(0, hit.index).replace(/\s+$/, '');
	}

	return {
		ts: extractHms(m[1]),
		msg: rest.trim(),
		level: m[2].toLowerCase(),
		outbound: fields.outbound || '',
		dialer: fields.dialer || '',
		fields: fields,
	};
}

function extractHms(s) {
	var m = String(s || '').match(/(\d{2}:\d{2}:\d{2})/);
	return m ? m[1] : '';
}

function shortenIPv6(ip) {
	if (!ip || ip.indexOf(':') === -1) return ip;
	if (ip.length <= 22) return ip;
	var parts = ip.split(':').filter(function (p) { return p.length; });
	if (parts.length <= 6) return ip;
	return parts.slice(0, 4).join(':') + ':…:' + parts[parts.length - 1];
}

function shortenEndpoint(ep) {
	if (!ep) return ep;
	var m = ep.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);
	if (m) {
		var ip = shortenIPv6(m[1]);
		return '[' + ip + ']' + (m[2] ? ':' + m[2] : '');
	}
	return ep;
}

function splitArrowMsg(msg) {
	var parts = String(msg || '').split(/\s*<->\s*/);
	return (parts.length === 2) ? { left: parts[0], right: parts[1] } : null;
}

function looksLikeIpEndpoint(ep) {
	return /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ep) || /^\[[0-9a-fA-F:]+\]:\d+$/.test(ep);
}

function compactLogfmt(fields) {
	var msg = fields && fields.msg ? fields.msg : '';
	if (!fields) return msg;

	if (fields._qname) {
		var qname = String(fields._qname).replace(/\.$/, '');
		var qtype = fields.qtype ? String(fields.qtype) : '';
		var server = '';
		var a = splitArrowMsg(msg);
		if (a && a.right) {
			server = a.right;
			server = server.replace(/^\[([^\]]+)\]:53$/, '[$1]');
			server = server.replace(/:53$/, '');
			server = shortenEndpoint(server);
		}

		var out = 'DNS';
		if (qtype) out += ' ' + qtype;
		if (qname) out += ' ' + qname;
		if (server) out += ' @ ' + server;
		return out;
	}

	var arrow = splitArrowMsg(msg);
	if (arrow) {
		var left = shortenEndpoint(arrow.left);
		var right = shortenEndpoint(arrow.right);

		if (fields.sniffed && looksLikeIpEndpoint(right) && msg.indexOf(fields.sniffed) === -1) {
			var pm = right.match(/^(?:\[[0-9a-fA-F:]+\]|\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
			if (pm) right = String(fields.sniffed) + ':' + pm[1];
		}

		return left + ' <-> ' + right;
	}

	return msg;
}

function parseLine(raw) {
	var m;
	var fields = parseLogfmt(raw);
	if (fields && (fields.time || fields.msg)) {
		var ts = extractHms(fields.time);
		var cm = compactLogfmt(fields);
		return {
			ts: ts,
			msg: cm || raw,
			outbound: fields.outbound || '',
			dialer: fields.dialer || '',
		};
	}

	var t = parseTracing(raw);
	if (t) {
		var cm2 = compactLogfmt(t.fields);
		return {
			ts: t.ts,
			msg: cm2 || t.msg,
			outbound: t.outbound,
			dialer: t.dialer,
		};
	}

	m = raw.match(/^time="?(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2}))/);
	if (m) return { ts: m[2], msg: raw.slice(m[0].length).replace(/^[" ]+/, '') };
	m = raw.match(/^\[?(\d{4}[\/\-]\d{2}[\/\-]\d{2})[ T](\d{2}:\d{2}:\d{2})\]?\s*/);
	if (m) return { ts: m[2], msg: raw.slice(m[0].length) };
	return { ts: '', msg: raw };
}

function escHtml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexToRgba(hex, alpha) {
	var m = String(hex || '').match(/^#?([0-9a-fA-F]{6})$/);
	if (!m) return '';
	var n = parseInt(m[1], 16);
	var r = (n >> 16) & 255;
	var g = (n >> 8) & 255;
	var b = n & 255;
	return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function isLight() {
	return window.matchMedia && window.matchMedia('(prefers-color-scheme:light)').matches;
}

return baseclass.extend({
	getRuntimeLog: function () {

		var rawLog      = '';
		var paused      = false;
		var reversed    = true;
		var activeLevel = null;
		var tabVisible  = false;
		var wasInDom    = false;
		var prevLines   = [];

		/* ── 搜索框 ── */
		var filterInput = E('input', {
			type: 'text',
			placeholder: _('搜索日志…'),
			class: 'jy-log-search',
			style: [
				'flex:1 1 200px;min-width:160px;box-sizing:border-box;',
				'padding:5px 11px;',
				'border:1px solid var(--jy-border);border-radius:5px;',
				'font-size:13px;font-weight:500;font-family:inherit;outline:none;',
				'background:var(--jy-bg2);color:var(--jy-text);',
				'-webkit-appearance:none;',
				'transition:border-color .15s,box-shadow .15s;',
			].join(''),
		});
		filterInput.addEventListener('focus', function () {
			this.style.borderColor = '#2980b9';
			this.style.boxShadow   = '0 0 0 2px rgba(41,128,185,.25)';
		});
		filterInput.addEventListener('blur', function () {
			this.style.borderColor = 'var(--jy-border)';
			this.style.boxShadow   = 'none';
		});
		filterInput.addEventListener('input', function () { renderLog(true); });

		/* ── 级别筛选按钮 ── */
		var levelBtns = {};
		function makeLevelBtn(lvl, label) {
			var c   = LEVEL_CFG[lvl];
			var btn = E('button', { style: [
				'padding:3px 11px;border-radius:20px;cursor:pointer;',
				'font-size:11px;font-weight:700;letter-spacing:.04em;',
				'border:1.5px solid ' + c.tagBg + ';',
				'color:' + c.tagBg + ';background:transparent;',
				'-webkit-tap-highlight-color:transparent;',
				'transition:background .12s,color .12s;',
			].join('') }, [label]);
			btn.addEventListener('click', function () {
				if (activeLevel === lvl) {
					activeLevel = null;
					btn.style.background = 'transparent';
					btn.style.color      = c.tagBg;
				} else {
					activeLevel = lvl;
					Object.keys(levelBtns).forEach(function (k) {
						levelBtns[k].style.background = 'transparent';
						levelBtns[k].style.color      = LEVEL_CFG[k].tagBg;
					});
					btn.style.background = c.tagBg;
					btn.style.color      = '#fff';
				}
				renderLog(true);
			});
			levelBtns[lvl] = btn;
			return btn;
		}
		var levelRow = E('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;' }, [
			makeLevelBtn('debug', 'DEBUG'),
			makeLevelBtn('info',  'INFO'),
			makeLevelBtn('warn',  'WARN'),
			makeLevelBtn('error', 'ERROR'),
		]);

		/* ── 日志容器 ── */
		var logBody = E('div', {
			class: 'jy-log-body',
			style: [
				'margin-top:10px;',
				'border:1px solid var(--jy-border);border-radius:5px;overflow:hidden;',
				'font-family:"SFMono-Regular",Consolas,monospace;font-size:12px;',
				'line-height:1.6;overflow-y:auto;-webkit-overflow-scrolling:touch;',
				'max-height:calc(100dvh - 300px);min-height:160px;',
				'background:var(--jy-bg2);',
				'scrollbar-width:thin;scrollbar-color:var(--jy-scroll-thumb) var(--jy-bg2);',
			].join(''),
		});

		var MAX_LINES = 1000;

		/* ── 构建单行 ── */
		function buildRow(line, kw) {
			var lvl    = lineLevel(line);
			var parsed = parseLine(line);
			var msg    = parsed.msg || line;
			var outbound = parsed.outbound || '';
			var dialer   = parsed.dialer || '';
			var metaText = (outbound + ' ' + dialer).toLowerCase();
			if (kw && line.toLowerCase().indexOf(kw) !== -1 && msg.toLowerCase().indexOf(kw) === -1 && metaText.indexOf(kw) === -1)
				msg = line;
			var c      = LEVEL_CFG[lvl];
			var light  = isLight();

			var msgHtml;
			if (kw && msg.toLowerCase().indexOf(kw) !== -1) {
				var re    = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
				var parts = msg.split(re);
				var kwLow = kw.toLowerCase();
				msgHtml = parts.map(function (part) {
					return part.toLowerCase() === kwLow
						? '<mark style="background:#ffec3d;color:#333;border-radius:2px;padding:0 2px;">' + escHtml(part) + '</mark>'
						: escHtml(part);
				}).join('');
			} else {
				msgHtml = escHtml(msg);
			}

			var tagEl = E('span', { style: [
				'flex-shrink:0;width:15px;height:15px;border-radius:3px;',
				'font-size:9px;font-weight:800;',
				'display:inline-flex;align-items:center;justify-content:center;',
				'background:' + c.tagBg + ';color:#fff;',
				'margin-right:7px;margin-top:2px;',
			].join('') }, [LEVEL_LABEL[lvl]]);

			var tsEl = parsed.ts ? E('span', { style: [
				'flex-shrink:0;margin-right:8px;min-width:54px;',
				'font-size:10px;font-weight:600;color:var(--jy-dim);margin-top:1px;',
				'letter-spacing:-.01em;',
			].join('') }, [parsed.ts]) : null;

			var msgColor = (lvl === 'debug')
				? (light ? 'color:rgba(80,80,80,.65);' : 'color:rgba(170,170,170,.7);')
				: 'color:var(--jy-text);';

			var chipBg = hexToRgba(c.tagBg, light ? 0.14 : 0.20) || 'rgba(128,128,128,.12)';

			function makeChip(text, title) {
				var hit = kw && String(text).toLowerCase().indexOf(kw) !== -1;
				return E('span', {
					title: title,
					style: [
						'display:inline-flex;align-items:center;',
						'height:16px;max-width:45vw;',
						'padding:0 7px;border-radius:999px;',
						'border:1px solid ' + (hit ? '#ffec3d' : c.tagBg) + ';',
						hit
							? 'background:#ffec3d;border-color:#ffec3d;color:#333;'
							: ('background:' + chipBg + ';color:' + c.tagBg + ';'),
						'font-size:10px;font-weight:800;letter-spacing:.01em;',
						'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
					].join(''),
				}, [text]);
			}

			var msgEl = E('div', { style: [
				'flex:1;min-width:0;',
				'font-size:12px;', msgColor,
			].join('') });

			if (outbound || dialer) {
				var metaRow = E('div', { style: [
					'display:flex;align-items:center;gap:4px;',
					'flex-wrap:wrap;',
					'margin:0 0 2px 0;',
				].join('') });
				if (outbound) metaRow.appendChild(makeChip(outbound, _('策略组（outbound）')));
				if (dialer)   metaRow.appendChild(makeChip(dialer,   _('节点（dialer）')));
				msgEl.appendChild(metaRow);
			}

			var msgTextEl = E('span', { style: [
				'word-break:break-all;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;',
			].join('') });
			msgTextEl.innerHTML = msgHtml;
			msgEl.appendChild(msgTextEl);

			var rowChildren = [tagEl];
			if (tsEl) rowChildren.push(tsEl);
			rowChildren.push(msgEl);

			var rowBg = light
				? (c.rowBgLight || '')
				: (c.rowBgDark  || '');

			return E('div', { style: [
				'display:flex;align-items:flex-start;',
				'padding:4px 10px;',
				'border-bottom:1px solid var(--jy-log-divider);',
				rowBg ? 'background:' + rowBg + ';' : '',
				'border-left:3px solid ' + c.border + ';',
			].join('') }, rowChildren);
		}

		function emptyEl(msg) {
			return E('div', { style: [
				'display:flex;align-items:center;justify-content:center;',
				'min-height:160px;color:var(--jy-muted);font-size:13px;',
			].join('') }, [msg]);
		}

		/* ── 渲染日志 ── */
		function renderLog(forceRedraw) {
			var allLines = rawLog ? rawLog.split('\n').filter(Boolean) : [];
			var capped   = allLines.length > MAX_LINES ? allLines.slice(-MAX_LINES) : allLines;
			var ordered  = reversed ? capped.slice().reverse() : capped;
			var kw       = filterInput.value.trim().toLowerCase();
			var hasFilter = kw || activeLevel;

			var filtered = ordered.filter(function (line) {
				var lvl = lineLevel(line);
				return (!activeLevel || activeLevel === lvl) &&
				       (!kw        || line.toLowerCase().indexOf(kw) !== -1);
			});

			if (!filtered.length) {
				logBody.innerHTML = ''; prevLines = [];
				logBody.appendChild(emptyEl(capped.length ? _('没有匹配的日志') : _('暂无日志')));
				return;
			}

			if (!forceRedraw && !hasFilter && filtered.length > prevLines.length && prevLines.length > 0) {
				var newCount  = filtered.length - prevLines.length;
				var canAppend = true;
				var checkCount = Math.min(prevLines.length, 8);
				if (reversed) {
					var tailStart = filtered.length - prevLines.length;
					for (var ci = 0; ci < checkCount && canAppend; ci++)
						if (filtered[tailStart + ci] !== prevLines[ci]) canAppend = false;
				} else {
					for (var ci2 = 0; ci2 < checkCount && canAppend; ci2++)
						if (filtered[ci2] !== prevLines[ci2]) canAppend = false;
				}
				if (canAppend) {
					var newLines = reversed ? filtered.slice(0, newCount) : filtered.slice(prevLines.length);
					var frag = document.createDocumentFragment();
					newLines.forEach(function (line) { frag.appendChild(buildRow(line, kw)); });
					if (reversed) logBody.insertBefore(frag, logBody.firstChild);
					else          logBody.appendChild(frag);
					prevLines = filtered.slice();
					return;
				}
			}

			if (!forceRedraw && filtered.length === prevLines.length && prevLines.length > 0) {
				var same = true;
				for (var i = 0; i < Math.min(filtered.length, 5) && same; i++)
					if (filtered[i] !== prevLines[i]) same = false;
				if (same) return;
			}

			prevLines = filtered.slice();
			logBody.innerHTML = '';
			var frag2 = document.createDocumentFragment();
			filtered.forEach(function (line) { frag2.appendChild(buildRow(line, kw)); });
			logBody.appendChild(frag2);
		}

		/* ── 读取日志文件 ── */
		var fetchInFlight = false;
		function fetchLog() {
			if (fetchInFlight) return;
			fetchInFlight = true;
			return fs.read_direct(LOG, 'text')
			.then(function (res) {
				fetchInFlight = false;
				// mihomo (tracing_subscriber) 写日志时 with_ansi=true，hun.log
				// 里是带颜色码的原始文本（\x1b[2m \x1b[32m \x1b[0m ...）。不剥掉的话
				// parseTracing/lineLevel 的正则全部失配，页面会显示 [2m [32m 这类
				// 控制序列残留，级别筛选也失效。这里统一剥一次 SGR 序列。
				var newLog = (res || '').trim().replace(/\x1b\[[0-9;]*m/g, '');
				if (newLog !== rawLog) { rawLog = newLog; renderLog(false); }
			})
				.catch(function (err) {
					fetchInFlight = false;
					var s = err ? err.toString() : '';
					var newLog = (s.indexOf('NotFoundError') !== -1 || s.indexOf('NoDataError') !== -1)
						? '' : _('读取错误：%s').format(err);
					if (newLog !== rawLog) { rawLog = newLog; renderLog(true); }
				});
		}

		/* ── 轮询控制 ── */
		var pollFn = function () {
			if (document.body.contains(logBody)) { wasInDom = true; }
			if (!tabVisible) {
				if (wasInDom && !paused) {
					paused = true;
				}
				fetchLog();
				return;
			}
			if (paused) { paused = false; fetchLog(); return; }
			fetchLog();
		};

		/* ── 暂停/排序/清空按钮 ── */
		var pauseBtn = E('button', { type: 'button', title: _('暂停/恢复刷新'), style: [
			'padding:5px 11px;border:1px solid var(--jy-border);border-radius:5px;',
			'cursor:pointer;background:transparent;color:var(--jy-muted);',
			'font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;',
			'-webkit-tap-highlight-color:transparent;',
			'transition:background .12s,color .12s;',
		].join('') });
		pauseBtn.innerHTML = SVG_PAUSE + ' ' + _('暂停');

		var sortBtn = E('button', { type: 'button', title: _('切换排序'), style: [
			'padding:5px 11px;border:1px solid var(--jy-border);border-radius:5px;',
			'cursor:pointer;background:transparent;color:var(--jy-muted);',
			'font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;',
			'-webkit-tap-highlight-color:transparent;',
			'transition:background .12s,color .12s;',
		].join('') });
		sortBtn.innerHTML = SVG_SORT_DESC + ' ' + _('最新');

		var clearBtn = E('button', { type: 'button', title: _('清空日志'), style: [
			'padding:5px 11px;border:1px solid var(--jy-border);border-radius:5px;',
			'cursor:pointer;background:transparent;color:var(--jy-muted);',
			'font-size:12px;font-family:inherit;display:inline-flex;align-items:center;gap:4px;',
			'-webkit-tap-highlight-color:transparent;',
			'transition:background .12s,color .12s;',
		].join('') });
		clearBtn.innerHTML = SVG_TRASH + ' ' + _('清空');

		pauseBtn.addEventListener('click', function () {
			tabVisible = true; paused = !paused;
			pauseBtn.innerHTML = paused
				? (SVG_PLAY + ' ' + _('恢复'))
				: (SVG_PAUSE + ' ' + _('暂停'));
			if (!paused) fetchLog();
		});
		sortBtn.addEventListener('click', function () {
			reversed = !reversed;
			sortBtn.innerHTML = reversed
				? (SVG_SORT_DESC + ' ' + _('最新'))
				: (SVG_SORT_ASC + ' ' + _('最旧'));
			renderLog(true);
		});
		clearBtn.addEventListener('click', function () {
			clearLogRpc().then(function (ok) {
				rawLog = ''; renderLog(true);
			});
		});

		var controls = E('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [
			pauseBtn, sortBtn, clearBtn, filterInput,
		]);

		/* ── 可见性管理 ── */
		var el = E('div', {}, [controls, levelRow, logBody]);

		el._setVisible = function (vis) {
			tabVisible = vis;
			if (vis && paused) { paused = false; pauseBtn.innerHTML = SVG_PAUSE + ' ' + _('暂停'); }
			if (vis) fetchLog();
		};

		fetchLog();
		poll.add(pollFn, 2);
		poll.start();

		return el;
	},
});
