import type { PlasmoCSConfig } from 'plasmo';
import extractBookData from 'extract-book-data';

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message === 'extractBookData')
    sendResponse(extractBookData(document));
});

export const config: PlasmoCSConfig = {
  matches: ["https://www.amazon.com/*"],
  all_frames: false
};
