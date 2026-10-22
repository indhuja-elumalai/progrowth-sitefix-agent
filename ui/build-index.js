// Run: node ui/build-index.js
// Writes ui/index.html from the parts defined here.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  .sidebar-footer{padding:12px 18px 16px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-3);line-height:1.6}
  .ver-badge{display:inline-block;background:var(--surface-3);color:var(--text-2);border-radius:var(--radius-xl);padding:1px 8px;font-size:10.5px;font-weight:500;margin-top:4px}

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

  /* Summary card */
  .rpt-hdr{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
  .rpt-sicon{width:36px;height:36px;background:var(--surface-1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .rpt-sicon svg{width:18px;height:18px}
  .rpt-info{flex:1;min-width:0}
  .rpt-url{font-size:14px;font-weight:600;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rpt-meta{font-size:12px;color:var(--text-3);margin-top:1px}
  .rpt-badge{padding:3px 10px;border-radius:var(--radius-xl);font-size:12px;font-weight:600;background:var(--surface-2);color:var(--text-1);flex-shrink:0;white-space:nowrap}
  .rpt-counts{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--border)}
  .cnt-cell{padding:12px 16px;border-right:1px solid var(--border)}
  .cnt-cell:last-child{border-right:none}
  .cnt-num{font-size:22px;font-weight:600;color:var(--text-1);letter-spacing:-.02em;line-height:1.15;font-variant-numeric:tabular-nums}
  .cnt-num.high{color:var(--high)}
  .cnt-num.medium{color:var(--medium)}
  .cnt-num.low{color:var(--low)}
  .cnt-lbl{font-size:11.5px;color:var(--text-3);margin-top:2px}
  .rpt-dets{padding:10px 16px 12px;display:flex;gap:6px;flex-wrap:wrap}
  .det-tag{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--radius-xl);background:var(--surface-1);font-size:12px;color:var(--text-2)}
  .det-tag svg{width:10px;height:10px;color:var(--success)}

  /* Issue groups */
  .issue-list{display:flex;flex-direction:column;gap:8px}
  .grp-hdr{padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;transition:background var(--t)}
  .grp-hdr:hover{background:var(--surface-1)}
  .grp-lbl{flex:1;font-size:14px;font-weight:600;color:var(--text-1)}
  .grp-cnt{font-size:12px;font-weight:500;color:var(--text-2);padding:1px 8px;background:var(--surface-2);border-radius:var(--radius-xl);font-variant-numeric:tabular-nums}
  .grp-chv{color:var(--text-3);transition:transform var(--t)}
  .grp-chv svg{width:14px;height:14px;display:block}
  .issue-grp.collapsed .grp-chv{transform:rotate(-90deg)}
  .grp-body{display:flex;flex-direction:column;border-top:1px solid var(--border)}
  .issue-grp.collapsed .grp-body{display:none}

  /* Issue items */
  .iss-item{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start;cursor:pointer;transition:background var(--t)}
  .iss-item:last-child{border-bottom:none}
  .iss-item:hover,.iss-item.open{background:var(--surface-1)}
  .iss-bar{flex-shrink:0;width:8px;height:8px;border-radius:50%;margin-top:6px}
  .iss-bar.high{background:var(--high)}
  .iss-bar.medium{background:var(--medium)}
  .iss-bar.low{background:var(--low)}
  .iss-body{flex:1;min-width:0}
  .iss-top{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
  .iss-type{font-size:14px;font-weight:500;color:var(--text-1);flex:1}
  .iss-sev{flex-shrink:0;font-size:11px;font-weight:600;padding:1px 8px;border-radius:var(--radius-xl);text-transform:capitalize}
  .iss-sev.high{background:var(--high-bg);color:var(--high)}
  .iss-sev.medium{background:var(--medium-bg);color:var(--medium)}
  .iss-sev.low{background:var(--low-bg);color:var(--low)}
  .iss-url{font-family:var(--font-mono);font-size:11.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px}
  .iss-detail{font-size:13px;color:var(--text-2);line-height:1.45}
  .iss-fix{display:inline-block;margin-top:6px;font-size:11px;font-weight:500;padding:1px 8px;border-radius:var(--radius-xl);background:var(--surface-2);color:var(--text-2)}
  .iss-fix.deterministic{color:var(--success);background:var(--success-bg)}
  .iss-fix.ai-proposed{color:var(--text-1);background:var(--accent-dim)}
  .iss-chv{flex-shrink:0;color:var(--text-3);transition:transform var(--t);margin-top:3px}
  .iss-chv svg{width:14px;height:14px;display:block}
  .iss-item.open .iss-chv{transform:rotate(180deg)}

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
  .ans ul{margin:4px 0 0 18px}.ans li{margin:2px 0}
  .cites{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .cite{border:1px solid var(--border-mid);background:var(--bg);border-radius:var(--radius-xl);font-size:11.5px;padding:2px 9px;cursor:pointer;color:var(--text-1)}
  .cite:hover{background:var(--accent-dim)}
  .typing{display:inline-flex;gap:4px}.typing i{width:6px;height:6px;border-radius:50%;background:var(--text-3);animation:pulse 1s infinite}
  .typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
  .fix-row{border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-top:6px;background:var(--bg);font-size:13px}
  .fix-from{color:var(--high);text-decoration:line-through;text-decoration-color:rgba(215,0,21,.35);overflow-wrap:anywhere}
  .fix-to{color:var(--success);font-weight:500;margin-top:2px;overflow-wrap:anywhere}
  .fix-why{color:var(--text-3);font-size:12px;margin-top:3px}
  .iss-item.flash{box-shadow:inset 3px 0 0 var(--accent)}
  .ai-status{display:block;margin-top:6px}
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
    #input-area{padding:8px 12px 12px}
    .msg-bbl{max-width:85%}
    #empty-state{padding-top:48px}
  }
`;

// String.raw keeps backslash escapes in the inline script (\', \n, \d, \b) intact.
const HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SiteFix — Website Audit Agent</title>
  <meta name="description" content="SiteFix is an internal website audit agent that inspects any client site, runs deterministic detectors, and presents findings in a clean, structured report." />
  <style>${CSS}</style>
</head>
<body>
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
    <button class="new-btn" id="new-btn" aria-label="New inspection">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
      New inspection
    </button>
    <div class="sidebar-section">Inspections <button class="hist-clear" id="hist-clear" type="button" hidden>Delete all</button></div>
    <div class="history-list" id="hist" aria-label="Inspection history">
      <div class="hist-empty">Loading&hellip;</div>
    </div>
    <div class="sidebar-footer">
      Phase 1 &middot; Detection only<br/>
      <span class="ai-status" id="ai-status">AI: checking&hellip;</span>
      <span class="ver-badge">v0.6 &middot; Day 10/12</span>
    </div>
  </aside>

  <main id="main">
    <div id="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" title="Past inspections" aria-label="Past inspections">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 6h13M3.5 10h13M3.5 14h13"/></svg>
      </button>
      <div class="tb-center">
        <div class="tb-av" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg></div>
        <div class="tb-name">SiteFix</div>
        <div id="tb-title">Website audit agent</div>
      </div>
      <button class="icon-btn" id="clear-btn" title="New inspection" aria-label="New inspection">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5H5.5a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2V11"/><path d="M14.6 2.9a1.4 1.4 0 012 2L10 11.5 7.5 12.5l1-2.5z"/></svg>
      </button>
    </div>

    <div id="chat-area" role="log" aria-live="polite" aria-label="Inspection conversation">
      <div class="chat-inner" id="chat-inner">
        <div id="empty-state">
          <div class="empty-av" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg></div>
          <h1 class="empty-title">SiteFix</h1>
          <p class="empty-desc">Send a website URL and I&rsquo;ll crawl it, run the detectors and report every issue I find, with evidence.</p>
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
        <input type="text" id="url-input" placeholder="Website URL"
          autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="send"
          aria-label="Website URL to inspect" aria-describedby="inp-hint" autofocus/>
        <button id="inspect-btn" aria-label="Start inspection" title="Inspect">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>
          <span class="sr-only">Inspect site</span>
        </button>
      </div>
      <div class="inp-hint" id="inp-hint">
        <span id="inp-err" role="alert"></span>
        <span id="inp-ok">Paste a URL to inspect it, or ask about the last report &middot; try the fixture:
          <span class="url-chip" id="fixture-chip" role="button" tabindex="0" title="Inspect the local fixture site">localhost:4000</span>
        </span>
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

S('#fixture-chip').addEventListener('click',()=>{if(running)return;urlIn.value='http://localhost:4000/';start();});

function validateUrl(r){
  const s=r.trim();
  if(!s)return{ok:false,msg:'Please enter a URL.'};
  const local=/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(s);
  let u;try{u=new URL(/^https?:\/\//i.test(s)?s:(local?'http://':'https://')+s);}catch{return{ok:false,msg:'Not a valid URL.'};}
  if(!['http:','https:'].includes(u.protocol))return{ok:false,msg:'Only http:// or https:// supported.'};
  return{ok:true,url:u.href};
}
urlIn.addEventListener('keydown',e=>{if(e.key==='Enter'&&!running)submit();});
urlIn.addEventListener('input',()=>{urlIn.classList.remove('invalid');inpErr.style.display='none';inpOk.style.display='';syncBtn();});
function syncBtn(){inspBtn.disabled=running||!urlIn.value.trim();if(typeof syncHistButtons==='function'&&hist)syncHistButtons();}
syncBtn();
inspBtn.addEventListener('click',()=>{if(!running)submit();});
// One box for both: a URL starts an inspection, anything else is a question about the last report.
function looksLikeUrl(s){s=s.trim();return !/\s/.test(s)&&(/^https?:\/\//i.test(s)||/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(s)||/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s));}
function submit(){const v=urlIn.value.trim();if(!v)return;if(looksLikeUrl(v))start();else ask(v);}
fetch('/api/ai-status').then(r=>r.json()).then(a=>{S('#ai-status').textContent=a.enabled?'AI: on ('+a.model+')':'AI: off \u2014 add a key to .env';}).catch(()=>{S('#ai-status').textContent='AI: unknown';});
S('#clear-btn').addEventListener('click',()=>{if(!running)clear();});
S('#new-btn').addEventListener('click',()=>{if(running)return;clear();closeSide();urlIn.focus();});
S('#menu-btn').addEventListener('click',()=>document.body.classList.toggle('show-side'));
function closeSide(){document.body.classList.remove('show-side');}
document.addEventListener('click',e=>{if(document.body.classList.contains('show-side')&&!e.target.closest('#sidebar,#menu-btn'))closeSide();});

function clear(){current=null;store.set(null);markActive();urlIn.placeholder='Website URL';chatIn.innerHTML='';chatIn.appendChild(empty);empty.style.display='';tbTitle.textContent='Website audit agent';lastTs=0;urlIn.value='';urlIn.classList.remove('invalid');inpErr.style.display='none';inpOk.style.display='';running=false;syncBtn();}

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

const DETS=[{id:'links',lbl:'Links & HTTP'},{id:'redirect',lbl:'Redirects'},{id:'images',lbl:'Images'},{id:'metadata',lbl:'SEO & tags'},{id:'content',lbl:'Content'},{id:'soft404',lbl:'Soft 404s'},{id:'registry',lbl:'Issue registry'},{id:'ai',lbl:'Explanations'},{id:'pdf',lbl:'PDF report'}];

function buildProg(url){
  const c=el('div','prog-card');
  c.innerHTML='<div class="prog-hdr"><div class="spin" id="ps"></div><div><div class="prog-title">Inspection running&hellip;</div><div class="prog-sub" id="psub">Crawling <span style="font-family:var(--font-mono);font-size:11px">'+esc(url)+'</span></div></div></div>'+'<div class="prog-log" id="plog" role="log"></div>'+'<div class="det-list">'+DETS.map(d=>'<div class="det-pill" id="pill-'+d.id+'"><span class="pdot"></span>'+esc(d.lbl)+'</div>').join('')+'</div>';
  return c;
}
function logLine(c,line){
  const log=S('#plog',c),d=el('div','log-line');
  if(/^\s*(crawling|checking|following)\b/i.test(line))d.classList.add('ok');
  else if(/summary|done\.|issue registry|===/i.test(line))d.classList.add('hl');
  else if(/warning|error/i.test(line))d.classList.add('err2');
  else if(/broken|404|loop|chain/i.test(line))d.classList.add('warn');
  d.textContent=line;log.appendChild(d);log.scrollTop=log.scrollHeight;
}
function setPill(c,id,st){const p=S('#pill-'+id,c);if(p)p.className='det-pill '+st;}
function progDone(c,reg){
  const sp=S('#ps',c),sb=S('#psub',c);
  if(sp)sp.classList.add('done');
  if(sb)sb.innerHTML='Completed &middot; '+reg.counts.total+' issue'+(reg.counts.total!==1?'s':'')+' found';
  DETS.forEach(d=>setPill(c,d.id,'done'));
}
function progErr(c,msg){const sp=S('#ps',c),sb=S('#psub',c);if(sp)sp.classList.add('err');if(sb)sb.innerHTML='<span style="color:var(--high)">Error: '+esc(msg)+'</span>';}

async function streamSSE(runId,card){
  return new Promise(res=>{
    const es=new EventSource('/api/stream/'+runId);
    es.addEventListener('message',e=>{
      const{line}=JSON.parse(e.data);
      if(line.startsWith('__DONE__:')){es.close();res(Number(line.slice(9)));return;}
      if(line.startsWith('__REPORT__:')){card.dataset.report=line.slice(11);return;}
      if(line.startsWith('__SAVED__:')){card.dataset.saved=line.slice(10);return;}
      logLine(card,line);
      if(/checking \d+ distinct links/i.test(line))setPill(card,'links','running');
      else if(/following \d+ redirect/i.test(line))setPill(card,'redirect','running');
      else if(/checking \d+ distinct images/i.test(line)){setPill(card,'links','done');setPill(card,'redirect','done');setPill(card,'images','running');}
      else if(/=== seo, social/i.test(line)){setPill(card,'links','done');setPill(card,'redirect','done');setPill(card,'images','done');setPill(card,'metadata','running');}
      else if(/=== content/i.test(line)){setPill(card,'metadata','done');setPill(card,'content','running');}
      else if(/soft 404/i.test(line)){setPill(card,'metadata','done');setPill(card,'content','done');setPill(card,'soft404','running');}
      else if(/issue registry/i.test(line)){setPill(card,'soft404','done');setPill(card,'registry','running');}
      else if(/done\. see issues/i.test(line))setPill(card,'registry','done');
      else if(/=== ai explanations/i.test(line)){setPill(card,'registry','done');setPill(card,'ai','running');}
      else if(/=== screenshots/i.test(line)){setPill(card,'ai','done');setPill(card,'pdf','running');}
      else if(/^report ready/i.test(line))setPill(card,'pdf','done');
      scroll();
    });
    es.addEventListener('error',()=>{es.close();res(-1);});
  });
}

async function start(){
  const v=validateUrl(urlIn.value);
  if(!v.ok){urlIn.classList.add('invalid');inpErr.textContent=v.msg;inpErr.style.display='inline';inpOk.style.display='none';return;}
  // Each inspection gets its own conversation: leave the one on screen (it stays in the list).
  if(current||chatIn.querySelector('.prog-card'))clear();
  running=true;inspBtn.disabled=true;urlIn.classList.remove('invalid');inpErr.style.display='none';syncHistButtons();
  const siteUrl=v.url;
  urlIn.value='';syncBtn();
  tbTitle.textContent=siteUrl;
  addMsg('user',esc(siteUrl));
  addMsg('agent','On it. I\'ll crawl the site, run the detectors and report what I find.');
  const prog=buildProg(siteUrl);
  if(empty.parentNode===chatIn)empty.style.display='none';
  chatIn.appendChild(prog);scroll();
  let runId;
  try{
    const r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:siteUrl})});
    const d=await r.json();
    if(!r.ok||!d.runId)throw new Error(d.error||'Failed to start crawl');
    runId=d.runId;
  }catch(e){
    progErr(prog,e.message);
    addMsg('agent','<span style="color:var(--high)">&#9888; Could not start the crawler: '+esc(e.message)+'</span><br><span style="font-size:12.5px;color:var(--text-2)">Make sure the UI server is running (<code style="font-family:var(--font-mono)">node ui/server.js</code>) and Playwright is installed.</span>');
    running=false;syncBtn();return;
  }
  const code=await streamSSE(runId,prog);
  try{
    if(code!==0)throw new Error('crawler exited with code '+code+' (see the log above)');
    const r=await fetch('/api/results?runId='+encodeURIComponent(runId));
    const reg=await r.json();
    if(!r.ok)throw new Error(reg.error||'issues.json not found');
    let report=null;
    if(prog.dataset.report==='0'){try{const rr=await fetch('/api/report');if(rr.ok)report=await rr.json();}catch{}}
    progDone(prog,reg);
    if(!report&&prog.dataset.report!==undefined)setPill(prog,'ai','err'),setPill(prog,'pdf','err');
    const savedId=prog.dataset.saved||null;
    renderResults(reg,siteUrl,report,savedId);
    if(savedId)store.set(savedId);
    await loadHistory();
  }catch(e){
    progErr(prog,'Could not load results: '+e.message);
    addMsg('agent','<span style="color:var(--high)">&#9888; Could not read results: '+esc(e.message)+'</span>');
  }
  running=false;syncBtn();
}

const PRI={P1:0,P2:1,P3:2};
// id: the saved inspection (history/<id>); its PDF and screenshots are served from there.
function renderResults(reg,siteUrl,report,id,meta){
  // Merge the explained report (priority, explanation, fix) into each issue when it exists.
  const extra=new Map(),typeInfo=new Map();
  if(report)for(const t of report.types){typeInfo.set(t.type,t);for(const i of t.issues)extra.set(i.id,i);}
  const issues=(reg.issues||[]).map(i=>({...i,...(extra.get(i.id)||{}),_type:typeInfo.get(i.type)||null}));
  const base=id?'/api/history/'+encodeURIComponent(id)+'/':'/api/';
  current={id:id||null,byId:new Map(issues.map(i=>[i.id,i])),report,base,hasPdf:meta?meta.hasPdf:Boolean(report)};
  markActive();
  const run=reg.run||{},counts=reg.counts||{},bySev=counts.bySeverity||{};
  const cats=[...new Set(issues.map(i=>i.category))];
  chatIn.appendChild(buildSummaryCard(siteUrl,run,counts,bySev,cats,report,current));scroll();
  urlIn.placeholder='Ask about this report, or paste another URL';
  if(!issues.length){addMsg('agent','<span style="color:var(--success)">&#10003; No issues detected.</span> The site looks clean based on the detectors that ran.');return;}
  const s=report&&report.summary;
  addMsg('agent','Done. I found <strong>'+counts.total+' issue'+(counts.total!==1?'s':'')+'</strong> in '+cats.length+' categor'+(cats.length!==1?'ies':'y')+(s?' &middot; <strong>'+s.byPriority.P1+'</strong> to fix first, '+s.quickWins+' quick win'+(s.quickWins!==1?'s':''):'')+'. Open a category to see its issues, or ask me anything about this report.');
  const grouped=groupBy(issues,i=>i.category);
  const order=['HTTP and URLs','Images','Soft 404s','SEO: indexing','SEO: titles & descriptions','Content','Social sharing','Page setup'];
  const sorted=[...order.filter(c=>grouped[c]),...Object.keys(grouped).filter(c=>!order.includes(c))];
  const wrap=el('div','issue-list');
  sorted.forEach(cat=>wrap.appendChild(buildGrp(cat,grouped[cat].sort((a,b)=>(PRI[a.priority]??3)-(PRI[b.priority]??3)))));
  chatIn.appendChild(wrap);scroll();
}

function buildSummaryCard(siteUrl,run,counts,bySev,cats,report,cur){
  const pdfOk=report&&cur.hasPdf;
  const card=el('div','rpt-card');
  const sa=run.startedAt?new Date(run.startedAt):null,fa=run.finishedAt?new Date(run.finishedAt):null;
  const dur=sa&&fa?Math.round((fa-sa)/1000):null;
  const catMap={'HTTP and URLs':'Links & Redirects','Soft 404s':'Soft 404 detector','SEO: indexing':'Canonical & robots','SEO: titles & descriptions':'Titles & headings','Social sharing':'Open Graph','Page setup':'Viewport & language','Images':'Image checks','Content':'Content checks'};
  card.innerHTML=
    '<div class="rpt-hdr">'+
      '<div class="rpt-sicon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="#515154" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M2 7h16"/><circle cx="5.5" cy="5" r=".8" fill="black" stroke="none"/><circle cx="8" cy="5" r=".8" fill="black" stroke="none"/></svg></div>'+
      '<div class="rpt-info"><div class="rpt-url" title="'+esc(siteUrl)+'">'+esc(siteUrl)+'</div><div class="rpt-meta">'+(run.pagesCrawled?run.pagesCrawled+' pages crawled':'')+( run.pagesCrawled&&sa?' &middot; ':'')+( sa?sa.toLocaleString():'')+( dur?' &middot; '+dur+'s':'')+( run.capReached?' &middot; <span style="color:var(--medium)">page cap reached</span>':'')+' </div></div>'+
      '<div class="rpt-badge">'+( counts.total>0?counts.total+' issue'+(counts.total!==1?'s':''):'Clean')+'</div>'+
    '</div>'+
    '<div class="rpt-counts">'+
      '<div class="cnt-cell"><div class="cnt-num high">'+(bySev.high||0)+'</div><div class="cnt-lbl">High</div></div>'+
      '<div class="cnt-cell"><div class="cnt-num medium">'+(bySev.medium||0)+'</div><div class="cnt-lbl">Medium</div></div>'+
      '<div class="cnt-cell"><div class="cnt-num low">'+(bySev.low||0)+'</div><div class="cnt-lbl">Low</div></div>'+
      '<div class="cnt-cell"><div class="cnt-num">'+(counts.total||0)+'</div><div class="cnt-lbl">Total</div></div>'+
    '</div>'+
    (report?'<div class="rpt-pri"><span class="lbl">Priority</span><span class="chip P1">P1 fix first &middot; '+report.summary.byPriority.P1+'</span><span class="chip P2">P2 fix soon &middot; '+report.summary.byPriority.P2+'</span><span class="chip P3">P3 when you can &middot; '+report.summary.byPriority.P3+'</span><span class="chip qw">Quick wins &middot; '+report.summary.quickWins+'</span></div>':'')+
    '<div class="rpt-dets">'+cats.map(c=>'<span class="det-tag"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="2,5 4.5,7.5 8.5,2"/></svg>'+esc(catMap[c]||c)+'</span>').join('')+'</div>'+
    '<div class="rpt-actions">'+
      '<a class="btn primary" href="'+esc(cur.base)+'report.pdf" target="_blank" rel="noopener"'+(pdfOk?'':' aria-disabled="true"')+'><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6z"/><path d="M9 2v4h4"/></svg>Open PDF report</a>'+
      (report?'<span class="rpt-meta" style="align-self:center">'+(report.ai.provider!=='none'?'Explained by AI ('+esc(report.ai.model)+')':'Standard guidance (AI off)')+'</span>':'<span class="rpt-meta" style="align-self:center">PDF report not available for this run</span>')+
    '</div>';
  return card;
}

function buildGrp(cat,issues){
  const grp=el('div','issue-grp collapsed'); // collapsed until the user opens it
  const worstSev=issues.reduce((s,i)=>{if(i.severity==='high')return 'high';if(i.severity==='medium'&&s!=='high')return 'medium';return s;},'low');
  const col={high:'var(--high)',medium:'var(--medium)',low:'var(--low)'}[worstSev];
  const hdr=el('div','grp-hdr');
  hdr.setAttribute('role','button');hdr.setAttribute('aria-expanded','false');hdr.setAttribute('tabindex','0');
  hdr.innerHTML='<svg style="width:15px;height:15px;flex-shrink:0;color:'+col+'" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'+catIcon(cat)+'</svg><span class="grp-lbl">'+esc(cat)+'</span><span class="grp-cnt">'+issues.length+'</span><span class="grp-chv"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3,5 7,9 11,5"/></svg></span>';
  hdr.addEventListener('click',()=>toggleGrp(grp,hdr));
  hdr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleGrp(grp,hdr);}});
  const body=el('div','grp-body');
  issues.forEach(iss=>{const{item,ev}=buildItem(iss);body.appendChild(item);body.appendChild(ev);});
  grp.appendChild(hdr);grp.appendChild(body);
  return grp;
}
function toggleGrp(grp,hdr){const x=!grp.classList.contains('collapsed');grp.classList.toggle('collapsed',x);hdr.setAttribute('aria-expanded',String(!x));}

function buildItem(iss){
  const item=el('div','iss-item');
  item.dataset.id=iss.id;
  item.setAttribute('role','button');item.setAttribute('tabindex','0');item.setAttribute('aria-expanded','false');
  const fcLabel={deterministic:'Auto-fixable','ai-proposed':'AI-proposable','not-automatable':'Manual'}[iss.fixClass]||iss.fixClass;
  item.innerHTML=
    '<div class="iss-bar '+iss.severity+'" aria-hidden="true"></div>'+
    '<div class="iss-body">'+
      '<div class="iss-top"><div class="iss-type">'+esc(issueLabel(iss.type))+'</div><span class="iss-sev '+iss.severity+'">'+iss.severity+'</span></div>'+
      '<div class="iss-url" title="'+esc(iss.affectedUrl)+'">'+esc(iss.affectedUrl)+'</div>'+
      '<div class="iss-detail">'+esc(iss.detail)+'</div>'+
      (iss.priority?'<span class="chip '+iss.priority+'" title="'+esc(iss.priorityReason||'')+'">'+iss.priority+'</span><span class="chip">'+esc(iss.effort)+' fix</span><span class="chip">'+esc(iss.owner)+'</span>'+(iss.quickWin?'<span class="chip qw">Quick win</span>':''):'<span class="iss-fix '+iss.fixClass+'">'+esc(fcLabel)+'</span>')+
    '</div>'+
    '<span class="iss-chv" aria-hidden="true"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3,5 7,9 11,5"/></svg></span>';
  const ev=buildEvidence(iss);
  item.addEventListener('click',()=>toggleItem(item));
  item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleItem(item);}});
  return{item,ev};
}
function toggleItem(item){const x=item.classList.contains('open');item.classList.toggle('open',!x);item.setAttribute('aria-expanded',String(!x));}

function buildEvidence(iss){
  const div=el('div','iss-ev'),ev=iss.evidence||{};
  let h='<div class="ev-title">Evidence</div>';
  if(ev.kind==='http'){h+='<div class="ev-pre">HTTP status: '+esc(ev.status??'unknown')+'</div>';}
  else if(ev.kind==='redirect'){
    if(ev.hops!==undefined)h+='<div class="ev-row"><span class="ev-k">Hops</span><span class="ev-v">'+ev.hops+'</span></div>';
    if(ev.finalUrl)h+='<div class="ev-row"><span class="ev-k">Final URL</span><span class="ev-v">'+esc(ev.finalUrl)+'</span></div>';
    if(ev.finalStatus)h+='<div class="ev-row"><span class="ev-k">Final status</span><span class="ev-v">'+ev.finalStatus+'</span></div>';
    if(ev.chain&&ev.chain.length){h+='<div class="ev-row"><span class="ev-k">Chain</span><div class="ev-chain">'+ev.chain.map((u,i)=>'<span class="chain-u">'+esc(u)+'</span>'+(i<ev.chain.length-1?'<span class="chain-a">&rarr;</span>':'')).join('')+'</div></div>';}
  }else if(ev.kind==='head'){
    // Show only the tags that matter for this issue's category.
    const hd=ev.head||{},cat=iss.category||'',none='<em style="color:var(--text-3)">none</em>';
    const row=(k,v)=>'<div class="ev-row"><span class="ev-k">'+k+'</span><span class="ev-v">'+v+'</span></div>';
    const val=(v)=>v?esc(v):none;
    if(cat.startsWith('SEO: titles')){
      h+=row('Title',val(hd.title))+row('Description',val(hd.description));
      if(hd.h1s&&hd.h1s.length)h+=row('H1',hd.h1s.map(esc).join(', '));
      if(iss.type==='heading-skip'&&hd.headings&&hd.headings.length)h+=row('Outline','<div class="ev-outline">'+hd.headings.slice(0,30).map(x=>'<div style="padding-left:'+((x.level-1)*14)+'px"><b>H'+x.level+'</b> '+esc(x.text)+'</div>').join('')+'</div>');
      if(ev.rawHead&&!ev.rawSameAsRendered)h+=row('JS change','<span style="color:var(--medium)">Tags differ in raw HTML vs rendered &mdash; JS-only</span>');
      if(ev.rawSameAsRendered)h+=row('JS change','<span style="color:var(--text-3)">None (raw HTML matches rendered)</span>');
    }else if(cat==='SEO: indexing'){
      h+=row('Canonical',hd.canonicals&&hd.canonicals.length?hd.canonicals.map(esc).join(', '):none);
      if(ev.canonicalCheck)h+=row('Canon. status',esc(ev.canonicalCheck.status??'unknown')+' ('+esc(ev.canonicalCheck.classification)+')');
      h+=row('Robots meta',val(hd.robots));
    }else if(cat==='Social sharing'){
      const og=hd.og||{},tw=hd.twitter||{};
      for(const k of ['og:title','og:description','og:image'])h+=row(k,val(og[k]));
      const extra=Object.keys(og).filter(k=>!['og:title','og:description','og:image'].includes(k));
      if(extra.length)h+=row('Other og:',extra.map(k=>esc(k)+' = '+esc(og[k])).join('<br>'));
      if(Object.keys(tw).length)h+=row('Twitter/X',Object.keys(tw).map(k=>esc(k)+' = '+esc(tw[k])).join('<br>'));
    }else if(cat==='Page setup'){
      h+=row('Viewport',val(hd.viewport))+row('&lt;html lang&gt;',val(hd.lang));
    }
  }else if(ev.kind==='soft-404'){
    if(ev.title)h+='<div class="ev-row"><span class="ev-k">Title</span><span class="ev-v">'+esc(ev.title)+'</span></div>';
    if(ev.wordCount!=null)h+='<div class="ev-row"><span class="ev-k">Word count</span><span class="ev-v">'+ev.wordCount+'</span></div>';
    if(ev.reachedOnlyThroughRedirects)h+='<div class="ev-row"><span class="ev-k">Access</span><span class="ev-v" style="color:var(--medium)">Only reachable through redirects</span></div>';
    if(ev.signals&&ev.signals.length){h+='<div class="ev-title" style="margin-top:10px">Signals</div><div class="ev-pre">'+ev.signals.map(s=>(s.strength==='strong'?'&#9733;':'&middot;')+' ['+s.strength+'] '+esc(s.detail)).join('\n')+'</div>';}
  }else if(ev.kind==='site-check'){h+='<div class="ev-pre">'+esc(ev.detail)+'</div>';}
  else if(ev.kind==='content'){
    const row=(k,v)=>'<div class="ev-row"><span class="ev-k">'+k+'</span><span class="ev-v">'+v+'</span></div>';
    h+=row('Words on page',esc(ev.words)+' <span style="color:var(--text-3)">('+esc(ev.mainWords)+' after removing menus and footers)</span>');
    if(ev.similarTo&&ev.similarTo.length)h+=row('Similar pages',ev.similarTo.map(x=>'<b>'+Math.round(x.similarity*100)+'%</b> '+esc(x.url)).join('<br>'));
    if(ev.matches&&ev.matches.length&&ev.matches[0].correction!==undefined){
      h+='<div class="ev-title" style="margin-top:10px">Found in the page text</div>'+ev.matches.map(x=>'<div class="fix-row"><div class="fix-from">&ldquo;'+esc(x.text)+'&rdquo;</div><div class="fix-to">&rarr; &ldquo;'+esc(x.correction)+'&rdquo;</div>'+(x.explanation?'<div class="fix-why">'+esc(x.explanation)+(x.source==='dictionary'?' (common misspelling)':'')+'</div>':'')+(x.alsoOn&&x.alsoOn.length?'<div class="fix-why">Same text on '+x.alsoOn.length+' other page'+(x.alsoOn.length===1?'':'s')+', fixing it once fixes all of them.</div>':'')+'</div>').join('');
    }else if(ev.matches&&ev.matches.length)h+='<div class="ev-title" style="margin-top:10px">Found in the page text</div><div class="ev-pre">'+ev.matches.map(x=>(x.name?esc(x.name)+': ':'')+'&ldquo;'+esc(x.text)+'&rdquo;').join('\n')+'</div>';
  }
  else if(ev.kind==='image'){
    const row=(k,v)=>'<div class="ev-row"><span class="ev-k">'+k+'</span><span class="ev-v">'+v+'</span></div>';
    if(ev.status!==null&&ev.status<400&&/^https?:/.test(ev.src))h+='<img class="ev-img" src="'+esc(ev.finalUrl||ev.src)+'" alt="" loading="lazy">';
    h+=row('Image',esc(ev.src));
    if(ev.usedAs)h+=row('Used as',esc(ev.usedAs)+' (the preview image when the page is shared)');
    if(ev.finalUrl)h+=row('Redirects to',esc(ev.finalUrl));
    h+=row('Status',ev.status===null?'<em style="color:var(--text-3)">no response</em>':esc(ev.status));
    if(ev.bytes)h+=row('File size',esc(ev.bytes>=1048576?(ev.bytes/1048576).toFixed(1)+' MB':ev.bytes>=1024?Math.round(ev.bytes/1024)+' KB':ev.bytes+' bytes'));
    if(ev.contentType)h+=row('Type',esc(ev.contentType));
    if('alt' in ev)h+=row('Alt text',ev.alt===null?'<em style="color:var(--text-3)">none (no alt attribute)</em>':ev.alt.map(a=>'&ldquo;'+esc(a)+'&rdquo;'+(a.length>60?' <span style="color:var(--text-3)">('+a.length+' chars)</span>':'')).join('<br>'));
    h+=row('Used on',ev.pages+' page'+(ev.pages!==1?'s':''));
  }
  if(iss.foundOn&&iss.foundOn.length){h+='<div class="found-on"><div class="fo-title">Found on '+iss.foundOn.length+' page'+(iss.foundOn.length!==1?'s':'')+'</div>'+iss.foundOn.slice(0,5).map(u=>'<div class="fo-url">'+esc(u)+'</div>').join('')+(iss.foundOn.length>5?'<div class="fo-url" style="color:var(--text-3)">&hellip; and '+(iss.foundOn.length-5)+' more</div>':'')+' </div>';}
  if(iss.explanation){
    const t=iss._type||{};
    let a='<div class="ai-box"><div class="ai-k">In plain words</div><div class="ai-v">'+esc(iss.explanation)+'</div>';
    if(t.why)a+='<div class="ai-k">Why it matters</div><div class="ai-v">'+esc(t.why)+'</div>';
    if(t.fixSteps&&t.fixSteps.length)a+='<div class="ai-k">How to fix</div><ol class="ai-steps">'+t.fixSteps.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>';
    if(iss.suggestedValue)a+='<div class="ai-k">'+esc(t.valueLabel||'Suggested value')+'</div><div class="val-box"><span class="v">'+esc(iss.suggestedValue)+'</span><button class="copy" type="button" data-copy="'+esc(iss.suggestedValue)+'">Copy</button></div>';
    if(iss.screenshot){const src=(current?current.base:'/api/')+iss.screenshot;a+='<div class="ai-k">Screenshot</div><a href="'+esc(src)+'" target="_blank" rel="noopener"><img class="ev-shot" src="'+esc(src)+'" alt="" loading="lazy"></a>';}
    a+='<div class="ai-src">'+(iss.explanationSource==='ai'?'Written by AI from this evidence and checked automatically':'SiteFix standard guidance')+' &middot; priority: '+esc(iss.priorityReason||iss.priority)+'</div></div>';
    h=a+h;
  }else{
    h+='<div class="ai-ph"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 4.5v2.5l1.5 1.5"/></svg>Explanation and fix appear here once the report step has run</div>';
  }
  div.innerHTML=h;return div;
}

function issueLabel(t){
  const m={'http-4xx-internal':'Internal link returns 4xx','http-4xx-external':'External link returns 4xx','link-unreachable':'Link unreachable','redirect-loop':'Redirect loop','redirect-chain':'Redirect chain','redirect-to-error':'Redirect ends in error','https-missing-redirect':'HTTP \u2192 HTTPS redirect missing','www-variant-not-redirected':'www/non-www not unified','soft-404':'Soft 404 (false 200 OK)','title-missing':'Missing <title> tag','title-multiple':'Multiple <title> tags','title-too-long':'Title too long','title-too-short':'Title too short','title-duplicate':'Duplicate title','description-missing':'Missing meta description','description-multiple':'Multiple meta descriptions','description-too-long':'Meta description too long','description-too-short':'Meta description too short','description-duplicate':'Duplicate meta description','h1-missing':'Missing H1','h1-multiple':'Multiple H1 tags','metadata-js-only':'Metadata only available after JS','canonical-missing':'Missing canonical tag','canonical-multiple':'Multiple canonical tags','canonical-broken-target':'Canonical points to broken URL','canonical-redirect':'Canonical points to redirect','image-broken':'Broken image','image-alt-missing':'Image has no alt text','image-alt-unhelpful':'Alt text does not describe the image','image-alt-too-long':'Alt text too long','image-mixed-content':'HTTP image on an HTTPS page','image-oversized':'Image file too large','heading-skip':'Heading levels skip','robots-noindex':'Hidden from search (noindex)','robots-nofollow':'Links not followed (nofollow)','og-missing':'No Open Graph tags','og-incomplete':'Open Graph tags incomplete','og-image-broken':'Share image broken','viewport-missing':'No viewport tag (not mobile-friendly)','lang-missing':'No page language set','content-thin':'Thin page (little text)','content-duplicate':'Near-duplicate page','content-placeholder':'Placeholder text on a live page','content-repeated-word':'Repeated word','copy-spelling':'Spelling mistakes','copy-grammar':'Grammar mistakes'};
  return m[t]||t.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}
function catIcon(c){
  const m={'HTTP and URLs':'<circle cx="7" cy="7" r="5.5"/><path d="M7 4v3.5l2 2"/>','Soft 404s':'<circle cx="7" cy="7" r="5.5"/><path d="M7 4.5v3m0 1.5v.5"/>','SEO: indexing':'<path d="M3 7h8m0 0l-3-3m3 3l-3 3"/><path d="M11 4h1a1 1 0 011 1v4a1 1 0 01-1 1h-1"/>','SEO: titles & descriptions':'<rect x="2" y="3" width="10" height="8" rx="1"/><path d="M5 6h4m-4 2h2"/>','Images':'<rect x="2" y="2.5" width="10" height="9" rx="1.5"/><circle cx="5.2" cy="5.6" r="1"/><path d="M2.5 10.5l3-3 2 2 1.5-1.5 2.5 2.5"/>','Social sharing':'<circle cx="10.5" cy="3.5" r="1.6"/><circle cx="3.5" cy="7" r="1.6"/><circle cx="10.5" cy="10.5" r="1.6"/><path d="M5 6.2l4-2M5 7.8l4 2"/>','Page setup':'<rect x="4" y="1.5" width="6" height="11" rx="1.2"/><path d="M6.3 10.5h1.4"/>','Content':'<path d="M3 3.5h8M3 6h8M3 8.5h8M3 11h5"/>'};
  return m[c]||'<circle cx="7" cy="7" r="5.5"/>';
}
function groupBy(arr,fn){return arr.reduce((a,x)=>{const k=fn(x);if(!a[k])a[k]=[];a[k].push(x);return a;},{});}
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
function answerHtml(d){
  let h='<div class="ans">'+formatAnswer(d.answer||d.error||'No answer.')+'</div>';
  const ids=(d.issueIds||[]).filter(id=>current&&current.byId.has(id));
  if(ids.length)h+='<div class="cites">'+ids.slice(0,8).map(id=>{const i=current.byId.get(id);return '<button class="cite" type="button" data-id="'+esc(id)+'">'+esc(issueLabel(i.type))+' &middot; '+esc(shortPath(i.affectedUrl))+'</button>';}).join('')+'</div>';
  return h;
}
async function ask(q){
  if(!current){addMsg('user',esc(q));addMsg('agent','Inspect a site first, or open a past inspection from the list, then ask me about it.');urlIn.value='';syncBtn();return;}
  urlIn.value='';syncBtn();
  addMsg('user',esc(q));
  const bbl=addMsg('agent','<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>');
  try{
    const r=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,inspectionId:current.id})});
    bbl.innerHTML=answerHtml(await r.json());
  }catch(e){bbl.innerHTML='<span style="color:var(--high)">Could not reach the SiteFix server: '+esc(e.message)+'</span>';}
  scroll();
}
// Open the issue's category and the issue itself, then scroll to it.
function reveal(id){
  const item=[...document.querySelectorAll('.iss-item')].reverse().find(x=>x.dataset.id===id);
  if(!item)return;
  const grp=item.closest('.issue-grp'),hdr=grp&&grp.querySelector('.grp-hdr');
  if(grp&&grp.classList.contains('collapsed'))toggleGrp(grp,hdr);
  if(!item.classList.contains('open'))toggleItem(item);
  item.scrollIntoView({behavior:'smooth',block:'center'});
  item.classList.add('flash');setTimeout(()=>item.classList.remove('flash'),1600);
}
chatIn.addEventListener('click',e=>{
  const c=e.target.closest('.cite');if(c){reveal(c.dataset.id);return;}
  const b=e.target.closest('.copy');
  if(b){e.stopPropagation();navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200);}).catch(()=>{});}
});

// ---------- past inspections (kept by the server in history/) ----------
async function loadHistory(){
  try{const r=await fetch('/api/history');const d=await r.json();if(!r.ok)throw new Error(d.error);history_=d.inspections||[];}
  catch(e){hist.innerHTML='<div class="hist-empty">Could not load past inspections: '+esc(e.message)+'</div>';return;}
  renderHist();
}
const TRASH='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.6a1 1 0 001 .9h4.6a1 1 0 001-.9l.7-8.6"/></svg>';
function renderHist(){
  S('#hist-clear').hidden=history_.length<2;
  if(!history_.length){hist.innerHTML='<div class="hist-empty">No inspections yet. Finished inspections are kept here, even after a reload.</div>';return;}
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
    btn.disabled=running;
    btn.addEventListener('click',()=>openInspection(m.id));
    const del=el('button','h-del',TRASH);del.type='button';
    del.setAttribute('aria-label','Delete inspection of '+(m.host||m.url)+' from '+(m.startedAt?new Date(m.startedAt).toLocaleString():''));
    del.title='Delete this inspection';
    del.disabled=running;
    del.addEventListener('click',e=>{e.stopPropagation();twoStep(del,'Delete',()=>removeInspection(m.id));});
    row.appendChild(btn);row.appendChild(del);hist.appendChild(row);
  });
  markActive();
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
  await loadHistory();
}
S('#hist-clear').addEventListener('click',e=>{const b=e.currentTarget;if(running)return;twoStep(b,'Delete all '+history_.length+'?',async()=>{
  try{const r=await fetch('/api/history',{method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error);}catch(err){alertHist('Could not delete: '+err.message);return;}
  b.classList.remove('confirm');b.textContent='Delete all';
  if(current&&current.id)clear();
  await loadHistory();
});});
function alertHist(msg){const n=el('div','hist-empty');n.style.color='var(--high)';n.textContent=msg;hist.prepend(n);setTimeout(()=>n.remove(),4000);}

async function openInspection(id){
  if(running)return;
  closeSide();
  let saved;
  try{const r=await fetch('/api/history/'+encodeURIComponent(id));saved=await r.json();if(!r.ok)throw new Error(saved.error);}
  catch(e){alertHist('Could not open: '+e.message);if(store.get()===id)store.set(null);await loadHistory();return;}
  clear();
  const{meta,registry,report,chat}=saved,url=meta.url||registry.run?.startUrl||'';
  store.set(id);
  tbTitle.textContent=url;
  addMsg('user',esc(url),meta.startedAt);
  renderResults(registry,url,report,id,meta);
  for(const c of chat){addMsg('user',esc(c.question),c.at);addMsg('agent',answerHtml(c),c.at);}
  // Start at the top of the inspection (addMsg scrolls to the bottom on the next frame).
  requestAnimationFrame(()=>requestAnimationFrame(()=>{chatA.style.scrollBehavior='auto';chatA.scrollTop=0;chatA.style.scrollBehavior='';}));
}
function syncHistButtons(){hist.querySelectorAll('.history-item,.h-del').forEach(b=>{b.disabled=running;});S('#hist-clear').disabled=running;}

// On load: list past inspections and reopen the one that was open before the reload.
loadHistory().then(()=>{const id=store.get();if(id&&history_.some(m=>m.id===id))openInspection(id);});
</script>
</body>
</html>`;

writeFileSync(out, HTML, "utf-8");
console.log("Written:", out);
