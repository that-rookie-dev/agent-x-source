/** Sliding window size for the chat message list (includes thought-bearing turns). */
export const MESSAGE_PAGE_SIZE = 50;

/** After load-more, allow up to two pages before dropping the newest page. */
export const MESSAGE_WINDOW_MAX = MESSAGE_PAGE_SIZE * 2;
