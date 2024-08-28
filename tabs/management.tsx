import fetchBooksNode from 'fetch-books-node';
import { backupFolder, organizeFolder } from 'organize';
import { useEffect, useRef, useState } from 'react';

const BookmarkNode = ({
  node,
  refMap,
  onOrganizeFolder = () => {},
  onRandomWalk = () => {},
  onRemove = () => {},
  onOpenAllInNewWindow = () => {},
  onFixTitles = () => {}
}: {
  node: chrome.bookmarks.BookmarkTreeNode;
  refMap: Map<string, HTMLLIElement>;
  onOrganizeFolder?: (id: string) => void;
  onRandomWalk?: (id: string) => void;
  onRemove?: (id: string) => void;
  onOpenAllInNewWindow?: (id: string) => void;
  onFixTitles?: (id: string) => void;
}) => {
  return (
    node != null && (
      <li key={node.id} ref={(element: HTMLLIElement | null) => {
        if (element)
          refMap.set(node.id, element);
        else
          refMap.delete(node.id);
      }}>
        {node.url == null ? (
          <>
            {node.title}{' '}
            <button onClick={() => onOrganizeFolder(node.id)}>
              Organize Folder
            </button>
            <button onClick={() => onRandomWalk(node.id)}>Random Walk</button>
            <button onClick={() => onOpenAllInNewWindow(node.id)}>
              Open All In New Window
            </button>
            <button onClick={() => onFixTitles(node.id)}>Fix Titles</button>
          </>
        ) :
        (
          <>
            <a href={node.url}>{node.title}</a>{' '}
          </>
        )}
        <button onClick={() => onRemove(node.id)}>Remove</button>
        <ul>
          {node.children?.map((c) => (
            <BookmarkNode
              node={c}
              refMap={refMap}
              key={c.id}
              onOrganizeFolder={onOrganizeFolder}
              onRandomWalk={onRandomWalk}
              onRemove={onRemove}
              onOpenAllInNewWindow={onOpenAllInNewWindow}
              onFixTitles={onFixTitles}
            />
          ))}
        </ul>
      </li>
    )
  );
};

const BookmarkList = ({
  root,
  refMap,
  onOrganizeFolder = () => {},
  onRandomWalk = () => {},
  onRemove = () => {},
  onOpenAllInNewWindow = () => {},
  onFixTitles = () => {},
}: {
  root: chrome.bookmarks.BookmarkTreeNode;
  refMap: Map<string, HTMLLIElement>;
  onOrganizeFolder?: (id: string) => void;
  onRandomWalk?: (id: string) => void;
  onRemove?: (id: string) => void;
  onOpenAllInNewWindow?: (id: string) => void;
  onFixTitles?: (id: string) => void;
}) => {
  return (
    root != null && (
      <ul>
        <BookmarkNode
          node={root}
          refMap={refMap}
          onOrganizeFolder={onOrganizeFolder}
          onRandomWalk={onRandomWalk}
          onRemove={onRemove}
          onOpenAllInNewWindow={onOpenAllInNewWindow}
          onFixTitles={onFixTitles}
        />
      </ul>
    )
  );
};

const Management = () => {
  const [booksNode, setBooksNode] =
    useState<chrome.bookmarks.BookmarkTreeNode | null>(null);

  const refMap = useRef<Map<string, HTMLLIElement> | null>(null);
  const getMap = () => {
    if (!refMap.current)
      refMap.current = new Map<string, HTMLLIElement>();
    return refMap.current;
  }

  const randomWalkResultsRef = useRef<HTMLUListElement>(null);

  const [randomWalkResults, setRandomWalkResults] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([]);

  const randomWalk = (
    root: chrome.bookmarks.BookmarkTreeNode,
  ): chrome.bookmarks.BookmarkTreeNode => {
    while (true) {
      const chooseFrom = root.children.filter((x) => x.url == null);
      const i = Math.floor(Math.random() * (chooseFrom.length + 1));
      if (i === chooseFrom.length) return root;
      root = chooseFrom[i];
    }
  };

  useEffect(() => {
    (async () => {
      const node = await fetchBooksNode();
      setBooksNode(node);
    })();
  }, []);

  const handleOrganizeFolder = async (folderId: string): Promise<void> => {
    await backupFolder(folderId);
    await organizeFolder(folderId);
    setBooksNode(await fetchBooksNode());
  };

  const handleRandomWalk = async (folderId: string): Promise<void> => {
    const node = (await chrome.bookmarks.getSubTree(folderId))[0];
    let randomResults: chrome.bookmarks.BookmarkTreeNode[] = new Array(10);
    for (let i = 0; i < randomResults.length; ++i)
      randomResults[i] = randomWalk(node);
    const seenIds = new Set<string>();
    randomResults = randomResults.filter((x) => {
      if (seenIds.has(x.id)) return false;
      seenIds.add(x.id);
      return true;
    });
    setRandomWalkResults(randomResults);
    randomWalkResultsRef.current.scrollIntoView();
  };

  const handleRemove = async (id: string): Promise<void> => {
    const node = (await chrome.bookmarks.get(id))[0];
    if (!confirm(`Are you sure you want to remove '${node.title}'?`)) return;
    if (!confirm(`Are you absolutely sure you want to remove '${node.title}'?`))
      return;
    if (node.url == null) await chrome.bookmarks.removeTree(id);
    else await chrome.bookmarks.remove(id);
    setBooksNode(await fetchBooksNode());
  };

  const handleOpenAllInNewWindow = async (id: string): Promise<void> => {
    const newWindow = await chrome.windows.create({
      focused: true,
    });

    const nodeTree = (await chrome.bookmarks.getSubTree(id))[0];

    const processNode = async (
      node: chrome.bookmarks.BookmarkTreeNode,
    ): Promise<void> => {
      for (const c of node.children || []) {
        if (c.url != null) {
          await chrome.tabs.create({
            url: c.url,
            windowId: newWindow.id,
          });
        } else {
          await processNode(c);
        }
      }
    };
    await processNode(nodeTree);
  };

  const handleFixTitles = async (folderId: string): Promise<void> => {
    console.warn('fixing titles!');
    await backupFolder(folderId);
    const nodeTree = (await chrome.bookmarks.getSubTree(folderId))[0];
    
    const processNode = async(
      node: chrome.bookmarks.BookmarkTreeNode
    ): Promise<void> => {
      for (const c of node.children || []) {
        if (c.url != null) {
          const response = await fetch(c.url);
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          console.warn(doc.head.title);
          await chrome.bookmarks.update(c.id, {
            title: doc.head.title,
          });
        } else {
          await processNode(c);
        }
      }
    }
    await processNode(nodeTree);

    setBooksNode(await fetchBooksNode());
  };

  const handleRandomWalkResultClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>, nodeId: string) => {
    e.preventDefault();
    const el = getMap().get(nodeId);
    el?.scrollIntoView();
    return false;
  };

  return (
    <>
      <ul ref={randomWalkResultsRef}>
        {randomWalkResults.map((f) => (
          <li key={f.id}>
            <a href="#" onClick={e => handleRandomWalkResultClick(e, f.id)}>{f.title}</a>
          </li>
        ))}
      </ul>
      <BookmarkList
        root={booksNode}
        refMap={getMap()}
        onOrganizeFolder={handleOrganizeFolder}
        onRandomWalk={handleRandomWalk}
        onRemove={handleRemove}
        onOpenAllInNewWindow={handleOpenAllInNewWindow}
        onFixTitles={handleFixTitles}
      />
    </>
  );
};

export default Management;
