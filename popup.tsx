import { Sema } from 'async-sema';
import type { BookData } from 'book-data';
import extractBookData from 'extract-book-data';
import { useState } from 'react';

const IndexPopup = () => {
  const [data, setData] = useState('');

  const fixup = async () => {
    const topLevelBookmarks = await chrome.bookmarks.getChildren('0');
    const bookmarksBarNode = topLevelBookmarks.find(
      (x) => x.title === 'Bookmarks bar',
    );
    const bookmarksBarChildren = await chrome.bookmarks.getChildren(
      bookmarksBarNode.id,
    );
    let booksNode = bookmarksBarChildren.find(
      (x) => x.title === 'books (old, corrupted)',
    );
    booksNode = (await chrome.bookmarks.getSubTree(booksNode.id))[0];

    const removeDupes = async (node: chrome.bookmarks.BookmarkTreeNode) => {
      if (node.children == null || node.children.length === 0) return;
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
        } else {
          if (seenUrls.has(child.url)) await chrome.bookmarks.remove(child.id);
          else seenUrls.add(child.url);
        }
      }
    };

    await removeDupes(booksNode);
  };

  interface AnnotatedBookmarkTreeNode extends BookData {
    originalNode: chrome.bookmarks.BookmarkTreeNode;
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
      return 'originalNode' in annotated
        ? annotated.originalNode.url
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

    const compareNumRatings = <
      T extends AnnotatedBookmarkTreeNode | AnnotatedTab,
    >(
      lhs: T,
      rhs: T,
    ): -1 | 0 | 1 => {
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

    const compareRating = <T extends AnnotatedBookmarkTreeNode | AnnotatedTab>(
      lhs: T,
      rhs: T,
    ): -1 | 0 | 1 => {
      if (lhs.rating === rhs.rating) return 0;
      if (lhs.rating == null) {
        if (rhs.rating == null) return 0;
        return -1;
      }
      if (rhs.rating == null) return 1;
      return lhs.rating > rhs.rating ? -1 : 1;
    };

    const compareTitle = <T extends AnnotatedBookmarkTreeNode | AnnotatedTab>(
      lhs: T,
      rhs: T,
    ): -1 | 0 | 1 => {
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
      if (!('originalNode' in lhs && 'originalNode' in rhs)) return 0;
      const result = lhs.originalNode.title.localeCompare(
        rhs.originalNode.title,
      );
      if (result === 0) return 0;
      return result > 0 ? 1 : -1;
    };

    const compareIs404 = <T extends AnnotatedBookmarkTreeNode | AnnotatedTab>(
      lhs: T,
      rhs: T,
    ): -1 | 0 | 1 => {
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

  const fetchBookData = async (
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

  const organizeTabs = async (tabs: readonly chrome.tabs.Tab[]) => {
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

  const organizeSelectedTabs = async () => {
    const tabs = await chrome.tabs.query({
      lastFocusedWindow: true,
      highlighted: true,
    });
    await organizeTabs(tabs);
  };

  const organizeUnselectedTabs = async () => {
    const tabs = await chrome.tabs.query({
      lastFocusedWindow: true,
      highlighted: false,
    });
    await organizeTabs(tabs);
  }

  const organizeWindow = async () => {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    await organizeTabs(tabs);
  };

  const organizeBookmarks = async () => {
    const topLevelBookmarks = await chrome.bookmarks.getChildren('0');
    const bookmarksBarNode = topLevelBookmarks.find(
      (x) => x.title === 'Bookmarks bar',
    );
    const bookmarksBarChildren = await chrome.bookmarks.getChildren(
      bookmarksBarNode.id,
    );
    let booksNode = bookmarksBarChildren.find((x) => x.title === 'books');
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

    const semaphore = new Sema(5);

    const processAsync = async (
      node: chrome.bookmarks.BookmarkTreeNode,
    ): Promise<AnnotatedBookmarkTreeNode> => {
      if (node.url == null && node.children != null) {
        const children = await Promise.all(node.children.map(processAsync));

        const sortedChildren = children.sort(compareAnnotated);
        return {
          originalNode: node,
          newChildren: sortedChildren,
        };
      }
      if (!isAmazon(node.url)) {
        return {
          originalNode: node,
        };
      }

      const bookData = await fetchBookData(node.url, semaphore);
      return {
        originalNode: node,
        ...bookData,
      };
    };

    const newBooksNode = await processAsync(booksNode);
    newBooksNode.originalNode.title = `books (${new Date().toISOString()})`;

    const removeDupes = (node: AnnotatedBookmarkTreeNode) => {
      if (node.newChildren?.length > 0) {
        node.newChildren = node.newChildren.filter((val, pos, ary) => {
          if (pos === 0) return true;
          const lastChild = ary[pos - 1];
          if (
            val.originalNode.url != null &&
            val.originalNode.url === lastChild.originalNode?.url
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

    removeDupes(newBooksNode);

    const removeEmptyFolders = (node: AnnotatedBookmarkTreeNode) => {
      if (node.newChildren?.length > 0) {
        node.newChildren = node.newChildren.filter((val) => {
          if (
            val.originalNode.url == null &&
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

    removeEmptyFolders(newBooksNode);

    const createBookmark = async (
      node: AnnotatedBookmarkTreeNode,
      parentNode: chrome.bookmarks.BookmarkTreeNode,
    ) => {
      const getTitle = (n: AnnotatedBookmarkTreeNode) => {
        if (n.title != null) return n.title;
        return n.originalNode.title;
      };
      const newParent = await chrome.bookmarks.create({
        parentId: parentNode.id,
        title: node.originalNode.title,
        url: node.originalNode.url,
      });
      if (node.newChildren?.length > 0)
        await Promise.all(
          node.newChildren.map((x) => createBookmark(x, newParent)),
        );
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
        <a href='https://www.plasmo.com' target='_blank'>
          Plasmo
        </a>{' '}
        Extension!
      </h2>
      <input onChange={(e) => setData(e.target.value)} value={data} />
      <a href='https://docs.plasmo.com' target='_blank'>
        View Docs
      </a>
      <button onClick={organizeBookmarks}>Organize Bookmarks!</button>
      <button onClick={organizeSelectedTabs}>Organize Selected Tabs!</button>
      <button onClick={organizeUnselectedTabs}>Organize Unselected Tabs!</button>
      <button onClick={organizeWindow}>Organize Window!</button>
      <button onClick={fixup}>Fixup!</button>
    </div>
  );
};

export default IndexPopup;
