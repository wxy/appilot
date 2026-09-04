/**
 * @appilot-labs/appilot — DSH 客户端 UI 插件（构建产物）。
 * 源：client/src（TS/TSX）；构建：scripts/build-client.mjs。请勿手改本文件。
 */
window.__ModuleLoader__.load({
  id: '@appilot-labs/appilot',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/src/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// client/src/styles.ts
var CSS_ID = "@appilot-labs/appilot/client.css";
var CSS = [
  /* DSH 对话固定宽度（--dsh-chat-content-width: 748px）——面板对齐该宽度并居中。 */
  ".ap-wb{display:flex;flex-direction:column;height:100%;min-height:0;max-width:748px;margin:0 auto;padding:20px 0 0;gap:14px;font-size:14px}",
  /* 面板（Appilot 视图）内不显示对话输入框（composer 对非 chat 视图默认仍渲染）。 */
  "[data-conversation-scroll]:has(.ap-wb) [data-composer-seat]{display:none}",
  ".ap-wb-header{display:flex;flex-direction:column;gap:2px}",
  ".ap-wb-title{font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}",
  ".ap-wb-sub{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
  ".ap-wb-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
  ".ap-wb-tab{padding:7px 14px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;border-radius:8px 8px 0 0;cursor:pointer}",
  ".ap-wb-tab:hover{color:var(--dsw-alias-label-primary)}",
  ".ap-wb-tab[data-active]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font-weight:500}",
  ".ap-wb-body{flex:1;min-height:0;overflow:auto;padding-bottom:24px}",
  ".ap-empty{display:flex;flex-direction:column;gap:6px;padding:28px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary)}",
  ".ap-empty-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
  ".ap-empty-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
  ".ap-ov{display:flex;flex-direction:column;gap:14px}",
  ".ap-ov-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}",
  ".ap-ov-card-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
  ".ap-ov-row{display:flex;flex-wrap:wrap;gap:6px}",
  ".ap-ov-kv{display:flex;gap:6px;font-size:12px;line-height:18px}",
  ".ap-ov-key{color:var(--dsw-alias-label-tertiary)}",
  ".ap-ov-val{color:var(--dsw-alias-label-primary)}",
  ".ap-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}",
  ".ap-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
  ".ap-btn:disabled{opacity:.55;cursor:default}",
  ".ap-ov-toolbar-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}",
  ".ap-ov-usage{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}",
  ".ap-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}",
  ".ap-chip-pass{color:var(--dsw-alias-state-success-primary)}",
  ".ap-chip-warn{color:var(--dsw-alias-state-warning-primary)}",
  ".ap-chip-fail{color:var(--dsw-alias-state-error-primary)}",
  ".ap-tool-card{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0}",
  ".ap-tool-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
  ".ap-tool-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".ap-tool-row{display:flex;flex-wrap:wrap;gap:6px}"
].join("");

// client/src/helpers.ts
var import_jsx_runtime = require("react/jsx-runtime");
function resultOf(content) {
  const parts = [];
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === "text") parts.push(b.text);
      else if (b) parts.push(JSON.stringify(b, null, 2));
    }
  }
  const text = parts.join("\n");
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  return { text, value };
}
function chip(label, tone) {
  let cls = "ap-chip";
  if (tone === "pass") cls += " ap-chip-pass";
  else if (tone === "warn") cls += " ap-chip-warn";
  else if (tone === "fail") cls += " ap-chip-fail";
  return (0, import_jsx_runtime.jsx)("span", { className: cls, children: label });
}
function statusTone(status) {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  if (status === "warning" || status === "warn") return "warn";
  return "";
}

// client/src/toolcards.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function ProjectCard(props) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "ap-tool-card", children: res.text || "(\u8FD0\u884C\u4E2D\u2026)" });
  const repo = v.repo || {};
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-title", children: [
      "\u9879\u76EE\uFF1A",
      v.name || "(\u672A\u77E5)"
    ] }),
    v.path ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ap-tool-meta", children: v.path }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-row", children: [
      v.platform ? chip(v.platform, "") : null,
      repo.branch ? chip("\u5206\u652F " + repo.branch, "") : null,
      v.languages && v.languages.length ? chip(v.languages.join(" \xB7 "), "") : null,
      repo.dirty ? chip("\u6709\u672A\u63D0\u4EA4\u6539\u52A8", "warn") : null,
      repo.remoteUrl ? chip(repo.remoteUrl, "") : null
    ] })
  ] });
}
function ReadinessCard(props) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "ap-tool-card", children: res.text || "(\u8FD0\u884C\u4E2D\u2026)" });
  const checks = v.checks || [];
  const pass = checks.filter((c) => statusTone(c.status) === "pass").length;
  const warn = checks.filter((c) => statusTone(c.status) === "warn").length;
  const fail = checks.filter((c) => statusTone(c.status) === "fail").length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-title", children: [
      "\u53D1\u5E03\u51C6\u5907\u5EA6",
      v.versionTag ? " \xB7 " + v.versionTag : ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-row", children: [
      chip("\u901A\u8FC7 " + pass, "pass"),
      warn > 0 ? chip("\u8B66\u544A " + warn, "warn") : null,
      fail > 0 ? chip("\u5931\u8D25 " + fail, "fail") : null,
      v.supportedLanguages && v.supportedLanguages.length ? chip(v.supportedLanguages.join(", "), "") : null
    ] }),
    checks.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ap-tool-row", children: checks.slice(0, 10).map(
      (c, index) => chip((c.label || c.id || "\u68C0\u67E5\u9879") + " \xB7 " + (c.status || ""), statusTone(c.status))
    ) }) : null
  ] });
}
function ReleaseStatusCard(props) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "ap-tool-card", children: res.text || "(\u8FD0\u884C\u4E2D\u2026)" });
  const releases = v.githubReleases || [];
  const drafts = releases.filter((r) => r && r.draft).length;
  const latest = v.latestTag ? v.latestTag.name : null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-title", children: [
      "\u53D1\u5E03\u72B6\u6001",
      latest ? " \xB7 " + latest : ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-row", children: [
      chip("GitHub \u53D1\u5E03 " + releases.length, ""),
      drafts > 0 ? chip("\u8349\u7A3F " + drafts, "warn") : null
    ] }),
    v.note ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ap-tool-meta", children: v.note }) : null
  ] });
}
function OverviewCard(props) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "ap-tool-card", children: res.text || "(\u8FD0\u884C\u4E2D\u2026)" });
  const repo = v.repo || {};
  const rel = v.release || {};
  const readiness = rel.readiness || {};
  const checks = readiness.checks || [];
  const pass = checks.filter((c) => statusTone(c.status) === "pass").length;
  const warn = checks.filter((c) => statusTone(c.status) === "warn").length;
  const fail = checks.filter((c) => statusTone(c.status) === "fail").length;
  const releases = rel.githubReleases || [];
  const drafts = releases.filter((r) => r && r.draft).length;
  const act = v.activity;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-title", children: [
      "\u603B\u89C8",
      v.name ? " \xB7 " + v.name : ""
    ] }),
    v.path ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ap-tool-meta", children: v.path }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-row", children: [
      v.platform ? chip(v.platform, "") : null,
      repo.branch ? chip("\u5206\u652F " + repo.branch, "") : null,
      v.languages && v.languages.length ? chip(v.languages.length + " \u8BED\u8A00", "") : null,
      repo.dirty ? chip("\u6709\u672A\u63D0\u4EA4\u6539\u52A8", "warn") : null,
      rel.latestTag ? chip("tag " + rel.latestTag.name, "") : null,
      chip("\u53D1\u5E03 " + releases.length, ""),
      drafts > 0 ? chip("\u8349\u7A3F " + drafts, "warn") : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ap-tool-row", children: [
      chip("\u51C6\u5907\u5EA6 \u901A\u8FC7 " + pass, "pass"),
      warn > 0 ? chip("\u8B66\u544A " + warn, "warn") : null,
      fail > 0 ? chip("\u5931\u8D25 " + fail, "fail") : null,
      act ? chip("\u4ECA\u65E5\u6D41\u91CF " + (act.views ?? 0) + " \u6B21\u6D4F\u89C8", "") : null
    ] })
  ] });
}

// client/src/ai-usage.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function AiUsage(props) {
  let usage = null;
  if (props.useProjection) {
    try {
      usage = props.useProjection("tokenUsage");
    } catch {
      usage = null;
    }
  }
  if (!usage) return null;
  const input = usage.inputTokens || 0;
  const cacheRead = usage.cacheReadTokens || 0;
  const cacheWrite = usage.cacheWriteTokens || 0;
  const output = usage.outputTokens || 0;
  const total = input + cacheRead + cacheWrite + output;
  if (total === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "span",
    {
      title: `AI \u7528\u91CF\uFF08\u672C\u4F1A\u8BDD\uFF09\uFF1A\u8F93\u5165 ${input} \xB7 \u7F13\u5B58\u8BFB ${cacheRead} \xB7 \u7F13\u5B58\u5199 ${cacheWrite} \xB7 \u8F93\u51FA ${output}`,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-interactive-bg-hover)",
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 11,
        lineHeight: "18px",
        whiteSpace: "nowrap"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { "aria-hidden": true, children: "\u26A1" }),
        total.toLocaleString(),
        " tokens"
      ]
    }
  );
}

// client/src/command-card.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var import_jsx_runtime5 = require("react/jsx-runtime");
var THEME = {
  projects: { accent: "#818cf8", label: "\u9879\u76EE\u4E0E\u4EA7\u54C1" },
  rank: { accent: "#a78bfa", label: "\u6392\u540D\u91C7\u96C6\u6982\u89C8" },
  release: { accent: "#38bdf8", label: "\u53D1\u5E03\u6458\u8981" },
  task: { accent: "#34d399", label: "\u4EFB\u52A1\u4E2D\u5FC3" }
};
var FALLBACK_THEME = { accent: "#a1a1aa", label: "Appilot" };
var softOf = (accent) => `color-mix(in srgb, ${accent} 14%, transparent)`;
var TOKEN_RULES = [
  { re: /✓/g, color: "var(--dsw-alias-state-success-primary)" },
  { re: /\bok \d+\b/g, color: "var(--dsw-alias-state-success-primary)" },
  { re: /\b(err|error) \d+\b/g, color: "var(--dsw-alias-state-error-primary)" },
  { re: /\bnever \d+\b/g, color: "var(--dsw-alias-label-tertiary)" },
  { re: /\b(失败|未运行|未到期|已到期未采到|部分覆盖|有失败)\b/g, color: "var(--dsw-alias-state-error-primary)" },
  { re: /\b(已全采到|全采到|覆盖齐)\b/g, color: "var(--dsw-alias-state-success-primary)" },
  { re: /\b(未过半|过半)\b/g, color: "var(--dsw-alias-state-warn-primary)" }
];
function tint(text) {
  const parts = [];
  let rest = text;
  const find = () => {
    let best = null;
    for (const r of TOKEN_RULES) {
      const m = r.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, len: m[0].length, color: r.color, raw: m[0] };
      }
    }
    for (const r of TOKEN_RULES) r.re.lastIndex = 0;
    return best;
  };
  let guard = 0;
  while (rest.length > 0 && guard++ < 200) {
    const hit = find();
    if (!hit || hit.index > rest.length) {
      if (rest) parts.push(rest);
      break;
    }
    if (hit.index > 0) parts.push(rest.slice(0, hit.index));
    parts.push(
      (0, import_jsx_runtime4.jsx)("span", { style: { color: hit.color, fontWeight: 600 }, children: hit.raw })
    );
    rest = rest.slice(hit.index + hit.len);
  }
  if (parts.length === 0) parts.push(rest);
  return parts;
}
function TableBlock({ rows }) {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const cellStyle = {
    padding: "3px 10px 3px 0",
    fontSize: 12,
    textAlign: "left",
    whiteSpace: "nowrap"
  };
  const thStyle = {
    ...cellStyle,
    color: "var(--dsw-alias-label-tertiary)",
    fontWeight: 600,
    borderBottom: "1px solid var(--dsw-alias-border-l2)"
  };
  const tdStyle = {
    ...cellStyle,
    color: "var(--dsw-alias-label-secondary)",
    borderBottom: "1px solid var(--dsw-alias-border-l1)"
  };
  const tintCell = (v) => (0, import_jsx_runtime4.jsx)("span", { children: tint(v) });
  return (0, import_jsx_runtime4.jsx)("table", {
    style: { borderCollapse: "collapse", width: "100%" },
    children: [
      (0, import_jsx_runtime4.jsx)("thead", {
        children: (0, import_jsx_runtime4.jsx)("tr", {
          children: header.map(
            (h, i) => (0, import_jsx_runtime4.jsx)("th", { key: i, style: thStyle, children: tintCell(h) })
          )
        })
      }),
      (0, import_jsx_runtime4.jsx)("tbody", {
        children: body.map(
          (r, ri) => (0, import_jsx_runtime4.jsx)("tr", {
            key: ri,
            children: r.map(
              (v, ci) => (0, import_jsx_runtime4.jsx)("td", { key: ci, style: tdStyle, children: tintCell(v) })
            )
          })
        )
      })
    ]
  });
}
function Lines({ text }) {
  const lines = String(text || "").split("\n");
  const out = [];
  let tableRows = null;
  const flushTable = () => {
    if (tableRows && tableRows.length > 0) {
      out.push((0, import_jsx_runtime4.jsx)("div", { key: "t" + out.length, style: { overflowX: "auto" }, children: (0, import_jsx_runtime4.jsx)(TableBlock, { rows: tableRows }) }));
      tableRows = null;
    }
  };
  lines.forEach((ln, i) => {
    const line = ln.trimEnd();
    if (!line.trim()) {
      flushTable();
      return;
    }
    if (line.includes("|")) {
      tableRows = tableRows ?? [];
      tableRows.push(line.split("|").map((s) => s.trim()).filter((s, idx, arr) => !(idx === 0 && s === "") && !(idx === arr.length - 1 && s === "")));
      return;
    }
    flushTable();
    const isFirst = i === 0;
    const content = tint(line);
    out.push(
      (0, import_jsx_runtime4.jsx)("div", {
        key: i,
        style: isFirst ? { fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: 3, lineHeight: "20px" } : { paddingLeft: 2, lineHeight: "19px" },
        children: content
      })
    );
  });
  flushTable();
  return (0, import_jsx_runtime4.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: out });
}
function AppilotCommandCard(props) {
  const cmd = props?.node?.data ?? props?.node ?? null;
  const outcome = cmd?.outcome ?? null;
  const args = cmd?.args ?? "";
  const sub = String(args.trim().split(/\s+/)[0] ?? "").toLowerCase();
  const theme = THEME[sub] ?? FALLBACK_THEME;
  const running = !outcome;
  const isError = outcome?.kind === "error";
  const text = outcome?.text ?? "";
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "div",
    {
      style: {
        borderRadius: 14,
        border: "1px solid var(--dsw-alias-border-l2)",
        overflow: "hidden",
        maxWidth: 680,
        boxShadow: "var(--dsw-shadow-lv1)"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { height: 3, background: `linear-gradient(90deg, ${theme.accent}, transparent)` } }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
          "div",
          {
            style: {
              background: softOf(theme.accent),
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderBottom: "1px solid var(--dsw-alias-border-l2)"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "span",
                {
                  style: {
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: running ? "var(--dsw-alias-state-warn-primary)" : isError ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)"
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)" }, children: [
                "/appilot ",
                sub
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }, children: running ? "\u6267\u884C\u4E2D\u2026" : isError ? "\u6267\u884C\u5931\u8D25" : "\u6267\u884C\u5B8C\u6210" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }, children: theme.label })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { padding: "10px 14px 12px", background: "var(--dsw-alias-bg-layer-3)" }, children: running ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 12.5, color: "var(--dsw-alias-label-secondary)" }, children: "\u6B63\u5728\u8BFB\u53D6\u5171\u4EAB\u6570\u636E\u5E93\u2026" }) : text ? (0, import_jsx_runtime4.jsx)(Lines, { text }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 12.5, color: "var(--dsw-alias-label-tertiary)" }, children: "\uFF08\u65E0\u8F93\u51FA\uFF09" }) })
      ]
    }
  );
}

// client/src/index.tsx
if (typeof document !== "undefined" && !document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) {
  const style = document.createElement("style");
  style.dataset.plugin = "@appilot-labs/appilot";
  style.dataset.pluginCss = CSS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
var inject = ["slots", "sessions", "workspaces"];
function apply(ctx) {
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () => ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "appilot-ai-usage",
        order: 100,
        label: "AI \u7528\u91CF"
      },
      AiUsage
    )
  );
  ctx.slots.inject(
    "conversation.chat.commandview",
    () => ctx.slots.register(
      {
        name: "conversation.chat.commandview",
        key: "appilot",
        order: 0,
        label: "Appilot \u547D\u4EE4"
      },
      AppilotCommandCard
    )
  );
  const cards = [
    ["appilot_overview", OverviewCard],
    ["resolve_current_project", ProjectCard],
    ["check_release_readiness", ReadinessCard],
    ["sync_release_status", ReleaseStatusCard]
  ];
  for (const [toolName, Card] of cards) {
    ctx.slots.inject(
      "tool.call.toolview",
      () => ctx.slots.register(
        {
          name: "tool.call.toolview",
          key: toolName
        },
        Card
      )
    );
  }
}

    return module.exports;
  },
});
