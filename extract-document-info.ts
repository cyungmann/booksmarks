const extractDocumentInfo: (document: Document) => {
  numRatings: number;
  rating: number;
  title: string;
} = (document: Document) => {
  try {
    const numRatingsSpan = document.querySelector<HTMLSpanElement>(
      'span#acrCustomerReviewText',
    );
    let numRatings = 0;
    if (numRatingsSpan != null) {
      const numRatingsMatches =
        numRatingsSpan.innerText.match(/^([\d,]+) ratings$/);
      if (numRatingsMatches?.length == 2)
        numRatings = +numRatingsMatches[1].replaceAll(',', '');
    }

    const title = document
      .querySelector<HTMLSpanElement>('span#productTitle')
      ?.innerText?.trim();

    const ratingSpan =
      document.querySelector<HTMLSpanElement>('span#acrPopover');
    const ratingMatches = ratingSpan?.innerText?.trim()?.match(/^\d\.?\d?/);
    let rating = 0;
    if (ratingMatches?.length === 1) rating = +ratingMatches[0];

    return { numRatings, rating, title };
  } catch (e: unknown) {
    console.warn(JSON.stringify(e));
    alert(JSON.stringify(e));
    return { numRatings: 0, rating: 5, title: 'Title' };
  }
};

export default extractDocumentInfo;
