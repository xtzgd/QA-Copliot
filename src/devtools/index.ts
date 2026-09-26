/** 注册 QA Copilot DevTools Panel。网络采集不依赖该面板是否打开。 */

chrome.devtools.panels.create(
  'QA Copilot',
  '',
  'sidepanel/index.html?surface=devtools',
  () => {
    if (chrome.runtime.lastError) {
      console.error('[QA Copilot DevTools] 面板创建失败:', chrome.runtime.lastError.message);
    }
  }
);
