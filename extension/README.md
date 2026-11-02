# Add to Vocab (browser extension)

Right-click selected text on any page → **Add to Vocab**. The word goes to the Learning app's
vocabulary with the sentence it was in and a link back to the page; the app writes its entry in the
background and a notification confirms it. Works in Vivaldi, Chrome and other Chromium browsers.

Install once:

1. Open `vivaldi://extensions` and switch on **Developer mode** (top right).
2. **Load unpacked** → choose this folder (`~/Projects/learning/extension`).
3. Keep the folder where it is: the browser loads the extension from it. After editing a file here,
   press the reload arrow on the extension's card.

The app must be running at `http://127.0.0.1:4000` (the `learning` user service starts it at login;
see `scripts/learning.service`). Pages that block extensions (the browser's own pages, the web store,
some PDF viewers) still add the word, without a sentence.
