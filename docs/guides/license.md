# Try Viewer and enter a license key

Use the direct-download edition for 30 days from its first launch. Viewer stays quiet during the
trial. **Viewer → About Viewer** and **Settings → License** show the days left.

**Find it:** **Viewer → License Key…** · **⌘K** → **License Key…** · **Settings → License**

## Buy Viewer

1. Open **Settings → License**.
2. Choose **Buy Viewer**. Viewer opens the publisher's purchase page in your browser.
3. Make the one-time purchase there and keep the license key you receive. The purchase page states
   the price.

Viewer makes no activation request. Buying happens in your browser, under the purchase site's own
terms.

A license key works with every later version of Viewer.

## Enter your key

1. Choose **Viewer → License Key…**.
2. Paste the complete key into **License key**. Line breaks from copying are accepted.
3. Choose **Save License Key**.

The page changes to **Licensed to** followed by your purchase email. Viewer checks and saves the key
on this Mac. It works offline and is checked again when Viewer starts. To replace a key, paste the
new one and save it. **Remove License Key** clears the saved key and returns to the recorded trial
dates.

A key this build cannot verify stays saved until you replace or remove it. Unreadable license
records are kept for recovery before a fresh trial starts; if recovery cannot finish, Viewer keeps
the existing copy intact and refuses writes for this session. See
[record recovery](../reference/license.md#stored-record).

The key contains your purchase email and order reference. Viewer sends neither to its developer.
Keep the key somewhere private so you can enter it again on a new Mac or in a new data folder.

## After the trial

All features keep working. A bar offers **Buy Viewer**, **Enter license…** and **Hide**. **Hide**
lasts until the next launch, across workspace windows. There is no modal or delay. Entering a valid
key removes the bar.

Updating or reinstalling Viewer keeps the trial and key when its application data folder stays in
place. A new data folder starts a new trial. Terminal CLI and MCP runs never start a trial or show
the reminder.

## If License is absent

The Mac App Store edition has no trial, key entry or license record. A direct build without both a
publisher public key and purchase address also has none. The shipped source leaves those values
empty; a publisher must configure them before selling a direct build.

[Key errors](troubleshooting.md#a-license-key-is-not-accepted) ·
[License format and storage](../reference/license.md) · [All guides](README.md)
