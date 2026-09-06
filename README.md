# LAN Transfer

Send files directly between two laptops (or a laptop and a phone) on the
same Wi-Fi — no internet, no compression, no upload/download through
WhatsApp or email. Files move straight from one browser to the other over
your local network using WebRTC.

## Requirements

- [Node.js](https://nodejs.org) installed on **one** of the devices (the
  one that will run the server). Any recent version works.
- All devices on the **same Wi-Fi network** (or one device's hotspot,
  with the others connected to it).

## Setup (do this once)

1. Copy this whole `lan-transfer` folder onto the device that will run
   the server.
2. Double-click **`Start LAN Transfer.bat`** (Windows) or
   **`Start LAN Transfer.command`** (Mac).
   - The first time, it installs a few components automatically (needs
     internet for this one step only) — this takes under a minute.
   - Your browser then opens on its own, already connected.
   - Keep that black window open while you're transferring files;
     closing it stops the app.

No typing in a terminal is needed after the first double-click.

## Using it

1. The app window shows a **link and a QR code** near the top.
2. On another laptop: open that link in a browser.
   On a phone: just scan the QR code with the camera.
3. All connected devices will see each other under "Devices on this
   network".
4. Drag and drop your files (photos, videos, anything) onto the page, then
   click the other device's name to send.
5. On the receiving device, tap **Accept** — the file saves straight into
   its normal Downloads folder, at full quality, with a live speed readout
   while it transfers.

## Notes

- Nothing is uploaded to the internet or to any server outside your own
  network — the file goes directly from one browser to the other.
- Only the laptop running `npm start` needs Node.js installed; the other
  side only needs a browser.
- Works for as many files/GBs as you like — large videos are fine, it's
  only limited by your Wi-Fi speed.
- If the two laptops can't see each other, double check they're on the
  exact same network (some public/office Wi-Fi networks block devices
  from seeing each other — a home Wi-Fi or personal hotspot always works).
