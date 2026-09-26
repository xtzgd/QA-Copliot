chrome.devtools.panels.create(
  "QA Copilot",
  "",
  "sidepanel/index.html?surface=devtools",
  () => {
    if (chrome.runtime.lastError) {
      console.error("[QA Copilot DevTools] 面板创建失败:", chrome.runtime.lastError.message);
    }
  }
);
