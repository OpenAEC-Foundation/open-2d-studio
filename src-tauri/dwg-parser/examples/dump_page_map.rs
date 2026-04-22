//! Dump the full page-map body so we can see if pages 20/21 have negative psize
//! (gap entries) or are entirely absent.

use dwg_parser::r2007;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read dwg");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");

    // Repeat the read_page_map logic to expose the raw decompressed bytes
    let page_map_off = u32::from_le_bytes([enc_hdr[0x54], enc_hdr[0x55], enc_hdr[0x56], enc_hdr[0x57]]) as usize + 0x100;
    println!("page_map_off=0x{:X}", page_map_off);

    // 20-byte system header
    let hdr = &data[page_map_off..page_map_off + 20];
    let sec_type = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
    let data_size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
    let comp_size = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
    let flag = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]);
    println!("sec_type=0x{:X} data_size={} comp_size={} flag={}", sec_type, data_size, comp_size, flag);

    // Decompress
    let body_off = page_map_off + 20;
    let body = &data[body_off..body_off + comp_size];
    let decomp = dwg_parser::parser::decompress_r2004(body, data_size).expect("decomp");
    println!("decompressed {} bytes", decomp.len());

    // Dump as 8-byte entries
    for i in 0..decomp.len() / 8 {
        let off = i * 8;
        let pn = i32::from_le_bytes([decomp[off], decomp[off + 1], decomp[off + 2], decomp[off + 3]]);
        let ps = i32::from_le_bytes([decomp[off + 4], decomp[off + 5], decomp[off + 6], decomp[off + 7]]);
        println!("entry[{:02}] @0x{:04X}: page_num={:6} psize={:6} (0x{:X})", i, off, pn, ps, ps);
    }
}
