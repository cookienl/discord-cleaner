// Everything that depends on Discord's page structure lives here.
// Discord changes its markup regularly; when the cleaner stops finding
// something, this is the file to update. Each entry is a list of CSS
// selectors tried in order, or a regex matched against visible text.
globalThis.DC_SELECTORS = {
  // The search box in the channel header (a contenteditable editor).
  searchInput: [
    'div[role="combobox"][aria-label="Search"] [contenteditable="true"]',
    '[aria-label="Search"][contenteditable="true"]',
    '[class*="searchBar"] [contenteditable="true"]',
    'div[class*="search_"] [contenteditable="true"]',
  ],

  // Autocomplete popout that appears while typing in the search box.
  searchAutocompleteOption: [
    '[class*="searchPopout"] [role="option"]',
    '[class*="searchPopout"] [class*="option"]',
    '[role="listbox"] [role="option"]',
  ],

  // The search results panel.
  resultsPanel: [
    'section[aria-label*="Search Results" i]',
    '[class*="searchResultsWrap"]',
    'div[class*="searchResults"]',
  ],

  // A single result wrapper (contains one message).
  resultItem: '[class*="searchResult_"], [class*="searchResult"], [role="listitem"], li',

  // Loading indicator inside the results panel.
  resultsLoading: '[class*="spinner"], [class*="loading"]',

  // Text shown when search has no hits / is still indexing.
  noResultsText: /no results|searched far and wide|we couldn.t find/i,
  indexingText: /being indexed|indexing/i,

  // Sort control. Either tabs ("Newest", "Oldest", ...) or a dropdown.
  sortOldestText: /^oldest$/i,
  sortDropdownText: /^(sort( by)?:?\s*)?(newest|oldest|most relevant|relevance|relevant)$/i,
  sortOptions: '[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"]',

  // Pagination at the bottom of the results.
  nextPage: [
    'button[rel="next"]',
    'button[aria-label="Next"]',
    '[class*="pagination"] button[aria-label*="next" i]',
  ],

  // "Jump" button on a search result.
  jumpText: /^jump$/i,

  // Message element in the main chat after jumping:
  // <li id="chat-messages-<channelId>-<messageId>">
  chatMessage: (id) => `[id^="chat-messages-"][id$="-${id}"]`,

  // Message content node, present in both search results and chat.
  messageContentPrefix: 'message-content-',

  // Right-click menu and its items.
  contextMenu: '[role="menu"]',
  menuDelete: ['#message-delete', '[id$="-delete"][role="menuitem"]'],
  menuDeleteText: /^delete message$/i,
  menuEdit: ['#message-edit', '[id$="-edit"][role="menuitem"]'],
  menuEditText: /^edit message$/i,

  // Confirm dialog (only used if shift-click didn't skip it).
  dialog: '[role="dialog"]',
  dialogConfirmText: /^delete$/i,

  // Toasts / dialogs that mean Discord wants us to slow down.
  notices: '[class*="toast"], [role="alert"], [role="dialog"], [class*="notice"]',
  rateLimitText: /rate limit|too fast|slow down|try again (later|in)/i,
};
