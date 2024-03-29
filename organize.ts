import { Sema } from 'async-sema';
import type { BookData } from 'book-data';
import extractBookData from 'extract-book-data';

interface AnnotatedBookmarkTreeNode extends BookData {
  originalUrl?: string;
  originalTitle: string;
  newChildren?: AnnotatedBookmarkTreeNode[];
}

interface AnnotatedTab extends BookData {
  originalTab: chrome.tabs.Tab;
}

const isAmazon = (url?: string) => url?.startsWith('https://www.amazon.com');

const compareAnnotated = <T extends AnnotatedTab | AnnotatedBookmarkTreeNode>(
  lhs: T,
  rhs: T,
): -1 | 0 | 1 => {
  const getUrl = (
    annotated: AnnotatedBookmarkTreeNode | AnnotatedTab,
  ): string | undefined => {
    return 'originalTitle' in annotated
      ? annotated.originalUrl
      : annotated.originalTab.url;
  };

  // bookmarks (with url) come before folders (without url)
  const compareFolderOrBookmark = <
    T extends AnnotatedBookmarkTreeNode | AnnotatedTab,
  >(
    lhs: T,
    rhs: T,
  ): -1 | 0 | 1 => {
    const lhsUrl = getUrl(lhs);
    const rhsUrl = getUrl(rhs);

    if (lhsUrl == null) {
      if (rhsUrl == null) return 0;
      return 1;
    }
    if (rhsUrl == null) return -1;
    return 0;
  };

  // Amazon comes after non-Amazon
  const compareAmazon = <T extends AnnotatedBookmarkTreeNode | AnnotatedTab>(
    lhs: T,
    rhs: T,
  ): -1 | 0 | 1 => {
    const lhsUrl = getUrl(lhs);
    const rhsUrl = getUrl(rhs);

    if (isAmazon(lhsUrl)) {
      if (isAmazon(rhsUrl)) return 0;
      return 1;
    }
    if (isAmazon(rhsUrl)) return -1;
    return 0;
  };

  const compareNumRatings = (lhs: BookData, rhs: BookData): -1 | 0 | 1 => {
    if (lhs.numRatings === rhs.numRatings) {
      return 0;
    }
    if (lhs.numRatings == null) {
      if (rhs.numRatings == null) return 0;
      return -1;
    }
    if (rhs.numRatings == null) return 1;
    return lhs.numRatings > rhs.numRatings ? -1 : 1;
  };

  const compareRating = (lhs: BookData, rhs: BookData): -1 | 0 | 1 => {
    if (lhs.rating === rhs.rating) return 0;
    if (lhs.rating == null) {
      if (rhs.rating == null) return 0;
      return -1;
    }
    if (rhs.rating == null) return 1;
    return lhs.rating > rhs.rating ? -1 : 1;
  };

  const compareTitle = (lhs: BookData, rhs: BookData): -1 | 0 | 1 => {
    if (lhs.title === rhs.title) return 0;
    if (lhs.title == null) {
      if (rhs.title == null) return 0;
      return -1;
    }
    if (rhs.title == null) return 1;
    return lhs.title.localeCompare(rhs.title) > 0 ? 1 : -1;
  };

  const compareBookmarkName = <
    T extends AnnotatedTab | AnnotatedBookmarkTreeNode,
  >(
    lhs: T,
    rhs: T,
  ): -1 | 0 | 1 => {
    if (!('originalTitle' in lhs && 'originalTitle' in rhs)) return 0;
    const result = lhs.originalTitle.localeCompare(rhs.originalTitle);
    if (result === 0) return 0;
    return result > 0 ? 1 : -1;
  };

  const compareIs404 = (lhs: BookData, rhs: BookData): -1 | 0 | 1 => {
    if (lhs.is404) {
      if (rhs.is404) return 0;
      return 1;
    }
    if (rhs.is404) return -1;
    return 0;
  };

  const folderResult = compareFolderOrBookmark(lhs, rhs);
  if (folderResult !== 0) return folderResult;
  const amazonResult = compareAmazon(lhs, rhs);
  if (amazonResult !== 0) return amazonResult;
  const is404Result = compareIs404(lhs, rhs);
  if (is404Result !== 0) return is404Result;
  const numRatingsResult = compareNumRatings(lhs, rhs);
  if (numRatingsResult !== 0) return numRatingsResult;
  const ratingResult = compareRating(lhs, rhs);
  if (ratingResult !== 0) return ratingResult;
  const titleResult = compareTitle(lhs, rhs);
  if (titleResult !== 0) return titleResult;
  return compareBookmarkName(lhs, rhs);
};

export const fetchBookData = async (
  url: string,
  semaphore: Sema,
): Promise<BookData> => {
  let response: Response;

  let attempt = 0;
  while (++attempt < 5) {
    await semaphore.acquire();
    try {
      response = await fetch(url);
      break;
    } catch (e) {
      console.warn({ e });
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      semaphore.release();
    }
  }

  if (response.status === 500 || response.status === 502)
    throw new Error('Response status 500 or 502!');

  if (response.status === 404) {
    return {
      is404: true,
    };
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return extractBookData(doc);
};

export const organizeTabs = async (tabs: readonly chrome.tabs.Tab[]) => {
  const semaphore = new Sema(5);
  const annotatedTabs: AnnotatedTab[] = await Promise.all(
    tabs.map(async (tab) => {
      if (!isAmazon(tab.url)) return { originalTab: tab };

      if (tab.title === 'Page Not Found')
        return { originalTab: tab, is404: true };

      let tabBookData: BookData;
      try {
        tabBookData = await chrome.tabs.sendMessage<string, BookData>(
          tab.id,
          'extractBookData',
        );
        if (tabBookData == null) {
          tabBookData = await fetchBookData(tab.url, semaphore);
        }
      } catch (e: unknown) {
        console.warn(e);
        tabBookData = await fetchBookData(tab.url, semaphore);
      }
      return { originalTab: tab, ...tabBookData };
    }),
  );

  annotatedTabs.sort(compareAnnotated);

  const tabIndices = annotatedTabs
    .map((x) => x.originalTab.index)
    .sort((lhs, rhs) => rhs - lhs);
  for (let i = annotatedTabs.length - 1; i > -1; --i)
    await chrome.tabs.move(annotatedTabs[i].originalTab.id, {
      index: tabIndices[tabIndices.length - i - 1],
    });

  const seenTitlesThenNumRatingsThenRating = new Map<
    string,
    Map<number, Set<number>>
  >();
  const seenUrls = new Set<string>();
  const haveMetadataAndNot404 = (bookData: BookData): boolean => {
    return (
      !bookData.is404 &&
      bookData.title != null &&
      bookData.title !== '' &&
      bookData.numRatings != null &&
      bookData.rating != null
    );
  };

  for (const annotatedTab of annotatedTabs) {
    let shouldRemove = false;
    if (seenUrls.has(annotatedTab.originalTab.url)) shouldRemove = true;
    else if (
      haveMetadataAndNot404(annotatedTab) &&
      seenTitlesThenNumRatingsThenRating[annotatedTab.title!]?.[
        annotatedTab.numRatings!
      ]?.has(annotatedTab.rating!)
    )
      shouldRemove = true;

    if (shouldRemove) await chrome.tabs.remove(annotatedTab.originalTab.id);

    seenUrls.add(annotatedTab.originalTab.url);
    if (haveMetadataAndNot404(annotatedTab)) {
      seenTitlesThenNumRatingsThenRating[annotatedTab.title] ??= new Map<
        number,
        Set<number>
      >();
      seenTitlesThenNumRatingsThenRating[annotatedTab.title][
        annotatedTab.numRatings
      ] ??= new Set<number>();
      seenTitlesThenNumRatingsThenRating[annotatedTab.title][
        annotatedTab.numRatings
      ].add(annotatedTab.rating);
    }
  }
};

export const organizeSelectedTabs = async () => {
  const tabs = await chrome.tabs.query({
    lastFocusedWindow: true,
    highlighted: true,
  });
  await organizeTabs(tabs);
};

export const organizeUnselectedTabs = async () => {
  const tabs = await chrome.tabs.query({
    lastFocusedWindow: true,
    highlighted: false,
  });
  await organizeTabs(tabs);
};

export const organizeWindow = async () => {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  await organizeTabs(tabs);
};

export const backupFolder = async (folderId: string) => {
  const folderNode = (await chrome.bookmarks.getSubTree(folderId))[0];

  const backupNode = await chrome.bookmarks.create({
    index: folderNode.index,
    parentId: folderNode.parentId,
    title: `${folderNode.title} (${new Date().toISOString()})`,
  });
  const processBackupAsync = async (
    parent: chrome.bookmarks.BookmarkTreeNode,
    child: chrome.bookmarks.BookmarkTreeNode,
  ) => {
    const newChildNode = await chrome.bookmarks.create({
      parentId: parent.id,
      title: child.title,
      url: child.url,
    });
    if (child.children != null) {
      for (const c of child.children) {
        await processBackupAsync(newChildNode, c);
      }
    }
  };

  for (const child of folderNode.children) {
    await processBackupAsync(backupNode, child);
  }
};

export const organizeFolder = async (folderId: string) => {
  const semaphore = new Sema(5);

  const processAsync = async (
    node: chrome.bookmarks.BookmarkTreeNode,
  ): Promise<AnnotatedBookmarkTreeNode> => {
    if (node.url == null && node.children != null) {
      const children = await Promise.all(node.children.map(processAsync));
      children.sort(compareAnnotated);
      return {
        originalTitle: node.title,
        originalUrl: node.url,
        newChildren: children,
      };
    }
    if (!isAmazon(node.url)) {
      return {
        originalTitle: node.title,
        originalUrl: node.url,
      };
    }

    const bookData = await fetchBookData(node.url, semaphore);
    return {
      originalTitle: node.title,
      originalUrl: node.url,
      ...bookData,
    };
  };

  const originalFolderNode = (await chrome.bookmarks.getSubTree(folderId))[0];

  const processedFolderNode = await processAsync(originalFolderNode);

  const removeDupes = (node: AnnotatedBookmarkTreeNode) => {
    if (node.newChildren?.length > 0) {
      node.newChildren = node.newChildren.filter((val, pos, ary) => {
        if (pos === 0) return true;
        const lastChild = ary[pos - 1];
        if (
          val.originalUrl != null &&
          val.originalUrl === lastChild.originalUrl
        ) {
          return false;
        }
        return true;
      });

      for (const child of node.newChildren) {
        removeDupes(child);
      }
    }
  };

  removeDupes(processedFolderNode);

  const removeEmptyFolders = (node: AnnotatedBookmarkTreeNode) => {
    if (node.newChildren?.length > 0) {
      node.newChildren = node.newChildren.filter((val) => {
        if (
          val.originalUrl == null &&
          (val.newChildren == null || val.newChildren.length === 0)
        )
          return false;
        return true;
      });

      for (const child of node.newChildren) {
        removeEmptyFolders(child);
      }
    }
  };

  removeEmptyFolders(processedFolderNode);

  const createBookmark = async (
    node: AnnotatedBookmarkTreeNode,
    parentNodeId: string,
  ) => {
    console.warn({node});
    const newNode = await chrome.bookmarks.create({
      parentId: parentNodeId,
      title: node.originalTitle,
      url: node.originalUrl,
    });
    for (const child of node.newChildren || [])
      await createBookmark(child, newNode.id);
    return newNode;
  };

  const newNode = await createBookmark(processedFolderNode, originalFolderNode.parentId);
  await chrome.bookmarks.move(newNode.id, {
    parentId: originalFolderNode.parentId,
    index: originalFolderNode.index,
  });
  await chrome.bookmarks.removeTree(originalFolderNode.id);
};
