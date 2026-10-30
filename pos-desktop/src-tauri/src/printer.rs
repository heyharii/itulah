//! The receipt printer on this till's own cable.
//!
//! Receipts are rendered by the node, always: one rendering, so the paper a
//! customer takes home is the paper the shop can print again. A network
//! printer the node sends to itself. A USB printer only this till can reach,
//! so the node renders the receipt and hands back its bytes
//! (`POST /api/v1/store/sales/{id}/receipt/escpos`), and this file sends them
//! down the cable untouched — ESC/POS, the drawer's pulse included.
//!
//! # How the bytes reach the printer
//!
//! - **Windows**: the spooler, as a RAW job (`OpenPrinterW`, `StartDocPrinterW`
//!   with datatype `RAW`, `WritePrinter`), loaded from `winspool.drv` the way
//!   `rfid.rs` loads the reader's SDK. RAW means the driver passes the bytes
//!   through unrendered, which is what a receipt printer's ESC/POS needs; the
//!   printer is named as Windows names it ("EPSON TM-T82 Receipt").
//! - **macOS and Linux**: CUPS, `lp -d <queue> -o raw`, the bytes on its
//!   standard input. The queue must exist (added in System Settings or with
//!   `lpadmin`), and `-o raw` keeps CUPS's filters off them.
//!
//! Nothing here renders, retries or queues. A printer that is off says so, and
//! the cashier prints again from the sale when it is back.

use serde::Serialize;
use serde_json::json;
use tauri::Manager;

use crate::edge::{self, Node};
use crate::peripherals::{Peripherals, RECEIPT_NONE, RECEIPT_RECORDED, RECEIPT_USB};

/// What the sale screen is told after a print.
#[derive(Serialize)]
pub struct PrintedHere {
    /// How many bytes went to the printer.
    pub bytes: usize,
    pub printer: String,
}

/// The printer's name as this machine knows it, when the till prints to USB.
fn usb_printer(app: &tauri::AppHandle) -> Result<String, String> {
    let node = app.state::<Node>();
    let held = edge::lock(node.inner());
    if held.peripherals.receipt_printer != RECEIPT_USB {
        return Err("Printer struk kasir ini bukan printer USB.".into());
    }
    held.peripherals
        .usb_printer_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            "Printer USB belum dipilih. Pilih namanya di Setelan → Perangkat kasir, \
             seperti yang tertulis di daftar printer komputer ini."
                .to_string()
        })
}

/// The language the USB printer reads: what the till was told, else guessed
/// from the model's name — a label printer (Xprinter XP-D4601B and its XP-4xxB
/// kin, TSC, Godex, Zebra) reads TSPL, anything else a receipt printer's
/// ESC/POS. "Make both" (Hari, 30 Oct 2026): a shop with either plugs it in
/// and the receipt prints.
pub fn language_of(peripherals: &Peripherals) -> &'static str {
    match peripherals.receipt_language.as_deref().map(str::trim) {
        Some(said) if said.eq_ignore_ascii_case("TSPL") => return "TSPL",
        Some(said) if said.eq_ignore_ascii_case("ESCPOS") => return "ESCPOS",
        _ => {}
    }
    let name = [&peripherals.usb_printer_model, &peripherals.usb_printer_name]
        .into_iter()
        .flatten()
        .map(|text| text.to_ascii_uppercase())
        .collect::<Vec<_>>()
        .join(" ");
    let label = name.contains("XP-D4")
        || name.contains("XP-D3")
        || ((name.contains("XP-4") || name.contains("XP-3")) && name.trim_end().ends_with('B'))
        || name.contains("LABEL")
        || name.contains("TSC")
        || name.contains("GODEX")
        || name.contains("ZEBRA");
    if label {
        "TSPL"
    } else {
        "ESCPOS"
    }
}

/// Dots per millimetre at 203 dpi, the resolution of the label printers this
/// is for.
const DOTS_PER_MM: usize = 8;
/// TSPL font "2" is 12 × 20 dots; a line takes 26 with its leading.
const FONT_W: usize = 12;
const LINE_H: usize = 26;
/// A row of the label that is a slice of the receipt's picture, not a line of
/// text: `[bytes a row (2), rows (2), the bits]`.
const IMAGE_ROW: u8 = 255;

/// The paper on the roll: how wide, how tall one label is (none: continuous
/// paper, as tall as the text), and the gap between labels.
#[derive(Clone, Debug, PartialEq)]
pub struct LabelStock {
    pub width_mm: usize,
    pub height_mm: Option<usize>,
    pub gap_mm: usize,
}

impl LabelStock {
    /// Receipt paper of 58 or 80 mm, continuous.
    pub fn continuous(wide: bool) -> Self {
        Self { width_mm: if wide { 80 } else { 58 }, height_mm: None, gap_mm: 0 }
    }

    /// What the till was told about its labels, else its paper.
    pub fn of(peripherals: &Peripherals, paper: &str) -> Self {
        let wide = paper.trim().eq_ignore_ascii_case("WIDE");
        match peripherals.label_width_mm {
            Some(width) => Self {
                width_mm: width as usize,
                height_mm: peripherals.label_height_mm.map(|mm| mm as usize),
                gap_mm: peripherals.label_gap_mm.unwrap_or(3) as usize,
            },
            None => Self::continuous(wide),
        }
    }
}

/// A receipt the node rendered in ESC/POS, as one long label in TSPL: the text
/// lines kept with their alignment, the rest (cut, drawer pulse, bold, size,
/// code page, feeds) left out — a label printer has no cutter or drawer — and
/// the label as tall as the lines need, on continuous paper (`GAP 0`).
///
/// `wide` is 80 mm paper, else 58 mm. Printing starts at the paper's own edge,
/// so the paper goes in against the printer's guide.
pub fn escpos_to_tspl(bytes: &[u8], stock: &LabelStock) -> Vec<u8> {
    let width_mm = stock.width_mm;
    let width_dots = width_mm * DOTS_PER_MM;
    let fit = (width_dots - 8) / FONT_W;

    let mut lines: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut line: Vec<u8> = Vec::new();
    let mut align = 0u8;
    let mut at = 0usize;
    let skip = |n: usize, at: &mut usize| *at = (*at + n).min(bytes.len());
    while at < bytes.len() {
        let byte = bytes[at];
        match byte {
            0x0A => {
                lines.push((align, std::mem::take(&mut line)));
                at += 1;
            }
            0x09 => {
                line.push(b' ');
                at += 1;
            }
            0x1B => {
                let command = bytes.get(at + 1).copied().unwrap_or(0);
                match command {
                    b'a' => {
                        let n = bytes.get(at + 2).copied().unwrap_or(0);
                        align = match n {
                            1 | b'1' => 1,
                            2 | b'2' => 2,
                            _ => 0,
                        };
                        skip(3, &mut at);
                    }
                    b'@' => {
                        align = 0;
                        skip(2, &mut at);
                    }
                    b'd' => {
                        let n = bytes.get(at + 2).copied().unwrap_or(0).min(6);
                        if !line.is_empty() {
                            lines.push((align, std::mem::take(&mut line)));
                        }
                        for _ in 0..n {
                            lines.push((0, Vec::new()));
                        }
                        skip(3, &mut at);
                    }
                    b'p' => skip(5, &mut at),
                    b'*' => {
                        let m = bytes.get(at + 2).copied().unwrap_or(0);
                        let n = bytes.get(at + 3).copied().unwrap_or(0) as usize
                            + 256 * bytes.get(at + 4).copied().unwrap_or(0) as usize;
                        let each = if m == 0 || m == 1 { 1 } else { 3 };
                        skip(5 + n * each, &mut at);
                    }
                    // ESC E / G / - / M / ! / t / r / { / V / 3 / J / D: one parameter.
                    b'E' | b'G' | b'-' | b'M' | b'!' | b't' | b'r' | b'{' | b'V' | b'3' | b'J' => {
                        skip(3, &mut at)
                    }
                    _ => skip(2, &mut at),
                }
            }
            0x1D => {
                let command = bytes.get(at + 1).copied().unwrap_or(0);
                match command {
                    // GS V m [n]: cut. 'A'/'B' (65/66) carry a count.
                    b'V' => {
                        let m = bytes.get(at + 2).copied().unwrap_or(0);
                        skip(if m == 65 || m == 66 { 4 } else { 3 }, &mut at)
                    }
                    // GS k: a barcode, which a label has no use for here.
                    b'k' => {
                        let m = bytes.get(at + 2).copied().unwrap_or(0);
                        if m <= 6 {
                            let mut end = at + 3;
                            while end < bytes.len() && bytes[end] != 0 {
                                end += 1;
                            }
                            skip(end + 1 - at, &mut at);
                        } else {
                            let n = bytes.get(at + 3).copied().unwrap_or(0) as usize;
                            skip(4 + n, &mut at);
                        }
                    }
                    // GS v 0 m xL xH yL yH data: a raster image (the store's
                    // picture at the top of the receipt). Kept: slices of one
                    // picture follow each other and are joined.
                    b'v' => {
                        let w = bytes.get(at + 4).copied().unwrap_or(0) as usize
                            + 256 * bytes.get(at + 5).copied().unwrap_or(0) as usize;
                        let h = bytes.get(at + 6).copied().unwrap_or(0) as usize
                            + 256 * bytes.get(at + 7).copied().unwrap_or(0) as usize;
                        let data = bytes
                            .get(at + 8..(at + 8 + w * h).min(bytes.len()))
                            .unwrap_or(&[])
                            .to_vec();
                        if !line.is_empty() {
                            lines.push((align, std::mem::take(&mut line)));
                        }
                        let mut payload =
                            vec![(w & 0xFF) as u8, (w >> 8) as u8, (h & 0xFF) as u8, (h >> 8) as u8];
                        payload.extend_from_slice(&data);
                        lines.push((IMAGE_ROW, payload));
                        skip(8 + w * h, &mut at);
                    }
                    // GS ( k pL pH …: a QR or PDF417 block.
                    b'(' => {
                        let n = bytes.get(at + 3).copied().unwrap_or(0) as usize
                            + 256 * bytes.get(at + 4).copied().unwrap_or(0) as usize;
                        skip(5 + n, &mut at);
                    }
                    _ => skip(3, &mut at),
                }
            }
            0x0D => at += 1,
            byte if byte < 0x20 => at += 1,
            byte => {
                line.push(byte);
                at += 1;
            }
        }
    }
    if !line.is_empty() {
        lines.push((align, line));
    }
    // The feed before the cut is blank lines at the end: two are enough.
    while lines.len() > 2 && lines[lines.len() - 1].1.is_empty() && lines[lines.len() - 2].1.is_empty() {
        lines.pop();
    }

    let top = 8usize;
    let size_of = |payload: &[u8]| -> (usize, usize) {
        let get = |at: usize| payload.get(at).copied().unwrap_or(0) as usize;
        (get(0) + 256 * get(1), get(2) + 256 * get(3))
    };
    let row_height = |row: &(u8, Vec<u8>)| {
        if row.0 == IMAGE_ROW {
            size_of(&row.1).1
        } else {
            LINE_H
        }
    };
    // Rows go onto labels while they fit; with continuous paper, all on one.
    let limit = stock.height_mm.map(|height| (height * DOTS_PER_MM).saturating_sub(8));
    let mut pages: Vec<(Vec<&(u8, Vec<u8>)>, usize)> = vec![(Vec::new(), top)];
    for row in &lines {
        let height = row_height(row);
        if let Some(limit) = limit {
            let page = pages.last().map_or(top, |page| page.1);
            if page + height > limit && pages.last().is_some_and(|page| !page.0.is_empty()) {
                pages.push((Vec::new(), top));
            }
        }
        if let Some(page) = pages.last_mut() {
            page.0.push(row);
            page.1 += height;
        }
    }
    let mut out: Vec<u8> = Vec::new();
    for (rows, used) in &pages {
        let height_mm = match stock.height_mm {
            Some(height) => height,
            None => (used + 32).div_ceil(DOTS_PER_MM).max(20),
        };
        out.extend_from_slice(
            format!(
                "SIZE {width_mm} mm,{height_mm} mm\r\nGAP {} mm,0 mm\r\nDIRECTION 0\r\nCODEPAGE 1252\r\nCLS\r\n",
                stock.gap_mm
            )
            .as_bytes(),
        );
        let mut y = top;
        for (how, text) in rows.iter().copied() {
            if *how == IMAGE_ROW {
                let (row_bytes, height) = size_of(text);
                let x = width_dots.saturating_sub(row_bytes * 8) / 2;
                out.extend_from_slice(format!("BITMAP {x},{y},{row_bytes},{height},0,").as_bytes());
                // ESC/POS 1 is black; TSPL's bitmap 0 is black.
                out.extend(text.iter().skip(4).map(|byte| !byte));
                out.extend_from_slice(b"\r\n");
                y += height;
                continue;
            }
            let text = text.trim_ascii_end();
            if !text.is_empty() {
                let text = &text[..text.len().min(fit)];
                let used = text.len() * FONT_W;
                let x = match how {
                    1 => width_dots.saturating_sub(used) / 2,
                    2 => width_dots.saturating_sub(used + 4),
                    _ => 4,
                };
                out.extend_from_slice(format!("TEXT {x},{y},\"2\",0,1,1,\"").as_bytes());
                for &byte in text {
                    if byte == b'"' {
                        out.extend_from_slice(b"\\[\"]");
                    } else {
                        out.push(byte);
                    }
                }
                out.extend_from_slice(b"\"\r\n");
            }
            y += LINE_H;
        }
        out.extend_from_slice(b"PRINT 1,1\r\n");
    }
    out
}

/// What goes down the USB cable: the bytes as they are for a receipt printer,
/// a label for a label printer.
fn for_usb(app: &tauri::AppHandle, bytes: Vec<u8>, paper: &str) -> Vec<u8> {
    let peripherals = edge::lock(app.state::<Node>().inner()).peripherals.clone();
    if language_of(&peripherals) == "TSPL" {
        escpos_to_tspl(&bytes, &LabelStock::of(&peripherals, paper))
    } else {
        bytes
    }
}

/// Lowercase hex, as the node sends the bytes (`escpos_hex`).
fn from_hex(text: &str) -> Result<Vec<u8>, String> {
    let text = text.trim();
    if text.len() % 2 != 0 {
        return Err("Node mengirim struk yang terpotong.".into());
    }
    let digit = |byte: u8| match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    };
    text.as_bytes()
        .chunks(2)
        .map(|pair| match pair {
            [high, low] => match (digit(*high), digit(*low)) {
                (Some(high), Some(low)) => Ok((high << 4) | low),
                _ => Err("Node mengirim struk dalam bentuk yang tidak dikenal.".to_string()),
            },
            _ => Err("Node mengirim struk yang terpotong.".to_string()),
        })
        .collect()
}

/// A path segment, percent-encoded: a sale id is a UUID today, and a till
/// must not build a different path the day it is not.
fn segment(text: &str) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

/// Ask the node for one sale's receipt as bytes, then send them to the USB
/// printer on this till. `drawer` is `PRINTER_PULSE` to open the drawer with
/// it; `copy` stamps a reprint as one.
#[tauri::command]
pub async fn print_receipt_here(
    app: tauri::AppHandle,
    sale_id: String,
    paper: String,
    drawer: String,
    copy: bool,
) -> Result<PrintedHere, String> {
    edge::off_the_window(move || {
        let printer = usb_printer(&app)?;
        let path = format!(
            "/api/v1/store/sales/{}/receipt/escpos",
            segment(sale_id.trim())
        );
        let body = json!({ "paper": paper, "drawer": drawer, "copy": copy });
        let reply = edge::session_call(&app, "POST", &path, Some(&body));
        if !reply.ok {
            return Err(reply
                .problem
                .unwrap_or_else(|| "Node tidak memberikan struk untuk dicetak.".into()));
        }
        let hex = reply
            .body
            .get("escpos_hex")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                "Node ini belum bisa menyiapkan struk untuk printer USB — perbarui node."
                    .to_string()
            })?;
        let bytes = for_usb(&app, from_hex(hex)?, &paper);
        let receipt = reply
            .body
            .get("receipt_no")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("struk");
        send_raw(&printer, &format!("Struk {receipt}"), &bytes)?;
        Ok(PrintedHere {
            bytes: bytes.len(),
            printer,
        })
    })
    .await
}

/// Central Gudang: ask the node for one move's surat jalan as bytes
/// (`POST /api/v1/store/warehouse/moves/{number}/slip/escpos`) and send them
/// to the USB printer on this PC, exactly as a sale's receipt goes. `paper` is
/// `NARROW` or `WIDE`; `copy` stamps a reprint as one.
#[tauri::command]
pub async fn print_slip_here(
    app: tauri::AppHandle,
    number: String,
    paper: String,
    copy: bool,
) -> Result<PrintedHere, String> {
    edge::off_the_window(move || {
        let printer = usb_printer(&app)?;
        let path = format!(
            "/api/v1/store/warehouse/moves/{}/slip/escpos",
            segment(number.trim())
        );
        let body = json!({ "paper": paper, "copy": copy });
        let reply = edge::session_call(&app, "POST", &path, Some(&body));
        if !reply.ok {
            return Err(reply
                .problem
                .unwrap_or_else(|| "Node tidak memberikan surat jalan untuk dicetak.".into()));
        }
        let hex = reply
            .body
            .get("escpos_hex")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                "Node ini belum bisa menyiapkan surat jalan untuk printer USB — perbarui node."
                    .to_string()
            })?;
        let bytes = for_usb(&app, from_hex(hex)?, &paper);
        send_raw(&printer, &format!("Surat jalan {}", number.trim()), &bytes)?;
        Ok(PrintedHere {
            bytes: bytes.len(),
            printer,
        })
    })
    .await
}

/// Print plain text to the USB printer on this till, silently — what the cash
/// slips (open/close the till, Laci) send instead of the browser's print
/// window. The text becomes an ESC/POS page like any other and goes through
/// [`for_usb`], so a label printer gets a label. Refused with `NOT_USB` when
/// this till has no USB printer, and the screen prints the old way.
#[tauri::command]
pub async fn print_text_here(
    app: tauri::AppHandle,
    text: String,
    paper: String,
) -> Result<PrintedHere, String> {
    edge::off_the_window(move || {
        {
            let held = edge::lock(app.state::<Node>().inner());
            if held.peripherals.receipt_printer != RECEIPT_USB {
                return Err("NOT_USB".to_string());
            }
        }
        let printer = usb_printer(&app)?;
        let mut bytes: Vec<u8> = vec![0x1b, b'@'];
        for character in text.chars() {
            bytes.push(if (character as u32) < 256 { character as u8 } else { b'?' });
        }
        bytes.extend_from_slice(b"\n\n\n\n");
        bytes.extend_from_slice(&[0x1d, b'V', 66, 0]);
        let bytes = for_usb(&app, bytes, &paper);
        send_raw(&printer, "Slip kasir", &bytes)?;
        Ok(PrintedHere {
            bytes: bytes.len(),
            printer,
        })
    })
    .await
}

/// A few lines to prove the cable, the name and the paper, without a sale.
///
/// The outcome is told to the node as well (`requests::report`), off this
/// call: head office's store page counts a test page from the till's own
/// button the same as one it asked for.
#[tauri::command]
pub async fn test_usb_printer(app: tauri::AppHandle) -> Result<PrintedHere, String> {
    edge::off_the_window(move || {
        let printer = usb_printer(&app)?;
        let label = edge::lock(app.state::<Node>().inner()).terminal_id.clone();
        let mut bytes: Vec<u8> = vec![0x1b, b'@']; // ESC @: start clean.
        bytes
            .extend_from_slice(format!("Tes printer kasir\n{label}\n{printer}\n\n\n\n").as_bytes());
        bytes.extend_from_slice(&[0x1d, b'V', 66, 0]); // GS V B 0: feed and cut.
        let paper = edge::lock(app.state::<Node>().inner()).paper.clone();
        let bytes = for_usb(&app, bytes, &paper);
        let outcome = send_raw(&printer, "Tes printer kasir", &bytes);
        let reporting = app.clone();
        let told = outcome.clone();
        std::thread::spawn(move || crate::requests::report(&reporting, None, &told));
        outcome?;
        Ok(PrintedHere {
            bytes: bytes.len(),
            printer,
        })
    })
    .await
}

/// A test page head office asked for, printed on the receipt printer this
/// till was set up with — the USB printer by its name on this machine, a
/// network printer at its address (the one typed in the settings, or the one
/// the node recorded, which the node sends with the ask) — and nothing when
/// the till has no receipt printer. Returns what it printed to.
///
/// In the till's language, like every paper the shop reads.
pub(crate) fn print_test_page(
    app: &tauri::AppHandle,
    asked_by: &str,
    recorded: Option<(String, u16)>,
) -> Result<String, String> {
    let config = edge::lock(app.state::<Node>().inner()).clone();
    let shop = config
        .joined
        .as_ref()
        .map(|joined| {
            [joined.site_code.as_deref(), joined.site_name.as_deref()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    let page = |printer: &str| -> Vec<u8> {
        // Reset, centre, bold on; the title; bold off.
        let mut bytes: Vec<u8> = vec![0x1b, b'@', 0x1b, b'a', 1, 0x1b, b'E', 1];
        bytes.extend_from_slice(b"HALAMAN UJI\n");
        bytes.extend_from_slice(&[0x1b, b'E', 0]);
        bytes.extend_from_slice(
            format!(
                "{}\n{shop}\n{printer}\nDiminta oleh {asked_by}\n\n\n\n",
                config.terminal_id
            )
            .as_bytes(),
        );
        bytes.extend_from_slice(&[0x1d, b'V', 66, 0]); // Feed and cut.
        bytes
    };
    match config.peripherals.receipt_printer.as_str() {
        RECEIPT_USB => {
            let printer = usb_printer(app)?;
            let bytes = for_usb(app, page(&printer), &config.paper);
            send_raw(&printer, "Halaman uji", &bytes)?;
            Ok(printer)
        }
        RECEIPT_RECORDED => {
            let (host, port) = recorded.ok_or_else(|| {
                "Printer jaringan kasir ini tidak aktif lagi di node, jadi halaman uji \
                 tidak bisa dicetak."
                    .to_string()
            })?;
            let printer = format!("{host}:{port}");
            send_network(&host, port, &page(&printer))?;
            Ok(printer)
        }
        RECEIPT_NONE => Err("Kasir ini tidak memakai printer struk.".into()),
        // RECEIPT_ADDRESS, and a till set up before the choice existed.
        _ => {
            let host = config
                .printer_host
                .as_deref()
                .map(str::trim)
                .filter(|host| !host.is_empty())
                .ok_or_else(|| "Alamat printer struk kasir ini belum diisi.".to_string())?
                .to_string();
            let printer = format!("{host}:{}", config.printer_port);
            send_network(&host, config.printer_port, &page(&printer))?;
            Ok(printer)
        }
    }
}

/// Bytes to a network printer's raw port (9100), straight from this till.
fn send_network(host: &str, port: u16, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let patience = Duration::from_secs(5);
    let addresses: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Alamat printer {host} tidak dikenal: {error}"))?
        .collect();
    let mut last = format!("Printer di {host}:{port} tidak menjawab.");
    for address in addresses {
        match TcpStream::connect_timeout(&address, patience) {
            Ok(mut stream) => {
                let _ = stream.set_write_timeout(Some(patience));
                return stream
                    .write_all(bytes)
                    .and_then(|()| stream.flush())
                    .map_err(|error| format!("Halaman uji tidak terkirim ke {address}: {error}"));
            }
            Err(error) => last = format!("Printer di {address} tidak bisa dihubungi: {error}"),
        }
    }
    Err(last)
}

/// The printers this machine has, by the names the spooler (or CUPS) knows
/// them under — what the peripherals screen offers to choose from.
#[tauri::command]
pub async fn local_printers() -> Result<Vec<String>, String> {
    edge::off_the_window(list_printers).await
}

#[cfg(target_os = "windows")]
fn send_raw(printer: &str, document: &str, bytes: &[u8]) -> Result<(), String> {
    spooler::send_raw(printer, document, bytes)
}

#[cfg(target_os = "windows")]
fn list_printers() -> Result<Vec<String>, String> {
    spooler::printers()
}

#[cfg(not(target_os = "windows"))]
fn send_raw(printer: &str, document: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut lp = Command::new("lp")
        .args(["-d", printer, "-t", document, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("CUPS (lp) tidak bisa dijalankan di komputer ini: {error}"))?;
    {
        let Some(mut input) = lp.stdin.take() else {
            return Err("CUPS (lp) tidak menerima struk.".into());
        };
        input
            .write_all(bytes)
            .map_err(|error| format!("Struk tidak terkirim ke CUPS: {error}"))?;
        // Dropped here: lp prints once its input ends.
    }
    let done = lp
        .wait_with_output()
        .map_err(|error| format!("CUPS (lp) tidak menjawab: {error}"))?;
    if done.status.success() {
        Ok(())
    } else {
        Err(format!(
            "CUPS menolak mencetak ke “{printer}”: {}",
            String::from_utf8_lossy(&done.stderr).trim()
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn list_printers() -> Result<Vec<String>, String> {
    let listed = std::process::Command::new("lpstat")
        .arg("-e")
        .output()
        .map_err(|error| format!("CUPS (lpstat) tidak bisa dijalankan di komputer ini: {error}"))?;
    if !listed.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&listed.stdout)
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect())
}

/// The Windows spooler, loaded at run time from `winspool.drv` so the shell
/// needs no binding crate for six functions.
#[cfg(target_os = "windows")]
mod spooler {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    use libloading::Library;

    type Handle = *mut c_void;

    /// `DOC_INFO_1W`. Read by the spooler through a pointer, never by Rust.
    #[repr(C)]
    #[allow(dead_code)]
    struct DocInfo1 {
        doc_name: *const u16,
        output_file: *const u16,
        datatype: *const u16,
    }

    /// `PRINTER_INFO_4W`, as the spooler writes it. Only the name is read.
    #[repr(C)]
    #[allow(dead_code)]
    struct PrinterInfo4 {
        printer_name: *const u16,
        server_name: *const u16,
        attributes: u32,
    }

    type OpenPrinterW = unsafe extern "system" fn(*const u16, *mut Handle, *const c_void) -> i32;
    type ClosePrinter = unsafe extern "system" fn(Handle) -> i32;
    type StartDocPrinterW = unsafe extern "system" fn(Handle, u32, *const DocInfo1) -> u32;
    type EndDocPrinter = unsafe extern "system" fn(Handle) -> i32;
    type StartPagePrinter = unsafe extern "system" fn(Handle) -> i32;
    type EndPagePrinter = unsafe extern "system" fn(Handle) -> i32;
    type WritePrinter = unsafe extern "system" fn(Handle, *const c_void, u32, *mut u32) -> i32;
    type EnumPrintersW =
        unsafe extern "system" fn(u32, *const u16, u32, *mut u8, u32, *mut u32, *mut u32) -> i32;

    const PRINTER_ENUM_LOCAL: u32 = 0x2;
    const PRINTER_ENUM_CONNECTIONS: u32 = 0x4;

    fn wide(text: &str) -> Vec<u16> {
        OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn last_error() -> std::io::Error {
        std::io::Error::last_os_error()
    }

    fn open_spooler() -> Result<Library, String> {
        // SAFETY: winspool.drv is the system's own print spooler client; loading
        // it runs no initialisation beyond Windows' own.
        unsafe { Library::new("winspool.drv") }
            .map_err(|error| format!("Spooler Windows tidak bisa dibuka: {error}"))
    }

    /// A function of the spooler's, by name. The pointer is good while
    /// `spooler` is: every caller keeps the library until it is done.
    fn function<T: Copy>(spooler: &Library, name: &[u8]) -> Result<T, String> {
        // SAFETY: each `T` above is the documented signature of the function
        // it is looked up by.
        unsafe { spooler.get::<T>(name).map(|symbol| *symbol) }
            .map_err(|error| format!("Spooler Windows tidak lengkap: {error}"))
    }

    /// A printer opened for one job, closed however the job ends.
    struct Opened {
        handle: Handle,
        close: ClosePrinter,
    }

    impl Drop for Opened {
        fn drop(&mut self) {
            // SAFETY: `handle` came from a successful OpenPrinterW and is
            // closed exactly once, here.
            unsafe { (self.close)(self.handle) };
        }
    }

    /// One RAW job: the bytes, passed through the driver untouched.
    pub(super) fn send_raw(printer: &str, document: &str, bytes: &[u8]) -> Result<(), String> {
        let spooler = open_spooler()?;
        let open: OpenPrinterW = function(&spooler, b"OpenPrinterW\0")?;
        let close: ClosePrinter = function(&spooler, b"ClosePrinter\0")?;
        let start_doc: StartDocPrinterW = function(&spooler, b"StartDocPrinterW\0")?;
        let end_doc: EndDocPrinter = function(&spooler, b"EndDocPrinter\0")?;
        let start_page: StartPagePrinter = function(&spooler, b"StartPagePrinter\0")?;
        let end_page: EndPagePrinter = function(&spooler, b"EndPagePrinter\0")?;
        let write: WritePrinter = function(&spooler, b"WritePrinter\0")?;

        let length = u32::try_from(bytes.len())
            .map_err(|_| "Struk terlalu besar untuk satu cetakan.".to_string())?;
        let name = wide(printer);
        let mut handle: Handle = std::ptr::null_mut();
        // SAFETY: `name` is NUL-terminated and outlives the call; `handle` is
        // written by the spooler on success.
        if unsafe { open(name.as_ptr(), &mut handle, std::ptr::null()) } == 0 {
            return Err(format!(
                "Printer “{printer}” tidak ditemukan di Windows: {}",
                last_error()
            ));
        }
        let opened = Opened { handle, close };

        let doc_name = wide(document);
        let datatype = wide("RAW");
        let info = DocInfo1 {
            doc_name: doc_name.as_ptr(),
            output_file: std::ptr::null(),
            datatype: datatype.as_ptr(),
        };
        // SAFETY: `info` and the strings it points at outlive the call.
        if unsafe { start_doc(opened.handle, 1, &info) } == 0 {
            return Err(format!(
                "Windows tidak mau memulai cetakan di “{printer}”: {}",
                last_error()
            ));
        }
        let mut written: u32 = 0;
        // SAFETY: the job was started on this handle; `bytes` is `length` long.
        let wrote = unsafe {
            start_page(opened.handle) != 0
                && write(opened.handle, bytes.as_ptr().cast(), length, &mut written) != 0
        };
        let wrote_error = last_error();
        // SAFETY: closing the page and the document this function started.
        unsafe {
            end_page(opened.handle);
            end_doc(opened.handle);
        }
        drop(opened);
        if !wrote {
            return Err(format!(
                "Struk tidak terkirim ke “{printer}”: {wrote_error}"
            ));
        }
        if written != length {
            return Err(format!(
                "Hanya {written} dari {length} byte struk yang diterima “{printer}”."
            ));
        }
        Ok(())
    }

    /// The UTF-16 string at `text`, up to its NUL.
    ///
    /// SAFETY: `text` is null or points at a NUL-terminated string that lives
    /// as long as the buffer `EnumPrintersW` filled.
    unsafe fn read_wide(text: *const u16) -> String {
        if text.is_null() {
            return String::new();
        }
        let mut length = 0;
        while *text.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(text, length))
    }

    /// Every printer this machine prints to: its own and the shared ones it is
    /// connected to.
    pub(super) fn printers() -> Result<Vec<String>, String> {
        let spooler = open_spooler()?;
        let enumerate: EnumPrintersW = function(&spooler, b"EnumPrintersW\0")?;
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut needed, mut returned) = (0u32, 0u32);
        // SAFETY: asking for the size only — a null buffer of length zero.
        unsafe {
            enumerate(
                flags,
                std::ptr::null(),
                4,
                std::ptr::null_mut(),
                0,
                &mut needed,
                &mut returned,
            )
        };
        if needed == 0 {
            return Ok(Vec::new());
        }
        // In u64s, so the records the spooler writes at its start are aligned.
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let size = u32::try_from(buffer.len() * 8).unwrap_or(needed);
        // SAFETY: `buffer` holds at least `size` writable bytes.
        let listed = unsafe {
            enumerate(
                flags,
                std::ptr::null(),
                4,
                buffer.as_mut_ptr().cast(),
                size,
                &mut needed,
                &mut returned,
            )
        };
        if listed == 0 {
            return Err(format!(
                "Daftar printer Windows tidak bisa dibaca: {}",
                last_error()
            ));
        }
        // SAFETY: the spooler wrote `returned` PRINTER_INFO_4W records at the
        // start of `buffer`, and the names they point at lie inside it.
        let names = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr().cast::<PrinterInfo4>(), returned as usize)
                .iter()
                .map(|info| read_wide(info.printer_name))
                .filter(|name| !name.is_empty())
                .collect()
        };
        Ok(names)
    }
}

#[cfg(test)]
mod tspl_tests {
    use super::*;

    fn text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    #[test]
    fn a_receipt_becomes_one_label_with_the_text_kept() {
        let mut escpos: Vec<u8> = vec![0x1b, b'@', 0x1b, b'a', 1, 0x1b, b'E', 1];
        escpos.extend_from_slice(b"CENTRAL\n");
        escpos.extend_from_slice(&[0x1b, b'E', 0, 0x1b, b'a', 0]);
        escpos.extend_from_slice(b"No Nota  ABC123\n1 x 118.000      118.000\n\n\n\n\n");
        escpos.extend_from_slice(&[0x1b, b'p', 0, 25, 250]); // drawer
        escpos.extend_from_slice(&[0x1d, b'V', 66, 0]); // cut
        let label = text(&escpos_to_tspl(&escpos, &LabelStock::continuous(true)));
        assert!(label.starts_with("SIZE 80 mm,"));
        assert!(label.contains("GAP 0 mm,0 mm"));
        assert!(label.contains("\"CENTRAL\""));
        assert!(label.contains("\"No Nota  ABC123\""));
        assert!(label.ends_with("PRINT 1,1\r\n"));
        // The cut, the drawer and the bold left nothing behind.
        assert!(!label.contains('\u{1b}') && !label.contains('\u{1d}'));
        // The title is centred, the rest is not.
        let title_x: usize = label
            .lines()
            .find(|line| line.contains("CENTRAL"))
            .and_then(|line| line.strip_prefix("TEXT "))
            .and_then(|rest| rest.split(',').next())
            .and_then(|x| x.parse().ok())
            .unwrap();
        assert!(title_x > 100);
    }

    #[test]
    fn narrow_paper_is_58_mm_and_a_quote_is_escaped() {
        let label = text(&escpos_to_tspl(b"say \"hi\"\n", &LabelStock::continuous(false)));
        assert!(label.starts_with("SIZE 58 mm,"));
        assert!(label.contains("say \\[\"]hi\\[\"]"));
    }

    #[test]
    fn a_long_line_is_cut_to_the_paper() {
        let long = vec![b'A'; 200];
        let mut bytes = long.clone();
        bytes.push(b'\n');
        let label = text(&escpos_to_tspl(&bytes, &LabelStock::continuous(false)));
        let drawn = label.lines().find(|line| line.starts_with("TEXT ")).unwrap();
        assert!(drawn.matches('A').count() <= 38);
    }

    #[test]
    fn a_long_receipt_is_cut_over_several_labels_of_the_roll() {
        let mut bytes = Vec::new();
        for n in 0..20 {
            bytes.extend_from_slice(format!("baris {n}\n").as_bytes());
        }
        let stock = LabelStock { width_mm: 80, height_mm: Some(50), gap_mm: 3 };
        let label = text(&escpos_to_tspl(&bytes, &stock));
        // 50 mm = 400 dots: (400 - 16) / 26 = 14 rows a label, so 2 labels.
        assert_eq!(label.matches("SIZE 80 mm,50 mm").count(), 2);
        assert_eq!(label.matches("PRINT 1,1").count(), 2);
        assert_eq!(label.matches("GAP 3 mm,0 mm").count(), 2);
        assert!(label.contains("\"baris 19\""));
    }

    #[test]
    fn the_stores_picture_goes_on_the_label_and_the_text_follows_it() {
        // 16 dots wide (2 bytes), 10 rows, all black in ESC/POS.
        let mut bytes: Vec<u8> = vec![0x1d, b'v', b'0', 0, 2, 0, 10, 0];
        bytes.extend_from_slice(&[0xFF; 20]);
        bytes.extend_from_slice(b"No Nota\n");
        let label = escpos_to_tspl(&bytes, &LabelStock::continuous(true));
        let at = label.windows(7).position(|w| w == b"BITMAP ").expect("a bitmap");
        let head: String = label[at..].iter().take_while(|&&b| b != b',' || false).map(|&b| b as char).collect();
        assert!(head.starts_with("BITMAP "));
        let line_end = label[at..].windows(2).position(|w| w == b"\r\n").unwrap();
        // 20 data bytes, inverted to 0 (black), after "BITMAP x,y,2,10,0,".
        assert!(label[at..at + line_end].ends_with(&[0u8; 20]));
        // The text sits below the 10 rows of the picture: y = 8 + 10.
        assert!(text(&label).contains("TEXT 4,18,"));
    }

    #[test]
    fn a_label_printer_is_known_by_its_name() {
        let mut peripherals = Peripherals::default();
        peripherals.usb_printer_name = Some("Xprinter XP-D4601B".into());
        assert_eq!(language_of(&peripherals), "TSPL");
        peripherals.usb_printer_name = Some("EPSON TM-T82 Receipt".into());
        assert_eq!(language_of(&peripherals), "ESCPOS");
        peripherals.usb_printer_name = Some("Xprinter XP-D4601B".into());
        peripherals.receipt_language = Some("ESCPOS".into());
        assert_eq!(language_of(&peripherals), "ESCPOS");
    }
}
