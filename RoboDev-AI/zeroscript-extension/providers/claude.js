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

  const S = {
    // Turns
    userItem: '[data-testid="user-message"], .font-user-message, [data-message-author="user"]',
    assistantItem: '.font-claude-message, [data-is-streaming], [data-testid="assistant-message"], [data-message-author="assistant"]',
    anyItem: '[data-testid="user-message"], .font-user-message, .font-claude-message, [data-is-streaming], [data-testid="assistant-message"]',
    reply: '.font-claude-message, [data-testid="assistant-message"], .prose',
    thinking: '[data-testid="thinking-content"], .thinking-container, [class*="thinking"]',
    // Composer
    editor: 'div[contenteditable="true"].ProseMirror, fieldset div[contenteditable="true"], div[contenteditable="true"]',
    composer: 'fieldset, form, div[class*="composer"]',
    sendBtn: 'button[aria-label*="Send" i], button[aria-label*="Envoyer" i], button[data-testid="send-button"]',
    stopBtn: 'button[aria-label*="Stop" i], button[aria-label*="Arrêter" i], button[data-testid="stop-button"]',
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
    for (const e of document.querySelectorAll(S.editor)) {
      if (!e.closest("#zs-root") && e.offsetParent !== null) return e;
    }
    return document.querySelector(S.editor);
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
    return ed.closest("fieldset") || ed.closest("form") || ed.closest('div[class*="composer"]') || ed.parentElement;
  };

  function barMount() {
    const frame = composerFrame();
    if (!frame) return null;
    return { parent: frame.parentElement || frame, before: frame };
  }

  function barAnchor() {
    return composerFrame() || getEditor();
  }

  let _locked = false;
  function setInputLock(on) {
    _locked = on;
    const ed = getEditor();
    if (!ed) return;
    ed.setAttribute("contenteditable", on ? "false" : "true");
    if (on) ed.setAttribute("data-zs-locked", "1");
    else ed.removeAttribute("data-zs-locked");
  }

  function submitButton() {
    const s = document.querySelector(S.sendBtn);
    if (s && s.offsetParent !== null) return s;
    const stop = document.querySelector(S.stopBtn);
    if (stop && stop.offsetParent !== null) return stop;
    return null;
  }

  function isStopBtn(b) {
    if (!b) return false;
    const aria = (b.getAttribute("aria-label") || "").toLowerCase();
    const testid = (b.getAttribute("data-testid") || "").toLowerCase();
    return aria.includes("stop") || aria.includes("arr") || testid.includes("stop");
  }

  function sendButton() {
    const b = document.querySelector(S.sendBtn);
    return (b && !isStopBtn(b) && b.offsetParent !== null) ? b : null;
  }

  function stopButton() {
    const b = document.querySelector(S.stopBtn) || submitButton();
    return (b && isStopBtn(b) && b.offsetParent !== null) ? b : null;
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
      if (b.offsetParent === null) continue;
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
    ed.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function typeAndSend(text, images) {
    const ed = getEditor();
    if (!ed) throw new Error("Claude input box not found");
    const relock = _locked;
    if (relock) ed.setAttribute("contenteditable", "true");
    try {
      selectAll(ed);
      const lines = String(text).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) document.execCommand("insertText", false, lines[i]);
        if (i < lines.length - 1) document.execCommand("insertLineBreak");
      }
      ed.dispatchEvent(new Event("input", { bubbles: true }));

      if (images && images.length) {
        try { await attachImages(images); } catch {}
      }

      await sleep(300);
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

  function enforceComposer() { return { ready: true }; }
  async function ensureComposerReady() { return { ready: !!getEditor() }; }

  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
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

  const conversationKey = () => (/^\/chat\//.test(location.pathname) ? location.pathname : "");

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
