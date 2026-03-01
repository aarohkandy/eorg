/* global chrome */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "inboxsdk__injectPageWorld") {
    return false;
  }

  const tabId = sender && sender.tab && Number.isInteger(sender.tab.id)
    ? Number(sender.tab.id)
    : null;
  if (tabId === null) {
    sendResponse(false);
    return false;
  }

  (async () => {
    try {
      const target = { tabId };
      if (Number.isInteger(sender.frameId) && sender.frameId >= 0) {
        target.frameIds = [sender.frameId];
      }
      await chrome.scripting.executeScript({
        target,
        files: ["pageWorld.js"],
        world: "MAIN"
      });
      sendResponse(true);
    } catch (error) {
      console.warn("[reskin] Failed to inject InboxSDK pageWorld.js", error);
      sendResponse(false);
    }
  })();

  return true;
});
