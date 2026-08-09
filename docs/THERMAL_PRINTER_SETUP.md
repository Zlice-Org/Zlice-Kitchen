# 58mm Thermal Printer Setup

## Overview

Setup guide for 58mm ESC/POS thermal printers (bills and Kitchen Order Tickets) on the
canteen POS. Deployment target is Windows counter PCs running Chrome or Edge, plus a
smaller fleet of Android tablets. Linux/CUPS is covered because it is the test bench.

## How the App Decides

Both `printReceipt()` and `printKOT()` build ESC/POS bytes first, then hand them to
`sendRawToPrinter()`, which walks the transports in a fixed order and only reaches the
browser print dialog when both wire transports are unavailable.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PRINT TRANSPORT ORDER                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   printReceipt(data)  /  printKOT(data)                                     │
│            │                                                                │
│            ▼  build ESC/POS byte stream                                     │
│   ┌──────────────────┐                                                      │
│   │ sendRawToPrinter │                                                      │
│   └──────────────────┘                                                      │
│            │                                                                │
│            ├──1──► WebUSB          ──► claimInterface ──► bulk OUT ──► ROLL │
│            │       (only if already granted - never opens a chooser)        │
│            │                                                                │
│            ├──2──► Web Bluetooth   ──► GATT characteristic ─────────► ROLL  │
│            │       (paired BLE printer, unless disabled in Settings)        │
│            │                                                                │
│            └──3──► null ──► printHTML() ──► browser print dialog ──► OS     │
│                                              driver ──► ??? ──► ROLL        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The dialog is the last resort because it does not send ESC/POS at all: it hands the OS a
rendered **PDF** and leaves the bytes-on-paper problem to whatever driver the print queue
has. Against a queue with no ESC/POS driver — a Windows "Generic / Text Only" queue, or a
**raw** CUPS queue — the printer receives PDF source and prints it as literal text
(`%PDF-1.7`, `/FlateDecode`, then metres of binary), which is the exact failure this
document exists to prevent.

| Order | Transport | Requires | Silent | Fidelity |
|-------|-----------|----------|--------|----------|
| 1 | WebUSB | HTTPS origin + WinUSB-bound printer + one-time pairing | Yes | Raw ESC/POS |
| 2 | Web Bluetooth | Paired BLE printer, `printer-bluetooth-enabled` not `false` | Yes | Raw ESC/POS |
| 3 | Print dialog | A Windows/CUPS queue with a 58mm ESC/POS driver | No (unless `--kiosk-printing`) | PDF via driver |

USB is attempted only when `getAuthorizedUSBPrinter()` already returns a device, so a
mid-order print never pops a device chooser at the counter.

### Deployment Options at a Glance

| | Option A - WinUSB direct | Option B - Windows spooler |
|---|---|---|
| Best for | Fixed counter PC, one dedicated printer | Shared printer, or a PC that must also print A4 |
| Output | Raw ESC/POS down the cable | PDF through the vendor driver |
| Dialog | None | None with `--kiosk-printing`, otherwise one click |
| Still a Windows printer | **No** | Yes |
| Dialog fallback still works | **No** | Yes |
| Setup effort | Zadig once + pair once | Vendor driver + Chrome shortcut flag |

## Files

| File | Purpose |
|------|---------|
| `lib/printer/usb-printer.ts` | WebUSB transport: pairing, silent re-acquire, raw byte writes |
| `lib/printer/pwa-printer.ts` | Bill ESC/POS builder, Bluetooth transport, `sendRawToPrinter()` |
| `lib/printer/kot-printer.ts` | KOT ESC/POS builder and its HTML fallback sheet |
| `lib/printer/html-print.ts` | Off-screen iframe that drives the browser print dialog, and pins the `@page` box to the roll width and the measured receipt height |
| `components/printer-settings.tsx` | Printer Settings card on `/settings` (pair, forget, test print) |

Saved state lives in `localStorage`, per browser profile and per origin:

| Key | Meaning |
|-----|---------|
| `printer-usb-name` | Label of the paired USB printer (display only; the grant itself is held by the browser) |
| `bluetooth-printer-id` | Device id of the paired BLE printer |
| `bluetooth-printer-name` | Label of the paired BLE printer |
| `printer-bluetooth-enabled` | Opt-out flag. Absent means Bluetooth is enabled |

## Option A - WinUSB Direct (recommended for a fixed counter PC)

Chrome and Edge reach USB devices on Windows through **WinUSB**. A printer left on the
stock `usbprint.sys` class driver is owned by the print spooler, so `claimInterface()`
fails and the printer is usually not even listed in the device chooser. Rebinding it to
WinUSB is what makes silent, dialog-free ESC/POS printing possible.

**Prerequisite:** WebUSB is a secure-context API. The app must be served over **HTTPS**,
or opened as `http://localhost` on the counter PC itself. On a plain `http://192.168.x.x`
origin `navigator.usb` does not exist and the pairing button is unavailable.

1. Plug the printer in, switch it on, confirm it is loaded with paper.
2. Download Zadig (<https://zadig.akeo.ie>) and run it as Administrator.
3. **Options → List all devices.** Without this the printer does not appear, because it
   already has a driver bound.
4. In the dropdown, select the printer. On a composite device pick the interface whose
   USB class reads `USB Printer (7, 1, 2)` — usually `Interface 0`. Check the USB ID
   against the label on the printer before continuing.
5. Set the target driver to **WinUSB**, then click **Replace Driver**. Zadig warns about
   replacing a system printer driver; that warning is expected here.
6. Unplug and replug the printer so Windows re-enumerates it under the new driver.
7. In the app: **Settings → Printer Settings → USB Printing → Pair USB Printer**, choose
   the printer in the Chrome chooser, then run **USB Test Print**. The **USB Available**
   badge is a browser check only — *Yes* means this browser exposes WebUSB, not that the
   printer is reachable, so the test print is what proves the setup. **Forget USB
   Printer** clears the pairing again.

The grant is remembered by the browser per origin, so every later print re-acquires the
printer silently — no chooser, no dialog.

> ⚠️ **CRITICAL - the tradeoff**: after the WinUSB rebind the device is no longer a
> Windows printer. It disappears from **Settings → Bluetooth & devices → Printers &
> scanners**. Notepad, PDF readers, other POS software, and the app's own print-dialog
> fallback can no longer reach it. Only this app, on this origin, in this Windows user's
> Chrome profile, can print. Choose Option A only when the printer is dedicated to the
> POS.

**To reverse it:** Device Manager → find the printer under *Universal Serial Bus devices*
→ **Uninstall device** with *Delete the driver software for this device* ticked → replug.
Windows reinstalls `usbprint.sys` and Option B becomes available again.

## Option B - Windows Spooler (keeps it a normal Windows printer)

Here the printer stays on the spooler and the app prints through the dialog path. It is
slower and lower fidelity than raw ESC/POS, but the printer remains usable by every other
application on the PC.

1. Install the vendor 58mm driver (POS-58 / XP-58 family, sometimes badged ZJ-58 or
   POS-5890). The generic Microsoft driver is **not** enough — it is what produces PDF
   source on the roll.
2. **Printer preferences → Paper size → 58mm roll** (vendor UIs also label this
   `58 x 3276 mm` or `Roll Paper 58mm`). Print a Windows test page and confirm the text
   fits inside the paper.
3. **Set as default printer.** `--kiosk-printing` always prints to the default printer.
4. Turn **off** *Let Windows manage my default printer*, otherwise Windows silently
   re-points the default at the last printer used and bills start coming out on A4.
5. Launch Chrome from a shortcut whose **Target** is exactly:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://pos.example.com/orders/take
   ```

   Edge equivalent:

   ```
   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing --app=https://pos.example.com/orders/take
   ```

   Replace the URL with the deployed origin. The flag is read at process start, so close
   every existing Chrome window before launching from the shortcut.
6. Print a bill. It should reach paper with no dialog and no confirmation.

**The tradeoff:** every bill is rendered to PDF and re-rasterised by the driver, which
costs a second or two per print and makes the layout only as good as the driver. Because
`--kiosk-printing` prints to the default printer with no confirmation, an operator who
changes the default redirects bills to whatever that printer is, with nothing on screen
to say so.

## Linux / CUPS (test bench)

> ⚠️ A **raw** queue (`lpadmin -m raw`, or "Generic → Raw Queue" in the CUPS UI) is the
> exact misconfiguration that reproduces the PDF-on-paper bug. A raw queue applies no
> filter and passes the PDF straight to the device. Install an ESC/POS raster driver.

`zj-58` provides the `rastertozj` filter plus `zj58.ppd`, and covers Zijiang ZJ-58,
XPrinter XP-58 and most other 58mm ESC/POS clones.

```bash
# Build dependencies (Debian/Ubuntu; Fedora: cmake cups-devel)
sudo apt install build-essential cmake libcups2-dev libcupsimage2-dev

git clone https://github.com/klirichek/zj-58
mkdir -p zj-58/build && cd zj-58/build
cmake .. && cmake --build .

# Installs rastertozj -> /usr/lib/cups/filter/
#          zj58.ppd   -> /usr/share/cups/model/zjiang/
sudo cmake --build . --target install
sudo systemctl restart cups
```

If you install by hand instead of via the target, those two paths are the ones that
matter:

```bash
sudo install -m 755 rastertozj /usr/lib/cups/filter/
sudo mkdir -p /usr/share/cups/model/zjiang
sudo install -m 644 ../zj58.ppd /usr/share/cups/model/zjiang/
```

Create the queue against the PPD, never with `-m raw`:

```bash
lpinfo -v | grep usb
# usb://ZJ-58/Printer?serial=XXXXXXXX

sudo lpadmin -p ZJ58 -E -v 'usb://ZJ-58/Printer?serial=XXXXXXXX' \
  -P /usr/share/cups/model/zjiang/zj58.ppd
lpoptions -d ZJ58
```

**Device node permissions.** The kernel exposes the printer as `/dev/usb/lp0`, owned
`root:lp` with mode `0660`, so a normal user cannot write to it directly:

```bash
ls -l /dev/usb/lp0
# crw-rw---- 1 root lp 180, 0 /dev/usb/lp0

sudo usermod -aG lp "$USER"      # log out and back in for it to take effect
printf '\x1b@Hello\n\n\n\n' > /dev/usb/lp0
```

**WebUSB on Linux** hits the same ownership problem Windows has with `usbprint.sys`: the
`usblp` kernel module claims the printer interface. If `claimInterface()` fails, release
it with `sudo modprobe -r usblp` (or blacklist it), and add a udev rule so Chrome may open
the device without root:

```
# /etc/udev/rules.d/99-escpos.rules  (use your printer's idVendor/idProduct)
SUBSYSTEM=="usb", ATTRS{idVendor}=="0416", ATTRS{idProduct}=="5011", MODE="0660", GROUP="lp"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Roll prints `%PDF-1.7`, `/FlateDecode` and binary garbage | The job went out over the print-dialog path to a queue with no ESC/POS driver (Windows "Generic / Text Only", or a raw CUPS queue), which forwards the PDF bytes verbatim | Stop relying on the fallback: do Option A, or Option B with the vendor 58mm driver installed. On Linux rebuild the queue with `-P zj58.ppd` instead of `-m raw` |
| Nothing prints at all, no error | Printer is out of paper / cover not latched / powered off, or the cable is a charge-only USB lead with no data pair | Hold **FEED** while switching the printer on: a self-test slip proves the printer and paper are fine. Then swap in a known data cable and re-pair. Console shows `❌ USB print error:` or `📄 Thermal print unavailable` |
| Receipt starts, then the printer hangs mid-roll | The job was cut short — the spooler was still generating when the source went away, or a USB bulk transfer failed partway and the printer sits waiting for the rest of the stream. Cheap firmware also stalls on a band-by-band bitmap logo | Power-cycle the printer to flush its buffer, then cancel the stuck job (**Printers & scanners → Open print queue → Cancel all documents**). Keep bitmap logos out of the fallback HTML — the wordmark is printed as text for this reason. Option A avoids the spooler entirely |
| **Pair USB Printer** ends in "No USB printer selected" | That string covers both a dismissed chooser and an empty one, and on Windows an empty chooser means the printer is still bound to `usbprint.sys` — the spooler owns it, so Chrome cannot enumerate it | If the chooser was empty rather than dismissed, re-clicking will not help: run Zadig → **Options → List all devices** → select the printer's interface → **WinUSB** → **Replace Driver** → replug → pair again. On Linux the equivalent owner is `usblp`: `sudo modprobe -r usblp` |
| The USB buttons are greyed out and the card reads "WebUSB needs Chrome or Edge over HTTPS" | The page is on a plain `http://` origin or a browser without WebUSB, so `navigator.usb` does not exist (WebUSB is secure-context only) | Serve the app over HTTPS, or open it as `http://localhost` on the counter PC, in Chrome or Edge. Bills keep printing over Bluetooth or the dialog meanwhile |
| **USB Available** reads *Yes* but **USB Test Print** reports "✗ USB test print failed - check cable and pairing" | The badge only reflects `isWebUSBAvailable()`, i.e. this browser exposes `navigator.usb` — it says nothing about a printer being plugged in or claimable. A *Yes* badge with a failing test is the spooler-ownership case, or a stale handle after a power-cycle, a charge-only cable, or another process holding the interface | Rebind the printer to WinUSB with Zadig if that has not been done, then replug it, close other POS software and re-run the test. Console carries the reason after `❌ USB print error:` |
| Paired, but every print silently falls back to the dialog | WebUSB grants are per origin *and* per browser profile. Opening the app on a different URL (`http` vs `https`, IP vs hostname, different port) or under a different Windows/Chrome profile makes `getDevices()` return nothing, so USB is skipped without a warning | Launch from one bookmarked origin only, and re-pair on that origin. Diagnostic: **no** "⚠️ USB printer did not respond" toast means there is no grant here; **seeing** that toast means the grant exists but the write failed — another process is holding the interface, so close other POS software and check the console for `❌ USB print error:` |
| Text runs off the right edge, or the bill stops a few lines in (dialog path) | Two separate faults land here. (a) `@page { size: 58mm auto; … }` is **invalid CSS** — the `size` grammar is `<length>{1,2} \| auto \| <page-size>`, so a length paired with `auto` matches nothing and the browser drops the whole declaration, falls back to the driver's default paper and lays the receipt out on **US Letter**; a 58mm head then prints only the top fragment that fits, i.e. a bill truncated right after the header, and the printer sits waiting for the rest. (b) A non-zero `@page` margin shrinks the page box below the 58mm body, clipping the right edge | Never pair a length with `auto`. Use two explicit lengths — `@page { size: 58mm 297mm; margin: 0; }` — and let `printHTML()` replace it at print time with the measured content height, which yields a single page exactly as tall as the receipt. Keep the margin at `0` and put side spacing in the body padding. Set the driver's paper to 58mm roll |
| Text runs off the right edge (raw ESC/POS path) | Font and column count are out of step. A 58mm head is 384 dots, so Font A (12 dots wide) gives 32 columns and Font B (9 dots) gives 42. The bill is laid out at 42 and depends on `ESC M 1` selecting Font B; a printer left in — or reverting to — Font A wraps every separator and total at column 32 | Confirm `ESC @` is followed by `ESC M 1` in `buildESCPOSCommands()`. If the printer's firmware ignores `ESC M`, lay the bill out at 32 columns the way `kot-printer.ts` does |
| Paper feeds but comes out blank | Thermal paper is loaded with the coated side away from the head | Reload the roll so it feeds off the **bottom** of the roll, coated side up. Scratch a corner with a fingernail: the coated side marks grey |
| Chrome still shows the print dialog despite `--kiosk-printing` | The flag is only read at process start, and an already-running Chrome reuses the existing process | Close every Chrome window (check the tray), then relaunch from the shortcut. Confirm the flag is listed on `chrome://version` under *Command Line* |
| The receipt prints **rotated 90 degrees**, or shrunk to tiny text and clipped on the left | The driver's selected paper is **shorter than the receipt**, so the print pipeline scales the page down to make it fit — and auto-rotates it when the page is nearer square than the paper. Nothing to do with the receipt HTML: the same document prints correctly once the paper matches. On Linux this is the CUPS queue's `PageSize`; the `zj-58` PPD ships defaulting to `58mm x 65mm`, which mangles every bill. On Windows it is the vendor driver's **Paper Size** | Set the paper to something at least as tall as a bill. Linux: `sudo lpadmin -p <queue> -o PageSize=X48MMY297MM -o fit-to-page=false`, verify with `lpoptions -p <queue> -l \| grep PageSize` (the active one is starred). Windows: **Printers & scanners → your printer → Printing preferences → Paper Size → 58 x 297mm** (or the roll option). Diagnostic: if the *content* is right but the *scale or angle* is wrong, it is always the paper size, never the app |
| Every bill is followed by a long blank feed | The driver's paper is much taller than the bill and the printer advances the full page. The `zj-58` PPD only offers fixed lengths — 65 / 105 / 210 / 297 / 3276mm — with no variable roll length, so a 240mm bill on a 297mm page wastes ~57mm | Pick the smallest listed size that still clears your longest bill, or pass an exact size per job (`lp -o PageSize=Custom.58x240mm`) since the PPD sets `*VariablePaperSize: True`. The raw ESC/POS path has no page concept and feeds only what it prints — that is the only way to get zero waste |

## Paper Geometry Reference

| Property | Value |
|----------|-------|
| Roll width | 58 mm |
| Printable width | 48 mm = **384 dots** |
| Head resolution | **203 dpi** (8 dots/mm) |
| Font A (12 x 24 dots) | **32 characters per line** — printer default after `ESC @`; used by the KOT |
| Font B (9 x 17 dots) | 42 characters per line — selected with `ESC M 1`; used by the bill |
| Feed for tear-off | ~4 blank lines (the builders emit these instead of `GS V`, which many 58mm units ignore) |
| Print-dialog page box | `58mm x 297mm` static floor, replaced at print time with `58mm x` the measured content height |

How the code uses that geometry:

- `kot-printer.ts` builds the KOT at `W = 32`, i.e. Font A.
- `pwa-printer.ts` builds the bill at `W = 42` and sends `ESC M 1` (Font B) immediately
  after `ESC @`. The column count and the font selection must always be changed together
  — 42 columns in Font A wraps at 32 and shreds the bill into ragged half-lines.
- The HTML fallback sheets in both files declare `@page { size: 58mm 297mm; margin: 0; }`,
  and `printHTML()` overrides the height at print time by measuring the laid-out receipt.
  **Never write `size: 58mm auto`** — a length paired with `auto` is invalid per the CSS
  `size` grammar, so the browser discards the entire declaration and falls back to the
  driver's default paper (US Letter), which is what makes a 58mm printer emit only the
  header before stalling. Verified in Chrome: the rule serialises back as
  `@page { margin: 0px; }` with `size` stripped.
- The override is `applyExactPageSize()` in `html-print.ts`, appended last so it beats the
  sheet baked into the receipt HTML. Its constants live in the same file: 58mm default
  width, `+2mm` slack to absorb rounding so the tail cannot spill onto a second strip, and
  a 1200mm ceiling so a runaway measurement cannot feed metres of blank paper. A failure
  there is caught and logged (`🖨️ Could not pin the page size:`), falling back to the
  sheet's own rule rather than losing the print.
- **A non-zero `@page` margin is what clips the right edge**: it shrinks the page box
  below the 58mm-wide body, and the overflow has nowhere to go. Side spacing belongs in
  the body's `padding` (currently `3mm`), which sits inside the page box.
