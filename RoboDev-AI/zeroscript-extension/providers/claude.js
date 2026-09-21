// SPDX-License-Identifier: GPL-3.0-or-later
// providers/claude.js - the Claude (claude.ai, Anthropic) provider.
// Exports the same ZSProvider interface as providers/deepseek.js, chatgpt.js, etc.
// The core (core/main.js) is provider-agnostic.
//
// Claude AI DOM notes:
//  - React app. Messages are grouped in a conversation flow container.
//    Turns are identified by [data-testid="user-message"] and assistant message containers
//    (e.g. .font-claude-message, [data-is-streaming], [data-testid="assistant-message"]).
//  - ProseMirror contenteditable editor: [contenteditable="true"].ProseMirror or
//    div[contenteditable="true"] in the composer area.
//  - Send control: button[aria-label*="Send" i] or button[data-testid="send-button"].
//  - Generating state: Stop button with button[aria-label*="Stop" i] or button[data-testid="stop-button"].
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  async function waitFor(pred, timeout = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
      await sleep(120);
    }
    return false;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent !== null) return true;
    try {
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: false })) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }

  const S = {
    // Turns
    userItem: '[data-testid="user-message"], .font-user-message, [data-message-author="user"]',
    assistantItem: '.font-claude-message, [data-is-streaming], [data-testid="assistant-message"], [data-message-author="assistant"]',
    anyItem: '[data-testid="user-message"], .font-user-message, .font-claude-message, [data-is-streaming], [data-testid="assistant-message"]',
    reply: '.font-claude-message, [data-testid="assistant-message"], .prose',
    thinking: '[data-testid="thinking-content"], .thinking-container, [class*="thinking"]',
    // Composer
    editor: [
      'div[contenteditable="true"].ProseMirror',
      '.ProseMirror[contenteditable]',
      'div[contenteditable="plaintext-only"].ProseMirror',
      'div[contenteditable="true"]',
      'div[contenteditable="plaintext-only"]',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[contenteditable]',
      '.ProseMirror',
      '[role="textbox"]',
      'p[data-placeholder]',
      'div[data-placeholder]',
      'textarea',
      '[data-testid*="editor"]',
      '[data-testid*="composer"] [contenteditable]',
      'fieldset [contenteditable]',
    ].join(', '),
    composer: 'fieldset, form, div[class*="composer"], div[class*="chat-input"]',
    sendBtn: 'button[aria-label*="Send" i], button[aria-label*="Envoyer" i], button[aria-label*="Kirim" i], button[aria-label*="send message" i], button[data-testid*="send"]',
    stopBtn: 'button[aria-label*="Stop" i], button[aria-label*="Arrêter" i], button[aria-label*="Berhenti" i], button[data-testid*="stop"]',
    codeWrap: "pre, .code-block",
    errorSurfaces: '[role="alert"], [data-testid*="error"], [class*="toast"], [class*="alert"], [class*="error-message"]',
  };

  const RE = {
    contextLimit: new RegExp(
      [
        "conversation.{0,20}(too long|trop long)",
        "context.{0,20}(limit|exceeded|length|d\\u00e9pass\\u00e9)",
        "message limit",
        "free tier limit",
        "please.{0,30}(start|cr\\u00e9er).{0,20}(new|nouveau).{0,20}(chat|conversation)",
        "(token|context).{0,10}limit",
        "maximum.{0,20}context",
      ].join("|"),
      "i"
    ),
    tooLong: /conversation .{0,20}(too long|getting too long|trop longue)|length limit|context window/i,
    busy: /something went wrong|une erreur s.est produite|please try again|try again later|réessayer plus tard|server is busy|rate.?limit|too many requests|capacity/i,
    continueBtn: /^(continue|continuer|continue generating)$/i,
  };

  const timings = {
    GEN_IDLE_MS: 1500,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function isUserItem(item) {
    if (!item) return false;
    if (item.matches && item.matches(S.userItem)) return true;
    if (item.querySelector && item.querySelector(S.userItem)) return true;
    return false;
  }

  function isAssistantItem(item) {
    if (!item) return false;
    if (isUserItem(item)) return false;
    if (item.matches && item.matches(S.assistantItem)) return true;
    if (item.querySelector && item.querySelector(S.assistantItem)) return true;
    return false;
  }

  function allItems() {
    const list = document.querySelectorAll(S.anyItem);
    const result = [];
    for (const el of list) {
      const turn = el.closest('[data-testid="user-message"], .font-user-message, .font-claude-message, [data-testid="assistant-message"]') || el;
      if (!result.includes(turn)) result.push(turn);
    }
    return result;
  }

  function textWithout(root, excludeSel) {
    if (!root) return "";
    let t = "";
    const skip = ".zs-chip" + (excludeSel ? ", " + excludeSel : "");
    const walk = (n) => {
      if (n.nodeType === 3) { t += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(skip)) return;
      if (n.tagName === "BR") { t += "\n"; return; }
      if (n.tagName === "PRE") {
        t += "\n" + (n.textContent || "") + "\n";
        return;
      }
      for (const c of n.childNodes) walk(c);
      if (/^(P|DIV|LI|H[1-6])$/i.test(n.tagName)) t += "\n";
    };
    walk(root);
    return t.replace(/\n{3,}/g, "\n\n");
  }

  function itemText(item) {
    if (!item) return "";
    const md = item.querySelector(S.reply) || item;
    return textWithout(md);
  }

  function classifyText(item, excludeSel) {
    if (!item) return "";
    const md = item.querySelector(S.reply) || item;
    return textWithout(md, excludeSel);
  }

  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;

  const lastAssistant = () => {
    const it = assistantItems();
    return it.length ? it[it.length - 1] : null;
  };

  const itemKey = (item) => {
    if (!item) return null;
    return item.getAttribute("data-message-id") ||
           item.getAttribute("data-testid") ||
           (item.dataset && item.dataset.turnId) ||
           null;
  };
  const lastAssistantId = () => itemKey(lastAssistant());

  const getEditor = () => {
    // 1. Direct candidate search: visible editable elements outside #zs-root
    const candidates = [];
    for (const sel of [
      'fieldset [contenteditable]',
      'form [contenteditable]',
      'div[class*="composer"] [contenteditable]',
      'div[class*="chat-input"] [contenteditable]',
      '.ProseMirror[contenteditable]',
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="plaintext-only"]',
      'div[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[contenteditable="true"]',
      '[contenteditable]',
      'div[role="textbox"]',
      '[role="textbox"]',
      '.ProseMirror',
      'p[data-placeholder]',
      'div[data-placeholder]',
      'textarea',
    ]) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.closest("#zs-root") && isVisible(el)) {
          const ed = el.closest('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable], [role="textbox"], .ProseMirror') || el;
          if (!candidates.includes(ed)) candidates.push(ed);
        }
      }
      if (candidates.length) break;
    }

    if (candidates.length > 0) {
      // Pick the one inside the composer card, or the last in DOM order (bottom composer)
      const composerCard = candidates.find((e) => e.closest('fieldset, form, div[class*="composer"], div[class*="chat-input"]'));
      return composerCard || candidates[candidates.length - 1];
    }

    // Fallback: any matching element outside #zs-root
    const anyMatches = [...document.querySelectorAll(S.editor)].filter((e) => !e.closest("#zs-root"));
    if (anyMatches.length > 0) {
      const last = anyMatches[anyMatches.length - 1];
      return last.closest('[contenteditable], [role="textbox"], .ProseMirror') || last;
    }
    return null;
  };

  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    return e.textContent || e.innerText || "";
  };

  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => chatIsEmpty() && (location.pathname === "/" || location.pathname === "/new" || location.pathname.startsWith("/chats"));

  const composerFrame = () => {
    const ed = getEditor();
    if (!ed) return null;
    return (
      ed.closest("fieldset") ||
      ed.closest("form") ||
      ed.closest('div[class*="composer"]') ||
      ed.closest('div[class*="chat-input"]') ||
      ed.closest('div[class*="relative"]') ||
      ed.parentElement
    );
  };

  function barMount() {
    const frame = composerFrame();
    if (!frame) return null;
    return { parent: frame.parentElement || frame, before: frame };
  }

  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    let n = ed;
    for (let i = 0; i < 10 && n && n.parentElement; i++) {
      if (n.matches && (
        n.matches('fieldset, form, [class*="composer"], [class*="chat-input"]') ||
        [...(n.classList || [])].some((c) => c.startsWith("rounded") || c.includes("border"))
      )) {
        if (n.querySelector('button, [role="button"]')) return n;
      }
      n = n.parentElement;
    }
    return composerFrame() || ed;
  }

  let _origContentEditable = null;
  let _locked = false;
  function setInputLock(on) {
    _locked = on;
    const ed = getEditor();
    if (!ed) return;
    if (on) {
      if (_origContentEditable === null) {
        _origContentEditable = ed.getAttribute("contenteditable") || "true";
      }
      ed.setAttribute("contenteditable", "false");
      ed.setAttribute("data-zs-locked", "1");
    } else {
      ed.setAttribute("contenteditable", _origContentEditable || "true");
      ed.removeAttribute("data-zs-locked");
      _origContentEditable = null;
    }
  }

  function isStopBtn(b) {
    if (!b) return false;
    const aria = (b.getAttribute("aria-label") || "").toLowerCase();
    const testid = (b.getAttribute("data-testid") || "").toLowerCase();
    return aria.includes("stop") || aria.includes("arr") || aria.includes("berhenti") || testid.includes("stop");
  }

  function submitButton() {
    for (const sel of [S.sendBtn, S.stopBtn, 'button[data-testid*="send"]', 'button[aria-label*="send" i]']) {
      for (const b of document.querySelectorAll(sel)) {
        if (!b.closest("#zs-root") && isVisible(b)) return b;
      }
    }
    return null;
  }

  function sendButton() {
    for (const b of document.querySelectorAll(S.sendBtn)) {
      if (!b.closest("#zs-root") && isVisible(b) && !isStopBtn(b)) return b;
    }
    const s = submitButton();
    return (s && !isStopBtn(s)) ? s : null;
  }

  function stopButton() {
    for (const b of document.querySelectorAll(S.stopBtn)) {
      if (!b.closest("#zs-root") && isVisible(b) && isStopBtn(b)) return b;
    }
    const s = submitButton();
    return (s && isStopBtn(s)) ? s : null;
  }

  function streamText(item) {
    return item ? textWithout(item, ".zs-chip") : "";
  }
  const streamLen = (item) => streamText(item === undefined ? lastAssistant() : item).length;

  let _streamMax = -1, _streamAt = 0, _streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = streamText(item).length;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 400) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }
  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;

  function genActive() {
    sampleStream();
    if (stopButton()) return true;
    const streamingEl = document.querySelector('[data-is-streaming="true"]');
    if (streamingEl) return true;
    return grewWithin(timings.GEN_IDLE_MS);
  }

  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = genActive;

  function stopGeneration() {
    const b = stopButton();
    if (b) { try { b.click(); } catch {} }
  }

  function turnHalted() { return false; }
  function findContinueBtn() {
    for (const b of document.querySelectorAll("button")) {
      if (!isVisible(b)) continue;
      if (RE.continueBtn.test((b.innerText || "").trim())) return b;
    }
    return null;
  }
  function clickContinueBtn() {
    const b = findContinueBtn();
    if (!b) return false;
    try { b.click(); return true; } catch { return false; }
  }

  function snapshot() {
    try {
      const it = lastAssistant();
      if (!it) return { th: 0, rp: 0 };
      const md = it.querySelector(S.reply) || it;
      return { th: 0, rp: (md.textContent || "").length };
    } catch { return {}; }
  }

  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    const md = item.querySelector(S.reply) || item;
    return {
      present: true,
      reply: textWithout(md, ".zs-chip").trim(),
      thinking: "",
      item,
    };
  }

  function selectAll(ed) {
    try {
      ed.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }

  async function typeAndSend(text, images) {
    const ed = getEditor();
    if (!ed) throw new Error("Claude input box not found");
    const relock = _locked;
    if (relock) ed.setAttribute("contenteditable", _origContentEditable || "true");
    try {
      selectAll(ed);
      const lines = String(text).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) document.execCommand("insertText", false, lines[i]);
        if (i < lines.length - 1) document.execCommand("insertLineBreak");
        if (i && i % 40 === 0) await sleep(0);
      }
      ed.dispatchEvent(new Event("input", { bubbles: true }));

      // Fallback if execCommand did not set text
      if ((ed.textContent || "").trim() === "" && text.trim()) {
        try {
          selectAll(ed);
          const dt = new DataTransfer();
          dt.setData("text/plain", text);
          ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch {}
        if ((ed.textContent || "").trim() === "") {
          ed.textContent = text;
        }
        ed.dispatchEvent(new Event("input", { bubbles: true }));
      }

      if (images && images.length) {
        try { await attachImages(images); } catch {}
      }

      await waitFor(() => {
        const b = sendButton();
        return b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
      }, 2500);

      const btn = sendButton();
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
        btn.click();
      } else {
        const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
        ed.dispatchEvent(new KeyboardEvent("keydown", o));
        ed.dispatchEvent(new KeyboardEvent("keyup", o));
      }
    } finally {
      if (relock) {
        const e2 = getEditor();
        if (e2) e2.setAttribute("contenteditable", "false");
      }
    }
  }

  function enforceComposer() { return { ready: !!getEditor() }; }
  async function ensureComposerReady(reason) {
    diag("mode_ready", { reason, provider: "claude" });
    const ok = await waitFor(() => !!getEditor(), 5000);
    return { ready: ok || !!getEditor() };
  }

  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (!isVisible(el)) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 8 && t.length < 500 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
    } catch {}
    if (!getEditor()) return "The input box disappeared (session ended?).";
    return null;
  }

  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text);

  function fileFromImage(img, i) {
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : "jpg";
    return new File([arr], `zeroscript_${Date.now()}_${i}.${ext}`, { type: mime });
  }

  async function attachImages(images) {
    const ed = getEditor();
    if (!ed || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      try { fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    }
    return true;
  }

  function clearAttachments() {
    try {
      document.querySelectorAll('[aria-label*="Remove" i], [aria-label*="Supprimer" i], button[class*="remove"]')
        .forEach((b) => { try { b.click(); } catch {} });
    } catch {}
  }

  const conversationKey = () => {
    const m = location.pathname.match(/\/(?:chat|c)\/([a-zA-Z0-9_-]+)/);
    return m ? m[0] : (/^\/chat\//.test(location.pathname) ? location.pathname : "");
  };

  function installSendHooks(handlers) {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const ed = getEditor();
        if (!ed || !ed.contains(e.target)) return;
        if (editorText().trim() === "") return;
        if (handlers.isBlocked()) return;
        if (!handlers.isStarted()) {
          if (!chatIsEmpty()) return;
          handlers.onBlockedAttempt();
          return;
        }
        handlers.onUserMessage(assistantCount());
      },
      true
    );

    document.addEventListener(
      "click",
      (e) => {
        if (!getEditor()) return;
        const t = e.target;
        const stop = t && t.closest && t.closest(S.stopBtn);
        if (stop) { handlers.onNativeStop(); return; }
        const btn = t && t.closest && (t.closest(S.sendBtn) || t.closest('button[data-testid="send-button"]'));
        if (!btn || isStopBtn(btn)) return;
        if (handlers.isBlocked()) return;
        if (!handlers.isStarted()) {
          if (!chatIsEmpty()) return;
          handlers.onBlockedAttempt();
          return;
        }
        handlers.onUserMessage(assistantCount());
      },
      true
    );
  }

  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;
  function findToolBlockSpot(item) {
    const replies = [...item.querySelectorAll(S.reply)];
    let hidAny = null;
    const hide = (el, mc) => {
      el.classList.add("zs-tool-hide");
      if (mc) mc.classList.add("zs-cmd-mask");
      hidAny = hidAny || { parent: el.parentElement, ref: el };
    };
    for (const mc of replies) {
      mc.querySelectorAll(S.codeWrap).forEach((pre) => {
        if (pre.closest(".zs-chip")) return;
        if (CMD_SHAPE.test(pre.textContent || "")) hide(pre, mc);
      });
      [...mc.children].forEach((el) => {
        if (el.classList.contains("zs-chip") || el.querySelector(S.codeWrap)) return;
        const t = el.textContent || "";
        if (t.length < 600 && CMD_SHAPE.test(t)) hide(el, null);
      });
    }
    return hidAny;
  }

  return {
    id: "claude",
    displayName: "Claude AI",
    supportsVision: true,
    timings,
    chipAtItemLevel: true,
    reliableCounts: true,
    init({ diag: d } = {}) { if (d) diag = d; },
    // turns
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    // composer / state
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barMount, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    // actions
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
