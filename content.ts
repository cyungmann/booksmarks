import type { PlasmoCSConfig } from 'plasmo';
import extractDocumentInfo from 'extract-document-info';

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message === 'extractDocumentInfo')
    sendResponse(extractDocumentInfo(document));
})

export const config: PlasmoCSConfig = {
  matches: ["https://www.amazon.com/*"],
  all_frames: false
};
