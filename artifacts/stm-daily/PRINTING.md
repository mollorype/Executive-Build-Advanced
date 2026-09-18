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
