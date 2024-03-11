import { organizeSelectedTabs, organizeUnselectedTabs, organizeWindow } from 'organize';

const IndexPopup = () => {
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

  const openManagementPage = async () => {
    await chrome.tabs.create({
      active: true,
      url: '/tabs/management.html',
    });
  };

  return (
    <div
      style={{
        padding: 16,
        minWidth: 200
      }}>
      <button onClick={organizeSelectedTabs}>Organize Selected Tabs!</button><br/>
      <button onClick={organizeUnselectedTabs}>
        Organize Unselected Tabs!
      </button><br/>
      <button onClick={organizeWindow}>Organize Window!</button><br/>
      <button onClick={fixup}>Fixup!</button><br/>
      <button onClick={openManagementPage}>Open Management Page!</button>
    </div>
  );
};

export default IndexPopup;
