use dwg_parser::r2007;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read dwg");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, page_size) = r2007::read_page_map(&data, &enc_hdr).expect("pm");
    let ver = "AC1024";
    let obj = r2007::assemble_section(&data, &page_map, page_size, 7, ver).expect("assemble");
    println!("OBJECTS assembled: {} bytes", obj.len());

    // Check zero coverage
    let n_zero = obj.iter().filter(|&&b| b == 0).count();
    println!("zero bytes: {} / {}  ({:.1}%)", n_zero, obj.len(), 100.0 * n_zero as f64 / obj.len() as f64);

    // Look at 4KB pages
    let page_sz = 4096;
    let mut zero_pgs = 0;
    for pg in 0..obj.len() / page_sz {
        if obj[pg*page_sz..(pg+1)*page_sz].iter().all(|&b| b == 0) { zero_pgs += 1; }
    }
    println!("all-zero 4KB pages: {} / {}", zero_pgs, obj.len() / page_sz);

    // Look at regions filled with data
    let mut regions = Vec::new();
    let mut in_data = false;
    let mut start = 0;
    for (i, &b) in obj.iter().enumerate() {
        if b != 0 && !in_data { start = i; in_data = true; }
        else if b == 0 && in_data {
            // Check ahead - if next 32 bytes all zero, close region
            let ahead_end = (i + 32).min(obj.len());
            if obj[i..ahead_end].iter().all(|&b| b == 0) {
                regions.push((start, i));
                in_data = false;
            }
        }
    }
    if in_data { regions.push((start, obj.len())); }
    println!("contiguous non-zero regions: {}", regions.len());
    for (s, e) in &regions[..regions.len().min(20)] {
        println!("  0x{:06X}..0x{:06X}  ({} bytes)", s, e, e - s);
    }
    if regions.len() > 20 {
        println!("  ...");
        for (s, e) in &regions[regions.len()-5..] {
            println!("  0x{:06X}..0x{:06X}  ({} bytes)", s, e, e - s);
        }
    }
}
