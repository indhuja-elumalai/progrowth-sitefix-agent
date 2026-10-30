// Run: node ui/build-index.js
// Writes ui/index.html from the parts defined here.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { suggestQuestions } from "../lib/suggest.js";
import { answerProcessQuestion } from "../lib/live-answers.js";
import { isVisual } from "../lib/screenshots.js";
import { classifyInput } from "../lib/input.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "index.html");

const CSS = `
  :root {
    --bg:#ffffff; --surface-1:#f5f5f7; --surface-2:#efeff2; --surface-3:#e5e5ea;
    --border:rgba(60,60,67,.12); --border-mid:rgba(60,60,67,.22);
    --text-1:#1d1d1f; --text-2:#515154; --text-3:#8e8e93;
    --bubble-in:#e9e9eb; --bubble-out:#1d1d1f; --bubble-out-text:#ffffff;
    --accent:#b8ff00; --accent-dark:#1d1d1f;
    --accent-dim:rgba(184,255,0,.16); --accent-border:rgba(132,184,0,.45);
    --high:#d70015; --high-bg:rgba(215,0,21,.08);
    --medium:#b25000; --medium-bg:rgba(178,80,0,.09);
    --low:#0066cc; --low-bg:rgba(0,102,204,.08);
    --success:#248a3d; --success-bg:rgba(36,138,61,.09);
    --font-sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","Segoe UI",Roboto,system-ui,sans-serif;
    --font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --radius-sm:8px; --radius:12px; --radius-lg:18px; --radius-xl:999px;
    --sidebar-w:260px; --t:160ms ease;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:var(--font-sans);background:var(--bg);color:var(--text-1);font-size:15px;line-height:1.4;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
  a{color:inherit}
  button{cursor:pointer;font-family:inherit}
  input{font-family:inherit}
  :focus-visible{outline:2px solid var(--accent-border);outline-offset:2px}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

  #app{display:flex;height:100vh;overflow:hidden}

  /* Sidebar (like the Messages conversation list) */
  #sidebar{width:var(--sidebar-w);min-width:var(--sidebar-w);background:var(--surface-1);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
  .sidebar-header{padding:18px 16px 12px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand-icon{width:32px;height:32px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .brand-icon svg{width:16px;height:16px}
  .brand-name{font-size:15px;font-weight:600;color:var(--text-1)}
  .brand-sub{font-size:12px;color:var(--text-3);display:block;line-height:1.3}
  .new-btn{margin:4px 12px 8px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-1);font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;transition:background var(--t);width:calc(100% - 24px)}
  .new-btn:hover{background:var(--surface-3)}
  .new-btn svg{width:14px;height:14px;flex-shrink:0;color:var(--text-2)}
  .sidebar-section{padding:12px 18px 4px;font-size:12px;font-weight:600;color:var(--text-3)}
  .history-list{flex:1;overflow-y:auto;padding:2px 8px 16px}
  .sidebar-section{display:flex;align-items:center;justify-content:space-between}
  .hist-clear{border:none;background:none;font-size:11.5px;font-weight:500;color:var(--text-3);padding:2px 6px;border-radius:6px}
  .hist-clear:hover{color:var(--high);background:var(--high-bg)}
  .hist-clear.confirm{color:#fff;background:var(--high)}
  .hist-day{padding:10px 10px 3px;font-size:11px;font-weight:600;color:var(--text-3)}
  .hist-empty{padding:6px 10px;font-size:12px;color:var(--text-3);line-height:1.5}
  .hist-row{position:relative;display:flex;align-items:center;border-radius:var(--radius-sm);transition:background var(--t)}
  .hist-row:hover,.hist-row:focus-within{background:var(--surface-3)}
  .hist-row.active{background:var(--surface-3)}
  .hist-row.active::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;background:var(--accent-border)}
  .history-item{padding:8px 10px;border-radius:var(--radius-sm);color:var(--text-1);font-size:13px;display:flex;align-items:center;gap:9px;cursor:pointer;border:none;background:none;flex:1;min-width:0;text-align:left;line-height:1.3}
  .history-item:disabled{cursor:default;opacity:.55}
  .h-dot{width:7px;height:7px;border-radius:50%;background:var(--success);flex-shrink:0}
  .h-dot.bad{background:var(--high)}
  .h-dot.mid{background:var(--medium)}
  .h-txt{min-width:0;flex:1}
  .h-url{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .h-meta{display:block;font-size:11.5px;color:var(--text-3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .h-del{flex-shrink:0;margin-right:6px;height:26px;min-width:26px;padding:0 6px;border:none;border-radius:var(--radius-xl);background:transparent;color:var(--text-3);display:flex;align-items:center;justify-content:center;gap:4px;font-size:11.5px;font-weight:600;opacity:0;transition:opacity var(--t),background var(--t),color var(--t)}
  .hist-row:hover .h-del,.h-del:focus-visible,.h-del.confirm{opacity:1}
  .h-del:hover{color:var(--high);background:var(--high-bg)}
  .h-del.confirm{color:#fff;background:var(--high)}
  .h-del svg{width:14px;height:14px}
  @media(hover:none){.h-del{opacity:1}}
  .icon-btn.menu-btn{display:none;left:12px;right:auto}

  /* Main + header (centered contact-style header) */
  #main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);position:relative}
  #topbar{position:relative;padding:10px 56px 9px;border-bottom:1px solid var(--border);display:flex;justify-content:center;background:rgba(255,255,255,.85);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);flex-shrink:0;z-index:2}
  .tb-center{display:flex;flex-direction:column;align-items:center;min-width:0;max-width:100%}
  .tb-av{width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:3px}
  .tb-av svg{width:14px;height:14px}
  .tb-name{font-size:12.5px;font-weight:600;color:var(--text-1);line-height:1.2}
  #tb-title{font-size:11px;color:var(--text-3);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .icon-btn{position:absolute;right:16px;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;border:none;background:transparent;display:flex;align-items:center;justify-content:center;transition:background var(--t);color:var(--text-2)}
  .icon-btn:hover{background:var(--surface-2);color:var(--text-1)}
  .icon-btn svg{width:18px;height:18px}
  #chat-area{flex:1;overflow-y:auto;padding:8px 0 24px;scroll-behavior:smooth}
  .chat-inner{max-width:720px;margin:0 auto;padding:0 20px;display:flex;flex-direction:column}

  /* Empty state */
  #empty-state{display:flex;flex-direction:column;align-items:center;text-align:center;padding:72px 24px 32px;max-width:440px;margin:0 auto}
  .empty-av{width:60px;height:60px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
  .empty-av svg{width:26px;height:26px}
  .empty-title{font-size:20px;font-weight:600;color:var(--text-1);margin-bottom:6px;letter-spacing:-.02em}
  .empty-desc{font-size:14px;color:var(--text-2);line-height:1.5;margin-bottom:20px}
  .cap-row{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
  .cap-pill{padding:5px 11px;border-radius:var(--radius-xl);background:var(--surface-1);border:1px solid var(--border);font-size:12px;color:var(--text-2)}

  /* Timestamp separator */
  .ts-sep{text-align:center;font-size:11px;color:var(--text-3);margin:18px 0 8px}
  .ts-sep b{font-weight:600}

  /* Bubbles */
  .chat-msg{display:flex;margin-top:10px}
  .chat-msg.user{justify-content:flex-end}
  .chat-msg.user + .chat-msg.user,.chat-msg.agent + .chat-msg.agent{margin-top:3px}
  .msg-bbl{position:relative;max-width:75%;padding:8px 13px;border-radius:18px;font-size:15px;line-height:1.38;word-wrap:break-word;overflow-wrap:anywhere}
  .chat-msg.agent .msg-bbl{background:var(--bubble-in);color:var(--text-1)}
  .chat-msg.user .msg-bbl{background:var(--bubble-out);color:var(--bubble-out-text)}
  .msg-bbl::before,.msg-bbl::after{content:"";position:absolute;bottom:0;height:20px}
  .chat-msg.user .msg-bbl::before{right:-7px;width:20px;background:var(--bubble-out);border-bottom-left-radius:16px 14px}
  .chat-msg.user .msg-bbl::after{right:-26px;width:26px;background:var(--bg);border-bottom-left-radius:10px}
  .chat-msg.agent .msg-bbl::before{left:-7px;width:20px;background:var(--bubble-in);border-bottom-right-radius:16px 14px}
  .chat-msg.agent .msg-bbl::after{left:-26px;width:26px;background:var(--bg);border-bottom-right-radius:10px}
  .chat-msg.user:has(+ .chat-msg.user) .msg-bbl::before,.chat-msg.user:has(+ .chat-msg.user) .msg-bbl::after,
  .chat-msg.agent:has(+ .chat-msg.agent) .msg-bbl::before,.chat-msg.agent:has(+ .chat-msg.agent) .msg-bbl::after{display:none}
  .msg-bbl code{font-family:var(--font-mono);font-size:13px}

  /* Rich cards sit in the agent column, like link previews */
  .prog-card,.rpt-card,.issue-list{margin-top:10px}
  .prog-card,.rpt-card,.issue-grp{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}

  /* Progress */
  .prog-hdr{padding:12px 16px;display:flex;align-items:center;gap:12px}
  .spin{width:16px;height:16px;border:2px solid var(--surface-3);border-top-color:var(--text-2);border-radius:50%;flex-shrink:0;animation:spin .8s linear infinite}
  .spin.done{border-color:var(--success);animation:none}
  .spin.err{border-color:var(--high);animation:none}
  @keyframes spin{to{transform:rotate(360deg)}}
  .prog-title{font-size:14px;font-weight:600;color:var(--text-1)}
  .prog-sub{font-size:12px;color:var(--text-3);margin-top:1px;overflow-wrap:anywhere}
  .prog-log{padding:10px 16px;max-height:180px;overflow-y:auto;font-family:var(--font-mono);font-size:11px;color:var(--text-3);line-height:1.65;background:var(--surface-1);border-top:1px solid var(--border)}
  .log-line{white-space:pre-wrap;word-break:break-all}
  .log-line.hl{color:var(--text-1);font-weight:600}
  .log-line.ok{color:var(--text-2)}
  .log-line.warn{color:var(--medium)}
  .log-line.err2{color:var(--high)}
  .det-list{padding:10px 16px 12px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border)}
  .det-pill{display:flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:var(--radius-xl);background:var(--surface-1);font-size:12px;color:var(--text-3);transition:background var(--t),color var(--t)}
  .det-pill .pdot{width:6px;height:6px;border-radius:50%;background:var(--border-mid);transition:background var(--t)}
  .det-pill.running{color:var(--text-2)}
  .det-pill.running .pdot{background:var(--medium);animation:pulse 1s infinite}
  .det-pill.done{background:var(--accent-dim);color:var(--text-1)}
  .det-pill.done .pdot{background:var(--success)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

  /* Live inspection card */
  .prog-card.live .prog-hdr{padding:14px 16px 10px}
  .p-txt{flex:1;min-width:0}
  .p-time{font-size:12.5px;color:var(--text-3);font-variant-numeric:tabular-nums;flex-shrink:0}
  .p-stop{flex-shrink:0;margin-left:10px;border:1px solid var(--border);background:var(--bg);color:var(--text-2);border-radius:999px;font:inherit;font-size:12.5px;font-weight:600;padding:4px 12px;cursor:pointer}
  .p-stop:hover{color:var(--high);border-color:var(--high)}
  .p-stop[disabled]{opacity:.5;cursor:default}
  .p-stopnote{padding:0 16px 10px;font-size:13px;color:var(--text-2)}
  .prog-card.done .p-stop,.prog-card.done .p-stopnote{display:none}
  .pbar{height:6px;margin:0 16px;border-radius:6px;background:var(--surface-2);overflow:hidden}
  .pfill{height:100%;width:2%;border-radius:6px;background:var(--accent);transition:width .4s ease}
  .prog-card.err .pfill{background:var(--high)}
  .p-nums{display:flex;justify-content:space-between;gap:10px;padding:6px 16px 10px;font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums}
  .p-eta{color:var(--text-3)}
  .steps{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px}
  .steps li{display:flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:var(--radius-xl);background:var(--surface-1);font-size:12px;color:var(--text-3)}
  .steps .sdot{width:7px;height:7px;border-radius:50%;background:var(--border-mid)}
  .steps li.active{color:var(--text-1);background:var(--surface-2)}
  .steps li.active .sdot{background:var(--medium);animation:pulse 1s infinite}
  .steps li.done{color:var(--text-1);background:var(--accent-dim)}
  .steps li.done .sdot{background:var(--success)}
  .steps li.failed .sdot{background:var(--high)}
  .steps .sval{color:var(--text-3);font-variant-numeric:tabular-nums}
  .live-issues{border-top:1px solid var(--border);padding:10px 16px 12px}
  .li-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;color:var(--text-3);margin-bottom:6px}
  .li-head b{font-weight:600;color:var(--text-2);margin-right:2px}
  .sev-n{font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:var(--radius-xl);font-variant-numeric:tabular-nums}
  .sev-n.high{background:var(--high-bg);color:var(--high)}.sev-n.medium{background:var(--medium-bg);color:var(--medium)}.sev-n.low{background:var(--low-bg);color:var(--low)}
  .li-note{margin-left:auto;font-size:11px}
  .feed{list-style:none;display:flex;flex-direction:column;gap:2px}
  .feed li{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:3px 0;animation:feedin .35s ease}
  .feed .fd{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .feed .fd.high{background:var(--high)}.feed .fd.medium{background:var(--medium)}.feed .fd.low{background:var(--low)}
  .feed .fl{color:var(--text-1);flex-shrink:0}
  .feed .fu{font-family:var(--font-mono);font-size:11.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .feed-empty{font-size:12px;color:var(--text-3)}
  @keyframes feedin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .log-toggle{display:block;width:100%;text-align:left;border:none;border-top:1px solid var(--border);background:transparent;color:var(--text-3);font-size:12px;padding:8px 16px}
  .log-toggle:hover{color:var(--text-1);background:var(--surface-1)}
  .prog-card.live .prog-log{border-top:none}
  .live-row .history-item{font-weight:500}
  .h-spin{width:9px;height:9px;border:2px solid var(--surface-3);border-top-color:var(--medium);border-radius:50%;flex-shrink:0;animation:spin .8s linear infinite}
  .h-spin.done{border-color:var(--success);animation:none}
  .h-spin.err{border-color:var(--high);animation:none}

  /* Suggested questions */
  .suggest{margin-top:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .sg-note{font-size:12.5px;color:var(--text-3)}
  .sg-chips{display:flex;flex-wrap:wrap;gap:6px}
  .sq{border:1px solid var(--accent-border);background:var(--accent-dim);color:var(--text-1);border-radius:var(--radius-xl);font-size:13px;padding:5px 12px;cursor:pointer;transition:background var(--t),transform var(--t)}
  .sq:hover{background:rgba(184,255,0,.32);transform:translateY(-1px)}
  .queued{color:var(--text-2)}
  .queued::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--medium);margin-right:7px;vertical-align:1px;animation:pulse 1s infinite}
  .queued.answered::before{background:var(--success);animation:none}
  .queued.missed::before{background:var(--high);animation:none}

  .sq.later::after{content:" · after the report";color:var(--text-3);font-size:11.5px}
  /* Report link card (like a link preview in Messages) */
  .rcard{display:block;width:min(440px,100%);margin-top:10px;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--border);background:var(--bg);text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(0,0,0,.05);transition:transform var(--t),box-shadow var(--t)}
  .rcard:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.08)}
  .rc-top{display:flex;gap:12px;padding:16px 16px 14px;background:linear-gradient(135deg,var(--surface-1),var(--bg));min-height:150px}
  .rc-txt{flex:1;min-width:0;display:flex;flex-direction:column}
  .rc-made{font-size:11px;color:var(--text-3)}
  .rc-title{font-family:Georgia,"Times New Roman",serif;font-size:24px;line-height:1.15;letter-spacing:-.01em;margin-top:8px;overflow-wrap:anywhere}
  .rc-brand{margin-top:auto;padding-top:12px;font-family:Georgia,"Times New Roman",serif;font-size:19px}
  .rc-shot{width:150px;flex-shrink:0;border-radius:8px;border:1px solid var(--border);background:var(--bg) center top/cover no-repeat}
  .rc-bot{padding:9px 14px;background:var(--surface-2);border-top:1px solid var(--border)}
  .rc-bot b{display:block;font-size:13.5px;font-weight:600}
  .rc-bot span{font-size:12px;color:var(--text-3)}
  .ans ol{margin:6px 0 0 20px}.ans ol li{margin:4px 0}
  .pt-box{margin-top:6px}
  .crisp-list{margin:0 0 0 20px;padding:0}
  .crisp-list li{margin:1px 0}
  .crisp-list li{overflow-wrap:anywhere}
  .crisp-list .dim{color:var(--text-3)}
  .pt-box .ev-more{margin-top:6px}
  .more-card{display:flex;align-items:center;gap:12px;width:min(540px,100%);margin-top:8px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-1);color:inherit;text-decoration:none;transition:background var(--t)}
  .more-card:hover{background:var(--surface-2)}
  .mc-ico{width:30px;height:30px;border-radius:8px;background:var(--bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2)}
  .mc-ico svg{width:15px;height:15px}
  .mc-txt{flex:1;min-width:0;display:flex;flex-direction:column}
  .mc-txt b{font-size:14px;font-weight:600}
  .mc-txt span{font-size:12px;color:var(--text-3)}
  .mc-go{font-size:22px;color:var(--text-3);line-height:1}
  .rc-links{display:flex;gap:14px;margin:6px 4px 0;font-size:12.5px}
  .rc-links a{color:var(--text-2);text-decoration:none;display:inline-flex;align-items:center;gap:5px}
  .rc-links a:hover{color:var(--text-1);text-decoration:underline}
  .rc-links svg{width:13px;height:13px}
  .rc-links a[aria-disabled="true"]{opacity:.45;pointer-events:none}
  /* A finished inspection folds into one line; "Show details" opens it again */
  .prog-card.live.done .pbar,.prog-card.live.done .p-nums,.prog-card.live.done .steps,.prog-card.live.done .live-issues,.prog-card.live.done .log-toggle,.prog-card.live.done .prog-log{display:none}
  .prog-card.live.done.open .pbar,.prog-card.live.done.open .p-nums,.prog-card.live.done.open .live-issues,.prog-card.live.done.open .log-toggle{display:block}
  .prog-card.live.done.open .steps{display:flex}
  .prog-card.live.done.open .prog-log:not([hidden]){display:block}
  .prog-card.live.done .prog-hdr{padding:10px 16px;cursor:pointer}
  .p-more{border:none;background:none;color:var(--text-3);font-size:12px;padding:0;display:none;cursor:pointer}
  .p-more:hover{color:var(--text-1);text-decoration:underline}
  .prog-card.live.done .p-more{display:inline}

  /* Evidence */
  .iss-ev{display:none;padding:4px 16px 14px 36px;background:var(--surface-1);border-bottom:1px solid var(--border)}
  .iss-item.open + .iss-ev{display:block}
  .iss-ev:last-child{border-bottom:none}
  .ev-title{font-size:11.5px;font-weight:600;color:var(--text-3);margin-bottom:6px}
  .ev-pre{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;font-family:var(--font-mono);font-size:11.5px;color:var(--text-2);overflow-x:auto;white-space:pre-wrap;word-break:break-all;line-height:1.6}
  .ev-row{display:flex;gap:12px;margin-bottom:5px;font-size:13px}
  .ev-k{color:var(--text-3);min-width:96px;flex-shrink:0}
  .ev-v{color:var(--text-1);flex:1;overflow-wrap:anywhere}
  .ev-chain{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .chain-u{font-family:var(--font-mono);font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:1px 7px;color:var(--text-2)}
  .chain-a{color:var(--text-3);font-size:12px}
  .ev-img{display:block;max-width:160px;max-height:96px;border-radius:8px;border:1px solid var(--border);background:var(--bg);margin-bottom:10px;object-fit:contain}
  .ev-outline{font-size:12.5px;line-height:1.7}
  .ev-outline b{color:var(--text-3);font-weight:600;font-size:11px;margin-right:4px}
  .found-on{margin-top:10px}
  .fo-title{font-size:11.5px;font-weight:600;color:var(--text-3);margin-bottom:3px}
  .fo-url{font-family:var(--font-mono);font-size:11.5px;color:var(--text-2);line-height:1.8}
  .chip{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:1px 8px;border-radius:var(--radius-xl);background:var(--surface-2);color:var(--text-2);margin:6px 6px 0 0}
  .chip.P1{background:var(--high-bg);color:var(--high)}.chip.P2{background:var(--medium-bg);color:var(--medium)}.chip.P3{background:var(--low-bg);color:var(--low)}
  .chip.qw{background:var(--accent-dim);color:var(--text-1)}
  .rpt-pri{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border)}
  .rpt-pri .lbl{font-size:12px;color:var(--text-3);margin-right:2px}
  .rpt-actions{display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px 12px;border-top:1px solid var(--border)}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--radius-xl);border:1px solid var(--border-mid);background:var(--bg);color:var(--text-1);font-size:12.5px;font-weight:500;text-decoration:none;cursor:pointer}
  .btn:hover{background:var(--surface-1)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-dark)}
  .btn svg{width:14px;height:14px}
  .btn[aria-disabled="true"]{opacity:.45;pointer-events:none}
  .ai-box{margin:4px 0 12px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--border)}
  .ai-k{font-size:11.5px;font-weight:600;color:var(--text-3);margin:8px 0 3px}
  .ai-k:first-child{margin-top:0}
  .ai-v{font-size:13.5px;color:var(--text-1);line-height:1.5}
  .ai-steps{margin:2px 0 0 18px;font-size:13px;line-height:1.55}
  .ai-src{font-size:11px;color:var(--text-3);margin-top:8px}
  .val-box{display:flex;gap:8px;align-items:flex-start;background:var(--accent-dim);border-radius:8px;padding:7px 10px;margin-top:3px}
  .val-box .v{flex:1;font-size:13px;font-weight:500;overflow-wrap:anywhere}
  .copy{border:none;background:var(--bg);border-radius:6px;font-size:11px;padding:2px 8px;cursor:pointer;color:var(--text-2)}
  .ev-shot{display:block;max-width:360px;width:100%;border-radius:8px;border:1px solid var(--border);margin-top:4px}
  .ev-img{display:block;max-width:240px;max-height:180px;border-radius:8px;border:1px solid var(--border);margin-top:4px;object-fit:contain}
  .ans ul{margin:4px 0 0 18px}.ans li{margin:2px 0}
  /* Evidence cards: the issues an answer is about, each with a screenshot of the page */
  .ev-list{display:flex;flex-direction:column;gap:8px;width:min(540px,100%);margin-top:8px}
  .ev{padding:10px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg);box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .ev-head{display:flex;gap:12px}
  .ev-more-info{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:13.5px;line-height:1.45;color:var(--text-1)}
  .ev-more-info h4{font-size:12px;font-weight:600;color:var(--text-3);margin:10px 0 3px}
  .ev-more-info h4:first-child{margin-top:0}
  .ev-more-info p{margin:0}
  .ev-more-info ol,.ev-more-info ul{margin:0 0 0 20px;padding:0}
  .ev-more-info li{margin:2px 0;overflow-wrap:anywhere}
  .ev-more-info q{font-style:normal;background:var(--high-bg);border-radius:4px;padding:0 3px}
  .ev-pages{color:var(--text-2)}
  .ev-big{display:block;width:100%;border-radius:8px;border:1px solid var(--border);cursor:zoom-in}
  .ev-cap{font-size:11.5px;color:var(--text-3);margin:4px 0 2px}
  .ev-sugg{display:flex;align-items:flex-start;gap:8px;background:var(--surface-1);border-radius:8px;padding:6px 8px}
  .ev-sugg span{flex:1;overflow-wrap:anywhere}
  .ev-facts{margin-top:10px;font-size:12px;color:var(--text-3)}
  .sp-t{border-collapse:collapse;width:100%;font-size:13px}
  .sp-t th,.sp-t td{text-align:left;padding:3px 8px 3px 0;vertical-align:top;font-weight:400}
  .sp-t th{color:var(--text-2)}
  .sp-t td:nth-child(2){font-variant-numeric:tabular-nums;white-space:nowrap}
  .sp-good{color:var(--success)}.sp-needs-improvement{color:var(--medium)}.sp-poor{color:var(--high)}
  .ev-more-info .dim{color:var(--text-3)}
  .ev-shot{position:relative;flex-shrink:0;width:150px;height:94px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--surface-2);padding:0;cursor:zoom-in}
  .ev-shot img{width:100%;height:100%;object-fit:cover;object-position:center;display:block;opacity:0;transform:scale(1.5);transition:opacity .25s}
  .ev-shot.ok img{opacity:1}
  .ev-shot:not(.ok)::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-100%);animation:shimmer 1.3s infinite}
  .ev-shot.none{display:none}
  @keyframes shimmer{to{transform:translateX(100%)}}
  .ev-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .ev-kind{font-size:11.5px;color:var(--text-3);display:flex;align-items:center;gap:6px}
  .ev-kind i{width:7px;height:7px;border-radius:50%;background:var(--text-3);flex-shrink:0}
  .ev-kind i.P1{background:var(--high)}.ev-kind i.P2{background:var(--medium)}
  .ev-what{font-size:14px;font-weight:600;overflow-wrap:anywhere;line-height:1.3}
  .ev-where,.ev-detail{font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere;line-height:1.35}
  .ev-detail q{font-style:normal;background:var(--high-bg);border-radius:4px;padding:0 3px}
  .ev-open{margin-top:auto;padding-top:4px;align-self:flex-start;border:none;background:none;padding-left:0;font-size:12.5px;font-weight:500;color:var(--text-1);cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--border-mid)}
  .ev-open:hover{text-decoration-color:currentColor}
  .ev-more{align-self:flex-start;border:1px solid var(--border-mid);background:var(--bg);border-radius:var(--radius-xl);font-size:13px;padding:5px 14px;color:var(--text-1);cursor:pointer}
  .ev-more:hover{background:var(--surface-1)}
  #shot-view{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:10px;cursor:zoom-out}
  #shot-view img{max-width:min(1100px,100%);max-height:calc(100% - 40px);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  #shot-view span{color:#fff;font-size:13px;opacity:.85;text-align:center}
  .typing{display:inline-flex;gap:4px}.typing i{width:6px;height:6px;border-radius:50%;background:var(--text-3);animation:pulse 1s infinite}
  .typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
  .fix-row{border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-top:6px;background:var(--bg);font-size:13px}
  .fix-from{color:var(--high);text-decoration:line-through;text-decoration-color:rgba(215,0,21,.35);overflow-wrap:anywhere}
  .fix-to{color:var(--success);font-weight:500;margin-top:2px;overflow-wrap:anywhere}
  .fix-why{color:var(--text-3);font-size:12px;margin-top:3px}
  .iss-item.flash{box-shadow:inset 3px 0 0 var(--accent)}
  .ai-ph{margin-top:10px;padding:8px 12px;border:1px dashed var(--border-mid);border-radius:var(--radius-sm);font-size:12px;color:var(--text-3);display:flex;align-items:center;gap:8px}
  .ai-ph svg{width:13px;height:13px;flex-shrink:0;opacity:.6}

  /* Input bar (pill field with a round send button inside) */
  #input-area{flex-shrink:0;padding:10px 20px 14px;border-top:1px solid var(--border);background:rgba(255,255,255,.85);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px)}
  .inp-wrap{position:relative;max-width:720px;margin:0 auto}
  #url-input{width:100%;min-width:0;height:38px;background:var(--bg);border:1px solid var(--border-mid);border-radius:19px;color:var(--text-1);font-size:15px;padding:0 46px 0 15px;transition:border-color var(--t),box-shadow var(--t);outline:none}
  #url-input::placeholder{color:var(--text-3)}
  #url-input:focus{border-color:rgba(60,60,67,.35);box-shadow:0 0 0 3px var(--accent-dim)}
  #url-input.invalid{border-color:var(--high);box-shadow:0 0 0 3px var(--high-bg)}
  #inspect-btn{position:absolute;right:4px;top:4px;width:30px;height:30px;border-radius:50%;border:none;background:var(--accent);color:var(--accent-dark);display:flex;align-items:center;justify-content:center;transition:background var(--t),transform var(--t)}
  #inspect-btn:hover:not(:disabled){transform:scale(1.06)}
  #inspect-btn:disabled{background:var(--surface-3);color:#fff;cursor:default}
  #inspect-btn svg{width:16px;height:16px}
  .inp-hint{max-width:720px;margin:7px auto 0;font-size:11.5px;color:var(--text-3);display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;text-align:center}
  #inp-err{color:var(--high);display:none}
  .url-chip{display:inline-flex;align-items:center;padding:2px 9px;border-radius:var(--radius-xl);background:var(--surface-1);border:1px solid var(--border);font-size:11.5px;color:var(--text-2);cursor:pointer;transition:background var(--t)}
  .url-chip:hover{background:var(--accent-dim);color:var(--text-1)}

  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:10px;border:2px solid transparent;background-clip:content-box}

  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  @media(max-width:720px){
    #sidebar{display:none}
    body.show-side #sidebar{display:flex;position:fixed;inset:0 auto 0 0;z-index:10;box-shadow:0 0 0 100vmax rgba(0,0,0,.25)}
    .icon-btn.menu-btn{display:flex}
    .rpt-counts{grid-template-columns:repeat(2,1fr)}
    .cnt-cell:nth-child(2){border-right:none}
    .cnt-cell:nth-child(-n+2){border-bottom:1px solid var(--border)}
    .chat-inner{padding:0 14px}
    .ev-shot{width:96px;height:64px}
    #input-area{padding:8px 12px 12px}
    .msg-bbl{max-width:85%}
    #empty-state{padding-top:48px}
  }

  /* Sign in: a name and a website link (no password for now) */
  #signin{position:fixed;inset:0;z-index:20;background:var(--surface-1);display:flex;align-items:center;justify-content:center;padding:24px 16px;overflow-y:auto}
  #signin[hidden]{display:none}
  .si-card{width:min(400px,100%);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px 24px 22px;box-shadow:0 10px 40px rgba(0,0,0,.06);display:flex;flex-direction:column}
  .si-card .empty-av{margin:0 auto 14px}
  .si-title{font-size:21px;font-weight:600;text-align:center;letter-spacing:-.02em}
  .si-desc{font-size:14px;color:var(--text-2);text-align:center;line-height:1.5;margin:6px 0 18px}
  .si-l{font-size:12.5px;font-weight:600;color:var(--text-2);margin:10px 0 5px}
  .si-card input{height:40px;border:1px solid var(--border-mid);border-radius:10px;padding:0 12px;font-size:15px;background:var(--bg);color:var(--text-1);outline:none}
  .si-card input:focus{border-color:rgba(60,60,67,.35);box-shadow:0 0 0 3px var(--accent-dim)}
  .si-card input[aria-invalid="true"]{border-color:var(--high);box-shadow:0 0 0 3px var(--high-bg)}
  .si-err{min-height:18px;font-size:12.5px;color:var(--high);margin-top:8px}
  .si-go,.go-btn{height:42px;border:none;border-radius:var(--radius-xl);background:var(--accent);color:var(--accent-dark);font-size:15px;font-weight:600;padding:0 22px;transition:transform var(--t),background var(--t)}
  .si-go{margin-top:6px}
  .si-go:hover:not(:disabled),.go-btn:hover:not(:disabled){transform:translateY(-1px)}
  .si-go:disabled,.go-btn:disabled{background:var(--surface-3);color:var(--text-3);cursor:default;transform:none}
  .si-note{font-size:12px;color:var(--text-3);text-align:center;margin-top:12px;line-height:1.45}

  /* Topbar: the site (a switcher) and its score */
  .tb-site{display:flex;align-items:center;gap:7px;border:none;background:none;padding:3px 8px 3px 4px;border-radius:var(--radius-xl);color:var(--text-1);font-size:13.5px;font-weight:600;max-width:100%;min-width:0}
  .tb-site:hover,.tb-site[aria-expanded="true"]{background:var(--surface-2)}
  .tb-site .tb-av{margin:0;width:24px;height:24px;flex-shrink:0}
  .tb-site .tb-av svg{width:12px;height:12px}
  #site-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tb-chev{width:12px;height:12px;flex-shrink:0;color:var(--text-3)}
  #tb-title{margin-top:3px;min-height:20px;display:flex;align-items:center}
  .tb-pill{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-2);text-decoration:none;padding:1px 9px 1px 3px;border-radius:var(--radius-xl);background:var(--surface-1);border:1px solid var(--border);white-space:nowrap}
  .tb-pill:hover{border-color:var(--border-mid);color:var(--text-1)}
  .tb-pill b{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:18px;padding:0 5px;border-radius:9px;font-size:11.5px;color:#fff;font-variant-numeric:tabular-nums}
  .tb-pill.b1 b{background:var(--high)}.tb-pill.b2 b{background:var(--medium)}.tb-pill.b3 b{background:var(--success)}.tb-pill.b4 b{background:#1f7a3a}
  .tb-to{color:var(--success);font-weight:600}
  .tb-none{font-size:11.5px;color:var(--text-3)}
  .site-menu{position:absolute;top:calc(100% - 4px);left:50%;transform:translateX(-50%);width:min(320px,calc(100vw - 32px));background:var(--bg);border:1px solid var(--border-mid);border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.12);padding:6px;z-index:5;text-align:left}
  .site-menu[hidden]{display:none}
  .sm-head{font-size:11.5px;font-weight:600;color:var(--text-3);padding:6px 10px 4px}
  .sm-row{display:flex;align-items:center;border-radius:9px}
  .sm-row:hover{background:var(--surface-1)}
  .sm-site{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border:none;background:none;padding:8px 10px;font-size:13.5px;color:var(--text-1);text-align:left}
  .sm-site span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sm-site i{width:14px;flex-shrink:0;font-style:normal;color:var(--success);font-weight:700}
  .sm-del{border:none;background:none;color:var(--text-3);font-size:12px;padding:4px 8px;margin-right:4px;border-radius:7px}
  .sm-del:hover{color:var(--high);background:var(--high-bg)}
  .sm-del.confirm{color:#fff;background:var(--high)}
  .sm-add{display:flex;gap:6px;padding:8px 6px 4px;border-top:1px solid var(--border);margin-top:4px}
  .sm-add input{flex:1;min-width:0;height:34px;border:1px solid var(--border-mid);border-radius:9px;padding:0 10px;font-size:13.5px;background:var(--bg);color:var(--text-1);outline:none}
  .sm-add input:focus{box-shadow:0 0 0 3px var(--accent-dim)}
  .sm-add button{border:none;border-radius:9px;background:var(--accent);color:var(--accent-dark);font-weight:600;font-size:13px;padding:0 12px}
  .sm-err{font-size:12px;color:var(--high);padding:0 10px 4px}
  .sm-err:empty{display:none}
  .sm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 4px;border-top:1px solid var(--border);margin-top:4px;font-size:12px;color:var(--text-3)}
  .sm-foot b{color:var(--text-2);font-weight:600}
  .sm-out{border:none;background:none;color:var(--text-2);font-size:12px;text-decoration:underline;padding:2px}

  /* Empty state: one button to inspect the site */
  .go-btn{margin:2px 0 12px}
  .empty-last{font-size:13px;color:var(--text-2);margin-bottom:20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
  .empty-last:empty{display:none}
  .link-btn{border:none;background:none;color:var(--text-1);font-size:13px;text-decoration:underline;padding:0}

  /* A running inspection stays compact; "Show details" opens the steps, the feed and the log */
  .prog-card.live:not(.done):not(.more) .steps,.prog-card.live:not(.done):not(.more) .feed,.prog-card.live:not(.done):not(.more) .feed-empty,.prog-card.live:not(.done):not(.more) .li-note,.prog-card.live:not(.done):not(.more) .log-toggle,.prog-card.live:not(.done):not(.more) .prog-log{display:none}
  .prog-card.live:not(.done):not(.more) .li-head{margin-bottom:0}
  .prog-card.live:not(.done) .p-more{display:inline}
  .p-more{margin-left:6px}
  .prog-title .dim{font-weight:400;color:var(--text-3);font-size:12.5px}

  /* The result: one card with the score, the areas, what to fix first and the report */
  .sum-card{width:min(480px,100%);margin-top:10px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg);box-shadow:0 1px 2px rgba(0,0,0,.05);overflow:hidden}
  .sc-top{display:flex;gap:16px;align-items:center;padding:16px 16px 12px}
  .sc-num{width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-1);background:conic-gradient(var(--sc-c,var(--surface-3)) calc(var(--sc,0)*1%),var(--surface-2) 0);position:relative}
  .sc-num::before{content:"";position:absolute;inset:6px;border-radius:50%;background:var(--bg)}
  .sc-num span{position:relative}
  .sum-card.b1{--sc-c:var(--high)}.sum-card.b2{--sc-c:var(--medium)}.sum-card.b3{--sc-c:var(--success)}.sum-card.b4{--sc-c:#1f7a3a}
  .sc-head{min-width:0;flex:1}
  .sc-band{font-size:16px;font-weight:600}
  .sc-meta{font-size:12.5px;color:var(--text-3);margin-top:2px}
  .sc-sev{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
  .sc-areas{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 16px 12px}
  .sc-area{font-size:12px;color:var(--text-2)}
  .sc-area b{float:right;color:var(--text-1);font-variant-numeric:tabular-nums}
  .sc-bar{height:5px;border-radius:5px;background:var(--surface-2);margin-top:5px;overflow:hidden}
  .sc-bar i{display:block;height:100%;border-radius:5px;background:var(--sc-c,var(--accent))}
  .sc-first{border-top:1px solid var(--border);padding:12px 16px 4px}
  .sc-first h4{font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px}
  .sc-first ol{list-style:none;counter-reset:f;display:flex;flex-direction:column;gap:8px}
  .sc-first li{counter-increment:f;display:flex;gap:10px;font-size:13.5px;line-height:1.35}
  .sc-first li::before{content:counter(f);width:20px;height:20px;border-radius:50%;background:var(--surface-2);font-size:11.5px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .sc-first .t{flex:1;min-width:0}
  .sc-first .t span{display:block;font-size:12.5px;color:var(--text-2);margin-top:1px}
  .sc-first .g{flex-shrink:0;font-size:12.5px;font-weight:600;color:var(--success);font-variant-numeric:tabular-nums}
  .sc-goal{font-size:12.5px;color:var(--text-2);padding:8px 16px 0}
  .sc-note{font-size:12.5px;color:var(--text-2);padding:8px 16px 0;line-height:1.45}
  .sum-card{padding-bottom:14px}
  @media(max-width:720px){.sc-areas{gap:8px}.tb-pill{font-size:11.5px}}
  @media(prefers-color-scheme:dark){.sc-num::before{background:var(--bg)}}
`;

// String.raw keeps backslash escapes in the inline script (\', \n, \d, \b) intact.
const HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SiteFix — Website Audit Agent</title>
  <meta name="description" content="SiteFix inspects every page of a website, finds what is broken or missing, and explains what to fix first and how." />
  <style>${CSS}</style>
</head>
<body>
<div id="signin" hidden>
  <form class="si-card" id="si-form" novalidate>
    <div class="empty-av" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg></div>
    <h1 class="si-title">Welcome to SiteFix</h1>
    <p class="si-desc">Tell me your name and the website to look after. I&rsquo;ll check it page by page and show you what to fix first.</p>
    <label class="si-l" for="si-name">Your name</label>
    <input id="si-name" autocomplete="name" maxlength="60" required>
    <label class="si-l" for="si-site">Your website</label>
    <input id="si-site" placeholder="example.com" autocomplete="url" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="url" required>
    <div class="si-err" id="si-err" role="alert"></div>
    <button type="submit" class="si-go" id="si-go">Continue</button>
    <p class="si-note">No password for now. You&rsquo;ll see this website&rsquo;s inspections only, and you can add more sites later.</p>
  </form>
</div>
<div id="app">
  <aside id="sidebar">
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-icon">
          <svg viewBox="0 0 20 20" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8.5" cy="8.5" r="5"/>
            <path d="M13 13l3.5 3.5"/>
            <path d="M8.5 6v1m0 3v1m2-2.5h-4"/>
          </svg>
        </div>
        <div>
          <span class="brand-name">SiteFix</span>
          <span class="brand-sub">Website Audit Agent</span>
        </div>
      </div>
    </div>
    <button class="new-btn" id="new-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
      New inspection
    </button>
    <div class="sidebar-section"><span id="hist-label">Inspections</span> <button class="hist-clear" id="hist-clear" type="button" hidden>Delete all</button></div>
    <div class="history-list" id="hist" aria-label="Inspection history">
      <div class="hist-empty">Loading&hellip;</div>
    </div>
  </aside>

  <main id="main">
    <div id="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" title="Past inspections" aria-label="Past inspections">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 6h13M3.5 10h13M3.5 14h13"/></svg>
      </button>
      <div class="tb-center">
        <button type="button" class="tb-site" id="site-btn" aria-haspopup="true" aria-expanded="false" aria-controls="site-menu" title="Your sites">
          <span class="tb-av" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg></span>
          <span id="site-name">SiteFix</span>
          <svg class="tb-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5L6 7.5 9 4.5"/></svg>
        </button>
        <div id="tb-title"></div>
      </div>
      <div class="site-menu" id="site-menu" hidden></div>
      <button class="icon-btn" id="clear-btn" title="Home" aria-label="Home">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.2L10 3.8l6.5 5.4"/><path d="M5.2 8v7.7a.8.8 0 00.8.8h2.8v-4.3h2.4v4.3H14a.8.8 0 00.8-.8V8"/></svg>
      </button>
    </div>

    <div id="chat-area" role="log" aria-live="polite" aria-label="Inspection conversation">
      <div class="chat-inner" id="chat-inner">
        <div id="empty-state">
          <div class="empty-av" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg></div>
          <h1 class="empty-title" id="empty-title">SiteFix</h1>
          <p class="empty-desc" id="empty-desc">I&rsquo;ll check every page, then show you what to fix first, why it matters and how to fix it.</p>
          <button type="button" class="go-btn" id="inspect-site">Inspect</button>
          <div class="empty-last" id="empty-last"></div>
          <div class="cap-row" aria-label="What gets checked">
            <span class="cap-pill">Broken links &amp; HTTP</span>
            <span class="cap-pill">Redirects</span>
            <span class="cap-pill">SEO tags &amp; indexing</span>
            <span class="cap-pill">Social sharing</span>
            <span class="cap-pill">Thin &amp; duplicate content</span>
            <span class="cap-pill">Spelling &amp; grammar</span>
            <span class="cap-pill">Soft 404s</span>
            <span class="cap-pill">Images &amp; alt text</span>
          </div>
        </div>
      </div>
    </div>

    <div id="input-area">
      <div class="inp-wrap">
        <input type="text" id="url-input" placeholder="Ask me anything"
          autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="send"
          aria-label="Ask SiteFix a question" aria-describedby="inp-hint" autofocus/>
        <button id="inspect-btn" aria-label="Send" title="Send">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>
          <span class="sr-only">Send</span>
        </button>
      </div>
      <div class="inp-hint" id="inp-hint">
        <span id="inp-err" role="alert"></span>
        <span id="inp-ok">Ask about your site&rsquo;s inspection, your score, or what to fix first.</span>
      </div>
    </div>
  </main>
</div>

<script>
"use strict";
const S=(s,c=document)=>c.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e;};
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
let running=false,history_=[],lastTs=0,current=null; // current = {id, byId, report, base} for the inspection on screen
const OPEN_KEY='sitefix.openInspection';
const store={get(){try{return localStorage.getItem(OPEN_KEY);}catch{return null;}},set(v){try{v?localStorage.setItem(OPEN_KEY,v):localStorage.removeItem(OPEN_KEY);}catch{}}};
const urlIn=S('#url-input'),inspBtn=S('#inspect-btn'),chatIn=S('#chat-inner'),
      chatA=S('#chat-area'),empty=S('#empty-state'),hist=S('#hist'),
      tbTitle=S('#tb-title'),inpErr=S('#inp-err'),inpOk=S('#inp-ok');
let me=null,siteScore_=null; // me = the workspace { name, sites, activeSite }; siteScore_ = the active site's score (GET /api/score)


function validateUrl(r){
  const s=r.trim();
  if(!s)return{ok:false,msg:'Please enter a URL.'};
  const local=/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(s);
  let u;try{u=new URL(/^https?:\/\//i.test(s)?s:(local?'http://':'https://')+s);}catch{return{ok:false,msg:'Not a valid URL.'};}
  if(!['http:','https:'].includes(u.protocol))return{ok:false,msg:'Only http:// or https:// supported.'};
  return{ok:true,url:u.href};
}
urlIn.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
urlIn.addEventListener('input',()=>{urlIn.classList.remove('invalid');inpErr.style.display='none';inpOk.style.display='';syncBtn();});
function syncBtn(){inspBtn.disabled=!urlIn.value.trim();if(typeof syncHistButtons==='function'&&hist)syncHistButtons();}
syncBtn();
inspBtn.addEventListener('click',()=>submit());
// One box for everything (lib/input.js, copied in when this page is built): a website
// starts an inspection; several websites, an almost-address or an address that isn't a
// website get a short reply with buttons; anything else is a question about the report.
${classifyInput.toString()}
function submit(){
  const v=urlIn.value.trim();if(!v)return;
  const c=classifyInput(v);
  if(c.kind==='question'){ask(v);return;}
  if(c.kind==='url'){routeSite(c.url,v);return;}
  urlIn.value='';syncBtn();
  if(empty.parentNode===chatIn)empty.style.display='none';
  addMsg('user',esc(v));
  if(c.kind==='not-web'){addMsg('agent','That looks like '+esc(c.what)+'. I check websites, like <b>'+esc(siteHost())+'</b>.');return;}
  if(c.kind==='urls'){
    const own=c.urls.filter(u=>onSite(u));
    if(own.length){choiceRow('I&rsquo;ll stick to <b>'+esc(siteHost())+'</b>, the site of this workspace. Check it now?',[{label:'Inspect '+siteHost(),run:()=>inspectSite()}]);return;}
    choiceRow('This workspace is for <b>'+esc(siteHost())+'</b>. Which one should I add as a site?',c.urls.slice(0,4).map(u=>({label:'Add '+keyOf(u),run:()=>addSiteAndInspect(u)})));
    return;
  }
  if(c.kind==='near-url')choiceRow('Did you mean <b>'+esc(hostOf(c.suggestion))+'</b>?',[{label:'Yes',run:()=>routeSite(c.suggestion,null,true)},{label:'No, it was a question',run:()=>ask(v)}]);
}
// A website typed in the box: this workspace's site starts an inspection; another of its
// sites can be switched to; any other site has to be added first.
function routeSite(url,typed,echoed){
  if(onSite(url)){
    urlIn.value='';syncBtn();
    if(running){inpErr.textContent='An inspection is already running.';inpErr.style.display='inline';inpOk.style.display='none';return;}
    inspectSite();return;
  }
  urlIn.value='';syncBtn();
  if(empty.parentNode===chatIn)empty.style.display='none';
  if(!echoed)addMsg('user',esc(typed||url));
  const have=me.sites.find(x=>sameSiteC(x,url)),cur=siteHost(),k=keyOf(url);
  if(have){choiceRow('<b>'+esc(k)+'</b> is another site in your workspace. Switch to it?',[{label:'Switch and inspect',run:async()=>{if(await switchSite(have))inspectSite();}},{label:'Just switch',run:()=>switchSite(have)}]);return;}
  choiceRow('This workspace is for <b>'+esc(cur)+'</b>, so I only check its pages. Add <b>'+esc(k)+'</b> as a site to check it.',[{label:'Add '+k+' and inspect',run:()=>addSiteAndInspect(url)}]);
}
async function addSiteAndInspect(url){if(await addSite(url)&&!running)inspectSite();}
function inspectSite(){if(!me||running)return;start(me.activeSite);}
// A short reply with buttons; the buttons go away once one is picked.
function choiceRow(html,choices){
  const bbl=addMsg('agent',html);
  const row=el('div','suggest scope-pick');
  row.innerHTML='<div class="sg-chips">'+choices.map((x,i)=>'<button type="button" class="sq" data-i="'+i+'">'+esc(x.label)+'</button>').join('')+'</div>';
  bbl.closest('.chat-msg').after(row);
  row.querySelectorAll('.sq').forEach(b=>b.addEventListener('click',()=>{row.remove();choices[Number(b.dataset.i)].run();}));
  scroll();
}
S('#clear-btn').addEventListener('click',()=>clear());
// The sidebar button inspects the site (or shows the inspection already running).
S('#new-btn').addEventListener('click',()=>{closeSide();if(live&&!live.done&&onSite(live.url)){showLive();return;}clear();inspectSite();});
S('#menu-btn').addEventListener('click',()=>document.body.classList.toggle('show-side'));
function closeSide(){document.body.classList.remove('show-side');}
document.addEventListener('click',e=>{if(document.body.classList.contains('show-side')&&!e.target.closest('#sidebar,#menu-btn'))closeSide();});

function clear(){current=null;store.set(null);markActive();urlIn.placeholder=idlePlaceholder();chatIn.innerHTML='';chatIn.appendChild(empty);empty.style.display='';renderEmpty();lastTs=0;urlIn.value='';urlIn.classList.remove('invalid');inpErr.style.display='none';inpOk.style.display='';viewingLive=false;if(typeof renderLiveRow==='function')renderLiveRow();syncBtn();}

function addMsg(role,html,ts){
  if(empty.parentNode===chatIn)empty.style.display='none';
  const now=ts?new Date(ts):new Date();
  if(!lastTs||Math.abs(now-lastTs)>5*60*1000){const sep=el('div','ts-sep');sep.innerHTML='<b>'+esc(dayLabel(now))+'</b> '+esc(fmtTime(now));chatIn.appendChild(sep);}
  lastTs=now;
  const w=el('div','chat-msg '+role),bbl=el('div','msg-bbl');
  bbl.innerHTML=html;w.appendChild(bbl);
  chatIn.appendChild(w);scroll();return bbl;
}
function dayStart(d){const x=new Date(d);x.setHours(0,0,0,0);return x.getTime();}
function dayLabel(d){const diff=Math.round((dayStart(new Date())-dayStart(d))/864e5);if(diff===0)return 'Today';if(diff===1)return 'Yesterday';return new Date(d).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short',year:new Date(d).getFullYear()===new Date().getFullYear()?undefined:'numeric'});}
function fmtTime(d){return(d instanceof Date?d:new Date(d)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
function scroll(){requestAnimationFrame(()=>{chatA.scrollTop=chatA.scrollHeight;});}

// ---------- suggested questions ----------
// The same function as lib/suggest.js (copied in when this page is built).
${suggestQuestions.toString()}
function suggestRow(qs,note,onPick,cls){
  if(!qs.length)return null;
  const w=el('div','suggest '+(cls||''));
  w.innerHTML=(note?'<div class="sg-note">'+note+'</div>':'')+'<div class="sg-chips">'+qs.map(q=>'<button type="button" class="sq">'+esc(q)+'</button>').join('')+'</div>';
  w.querySelectorAll('.sq').forEach(b=>b.addEventListener('click',()=>onPick(b.textContent,b,w)));
  return w;
}
function keepLast(node){if(node&&node.isConnected){chatIn.appendChild(node);scroll();}}
// Questions about the inspection itself are answered at once, from the live numbers
// (the same function as lib/live-answers.js, copied in when this page is built).
${answerProcessQuestion.toString()}
function liveCtx(){
  const p=(live&&live.progress)||{};
  return {running:true,site:live.url,phase:p.phase||'crawl',pages:p.pages,checks:p.checks,issues:p.issues,elapsedMs:Date.now()-live.startedAt,etaMs:p.etaMs,avgLoadMs:p.avgLoadMs,slowDowns:p.slowDowns,findings:live.findings,label:issueLabel};
}
function doneCtx(){
  const l=(current&&current.report&&current.report.summaries&&current.report.summaries.links)||{},run=(current&&current.run)||{};
  return {running:false,site:run.startUrl,pages:{done:run.pagesCrawled||l.pagesCrawled||0},seconds:l.seconds,avgLoadMs:l.pageTiming&&l.pageTiming.averageLoadMs,partial:run.partial||null,label:issueLabel};
}
// A message in the running inspection's conversation: kept with the run, so it is
// still there after opening a past inspection and coming back.
function liveSay(role,html){
  const w=el('div','chat-msg '+role),bbl=el('div','msg-bbl');
  bbl.innerHTML=html;w.appendChild(bbl);
  live.thread.push(w);
  if(viewingLive){if(empty.parentNode===chatIn)empty.style.display='none';chatIn.appendChild(w);keepLast(live.sgEl);scroll();}
  return bbl;
}
// While an inspection runs: questions about the inspection are answered now; questions
// about the results are answered as soon as the report is ready.
function liveChips(){
  const asked=new Set(live.asked.map(x=>x.toLowerCase()));
  const elapsed=Date.now()-live.startedAt,p=live.progress||{};
  const now=['How does the crawl work?',live.findings.length?'What have you found so far?':'What are you checking?','How long is left?',elapsed>20000?'Why is it taking this long?':'Will this change my site?'].filter(q=>!asked.has(q.toLowerCase()));
  const later=suggestQuestions(live.types,live.asked,1);
  return {now:now.slice(0,2),later};
}
function refreshLiveSuggest(){
  if(!live||live.done||!viewingLive)return;
  const c=liveChips(),sig=c.now.concat(c.later).join('|');
  if(live.sgEl&&live.sgEl.isConnected&&live.sgSig===sig)return;
  live.sgSig=sig;
  const row=suggestRow(c.now.concat(c.later),'',q=>liveAsk(q),'live-sg');
  if(row)row.querySelectorAll('.sq').forEach((b,i)=>{if(i>=c.now.length){b.classList.add('later');b.title='Answered when the report is ready';}});
  if(live.sgEl&&live.sgEl.isConnected){if(row)live.sgEl.replaceWith(row);else live.sgEl.remove();}
  else if(row)chatIn.appendChild(row);
  live.sgEl=row;
}
function liveAsk(q){
  live.asked.push(q);
  liveSay('user',esc(q));
  const instant=answerProcessQuestion(q,liveCtx());
  if(instant)liveSay('agent',answerHtml({answer:instant.answer}));
  else{const b=liveSay('agent','<span class="queued">Good question. I&rsquo;ll answer it as soon as the report is ready.</span>');live.queue.push({q,bubble:b});}
  live.sgSig=null;refreshLiveSuggest();keepLast(live.sgEl);
}
// After a finished inspection: suggestions based on what it found.
function showResultSuggest(asked){
  if(!current||!current.sgTypes||!current.sgTypes.length)return;
  if(current.sgEl)current.sgEl.remove();
  current.asked=(current.asked||[]).concat(asked||[]);
  const cur=current;
  const row=suggestRow(suggestQuestions(cur.sgTypes,cur.asked,4),'Ask me about this report:',(q,b,w)=>{b.remove();if(!w.querySelector('.sq'))w.remove();ask(q).then(()=>keepLast(w));},'after');
  if(row)chatIn.appendChild(row);
  cur.sgEl=row;
}
// Answer the questions asked while the inspection ran, in order, saved with it.
async function answerQueue(run,show){
  if(!run.queue||!run.queue.length)return;
  if(run.sgEl)run.sgEl.remove();
  const id=run.savedId||null;
  if(show){
    for(const it of run.queue){it.bubble.innerHTML='<span class="queued answered">Answered below &darr;</span>';}
    addMsg('agent','You asked '+run.queue.length+' question'+(run.queue.length===1?'':'s')+' while I worked. Here '+(run.queue.length===1?'is the answer':'are the answers')+':');
  }
  for(const it of run.queue){
    let bbl=null;
    if(show){addMsg('user',esc(it.q));bbl=addMsg('agent','<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>');}
    try{
      const r=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(id?{question:it.q,inspectionId:id}:{question:it.q})});
      const d=await r.json();
      if(bbl)showAnswer(bbl,d);
    }catch{if(bbl)bbl.innerHTML='<span style="color:var(--high)">I couldn&rsquo;t get an answer just now. Please ask again.</span>';}
    if(show)scroll();
  }
  if(show&&current){current.asked=(current.asked||[]).concat(run.queue.map(x=>x.q));showResultSuggest([]);}
}

// ---------- live inspection ----------
// The crawler and report send structured progress (lib/progress.js) over the stream:
// pages done and found, checks done, the current step, issues found so far and time
// left. The card shows it; the raw log is one click away. An inspection keeps running
// while past inspections are opened, and a reloaded page picks it up again.
const STEPS=[{id:'crawl',lbl:'Pages'},{id:'checks',lbl:'Links & images'},{id:'seo',lbl:'SEO & content'},{id:'spelling',lbl:'Spelling'},{id:'speed',lbl:'Page speed'},{id:'report',lbl:'Explanations & screenshots'},{id:'pdf',lbl:'Reports'}];
const PHASE_STEP={crawl:0,links:1,images:1,seo:2,content:2,spelling:3,speed:4,crawled:5,report:5,pdf:6,'report-done':7};
const BASE_TITLE=document.title;
let live=null,viewingLive=false;
function hostOf(u){try{return new URL(u).host;}catch{return u;}}
function fmtDur(ms){const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function fmtEta(ms){if(ms==null)return '';const s=Math.round(ms/1000);if(s<5)return 'almost done';if(s<60)return 'about '+s+' s left';return 'about '+Math.round(s/60)+' min left';}
function pctOf(p){
  const ph=p.phase,pg=p.pages||{},tot=Math.max(pg.found||0,pg.sitemap||0,pg.done||0,1),capT=pg.cap?Math.min(tot,pg.cap):tot,frac=(o)=>o&&o.total?Math.min(1,o.done/o.total):1;
  if(ph==='crawl')return 2+66*Math.min(1,(pg.done||0)/capT);
  if(ph==='links'||ph==='images')return 68+6*frac(p.checks);
  if(ph==='seo'||ph==='content')return 75;
  if(ph==='spelling')return 76+3*frac(p.step);
  if(ph==='speed')return 79+6*frac(p.step);
  if(ph==='crawled')return 85;
  if(ph==='report')return 85+12*frac(p.step);
  if(ph==='pdf')return 97;
  if(ph==='report-done')return 100;
  return 2;
}
function subOf(p){
  const st=p.step||{};
  switch(p.phase){
    case 'crawl':return 'Crawling pages'+(p.current?' &middot; <span style="font-family:var(--font-mono);font-size:11px">'+esc(shortPath(p.current))+'</span>':'');
    case 'links':case 'images':return 'Finishing link and image checks';
    case 'seo':return 'Reading titles, tags and headings';
    case 'content':return 'Checking page content';
    case 'spelling':return 'Checking spelling and grammar'+(st.total?' ('+st.done+'/'+st.total+' pages)':'');
    case 'speed':return 'Finishing the phone speed test'+(st.total?' ('+st.done+'/'+st.total+' pages)':'');
    case 'crawled':return 'Crawl finished &middot; preparing the report';
    case 'report':{const e=p.explain||{},sh=p.shots||{};return 'Writing explanations'+(e.total?' ('+e.done+'/'+e.total+')':'')+' and taking screenshots'+(sh.total?' ('+sh.done+'/'+sh.total+')':'');}
    case 'pdf':return 'Building the PDF and web report';
    case 'report-done':return 'Report ready';
    default:return 'Starting&hellip;';
  }
}
function buildLiveCard(url){
  const c=el('div','prog-card live');
  c.innerHTML='<div class="prog-hdr"><div class="spin ps"></div><div class="p-txt"><div class="prog-title">Inspecting '+esc(hostOf(url))+'</div><div class="prog-sub"><span class="p-sub">Starting&hellip;</span> <button type="button" class="p-more">Show details</button></div></div><div class="p-time" title="Time so far">0:00</div><button type="button" class="p-stop" title="Stop the inspection">Stop</button></div><div class="p-stopnote" role="status" hidden></div>'+
    '<div class="pbar" role="progressbar" aria-label="Inspection progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="2"><div class="pfill"></div></div>'+
    '<div class="p-nums"><span class="p-count">Looking for pages&hellip;</span><span class="p-eta"></span></div>'+
    '<ol class="steps">'+STEPS.map((x,i)=>'<li data-step="'+i+'"><span class="sdot"></span>'+esc(x.lbl)+'<span class="sval"></span></li>').join('')+'</ol>'+
    '<div class="live-issues"><div class="li-head"><b>Found so far</b><span class="sev-n high">0 high</span><span class="sev-n medium">0 medium</span><span class="sev-n low">0 low</span><span class="li-note">live preview, final list at the end</span></div>'+
    '<ul class="feed" aria-live="off"></ul><div class="feed-empty">Nothing yet. Problems appear here the moment they are found.</div></div>'+
    '<button class="log-toggle" type="button" aria-expanded="false">Show the log</button><div class="prog-log" role="log" hidden></div>';
  const more=S('.p-more',c);
  S('.prog-hdr',c).addEventListener('click',()=>{if(!c.classList.contains('done'))return;const o=c.classList.toggle('open');more.textContent=o?'Hide details':'Show details';});
  // While it runs, the card stays small: progress and the count of problems. Details opens the steps, the feed and the log.
  more.addEventListener('click',e=>{if(c.classList.contains('done'))return;e.stopPropagation();const o=c.classList.toggle('more');more.textContent=o?'Hide details':'Show details';});
  const tog=S('.log-toggle',c),log=S('.prog-log',c);
  tog.addEventListener('click',()=>{const open=log.hidden;log.hidden=!open;tog.textContent=open?'Hide the log':'Show the log';tog.setAttribute('aria-expanded',String(open));if(open)log.scrollTop=log.scrollHeight;});
  return c;
}
function logLine(c,line){
  const log=S('.prog-log',c),d=el('div','log-line');
  if(/^\s*(crawling|checking|following)\b/i.test(line))d.classList.add('ok');
  else if(/summary|done\.|issue registry|===/i.test(line))d.classList.add('hl');
  else if(/warning|error/i.test(line))d.classList.add('err2');
  else if(/broken|404|loop|chain/i.test(line))d.classList.add('warn');
  d.textContent=line;log.appendChild(d);
  while(log.childElementCount>600)log.firstChild.remove();
  if(!log.hidden)log.scrollTop=log.scrollHeight;
}
function updateLive(p){
  if(!live)return;
  live.progress=p;
  const c=live.card,pct=Math.round(pctOf(p)),pg=p.pages||{},iss=p.issues||{};
  S('.pfill',c).style.width=pct+'%';S('.pbar',c).setAttribute('aria-valuenow',String(pct));
  S('.p-sub',c).innerHTML=subOf(p);
  const tot=Math.max(pg.found||0,pg.sitemap||0,pg.done||0);
  let count;
  if(p.phase==='crawl'){
    if(pg.cap)count=(pg.done||0)+' of '+Math.min(tot,pg.cap)+' pages (page limit '+pg.cap+')';
    else count=(pg.done||0)+' of '+(pg.found>pg.done?'at least ':'')+tot+' pages';
  }else count=(pg.done||0)+' page'+(pg.done===1?'':'s')+' crawled';
  if(p.checks&&p.checks.total)count+=' &middot; '+p.checks.done+'/'+p.checks.total+' links and images checked';
  S('.p-count',c).innerHTML=count;
  S('.p-eta',c).textContent=p.phase==='crawl'?fmtEta(p.etaMs):'';
  const cur=PHASE_STEP[p.phase]??0;
  S('.steps',c).querySelectorAll('li').forEach((li,i)=>{
    li.className=i<cur?'done':i===cur?'active':'';
    let v='';
    if(i===0&&(pg.done||cur===0))v=cur===0?(pg.done||0)+'/'+(pg.cap?Math.min(tot,pg.cap):tot):String(pg.done||0);
    if(i===1&&p.checks&&p.checks.total)v=p.checks.done+'/'+p.checks.total;
    if(i===3&&p.phase==='spelling'&&p.step&&p.step.total)v=p.step.done+'/'+p.step.total;
    if(i===4&&p.speed&&p.speed.total)v=(p.phase==='speed'&&p.step&&p.step.total?p.step.done+'/'+p.step.total:p.speed.done+'/'+p.speed.total);
    if(i===5&&p.explain&&p.explain.total)v=p.explain.done+'/'+p.explain.total+' &middot; '+((p.shots&&p.shots.done)||0)+'/'+((p.shots&&p.shots.total)||0);
    S('.sval',li).innerHTML=v?' '+v:'';
  });
  S('.sev-n.high',c).textContent=(iss.high||0)+' high';S('.sev-n.medium',c).textContent=(iss.medium||0)+' medium';S('.sev-n.low',c).textContent=(iss.low||0)+' low';
  if(p.final&&p.phase==='crawled')S('.li-note',c).textContent='final count';
  if(!document.hidden||!live.done)document.title='('+pct+'%) Inspecting '+hostOf(live.url)+' — SiteFix';
  // The card says it all; the conversation stays quiet. A site that moved shows in the title.
  if(p.movedTo&&!live.said.moved){live.said.moved=1;S('.prog-title',c).innerHTML='Inspecting '+esc(hostOf(p.movedTo.to))+' <span class="dim">(moved from '+esc(hostOf(p.movedTo.from))+')</span>';}
  if(p.phase!==live.lastPhase){live.lastPhase=p.phase;live.sgSig=null;refreshLiveSuggest();}
  renderLiveRow();
}
function addFinding(f){
  if(!live)return;
  if(live.findings.length<400)live.findings.push(f);
  if(!live.types.includes(f.type)){live.types.push(f.type);refreshLiveSuggest();}
  const feed=S('.feed',live.card),li=el('li');
  li.title=f.detail||'';
  li.innerHTML='<span class="fd '+esc(f.severity)+'"></span><span class="fl">'+esc(issueLabel(f.type))+'</span><span class="fu">'+esc(shortPath(f.url||''))+'</span>';
  feed.prepend(li);
  while(feed.childElementCount>6)feed.lastChild.remove();
  S('.feed-empty',live.card).hidden=true;
}
function tick(){if(!live||live.done)return;S('.p-time',live.card).textContent=fmtDur(Date.now()-live.startedAt);renderLiveRow();if(Date.now()-live.startedAt>20000)refreshLiveSuggest();}
setInterval(tick,1000);

// The running (or just finished) inspection at the top of the sidebar.
function renderLiveRow(){
  if(!hist)return;
  let row=hist.querySelector('.live-row');
  if(!live||!onSite(live.url)){if(row){row.previousElementSibling&&row.previousElementSibling.classList.contains('live-day')&&row.previousElementSibling.remove();row.remove();}return;}
  if(!row){
    const day=el('div','hist-day live-day','Now');
    row=el('div','hist-row live-row');
    const btn=el('button','history-item');btn.type='button';
    btn.addEventListener('click',()=>{if(live&&live.done&&live.savedId&&!viewingLive){const id=live.savedId;live=null;renderLiveRow();openInspection(id);}else showLive();});
    row.appendChild(btn);hist.prepend(row);hist.prepend(day);
  }
  const p=live.progress||{},pct=Math.round(pctOf(p));
  const state=live.failed?'err':live.done?'done':'';
  const meta=live.failed?'Failed &middot; open to see why':live.done?'Finished '+fmtDur(live.endedAt-live.startedAt)+(viewingLive?'':' &middot; open the results'):pct+'% &middot; '+fmtDur(Date.now()-live.startedAt)+((p.pages&&p.pages.done)?' &middot; '+p.pages.done+' pages':'');
  row.querySelector('.history-item').innerHTML='<span class="h-spin '+state+'" aria-hidden="true"></span><span class="h-txt"><span class="h-url">'+esc(hostOf(live.url))+'</span><span class="h-meta">'+meta+'</span></span>';
  row.classList.toggle('active',viewingLive);
}
// Show the running inspection (after browsing a past one, or after a reload).
function showLive(){
  if(!live)return;
  closeSide();
  clear();
  viewingLive=true;
  addMsg('user','Inspect '+esc(keyOf(live.url)),live.startedAt);
  addMsg('agent','Checking <b>'+esc(keyOf(live.url))+'</b> now, every page, link and image. Nothing on your site changes, and you can keep asking me things.',live.startedAt);
  urlIn.placeholder='Ask me anything while I work';
  chatIn.appendChild(live.card);
  for(const w of live.thread)chatIn.appendChild(w);
  live.sgEl=null;live.sgSig=null;refreshLiveSuggest();
  markActive();renderLiveRow();scroll();
}

function streamRun(){
  return new Promise(res=>{
    const es=new EventSource('/api/stream/'+live.runId);
    es.addEventListener('message',e=>{
      const m=JSON.parse(e.data);
      if(m.progress){updateLive(m.progress);return;}
      if(m.finding){addFinding(m.finding);return;}
      const line=m.line||'';
      if(line.startsWith('__DONE__:')){es.close();res(Number(line.slice(9)));return;}
      if(line.startsWith('__REPORT__:')){live.reportCode=line.slice(11);return;}
      if(line.startsWith('__SAVED__:')){live.savedId=line.slice(10);return;}
      logLine(live.card,line);
    });
    es.addEventListener('error',()=>{es.close();res(-1);});
  });
}

function couldNotOpen(run,f){
  const c=run.card,host=hostOf(f.url||run.url).replace(/^www\./,'');
  c.classList.add('err','done');S('.ps',c).classList.add('err');
  S('.p-sub',c).innerHTML='<span style="color:var(--high)">Couldn&rsquo;t open '+esc(host)+'</span>';
  S('.steps',c).querySelectorAll('li').forEach(li=>li.className='');
  run.done=true;run.failed=true;run.endedAt=Date.now();
  if(run.sgEl){run.sgEl.remove();run.sgEl=null;}
  for(const it of run.queue){it.bubble.innerHTML='<span class="queued missed">I couldn&rsquo;t answer this because the site couldn&rsquo;t be opened.</span>';}
  if(viewingLive)addMsg('agent','I couldn&rsquo;t open <b>'+esc(host)+'</b>: '+esc(f.message)+'<br><span style="font-size:13px;color:var(--text-2)">Nothing was checked, so there&rsquo;s no report. Check the address in your site list, or try again in a moment.</span>');
  if(viewingLive){live=null;renderLiveRow();markActive();if(!current)urlIn.placeholder=idlePlaceholder();}else renderLiveRow();
  renderEmpty();
  document.title=BASE_TITLE;
}
// Stop: the first press stops reading pages and the report covers what was read; once
// pressed it becomes "Stop now, no report", which ends everything and saves nothing.
async function stopRun(run){
  const b=S('.p-stop',run.card),note=S('.p-stopnote',run.card),now=run.stopping==='crawl';
  b.disabled=true;
  try{
    const r=await fetch('/api/run/'+encodeURIComponent(run.runId)+'/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({now})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'it may have just finished');
    run.stopping=d.stopping;note.hidden=false;
    if(d.stopping==='crawl'){note.textContent='Stopping: no new pages. I\u2019m finishing the checks on the pages already read, then the report.';b.textContent='Stop now, no report';b.disabled=false;}
    else if(d.stopping==='report'){note.textContent='Almost done: writing the report for the pages read.';b.hidden=true;}
    else{note.textContent='Stopping now\u2026';b.hidden=true;}
  }catch(e){b.disabled=false;note.hidden=false;note.textContent='Couldn\u2019t stop it: '+e.message;}
}
// Stopped with "Stop now": nothing was saved.
function stoppedNow(run){
  const c=run.card,host=hostOf(run.url).replace(/^www\./,'');
  c.classList.add('done');S('.ps',c).classList.add('done');
  S('.p-sub',c).textContent='Stopped';
  S('.steps',c).querySelectorAll('li').forEach(li=>li.className='');
  run.done=true;run.endedAt=Date.now();
  if(run.sgEl){run.sgEl.remove();run.sgEl=null;}
  for(const it of run.queue){it.bubble.innerHTML='<span class="queued missed">I couldn&rsquo;t answer this because the inspection was stopped.</span>';}
  if(viewingLive)addMsg('agent','I stopped the inspection of <b>'+esc(host)+'</b>. Nothing was saved, so there&rsquo;s no report. Start again whenever you like.');
  if(viewingLive){live=null;renderLiveRow();markActive();if(!current)urlIn.placeholder=idlePlaceholder();}else renderLiveRow();
  renderEmpty();
  document.title=BASE_TITLE;
}
function failLive(msg){
  const c=live.card;c.classList.add('err');
  S('.ps',c).classList.add('err');S('.p-sub',c).innerHTML='<span style="color:var(--high)">'+esc(msg)+'</span>';
  const a=S('.steps li.active',c);if(a)a.className='failed';
  live.done=true;live.failed=true;live.endedAt=Date.now();
  if(live.sgEl)live.sgEl.remove();
  for(const it of live.queue){it.bubble.innerHTML='<span class="queued missed">I couldn&rsquo;t answer this because the inspection didn&rsquo;t finish.</span>';}
  const log=S('.prog-log',c),tog=S('.log-toggle',c);if(log.hidden)tog.click();
}

// Follow a run to the end, then show its results (or, when another inspection is on
// screen, mark it finished in the sidebar).
async function followRun(){
  const run=live;
  const code=await streamRun();
  running=false;syncBtn();
  if(live!==run)return;
  try{
    // The site couldn't be opened (lib/start-url.js): say why, plainly, and stop.
    const fail=code===3&&run.progress&&run.progress.failure;
    if(fail){couldNotOpen(run,fail);return;}
    if(code===130){stoppedNow(run);return;}
    if(code!==0)throw new Error(code===-1?'the connection to SiteFix was lost':'the inspection stopped with an error; the details are below');
    const r=await fetch('/api/results?runId='+encodeURIComponent(run.runId));
    const reg=await r.json();
    if(!r.ok)throw new Error(reg.error||'issues.json not found');
    let report=null;
    if(run.reportCode==='0'){try{const rr=await fetch('/api/report');if(rr.ok)report=await rr.json();}catch{}}
    run.done=true;run.endedAt=Date.now();
    const c=run.card;S('.ps',c).classList.add('done');S('.pfill',c).style.width='100%';
    S('.p-sub',c).innerHTML='Checked '+(reg.run&&reg.run.pagesCrawled||0)+' pages in '+fmtDur(run.endedAt-run.startedAt);
    c.classList.add('done');
    S('.steps',c).querySelectorAll('li').forEach(li=>li.className='done');
    if(!report&&run.reportCode!==undefined){const l=S('.steps li[data-step="4"]',c);if(l)l.className='failed';}
    S('.p-eta',c).textContent='';c.classList.remove('more');S('.prog-title',c).innerHTML=S('.prog-title',c).innerHTML.replace(/^Inspecting/,'Inspected');S('.p-more',c).textContent='Show details';
    if(run.sgEl){run.sgEl.remove();run.sgEl=null;} // the "while I work" questions give way to the results
    const shown=viewingLive;
    if(shown){renderResults(reg,run.url,report,run.savedId||null);if(run.savedId)store.set(run.savedId);}
    await loadHistory();
    refreshScore();
    await answerQueue(run,shown&&viewingLive);
    if(viewingLive){live=null;renderLiveRow();markActive();}
    else renderLiveRow();
    document.title=document.hidden?'✓ Report ready — SiteFix':BASE_TITLE;
  }catch(e){
    failLive('Could not finish: '+e.message);
    if(viewingLive)addMsg('agent','<span style="color:var(--high)">&#9888; '+esc(e.message)+'</span>');
    document.title=BASE_TITLE;
    renderLiveRow();
  }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!running)document.title=BASE_TITLE;});

function beginLive(runId,url,startedAt){
  live={runId,url,startedAt:startedAt?new Date(startedAt).getTime():Date.now(),card:buildLiveCard(url),progress:null,done:false,types:[],asked:[],queue:[],sgEl:null,sgSig:null,thread:[],findings:[],said:{},lastPhase:null};
  running=true;syncBtn();
  const run=live;
  S('.p-stop',run.card).addEventListener('click',e=>{e.stopPropagation();stopRun(run);});
  showLive();
  followRun();
}

async function start(url){
  const v=validateUrl(url||urlIn.value);
  if(!v.ok){urlIn.classList.add('invalid');inpErr.textContent=v.msg;inpErr.style.display='inline';inpOk.style.display='none';return;}
  const siteUrl=v.url;
  clear();
  running=true;syncBtn();
  try{
    const r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:siteUrl})});
    const d=await r.json();
    if(!r.ok||!d.runId)throw new Error(d.error||'Failed to start crawl');
    beginLive(d.runId,siteUrl);
  }catch(e){
    running=false;syncBtn();renderEmpty();
    addMsg('user','Inspect '+esc(keyOf(siteUrl)));
    addMsg('agent','<span style="color:var(--high)">&#9888; I couldn&rsquo;t start the inspection: '+esc(e.message)+'</span>');
  }
}

const PRI={P1:0,P2:1,P3:2};
// id: the saved inspection (history/<id>); its PDF and screenshots are served from there.
function renderResults(reg,siteUrl,report,id,meta){
  // Merge the explained report (priority, explanation, fix) into each issue when it exists.
  const extra=new Map(),typeInfo=new Map();
  if(report)for(const t of report.types){typeInfo.set(t.type,t);for(const i of t.issues)extra.set(i.id,i);}
  const issues=(reg.issues||[]).map(i=>({...i,...(extra.get(i.id)||{}),_type:typeInfo.get(i.type)||null}));
  const base=id?'/api/history/'+encodeURIComponent(id)+'/':'/api/';
  current={id:id||null,byId:new Map(issues.map(i=>[i.id,i])),report,base,hasPdf:meta?meta.hasPdf:Boolean(report),run:reg.run||{}};
  markActive();
  const run=reg.run||{},counts=reg.counts||{};
  urlIn.placeholder='Ask about this report';
  const pages=run.pagesCrawled||0;
  if(!issues.length){
    addMsg('agent','<span style="color:var(--success)">&#10003; No issues found.</span> I checked '+pages+' page'+(pages===1?'':'s')+' and the site looks clean on every check. Nothing changed on the site.');
    if(report&&id)chatIn.appendChild(summaryCard(siteUrl,reg,report,issues,id,meta));
    scroll();return;
  }
  if(report){
    // One card says it all: the score, the areas, what to fix first and the report.
    addMsg('agent',(run.partial?'Here&rsquo;s what I found on the pages I read.':'Done. Here&rsquo;s where <b>'+esc(keyOf(siteUrl))+'</b> stands.'));
    chatIn.appendChild(summaryCard(siteUrl,reg,report,issues,id,meta));
  }else{
    addMsg('agent','Found <strong>'+counts.total+' issue'+(counts.total!==1?'s':'')+'</strong> on '+pages+' pages. The written report couldn&rsquo;t be created this time, but you can ask me about any of them, or run the inspection again for the full report.');
  }
  scroll();
  current.sgTypes=[...new Set(issues.map(i=>i.type))];
  showResultSuggest([]);
}

const BAND_CLS=s=>s<=49?'b1':s<=69?'b2':s<=84?'b3':'b4';
const BAND_NAME=s=>s<=49?'Needs work':s<=69?'Fair':s<=84?'Good':'Excellent';
// The result card. The score comes from the server (GET /api/history/:id/score), so it
// counts what was confirmed fixed or kept in the report, the same as the report shows.
function summaryCard(siteUrl,reg,report,issues,id,meta){
  const run=reg.run||{},counts=reg.counts||{},sev=counts.bySeverity||{},pages=run.pagesCrawled||0;
  const host=keyOf(siteUrl),first=fixFirstList(issues);
  const when=run.startedAt?new Date(run.startedAt).toLocaleDateString([],{day:'numeric',month:'short'}):'';
  const dur=run.startedAt&&run.finishedAt?fmtDur(new Date(run.finishedAt)-new Date(run.startedAt)):'';
  const sm=report.summaries||{},sp=sm.speed;
  const c=el('div','sum-card');
  const pdf=id?'/api/history/'+encodeURIComponent(id)+'/report.pdf':'';
  const hasPdf=meta?meta.hasPdf:true;
  let note='';
  if(run.partial&&run.partial.reason==='stopped')note='You stopped early, so I read '+pages+' of the '+run.partial.pagesFound+'+ pages I found. Run it again for the whole site.';
  else if(run.partial&&run.partial.reason==='time')note='A large site: I read '+pages+' of at least '+run.partial.pagesFound+' pages, a share of every section.';
  if(sp&&sp.pagesTested&&sp.median&&sp.median.lcpMs!=null)note+=(note?' ':'')+'On a phone over 4G your pages show their main content in about '+(sp.median.lcpMs/1000).toFixed(1)+' s (good is under 2.5 s).';
  c.innerHTML='<div class="sc-top"><div class="sc-num" aria-hidden="true"><span>&hellip;</span></div><div class="sc-head"><div class="sc-band">Your score</div>'+
    '<div class="sc-meta">'+esc(host)+(when?' &middot; '+esc(when):'')+' &middot; '+pages+' page'+(pages===1?'':'s')+(dur?' in '+dur:'')+'</div>'+
    '<div class="sc-sev"><span class="sev-n high">'+(sev.high||0)+' high</span><span class="sev-n medium">'+(sev.medium||0)+' medium</span><span class="sev-n low">'+(sev.low||0)+' low</span></div></div></div>'+
    '<div class="sc-areas"></div>'+
    (first.length?'<div class="sc-first"><h4>Fix these first</h4><ol>'+first.map(i=>'<li data-type="'+esc(i.type)+'"><div class="t"><b>'+esc(i._type?i._type.title:issueLabel(i.type))+'</b><span>'+esc(firstLine(i))+'</span></div><span class="g"></span></li>').join('')+'</ol></div>':'')+
    '<div class="sc-goal" hidden></div>'+
    (note?'<div class="sc-note">'+esc(note)+'</div>':'')+
    '';
  if(!id)return c;
  fillScore(c,id);
  // Then the report itself, as a link preview (like a link shared in Messages), with the PDF and the download under it.
  const w=el('div','sum-wrap');w.appendChild(c);w.appendChild(reportCard(siteUrl,run,counts.total||issues.length,issues,id,pdf,hasPdf));
  return w;
}
// A link preview to the web report: who it was made for, the site and its issues, a
// screenshot of the most urgent problem.
function reportCard(siteUrl,run,total,issues,id,pdf,hasPdf){
  const shot=issues.find(i=>i.screenshot&&i.priority==='P1')||issues.find(i=>i.screenshot);
  const when=run.startedAt?new Date(run.startedAt).toLocaleDateString([],{day:'numeric',month:'short'}):'';
  const host=keyOf(siteUrl),title=esc(host)+': '+total+' issue'+(total!==1?'s':'')+' to fix';
  const who=me&&me.name?'Made for '+esc(String(me.name).split(' ')[0]):'SiteFix report';
  const a=el('a','rcard');a.href='/report/'+encodeURIComponent(id);a.target='_blank';a.rel='noopener';
  a.innerHTML='<div class="rc-top"><div class="rc-txt"><span class="rc-made">'+who+(when?' &middot; '+esc(when):'')+'</span><span class="rc-title">'+title+'</span><span class="rc-brand">SiteFix</span></div>'+(shot?'<div class="rc-shot" style="background-image:url(&quot;'+esc(current.base+shot.screenshot)+'&quot;)"></div>':'')+'</div><div class="rc-bot"><b>'+title+'</b><span>Web report with screenshots and fixes</span></div>';
  const wrap=el('div','rc-wrap');wrap.appendChild(a);
  const links=el('div','rc-links');
  links.innerHTML='<a href="'+pdf+'" target="_blank" rel="noopener"'+(hasPdf?'':' aria-disabled="true"')+'><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6z"/><path d="M9 2v4h4"/></svg>PDF</a>'+
    '<a href="/report/'+encodeURIComponent(id)+'/download"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/></svg>Download</a>';
  wrap.appendChild(links);
  return wrap;
}
async function fillScore(c,id){
  let d;
  try{const r=await fetch('/api/history/'+encodeURIComponent(id)+'/score');d=await r.json();if(!r.ok)throw new Error(d.error);}catch{S('.sc-num span',c).textContent='–';return;}
  const s=d.score;c.classList.add(BAND_CLS(s));
  const num=S('.sc-num',c);num.style.setProperty('--sc',s);S('span',num).textContent=s;
  S('.sc-band',c).textContent=d.band+(d.verified||d.kept?' · counting your fixes':'');
  const A={'on-page':'On-page',technical:'Technical','off-page':'Off-page'};
  S('.sc-areas',c).innerHTML=Object.keys(A).map(a=>'<div class="sc-area">'+A[a]+'<b>'+d.areas[a]+'</b><div class="sc-bar"><i style="width:'+d.areas[a]+'%"></i></div></div>').join('');
  const pts=new Map(d.next.map(t=>[t.type,t.points]));
  let gain=0;
  c.querySelectorAll('.sc-first li').forEach(li=>{const g=pts.get(li.dataset.type)||0;gain+=g;S('.g',li).textContent=g?'+'+fmtPts(g):'';});
  const goal=S('.sc-goal',c);
  if(gain>0){goal.hidden=false;goal.innerHTML='Fixing these three takes your score to about <b>'+Math.min(100,Math.round(d.exact+gain))+'</b>.';}
}
function fmtPts(x){if(x>=10)return String(Math.round(x));const r=Math.round(x*10)/10;return r===0&&x>0?'<0.1':String(r);}

// The three things to fix first: P1 issues, then quick wins; one per kind of problem.
function fixFirstList(issues){
  const seen=new Set(),eff={easy:0,medium:1,hard:2};
  return issues.filter(i=>i.priority==='P1'||i.quickWin)
    .sort((a,b)=>(PRI[a.priority]??3)-(PRI[b.priority]??3)||(b.quickWin-a.quickWin)||(eff[a.effort]??3)-(eff[b.effort]??3))
    .filter(i=>{if(seen.has(i.type))return false;seen.add(i.type);return true;}).slice(0,3);
}
function firstLine(i){
  const n=(i._type&&i._type.issues)?i._type.issues.length:1;
  let t=String(i.explanation||i.detail||'').replace(/\s*\((https?:\/\/[^)]*)\)\.?$/,'.').trim();
  if(t.length>170)t=t.slice(0,167).replace(/\s+\S*$/,'')+'\u2026';
  return t+(n>1?' ('+n+' found)':'');
}
function issueLabel(t){
  const m={'http-4xx-internal':'Broken link to your own page','http-4xx-external':'Broken link to another website','link-unreachable':'Link could not be reached','redirect-loop':'Redirect loop','redirect-chain':'Redirect chain','redirect-to-error':'Redirect ends in error','https-missing-redirect':'HTTP \u2192 HTTPS redirect missing','www-variant-not-redirected':'www/non-www not unified','soft-404':'Error page that says it is fine','title-missing':'Missing <title> tag','title-multiple':'Multiple <title> tags','title-too-long':'Title too long','title-too-short':'Title too short','title-duplicate':'Duplicate title','description-missing':'Missing meta description','description-multiple':'Multiple meta descriptions','description-too-long':'Meta description too long','description-too-short':'Meta description too short','description-duplicate':'Duplicate meta description','h1-missing':'Missing H1','h1-multiple':'Multiple H1 tags','metadata-js-only':'Tags only appear after JavaScript runs','canonical-missing':'Missing canonical tag','canonical-multiple':'Multiple canonical tags','canonical-broken-target':'Canonical points to broken URL','canonical-redirect':'Canonical points to redirect','image-broken':'Broken image','image-alt-missing':'Image has no alt text','image-alt-unhelpful':'Alt text does not describe the image','image-alt-too-long':'Alt text too long','image-mixed-content':'HTTP image on an HTTPS page','image-oversized':'Image file too large','heading-skip':'Heading levels skip','robots-noindex':'Hidden from search (noindex)','robots-nofollow':'Links not followed (nofollow)','og-missing':'No Open Graph tags','og-incomplete':'Open Graph tags incomplete','og-image-broken':'Share image broken','viewport-missing':'No viewport tag (not mobile-friendly)','lang-missing':'No page language set','content-thin':'Thin page (little text)','content-duplicate':'Near-duplicate page','content-placeholder':'Placeholder text on a live page','content-repeated-word':'Repeated word','copy-spelling':'Spelling mistakes','copy-grammar':'Grammar mistakes','speed-lcp-slow':'Main content shows slowly','speed-cls-high':'Layout jumps while loading','speed-tbt-high':'Too busy to respond','speed-ttfb-slow':'Server slow to answer','speed-page-heavy':'Page too heavy'};
  return m[t]||t.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}
// ---------- chat about the report ----------
function formatAnswer(t){
  // Escape first, then allow only simple formatting: **bold**, "- " bullet lines, line breaks.
  const lines=esc(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').split('\n');
  let out='',inList=false;
  for(const l of lines){
    const m=l.match(/^\s*[-•]\s+(.*)/);
    if(m){if(!inList){out+='<ul>';inList=true;}out+='<li>'+m[1]+'</li>';}
    else{if(inList){out+='</ul>';inList=false;}out+=(out&&!out.endsWith('</ul>')?'<br>':'')+l;}
  }
  return out+(inList?'</ul>':'');
}
function shortPath(u){try{const x=new URL(u);return x.pathname+x.search;}catch{return u;}}
function answerHtml(d){return '<div class="ans">'+formatAnswer(d.answer||d.error||'No answer.')+'</div>';}
// The same rule as lib/screenshots.js: is the problem visible on the page?
${isVisual.toString()}
// An answer: the text in the bubble, then a card for each issue it is about (screenshot
// of the page with the problem outlined, what and where, a link into the report), then
// the closing line. List answers (display "cards") carry the lead and closing line apart
// from the plain-text version of the list.
// An answer: the text in the bubble, then the issues it is about. One issue: its card
// (screenshot of the page with the problem outlined, what and where, Details). Two or
// more: short numbered points, then all their cards. The rest of a long list is a link
// card to the web report, filtered to that list.
function showAnswer(bbl,d){
  const known=id=>current&&current.byId.has(id);
  const ids=(d.issueIds||[]).filter(known);
  const cards=d.display==='cards';
  const rest=cards?(d.moreIds||[]).filter(known):ids.slice(6);
  bbl.innerHTML=answerHtml(cards?{answer:d.lead||d.answer}:d);
  if(!ids.length&&!(cards&&d.tail))return;
  const row=bbl.closest('.chat-msg');
  let at=row;
  if(ids.length===1){
    const list=el('div','ev-list');list.appendChild(evCard(current.byId.get(ids[0])));
    at.after(list);at=list;
  }else if(ids.length>1){
    // Two or more: short numbered points, then every card at once.
    const all=ids.slice(0,6),mixed=new Set(all.concat(rest).map(id=>current.byId.get(id).type)).size>1;
    const pts=el('ol','crisp-list');
    all.forEach(id=>{const li=el('li');li.innerHTML=crispLine(current.byId.get(id),mixed);pts.appendChild(li);});
    const box=el('div','pt-box');box.appendChild(pts);
    const view=el('div','ev-list');
    all.forEach(id=>view.appendChild(evCard(current.byId.get(id))));
    if(rest.length&&!cards)view.appendChild(moreButton(view,rest));
    bbl.appendChild(box);
    at.after(view);at=view;
  }
  // The rest of a list: a link card to the web report, filtered to exactly that list.
  if(cards&&d.more>0&&current.id&&d.reportHash){
    const a=el('a','more-card');a.href='/report/'+encodeURIComponent(current.id)+'#'+d.reportHash;a.target='_blank';a.rel='noopener';
    a.innerHTML='<span class="mc-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg></span><span class="mc-txt"><b>'+esc(d.moreLabel||('See all '+(d.more+ids.length)))+'</b><span>'+d.more+' more in the report, with screenshots and fixes</span></span><span class="mc-go">&rsaquo;</span>';
    at.after(a);at=a;
  }
  if(cards&&d.tail){
    const w=el('div','chat-msg agent'),b=el('div','msg-bbl');
    b.innerHTML=answerHtml({answer:d.tail});w.appendChild(b);at.after(w);at=w;
  }
  scroll();
}
function moreButton(list,rest){
  const b=el('button','ev-more');b.type='button';
  const label=()=>{b.textContent='Show '+Math.min(6,rest.length)+' more';};label();
  b.addEventListener('click',()=>{rest.splice(0,6).forEach(id=>list.insertBefore(evCard(current.byId.get(id)),b));if(rest.length)label();else b.remove();});
  return b;
}
function crispLine(i,mixed){
  const on=['image','http','redirect'].includes(i.evidence&&i.evidence.kind),n=(i.foundOn||[]).length;
  const what=esc(pathOn(i.affectedUrl))+(on&&n?' <span class="dim">on '+esc(pathOn(i.foundOn[0]))+(n>1?' and '+(n-1)+' more':'')+'</span>':'');
  return (mixed?'<b>'+esc(issueLabel(i.type))+'</b> &middot; ':'')+what;
}
function pathOn(u){const h=hostOf(u).replace(/^www\./,''),site=current&&current.run&&current.run.startUrl?hostOf(current.run.startUrl).replace(/^www\./,''):'';return (h&&h!==site?h:'')+shortPath(u);}
const OWNER_SAYS={P1:'Fix first',P2:'Fix soon',P3:'When you can'};
// Screenshots load two at a time: one that is still being taken must not hold up the
// browser's few connections to this server, or the next answer would wait behind it.
const shotQueue=[];let shotsLoading=0;
function loadShot(img,ok,fail){shotQueue.push({img,ok,fail});pumpShots();}
function pumpShots(){
  while(shotsLoading<2&&shotQueue.length){
    const j=shotQueue.shift();shotsLoading++;
    const done=f=>()=>{shotsLoading--;f();pumpShots();};
    j.img.onload=done(j.ok);j.img.onerror=done(j.fail);j.img.src=j.img.dataset.src;
  }
}
function evCard(i){
  const c=el('div','ev'),on=['image','http','redirect'].includes(i.evidence&&i.evidence.kind),pages=i.foundOn||[],n=pages.length;
  const what=pathOn(i.affectedUrl);
  const where=on&&n?'On '+pathOn(pages[0])+(n>1?' and '+(n-1)+' other page'+(n>2?'s':''):''):'';
  const m=i.evidence&&i.evidence.matches&&i.evidence.matches[0];
  const detail=m&&m.text?'<q>'+esc(m.text.slice(0,90))+'</q>'+(m.correction?' &rarr; '+esc(m.correction.slice(0,90)):''):esc(String(i.detail||'').slice(0,180));
  const shot=current&&current.id&&isVisual(i);
  const src=shot?'/api/history/'+encodeURIComponent(current.id)+'/shot/'+encodeURIComponent(i.id):'';
  c.innerHTML='<div class="ev-head">'+(shot?'<button type="button" class="ev-shot" aria-label="View the screenshot"><img alt="Screenshot of '+esc(on&&n?pathOn(pages[0]):what)+'" data-src="'+src+'"></button>':'')+
    '<div class="ev-txt"><div class="ev-kind"><i class="'+esc(i.priority||'')+'"></i>'+esc(issueLabel(i.type))+'</div>'+
    '<div class="ev-what">'+esc(what)+'</div>'+(where?'<div class="ev-where">'+esc(where)+'</div>':'')+(detail?'<div class="ev-detail">'+detail+'</div>':'')+
    '<button type="button" class="ev-open" aria-expanded="false">Details</button></div></div>';
  const b=c.querySelector('.ev-shot');
  if(b){const img=b.querySelector('img');loadShot(img,()=>b.classList.add('ok'),()=>b.classList.add('none'));
    b.addEventListener('click',()=>{if(b.classList.contains('ok'))viewShot(img.src,where||what);});}
  const t=c.querySelector('.ev-open');
  t.addEventListener('click',()=>{
    let box=c.querySelector('.ev-more-info');
    if(!box){box=evDetails(i,pages,on,b&&!b.classList.contains('none')?src:'');c.appendChild(box);}
    else box.hidden=!box.hidden;
    const open=!box.hidden;t.textContent=open?'Hide details':'Details';t.setAttribute('aria-expanded',open);
    if(open)box.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  return c;
}
// Everything the report says about one issue, opened inside the card.
// The page's speed test on a phone over 4G: every measure, marked good / slow / poor.
function speedTable(e){
  const r=e.ratings||{},mark={good:'Good','needs-improvement':'Needs work',poor:'Poor'};
  const s=ms=>ms==null?'n/a':(ms/1000).toFixed(1)+' s',kb=b=>b==null?'n/a':b>=1048576?(b/1048576).toFixed(1)+' MB':Math.round(b/1024)+' KB';
  const rows=[['Main content shows (LCP)',s(e.lcpMs),'under 2.5 s',r.lcp],['Layout shift (CLS)',e.cls==null?'n/a':String(e.cls),'under 0.1',r.cls],['Too busy to respond (TBT)',e.tbtMs==null?'n/a':Math.round(e.tbtMs)+' ms','under 200 ms',r.tbt],['Server starts answering (TTFB)',s(e.ttfbMs),'under 0.8 s',r.ttfb],['Page weight',kb(e.bytes)+(e.requests?' &middot; '+e.requests+' files':''),'under 3 MB',r.bytes]];
  let h='<h4>Speed test on a phone over 4G</h4><table class="sp-t">'+rows.map(x=>'<tr><th>'+x[0]+'</th><td>'+x[1]+'</td><td class="sp-'+esc(x[3]||'')+'">'+(mark[x[3]]||'')+'</td><td class="dim">good: '+x[2]+'</td></tr>').join('')+'</table>';
  if(e.lcpElement)h+='<p class="dim">Main content: '+esc(e.lcpElement)+'</p>';
  const big=(e.biggest||[]).slice(0,3);
  if(big.length&&(e.metric==='bytes'||e.metric==='tbt'||e.metric==='lcp'))h+='<h4>Largest files</h4><ul>'+big.map(f=>'<li>'+esc((f.url.split('/').pop()||f.url).split('?')[0].slice(0,60))+' <span class="dim">'+kb(f.bytes)+' &middot; '+esc(f.type)+'</span></li>').join('')+'</ul>';
  return h;
}
function evDetails(i,pages,on,src){
  const box=el('div','ev-more-info'),ty=i._type||{},steps=ty.fixSteps||[];
  let h='';
  if(src)h+='<img class="ev-big" alt="" src="'+esc(src)+'">'+'<div class="ev-cap">The problem is outlined in red where it could be found.</div>';
  if(i.explanation)h+='<h4>What&rsquo;s wrong</h4><p>'+esc(i.explanation)+'</p>';
  // Image problems: the image itself (a broken one can't be shown, so say so).
  if(i.evidence&&i.evidence.kind==='image'&&/^https?:\/\//.test(i.affectedUrl||''))h+=/broken$/.test(i.type)?'<p class="ev-cap">The image itself can&rsquo;t be shown: it doesn&rsquo;t load'+(i.evidence.status?' (the server answers '+esc(String(i.evidence.status))+')':'')+', which is the problem.</p>':'<h4>The image</h4><img class="ev-img" alt="The image at '+esc(i.affectedUrl)+'" src="'+esc(i.affectedUrl)+'" referrerpolicy="no-referrer">';
  if(i.evidence&&i.evidence.kind==='speed')h+=speedTable(i.evidence);
  if(steps.length)h+='<h4>How to fix it</h4><ol>'+steps.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>';
  if(i.suggestedValue)h+='<h4>Suggested</h4><div class="ev-sugg"><span>'+esc(i.suggestedValue)+'</span><button type="button" class="copy" data-copy="'+esc(i.suggestedValue)+'">Copy</button></div>';
  const mm=(i.evidence&&i.evidence.matches)||[];
  if(mm.length>1)h+='<h4>All mistakes on this page</h4><ul>'+mm.slice(0,10).map(x=>'<li><q>'+esc(String(x.text||'').slice(0,90))+'</q>'+(x.correction?' &rarr; '+esc(String(x.correction).slice(0,90)):'')+'</li>').join('')+'</ul>';
  if(on&&pages.length)h+='<h4>Found on '+pages.length+' page'+(pages.length===1?'':'s')+'</h4><p class="ev-pages">'+pages.slice(0,12).map(u=>esc(pathOn(u))).join(', ')+(pages.length>12?' and '+(pages.length-12)+' more':'')+'</p>';
  const facts=[OWNER_SAYS[i.priority],i.owner?'usually fixed by: '+i.owner:'',i.effort?i.effort+' to fix':''].filter(Boolean);
  if(facts.length)h+='<div class="ev-facts">'+esc(facts.join(' \u00b7 '))+'</div>';
  box.innerHTML=h||'<p>'+esc(i.detail||'')+'</p>';
  const big=box.querySelector('.ev-big');if(big)big.onerror=()=>{big.nextSibling&&big.nextSibling.remove();big.remove();};
  const own=box.querySelector('.ev-img');if(own)own.onerror=()=>{const n=el('p','ev-cap');n.textContent='The image doesn\u2019t load right now.';own.replaceWith(n);};
  return box;
}
function viewShot(src,caption){
  const v=el('div');v.id='shot-view';v.setAttribute('role','dialog');v.setAttribute('aria-label','Screenshot');
  v.innerHTML='<img alt="" src="'+esc(src)+'"><span>'+(caption?esc(caption)+' &middot; ':'')+'the problem is outlined in red where it could be found</span>';
  const close=()=>{v.remove();document.removeEventListener('keydown',key);};
  const key=e=>{if(e.key==='Escape')close();};
  v.addEventListener('click',close);document.addEventListener('keydown',key);
  document.body.appendChild(v);
}
async function ask(q,opts){
  opts=opts||{};
  if(!current&&live&&!live.done&&viewingLive){urlIn.value='';syncBtn();liveAsk(q);return;}
  if(current){
    const instant=answerProcessQuestion(q,doneCtx());
    if(instant){urlIn.value='';syncBtn();addMsg('user',esc(q));addMsg('agent',answerHtml({answer:instant.answer}));showResultSuggest([q]);return;}
  }
  if(!current){
    // Nothing open: answer from the site's latest inspection when there is one.
    if(siteScore_&&siteScore_.id&&!viewingLive){urlIn.value='';syncBtn();await openInspection(siteScore_.id,true);if(current)return ask(q,opts);return;}
    addMsg('user',esc(q));addMsg('agent',viewingLive?'I can answer that once the inspection finishes, in a minute or two.':'Inspect <b>'+esc(siteHost())+'</b> first, then ask me anything about it.');urlIn.value='';syncBtn();return;
  }
  urlIn.value='';syncBtn();
  // A general follow-up ("what should I fix first?") right after a list of one kind of
  // problem: ask whether it is about that list or the whole site.
  if(!opts.decided&&current.lastScope&&FOLLOW_UP.test(q)&&!WHOLE_SITE.test(q)){chooseScope(q,current.lastScope);return;}
  addMsg('user',esc(opts.echo||q));
  const bbl=addMsg('agent','<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>');
  try{
    const body={question:q,inspectionId:current.id};
    if(opts.scope)body.scope=opts.scope.types;
    const r=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    showAnswer(bbl,d);
    // The topic of this answer is what the next follow-up may be about.
    if(d.display==='cards')current.lastScope=d.scope||(opts.scope&&d.issueIds&&d.issueIds.length?opts.scope:null);
    else if(d.issueIds&&d.issueIds.length)current.lastScope=null;
  }catch(e){bbl.innerHTML='<span style="color:var(--high)">I couldn&rsquo;t get an answer just now. Please try again.</span>';}
  if(current)showResultSuggest([q]);
  scroll();
}
const FOLLOW_UP=/\b(fix|do|tackle|start)\b.*\bfirst\b|\bpriorit|\b(most )?(urgent|important|critical|serious)\b|\bquick (wins?|fix(es)?)\b|\beasy (wins?|fix(es)?)\b|\bwhere (do|should) i start\b/i;
const WHOLE_SITE=/\b(overall|whole|entire|all|site[- ]?wide|everything|every)\b/i;
function chooseScope(q,scope){
  addMsg('user',esc(q));
  const bbl=addMsg('agent','Just the '+esc(scope.noun)+', or across the whole site?');
  const row=el('div','suggest scope-pick');
  row.innerHTML='<div class="sg-chips"><button type="button" class="sq" data-k="scope">Just the '+esc(scope.noun)+'</button><button type="button" class="sq" data-k="all">The whole site</button></div>';
  bbl.closest('.chat-msg').after(row);
  row.querySelectorAll('.sq').forEach(b=>b.addEventListener('click',()=>{
    row.remove();
    const pick=b.dataset.k==='scope';
    if(!pick)current.lastScope=null;
    ask(q,{decided:true,scope:pick?scope:null,echo:b.textContent});
  }));
  keepLast(current.sgEl);scroll();
}
chatIn.addEventListener('click',e=>{
  const big=e.target.closest('.ev-big');if(big){viewShot(big.src,'');return;}
  const b=e.target.closest('.copy');
  if(b){e.stopPropagation();navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200);}).catch(()=>{});}
});

// ---------- past inspections (kept by the server in history/) ----------
async function loadHistory(){
  if(!me)return;
  try{const r=await fetch('/api/history?site='+encodeURIComponent(me.activeSite));const d=await r.json();if(r.status===401){showSignin();return;}if(!r.ok)throw new Error(d.error);history_=d.inspections||[];}
  catch(e){hist.innerHTML='<div class="hist-empty">Could not load past inspections: '+esc(e.message)+'</div>';return;}
  renderHist();
}
const TRASH='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.6a1 1 0 001 .9h4.6a1 1 0 001-.9l.7-8.6"/></svg>';
function renderHist(){
  S('#hist-clear').hidden=history_.length<2;
  if(!history_.length){hist.innerHTML='<div class="hist-empty">No inspections of '+esc(siteHost())+' yet. Finished inspections are kept here.</div>';renderLiveRow();return;}
  hist.innerHTML='';
  let day='';
  history_.forEach(m=>{
    const label=m.startedAt?dayLabel(m.startedAt):'Earlier';
    if(label!==day){day=label;hist.appendChild(el('div','hist-day',esc(label)));}
    const row=el('div','hist-row');row.dataset.id=m.id;
    const sev=m.bySeverity||{},dot=sev.high?' bad':sev.medium?' mid':'';
    const when=m.startedAt?fmtTime(m.startedAt):'';
    const btn=el('button','history-item');btn.type='button';
    btn.title=(m.url||m.host)+(m.startedAt?' — '+new Date(m.startedAt).toLocaleString():'');
    btn.innerHTML='<span class="h-dot'+dot+'" aria-hidden="true"></span><span class="h-txt"><span class="h-url">'+esc(m.host||m.url)+'</span><span class="h-meta">'+esc(when)+' &middot; '+(m.total?m.total+' issue'+(m.total!==1?'s':''):'Clean')+(m.pagesCrawled?' &middot; '+m.pagesCrawled+' page'+(m.pagesCrawled!==1?'s':''):'')+'</span></span>';
    btn.addEventListener('click',()=>openInspection(m.id));
    const del=el('button','h-del',TRASH);del.type='button';
    del.setAttribute('aria-label','Delete inspection of '+(m.host||m.url)+' from '+(m.startedAt?new Date(m.startedAt).toLocaleString():''));
    del.title='Delete this inspection';
    del.addEventListener('click',e=>{e.stopPropagation();twoStep(del,'Delete',()=>removeInspection(m.id));});
    row.appendChild(btn);row.appendChild(del);hist.appendChild(row);
  });
  markActive();
  renderLiveRow();
}
function markActive(){hist.querySelectorAll('.hist-row').forEach(r=>{const on=Boolean(current&&current.id&&r.dataset.id===current.id);r.classList.toggle('active',on);const b=r.querySelector('.history-item');if(b){if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}});}
// First click arms the button ("Delete"), a second click within 3 seconds confirms. No pop-up dialog.
function twoStep(btn,label,action){
  if(btn.classList.contains('confirm')){clearTimeout(btn._t);action();return;}
  const old=btn.innerHTML;btn.classList.add('confirm');btn.textContent=label;
  btn._t=setTimeout(()=>{btn.classList.remove('confirm');btn.innerHTML=old;},3000);
}
async function removeInspection(id){
  try{const r=await fetch('/api/history/'+encodeURIComponent(id),{method:'DELETE'});if(!r.ok&&r.status!==404)throw new Error((await r.json()).error);}
  catch(e){alertHist('Could not delete: '+e.message);return;}
  if(current&&current.id===id)clear();
  if(store.get()===id)store.set(null);
  await loadHistory();refreshScore();
}
S('#hist-clear').addEventListener('click',e=>{const b=e.currentTarget;if(running)return;twoStep(b,'Delete all '+history_.length+'?',async()=>{
  try{const r=await fetch('/api/history?site='+encodeURIComponent(me.activeSite),{method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error);}catch(err){alertHist('Could not delete: '+err.message);return;}
  b.classList.remove('confirm');b.textContent='Delete all';
  if(current&&current.id)clear();
  await loadHistory();refreshScore();
});});
function alertHist(msg){const n=el('div','hist-empty');n.style.color='var(--high)';n.textContent=msg;hist.prepend(n);setTimeout(()=>n.remove(),4000);}

async function openInspection(id,quiet){
  closeSide();
  let saved;
  try{const r=await fetch('/api/history/'+encodeURIComponent(id));saved=await r.json();if(!r.ok)throw new Error(saved.error);}
  catch(e){alertHist('Could not open: '+e.message);if(store.get()===id)store.set(null);await loadHistory();return;}
  clear();
  const{meta,registry,report,chat}=saved,url=meta.url||registry.run?.startUrl||'';
  store.set(id);
  addMsg('user','Inspect '+esc(keyOf(url)),meta.startedAt);
  renderResults(registry,url,report,id,meta);
  for(const c of chat){addMsg('user',esc(c.question),c.at);showAnswer(addMsg('agent','',c.at),c);}
  const lastC=chat[chat.length-1];current.lastScope=lastC&&lastC.display==='cards'&&lastC.scope?lastC.scope:null;
  showResultSuggest(chat.map(c=>c.question));
  // Start at the top of the inspection (addMsg scrolls to the bottom on the next frame).
  if(!quiet)requestAnimationFrame(()=>requestAnimationFrame(()=>{chatA.style.scrollBehavior='auto';chatA.scrollTop=0;chatA.style.scrollBehavior='';}));
}
function syncHistButtons(){S('#hist-clear').disabled=running;} // "Delete all" waits for the running inspection

// ---------- the workspace: who is signed in and which site is on screen ----------
// A site is its host without www. and http/https, the same rule as lib/profiles.js.
function keyOf(u){try{const x=new URL(/^https?:\/\//i.test(u)?u:'https://'+u);return x.host.toLowerCase().replace(/^www\./,'');}catch{return String(u||'');}}
function sameSiteC(a,b){return Boolean(a&&b)&&keyOf(a)===keyOf(b);}
function onSite(u){return Boolean(me)&&sameSiteC(u,me.activeSite);}
function siteHost(){return me?keyOf(me.activeSite):'your site';}
function idlePlaceholder(){return me?'Ask me anything about '+siteHost():'Ask me anything';}
function renderEmpty(){
  if(!me)return;
  const first=String(me.name).split(' ')[0];
  S('#empty-title').textContent='Hi '+first+' \u{1F44B}';
  const b=S('#inspect-site');
  const busy=live&&!live.done,here=busy&&onSite(live.url);
  b.textContent=here?'Inspecting '+siteHost()+'…':'Inspect '+siteHost();
  b.disabled=Boolean(busy);
  const last=S('#empty-last');
  if(here){last.innerHTML='<button type="button" class="link-btn" id="follow-live">Follow the inspection</button>';S('#follow-live').onclick=()=>showLive();}
  else if(busy)last.textContent='SiteFix is checking '+keyOf(live.url)+' right now. Switch back to follow it.';
  else if(siteScore_&&siteScore_.id){
    const d=siteScore_.startedAt?dayLabel(siteScore_.startedAt):'';
    last.innerHTML='<span>Last checked '+esc(d==='Today'||d==='Yesterday'?d.toLowerCase():d)+' &middot; score <b>'+siteScore_.score+'</b> ('+esc(siteScore_.band)+')</span><button type="button" class="link-btn" id="open-last">Open it</button>';
    S('#open-last').onclick=()=>openInspection(siteScore_.id);
  }else last.textContent='';
  S('#empty-desc').innerHTML=siteScore_&&siteScore_.id?'Run it again to see what changed, or ask me about the last inspection.':'I&rsquo;ll check every page of <b>'+esc(siteHost())+'</b>, then show you what to fix first, why it matters and how. It takes a minute or two.';
}
S('#inspect-site').addEventListener('click',()=>inspectSite());
function renderScore(){
  const t=S('#tb-title');
  if(!me){t.innerHTML='';return;}
  const d=siteScore_;
  if(!d||d.score==null){t.innerHTML='<span class="tb-none">Not inspected yet</span>';return;}
  const up=d.withSelected>d.score?' <span class="tb-to">&rarr; '+d.withSelected+'</span>':'';
  t.innerHTML='<a class="tb-pill '+BAND_CLS(d.score)+'" href="/report/'+encodeURIComponent(d.id)+'" target="_blank" rel="noopener" title="Score from the latest inspection'+(up?', and with the fixes you selected':'')+'. Opens the report."><b>'+d.score+'</b>'+esc(d.band)+up+'</a>';
}
let scoreAt=0;
async function refreshScore(){
  if(!me)return;
  scoreAt=Date.now();
  const site=me.activeSite;
  try{const r=await fetch('/api/score?site='+encodeURIComponent(site));const d=await r.json();if(!r.ok||!me||me.activeSite!==site)return;siteScore_=d.score==null?null:d;}catch{return;}
  renderScore();if(empty.parentNode===chatIn&&empty.style.display!=='none')renderEmpty();
}
// Back from the report tab (fixes selected or confirmed there): the score follows.
window.addEventListener('focus',()=>{if(me&&Date.now()-scoreAt>3000)refreshScore();});
function applyProfile(p){
  me=p;
  S('#site-name').textContent=siteHost();
  S('#new-btn').lastChild.textContent=' Inspect '+siteHost();
  if(!current&&!viewingLive)urlIn.placeholder=idlePlaceholder();
  renderSiteMenu();renderEmpty();
}
async function profileCall(method,path,body){
  const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){showSignin();throw new Error('Please sign in again.');}
  if(!r.ok)throw new Error(d.error||'Something went wrong. Please try again.');
  return d.profile;
}
async function switchSite(site){
  closeMenu();
  try{applyProfile(await profileCall('PUT','/api/profile/active',{site}));}catch(e){addMsg('agent','<span style="color:var(--high)">'+esc(e.message)+'</span>');return false;}
  siteScore_=null;renderScore();clear();
  await loadHistory();await refreshScore();
  if(live&&onSite(live.url)&&!live.done)showLive();
  return true;
}
async function addSite(url,errEl){
  try{applyProfile(await profileCall('POST','/api/profile/sites',{site:url}));}
  catch(e){if(errEl)errEl.textContent=e.message;else addMsg('agent','<span style="color:var(--high)">'+esc(e.message)+'</span>');return false;}
  closeMenu();siteScore_=null;renderScore();clear();
  await loadHistory();await refreshScore();
  return true;
}
// The site switcher: the workspace's sites, add a site link, sign out.
const menu=S('#site-menu'),siteBtn=S('#site-btn');
function renderSiteMenu(){
  if(!me)return;
  menu.innerHTML='<div class="sm-head">Your sites</div>'+me.sites.map((x,i)=>'<div class="sm-row"><button type="button" class="sm-site" data-i="'+i+'" role="menuitemradio" aria-checked="'+(x===me.activeSite)+'"><i>'+(x===me.activeSite?'&#10003;':'')+'</i><span>'+esc(keyOf(x))+'</span></button>'+(me.sites.length>1?'<button type="button" class="sm-del" data-i="'+i+'" title="Remove from your sites (its inspections are kept)" aria-label="Remove '+esc(keyOf(x))+'">Remove</button>':'')+'</div>').join('')+
    '<form class="sm-add" novalidate><input type="text" placeholder="Add a site link, e.g. example.org" aria-label="Website to add" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="url"><button type="submit">Add</button></form><div class="sm-err" role="alert"></div>'+
    '<div class="sm-foot"><span>Signed in as <b>'+esc(me.name)+'</b></span><button type="button" class="sm-out">Sign out</button></div>';
  menu.querySelectorAll('.sm-site').forEach(b=>b.addEventListener('click',()=>{const x=me.sites[Number(b.dataset.i)];if(x===me.activeSite){closeMenu();return;}switchSite(x);}));
  menu.querySelectorAll('.sm-del').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const x=me.sites[Number(b.dataset.i)];twoStep(b,'Remove?',async()=>{
    try{const was=me.activeSite;applyProfile(await profileCall('DELETE','/api/profile/sites?site='+encodeURIComponent(x)));if(me.activeSite!==was){siteScore_=null;renderScore();clear();await loadHistory();await refreshScore();}menu.hidden=false;siteBtn.setAttribute('aria-expanded','true');}
    catch(err){S('.sm-err',menu).textContent=err.message;}
  });}));
  const f=S('.sm-add',menu),inp=S('input',f);
  f.addEventListener('submit',e=>{e.preventDefault();const v=inp.value.trim();if(!v)return;S('.sm-err',menu).textContent='';addSite(v,S('.sm-err',menu));});
  S('.sm-out',menu).addEventListener('click',async()=>{try{await fetch('/api/profile/signout',{method:'POST'});}catch{}store.set(null);location.reload();});
}
function closeMenu(){menu.hidden=true;siteBtn.setAttribute('aria-expanded','false');}
siteBtn.addEventListener('click',e=>{e.stopPropagation();const open=menu.hidden;menu.hidden=!open;siteBtn.setAttribute('aria-expanded',String(open));if(open){const i=S('.sm-add input',menu);if(i&&matchMedia('(hover:hover)').matches)i.focus();}});
document.addEventListener('click',e=>{if(!menu.hidden&&!e.target.closest('#site-menu,#site-btn'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){closeMenu();siteBtn.focus();}});
// Sign in: a name and a website link. No password for now.
const signin=S('#signin');
function showSignin(){me=null;signin.hidden=false;S('#si-name').focus();}
S('#si-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const name=S('#si-name'),site=S('#si-site'),err=S('#si-err'),go=S('#si-go');
  name.removeAttribute('aria-invalid');site.removeAttribute('aria-invalid');err.textContent='';
  if(!name.value.trim()){name.setAttribute('aria-invalid','true');err.textContent='Please enter your name.';name.focus();return;}
  const c=classifyInput(site.value);
  if(c.kind!=='url'){site.setAttribute('aria-invalid','true');err.textContent=c.kind==='urls'?'One website to start with. You can add more later.':'That doesn’t look like a website address. Try something like example.com.';site.focus();return;}
  go.disabled=true;
  try{const p=await profileCall('POST','/api/profile',{name:name.value,site:c.url});signin.hidden=true;store.set(null);await enter(p);}
  catch(x){err.textContent=x.message;}
  finally{go.disabled=false;}
});

// On load: the workspace (or the sign-in screen); then its site's inspections. Follow an
// inspection that is still running (the page was reloaded mid-run), else reopen the one
// that was open before the reload.
async function enter(p){
  applyProfile(p);
  let act={};
  try{act=await (await fetch('/api/run/active')).json();}catch{}
  // A running inspection of another of the workspace's sites: switch to it.
  if(act.runId&&!onSite(act.url)){try{applyProfile(await profileCall('PUT','/api/profile/active',{site:act.url}));}catch{}}
  await loadHistory();
  refreshScore();
  if(act.runId){beginLive(act.runId,act.url,act.startedAt);return;}
  const id=store.get();if(id&&history_.some(m=>m.id===id))openInspection(id);
}
(async()=>{
  let p=null;
  try{p=(await (await fetch('/api/profile')).json()).profile;}catch{}
  if(!p){showSignin();return;}
  enter(p);
})();
</script>
</body>
</html>`;

writeFileSync(out, HTML, "utf-8");
console.log("Written:", out);
