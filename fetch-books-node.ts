const fetchBooksNode = async () => {
  const topLevelBookmarks = await chrome.bookmarks.getChildren('0');
  const bookmarksBarNode = topLevelBookmarks.find(
    (x) => x.title === 'Bookmarks bar',
  );
  const bookmarksBarChildren = await chrome.bookmarks.getChildren(
    bookmarksBarNode.id,
  );
  let booksNode = bookmarksBarChildren.find((x) => x.title === 'books');
  return (await chrome.bookmarks.getSubTree(booksNode.id))[0];
};

export default fetchBooksNode;
