# Discord Cleaner

A Chrome extension that deletes your own messages in a Discord server, one at a time, by driving the Discord web app the same way you would by hand:

1. It types `from:<you> after:<start date>` into Discord's search box and sorts the results **Oldest** first.
2. It right-clicks the first result. If the search result's menu has no "Delete Message", it clicks **Jump** and right-clicks the message in the chat instead.
3. It holds Shift and clicks **Delete Message**, which skips the confirmation dialog.
4. It waits a random delay, then moves to the next result, the next page, or a fresh search.
5. When search comes back empty, it searches once more to confirm and then stops.

> **Warning:** automating a user account is against Discord's Terms of Service. Accounts can be flagged or banned for it. Deleted messages cannot be recovered. Use at your own risk.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
4. Pin the extension so its icon is easy to reach.

## Use

1. Open https://discord.com in Chrome, log in, and open any channel in the server you want to clean.
2. Click the extension icon and fill in:
   - **Your Discord username**: your unique username (not your display name). It is used for `from:`.
   - **Start date**: messages sent on or after this day are deleted.
   - **Min / max delay**: a random pause between deletions. The default of 2–4 seconds is a safe pace.
   - **Max messages**: stop after this many deletions (0 = no limit). Try a small number such as 5 first.
3. Click **Start**. You can close the popup; reopen it to see progress or to click **Stop**.

Keep the Discord tab **visible** while it runs. Chrome slows down timers in background tabs, which makes the cleaner very slow.

### What the counters mean

- **deleted**: the message disappeared after clicking Delete.
- **unconfirmed**: Delete was clicked but the message stayed on screen. It is retried if a later search still finds it.
- **skipped**: no "Delete Message" option after 3 tries, or the menu had no "Edit Message". Only your own messages have "Edit Message", so the cleaner skips any message without it. This stops it deleting someone else's message if you are a moderator.

## Scope

- Server channels only (not DMs). The search covers the whole server you have open.
- English Discord interface (it finds menu items by their text).

## When Discord updates its layout

All page lookups (search box, results panel, menu items, buttons) live in [`src/selectors.js`](src/selectors.js). If the log shows errors like "Could not find the Discord search box", update the matching entry there and click the reload button for the extension in `chrome://extensions`.

## Files

- `manifest.json`: extension manifest (Manifest V3)
- `src/selectors.js`: Discord page lookups
- `src/content.js`: the automation that runs inside the Discord page
- `popup/`: the settings, start/stop controls and live log
