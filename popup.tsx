import { useState } from 'react';
import { Sema } from 'async-sema';
import { assert } from 'console';
import extractDocumentInfo from 'extract-document-info';

const IndexPopup = () => {
  const [data, setData] = useState('');

  const fixup = async () => {
    const topLevelBookmarks = await chrome.bookmarks.getChildren('0');
    const bookmarksBarNode = topLevelBookmarks.find(x => x.title === 'Bookmarks bar');
    const bookmarksBarChildren = await chrome.bookmarks.getChildren(bookmarksBarNode.id);
    let booksNode = bookmarksBarChildren.find(x => x.title === 'books (old, corrupted)');
    booksNode = (await chrome.bookmarks.getSubTree(booksNode.id))[0];

    const removeDupes = async (node: chrome.bookmarks.BookmarkTreeNode) => {
      if (node.children == null || node.children.length === 0)
        return;
      const seenUrls = new Set<string>();
      const seenFolderNames = new Set<string>();
      for (const child of node.children) {
        if (child.url == null) {
          if (seenFolderNames.has(child.title))
            await chrome.bookmarks.removeTree(child.id);
          else {
            seenFolderNames.add(child.title);
            await removeDupes(child);
          }
        }
        else {
          if (seenUrls.has(child.url))
            await chrome.bookmarks.remove(child.id);
          else
            seenUrls.add(child.url);
        }
      }
    };
  
    await removeDupes(booksNode);
  };

  const isAmazon = (url?: string) => url?.startsWith('https://www.amazon.com');

  const organizeSelectedTabs = async () => {
    const tabs = await chrome.tabs.query({lastFocusedWindow: true, highlighted: true});

    interface AnnotatedTab {
      originalTab: chrome.tabs.Tab;
      numRatings?: number;
      rating?: number;
      title?: string;
      is404?: boolean;
    };

    const annotatedTabs: AnnotatedTab[] = await Promise.all(tabs.map(async tab => {
      if (!isAmazon(tab.url))
        return { originalTab: tab };

      if (tab.title === 'Page Not Found')
        return { originalTab: tab, is404: true };

      const response = await chrome.tabs.sendMessage<string, { numRatings: number, rating: number, title: string }>(tab.id, 'extractDocumentInfo');
      return { originalTab: tab, ...response };
    }));

    assert(tabs.length === annotatedTabs.length);

    alert(JSON.stringify(annotatedTabs));
  };

  const organizeWindow = async () => {

  };

  const organizeBookmarks = async () => {
    const topLevelBookmarks = await chrome.bookmarks.getChildren('0');
    const bookmarksBarNode = topLevelBookmarks.find(x => x.title === 'Bookmarks bar');
    const bookmarksBarChildren = await chrome.bookmarks.getChildren(bookmarksBarNode.id);
    let booksNode = bookmarksBarChildren.find(x => x.title === 'books');
    booksNode = (await chrome.bookmarks.getSubTree(booksNode.id))[0];

    // const removeEmptyFolders1 = async (node: chrome.bookmarks.BookmarkTreeNode) => {
    //   if (node.children == null || node.children.length === 0)
    //     return;
    //   for (const child of node.children) {
    //     if (child.url == null && (child.children == null || child.children.length === 0))
    //       await chrome.bookmarks.remove(child.id);
    //     await removeEmptyFolders1(child);
    //   }
    // };
    // await removeEmptyFolders1(booksNode);

    // booksNode = (await chrome.bookmarks.getSubTree(booksNode.id))[0];
    // const removeDupes1 = async (node: chrome.bookmarks.BookmarkTreeNode) => {
    //   if (node.children == null || node.children.length < 2)
    //     return;
    //   for (let i = node.children.length - 1; i > 0; --i) {
    //     const current = node.children[i];
    //     const prev = node.children[i-1];
    //     if (current.url != null && (current.url === prev.url)) {
    //       await chrome.bookmarks.remove(current.id);
    //     }
    //     if (current.url == null) {
    //       await removeDupes1(current);
    //     }
    //   }
    // };
    // await removeDupes1(booksNode);

    // return;

    interface AnnotatedBookmarkTreeNode {
      originalNode: chrome.bookmarks.BookmarkTreeNode;
      newChildren?: AnnotatedBookmarkTreeNode[];
      numRatings?: number;
      rating?: number;
      title?: string;
      is404?: boolean;
    };

    const semaphore = new Sema(5);

    const processAsync = async (node: chrome.bookmarks.BookmarkTreeNode): Promise<AnnotatedBookmarkTreeNode> => {
      if (node.url == null && node.children != null) {
        const children = await Promise.all(node.children.map(processAsync));

        const compareFolderOrBookmark = (lhs: AnnotatedBookmarkTreeNode, rhs: AnnotatedBookmarkTreeNode): -1 | 0 | 1 => {
          if (lhs.originalNode.url == null) {
            if (rhs.originalNode.url == null)
              return 0;
            return 1;
          }
          if (rhs.originalNode.url == null)
            return -1;
          return 0;
        };

        const compareAmazon = (lhs: AnnotatedBookmarkTreeNode | string, rhs: AnnotatedBookmarkTreeNode | string): -1 | 0 | 1 => {
          const lhsUrl = typeof lhs === 'string' ? lhs : lhs.originalNode.url;
          const rhsUrl = typeof rhs === 'string' ? rhs : rhs.originalNode.url;

          if (isAmazon(lhsUrl)) {
            if (isAmazon(rhsUrl))
              return 0;
            return 1;
          }
          if (isAmazon(rhsUrl))
            return -1;
          return 0;
        };

        const compareNumRatings = (lhs: AnnotatedBookmarkTreeNode, rhs: AnnotatedBookmarkTreeNode): -1 | 0 | 1 => {
          if (lhs.numRatings === rhs.numRatings) {
            return 0;
          }
          if (lhs.numRatings == null) {
            if (rhs.numRatings == null)
              return 0;
            return -1;
          }
          if (rhs.numRatings == null)
            return 1;
          return lhs.numRatings > rhs.numRatings ? -1 : 1;
        };

        const compareRating = (lhs: AnnotatedBookmarkTreeNode, rhs: AnnotatedBookmarkTreeNode): -1 | 0 | 1 => {
          if (lhs.rating === rhs.rating)
            return 0;
          if (lhs.rating == null) {
            if (rhs.rating == null)
              return 0;
            return -1;
          }
          if (rhs.rating == null)
            return 1;
          return lhs.rating > rhs.rating ? -1 : 1;
        }

        const compareTitle = (lhs: AnnotatedBookmarkTreeNode, rhs: AnnotatedBookmarkTreeNode): -1 | 0 | 1 => {
          if (lhs.title === rhs.title)
            return 0;
          if (lhs.title == null) {
            if (rhs.title == null)
              return 0;
            return -1;
          }
          if (rhs.title == null)
            return 1;
          return lhs.title.localeCompare(rhs.title) > 0 ? 1 : -1;
        }

        const compareBookmarkName = (lhs: AnnotatedBookmarkTreeNode, rhs: AnnotatedBookmarkTreeNode): -1 | 0 | 1 => {
          const result = lhs.originalNode.title.localeCompare(rhs.originalNode.title);
          if (result === 0)
            return 0;
          return result > 0 ? 1 : -1;
        }

        const compareIs404 = (lhs: AnnotatedBookmarkTreeNode, rhs: AnnotatedBookmarkTreeNode): -1 | 0 | 1 => {
          if (lhs.is404) {
            if (rhs.is404)
              return 0;
            return 1;
          }
          if (rhs.is404)
            return -1;
          return 0;
        }

        const sortedChildren = children.sort((lhs, rhs) => {
          const folderResult = compareFolderOrBookmark(lhs, rhs);
          if (folderResult !== 0)
            return folderResult;
          const amazonResult = compareAmazon(lhs, rhs);
          if (amazonResult !== 0)
            return amazonResult;
          const is404Result = compareIs404(lhs, rhs);
          if (is404Result !== 0)
            return is404Result;
          const numRatingsResult = compareNumRatings(lhs, rhs);
          if (numRatingsResult !== 0)
            return numRatingsResult;
          const ratingResult = compareRating(lhs, rhs);
          if (ratingResult !== 0)
            return ratingResult;
          const titleResult = compareTitle(lhs, rhs);
          if (titleResult !== 0)
            return titleResult;
          return compareBookmarkName(lhs, rhs);
        })
        return {
          originalNode: node,
          newChildren: sortedChildren,
        };
      }
      if (!isAmazon(node.url)) {
        return {
          originalNode: node
        };
      }

      let response: Response;

      let attempt = 0;
      while (++attempt < 5) {
        await semaphore.acquire();
        try {
          response = await fetch(node.url);
          break;
        } catch (e) {
          console.warn({e});
          await new Promise(r => setTimeout(r, 5000));
        } finally {
          semaphore.release();
        }
      }

      if (response.status === 500 || response.status === 502)
        throw new Error('Response status 500 or 502!');
      
      if (response.status === 404) {
        return {
          originalNode: node,
          is404: true,
        };
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const numRatingsSpan = doc.querySelector<HTMLSpanElement>('span#acrCustomerReviewText');
      let numRatings = 0;
      if (numRatingsSpan != null) {
        const numRatingsMatches = numRatingsSpan.innerText.match(/^([\d,]+) ratings$/);
        if (numRatingsMatches?.length == 2)
          numRatings = +(numRatingsMatches[1].replaceAll(',',''));
      }
      
      const title = doc.querySelector<HTMLSpanElement>('span#productTitle')?.innerText?.trim();

      const ratingSpan = doc.querySelector<HTMLSpanElement>('span#acrPopover');
      const ratingMatches = ratingSpan?.innerText?.trim()?.match(/^\d\.?\d?/);
      let rating = 0;
      if (ratingMatches?.length === 1)
        rating = +ratingMatches[0];

      return {
        originalNode: node,
        title,
        rating,
        numRatings,
      };
    }

    const newBooksNode = await processAsync(booksNode);
    newBooksNode.originalNode.title = `books (${new Date().toISOString()})`;

    const removeDupes = (node: AnnotatedBookmarkTreeNode) => {
      if (node.newChildren?.length > 0) {
        node.newChildren = node.newChildren.filter((val, pos, ary) => {
          if (pos === 0)
            return true;
          const lastChild = ary[pos-1];
          if ((val.originalNode.url != null) && (val.originalNode.url === lastChild.originalNode?.url)) {
            return false;
          }
          return true;
        });
        
        for (const child of node.newChildren) {
          removeDupes(child);
        }
      }
    };

    removeDupes(newBooksNode);

    const removeEmptyFolders = (node: AnnotatedBookmarkTreeNode) => {
      if (node.newChildren?.length > 0) {
        node.newChildren = node.newChildren.filter((val) => {
          if (val.originalNode.url == null && (val.newChildren == null || val.newChildren.length === 0))
            return false;
          return true;
        });
        
        for (const child of node.newChildren) {
          removeEmptyFolders(child);
        }
      }
    };

    removeEmptyFolders(newBooksNode);

    const createBookmark = async (node: AnnotatedBookmarkTreeNode, parentNode: chrome.bookmarks.BookmarkTreeNode) => {
      const getTitle = (n: AnnotatedBookmarkTreeNode) => {
        if (n.title != null)
          return n.title;
        return n.originalNode.title;
      };
      const newParent = await chrome.bookmarks.create({
        parentId: parentNode.id,
        title: node.originalNode.title,
        url: node.originalNode.url,
      });
      if (node.newChildren?.length > 0)
        await Promise.all(node.newChildren.map(x => createBookmark(x, newParent)));
    };

    await createBookmark(newBooksNode, bookmarksBarNode);
  };

  return (
    <div
      style={{
        padding: 16,
      }}>
      <h2>
        Welcome to your{' '}
        <a href="https://www.plasmo.com" target="_blank">
          Plasmo
        </a>{' '}
        Extension!
      </h2>
      <input onChange={(e) => setData(e.target.value)} value={data} />
      <a href="https://docs.plasmo.com" target="_blank">
        View Docs
      </a>
      <button onClick={organizeBookmarks}>Organize Bookmarks!</button>
      <button onClick={organizeSelectedTabs}>Organize Selected Tabs!</button>
      <button onClick={organizeWindow}>Organize Window!</button>
      <button onClick={fixup}>Fixup!</button>
    </div>
  );
}

export default IndexPopup;
