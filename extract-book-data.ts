import type { BookData } from 'book-data';

const extractBookData: (document: Document) => BookData = (
  document: Document,
) => {
  if (document.head.querySelector('title')?.textContent.trim() === 'Page Not Found') {
    return {
      is404: true,
    };
  }

  const numRatingsSpan = document.querySelector<HTMLSpanElement>(
    'span#acrCustomerReviewText',
  );
  let numRatings = 0;
  if (numRatingsSpan != null) {
    const numRatingsMatches =
      numRatingsSpan.innerText.match(/^([\d,]+)$/);
    if (numRatingsMatches?.length == 2)
      numRatings = +numRatingsMatches[1].replaceAll(',', '');
  }

  const title = document
    .querySelector<HTMLSpanElement>('span#productTitle')
    ?.innerText?.trim();

  const ratingSpan = document.querySelector<HTMLSpanElement>('span#acrPopover');
  const ratingMatches = ratingSpan?.innerText?.trim()?.match(/^\d\.?\d?/);
  let rating = 0;
  if (ratingMatches?.length === 1) rating = +ratingMatches[0];

  return { numRatings, rating, title };
};

export default extractBookData;
