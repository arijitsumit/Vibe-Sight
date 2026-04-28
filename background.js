const setBadge = (tabId, active) => {
  chrome.action.setBadgeText({ text: active ? 'ON' : '', tabId });
  chrome.action.setBadgeBackgroundColor({
    color: active ? '#10b981' : '#6b7280',
    tabId,
  });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'vibecoder-state-changed' && sender.tab?.id) {
    setBadge(sender.tab.id, message.active);
  }
  sendResponse({ ok: true });
});
