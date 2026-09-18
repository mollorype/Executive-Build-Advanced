# Receipt printing — Epson TM-T81 III

The **Issue Customer Receipt** screen prints through the browser
(`window.print()`), and `src/index.css` now carries a print stylesheet tuned
for the TM-T81 III instead of the old generic A4 one.

## What the stylesheet does

| Setting | Value | Why |
| --- | --- | --- |
| `@page size` | `80mm auto` | Matches the 80 mm roll; `auto` height asks for a page as long as the receipt, not a full sheet. |
| Receipt body width | `72mm` | The TM-T81 III's printable area is 72 mm (576 dots @ 203 dpi). Anything wider is clipped. |
| Page margin | `0` (2 mm side gutter on the body) | The printer has no unprintable margin to respect, and a `0` margin also suppresses Chrome's URL/date headers. |
| Colour | Everything forced to `#000` on `#fff` | The head is 1-bit — greys dither into muddy patterns and light hairlines drop out entirely. |
| Borders | Dashed → solid 1 px, radius removed, shadows removed | Dashed/rounded/shadowed edges print as speckle. |
| Font | `Consolas / Courier New / monospace`, 11 px (10 px in the items table) | Fixed-width keeps the amount column aligned; ~41 characters fit across 72 mm. |
| Everything except the receipt | Hidden | The dark action bar and app chrome never reach the paper. |

The on-screen receipt is unchanged — these rules only apply to `@media print`.

## Windows setup (USB)

1. Install the **Epson Advanced Printer Driver (APD)** for the TM-T81 III and
   let it detect the printer.
2. Open *Printers & scanners → EPSON TM-T81III → Printing preferences*:
   - **Paper size**: `Roll Paper 80 x 297 mm` (or a custom 80 mm width).
   - **Paper conservation / Reduce paper feed**: on — this is what stops the
     printer feeding the remainder of the 297 mm page after a short receipt.
   - **Auto cut**: *Cut per page* (or *Cut at end of document*), so the roll is
     cut after each receipt.
3. In Chrome's print dialog (Ctrl+P), the first time only:
   - **Destination**: EPSON TM-T81III
   - **Margins**: None
   - **Scale**: Default (100 %)
   - **Headers and footers**: unchecked
   - **Background graphics**: on

   Chrome remembers these per destination.

A three-line receipt comes out about 101 mm long (measured from the rendered
print layout), and grows roughly 4.3 mm per extra fuel line.

### Step by step, in detail

Exact wording differs a little between APD 5 and APD 6 and between Windows
versions, so each step below says **what the setting does** — look for the
option that matches, not necessarily the identical label.

**1. Get the right driver.** On Epson's support site, open the TM-T81 III page
and download *Advanced Printer Driver* (APD) for Windows. Take APD 6 if it is
offered for your Windows version, otherwise APD 5. Do **not** use the generic
"Windows driver" — the APD is the one that exposes roll-paper, auto-cut and
paper-conservation settings.

**2. Install with the printer connected.** Power the printer on, plug the USB
cable in, then run the installer **as Administrator**. Choose the standard /
*Easy Install* path, select model **TM-T81III**, and let it pick the detected
USB port. Keep the default queue name (`EPSON TM-T81III Receipt`) — you will
look for it in Chrome later. Finish with the installer's **test print** so you
know the hardware and cable are good before any browser is involved.

**3. Open Printing Preferences.** *Settings → Bluetooth & devices → Printers &
scanners → EPSON TM-T81III Receipt → Printing preferences*. These are the
per-document defaults Chrome inherits.

**4. Paper size.** Pick the 80 mm roll entry — typically
`Roll Paper 80 x 297 mm`. The 297 mm is a maximum page length, not a fixed
feed; step 5 is what keeps short receipts short. If no 80 mm entry exists,
create a custom form of 80 mm width and 297 mm length and select that.
Leave orientation **Portrait**.

**5. Paper conservation.** Find the *Paper Conservation* / *Paper Saving*
group and enable the reductions — top margin, bottom margin, blank line and
line space. Without this the printer feeds the balance of the 297 mm page
after every 101 mm receipt, which wastes about two thirds of your roll.

**6. Auto cut.** In the document/feed settings, set cutting to **per page**
(*Cut per page*, *Feed & cut*, or *Cut at end of document* — any of these cuts
after each receipt, since one receipt is one page here). If you set *No cut*,
staff have to tear each receipt by hand.

**7. Print density and speed.** Defaults are fine for normal thermal rolls.
If receipts look faint, raise density one step; if the printer stutters on
long receipts, drop the speed one step. Density above the default shortens
head life, so only change it if the output is actually pale.

**8. Cash drawer and buzzer.** Under the peripherals/device settings, leave
the drawer pulse **off** unless a drawer is actually wired to the printer —
an enabled pulse on a printer with no drawer just adds a click and a delay to
every receipt.

**9. Make it the Windows default.** In *Printers & scanners*, turn **off**
"Let Windows manage my default printer", then set EPSON TM-T81III as the
default. Otherwise Windows silently repoints the default at whatever was used
last, and receipts end up queued on an office printer.

**10. Prime Chrome once.** Open a receipt in the app, press Ctrl+P and set
destination, Margins: None, Scale: Default, headers/footers off, background
graphics on. Chrome stores these per destination, so it is a one-time step per
machine.

### Optional: skip the print dialog entirely

For a counter PC, Chrome's `--kiosk-printing` flag makes the app's Print
button go straight to the default printer with no dialog. Create a desktop
shortcut whose target is:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://<your-daily-app-url>
```

Staff open the app from that shortcut; `window.print()` then prints silently
using the preferences configured above. Everything else still works normally
in an ordinary Chrome window — the flag only affects windows launched from
this shortcut.

### If the output is wrong

| Symptom | Cause |
| --- | --- |
| Long blank feed after each receipt | Paper conservation off (step 5). |
| Right-hand column cut off | Paper size set to 58 mm, or Chrome scale not 100 %. |
| Tiny receipt in the corner of a long page | Chrome is printing to a sheet-paper destination, not the TM queue. |
| URL and date printed at the top | "Headers and footers" still ticked in Chrome. |
| Grey/washed-out text | Background graphics off, or driver density set low. |
| Nothing prints, no error | Windows default printer got repointed (step 9). |

## Android

Chrome on Android prints through the Android print framework, so the phone
needs a print service that can see the printer:

- **Epson Print Enabler** (Play Store) for a network-connected TM-T81 III, or
- **Epson TM Print / ePOS** for Bluetooth/USB-connected TM units.

The same stylesheet applies — only the paper size has to be selected in the
Android print sheet.

## If you later want cut/drawer control without a print dialog

CSS printing cannot trigger the auto-cutter on demand, open a cash drawer, or
print silently — those need raw **ESC/POS** commands. That means either:

- wrapping the app with Capacitor (Android) or Tauri (Windows) and sending
  ESC/POS over USB/Bluetooth from native code, or
- running Epson's **ePOS-Print** (network/ePOS-capable TM units), where the
  browser POSTs an ESC/POS XML document straight to the printer.

Both are a separate piece of work from this stylesheet; the current setup
relies on the printer driver's own "cut per page" setting instead.
