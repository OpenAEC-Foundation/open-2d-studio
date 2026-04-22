//! Dump the R2010 decrypted file header (0x6C bytes) as u32s to look for
//! additional section-map or system-section pointers.

use dwg_parser::r2007;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read");
    let enc = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    println!("enc_hdr = {} bytes", enc.len());
    for i in 0..enc.len() / 4 {
        let o = i * 4;
        let v = u32::from_le_bytes([enc[o], enc[o+1], enc[o+2], enc[o+3]]);
        println!("  [0x{:02X}] = 0x{:08X} ({})", o, v, v);
    }
    // ASCII
    let mut s = String::new();
    for &b in &enc {
        if (0x20..0x7F).contains(&b) { s.push(b as char); } else { s.push('.'); }
    }
    println!("\nASCII: {}", s);
}
