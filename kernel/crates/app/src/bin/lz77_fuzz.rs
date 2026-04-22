//! LZ77 fuzz tester for dwg_parser::parser::decompress_r2004
//!
//! Constructs synthetic known-good LZ77 streams for each opcode class,
//! predicts the expected output, and verifies the decompressor produces it.

use dwg_parser::parser::decompress_r2004;

// ─── Stream builder helpers ───────────────────────────────────────────────────

/// Build a two-byte offset field: encodes (offset, lit_count) into [B1, B2].
///   offset    = (B1 >> 2) | (B2 << 6)   →  14-bit
///   lit_count = B1 & 0x03               →  2-bit
fn encode_two_byte_offset(offset: usize, lit_count: u8) -> [u8; 2] {
    // offset = (b1 >> 2) | (b2 << 6)
    // b1 = ((offset & 0x3F) << 2) | (lit_count & 0x03)
    // b2 = (offset >> 6) & 0xFF
    let b1 = (((offset & 0x3F) as u8) << 2) | (lit_count & 0x03);
    let b2 = ((offset >> 6) & 0xFF) as u8;
    [b1, b2]
}

/// Build a length-extension sequence for a given value.
/// The decoder reads bytes, summing them until one is < 0xFF.
fn encode_length_extension(value: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut remaining = value;
    while remaining >= 255 {
        bytes.push(0xFF);
        remaining -= 255;
    }
    bytes.push(remaining as u8);
    bytes
}

// ─── Test result tracking ─────────────────────────────────────────────────────

struct TestResult {
    name: String,
    passed: bool,
    detail: String,
}

fn run_test(
    name: &str,
    src: &[u8],
    decompressed_size: usize,
    expected: &[u8],
) -> TestResult {
    match decompress_r2004(src, decompressed_size) {
        Ok(got) => {
            if got == expected {
                TestResult {
                    name: name.to_string(),
                    passed: true,
                    detail: format!("output matches ({} bytes)", got.len()),
                }
            } else {
                // Find first difference
                let first_diff = got.iter().zip(expected.iter())
                    .position(|(a, b)| a != b)
                    .unwrap_or(got.len().min(expected.len()));
                let got_hex: String = got.iter().take(64).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                let exp_hex: String = expected.iter().take(64).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                TestResult {
                    name: name.to_string(),
                    passed: false,
                    detail: format!(
                        "MISMATCH at byte {}\n    got[{}]: {}\n    exp[{}]: {}",
                        first_diff,
                        got.len(), got_hex,
                        expected.len(), exp_hex,
                    ),
                }
            }
        }
        Err(e) => TestResult {
            name: name.to_string(),
            passed: false,
            detail: format!("ERROR: {:?}", e),
        },
    }
}

// ─── Test cases ───────────────────────────────────────────────────────────────

/// Test 0x01..0x0F: short initial literal run, then terminator.
fn test_short_literal() -> TestResult {
    // First byte = 0x05 → copy 5 literal bytes, then 0x11 = terminator
    let src: Vec<u8> = vec![
        0x05,                               // initial literal count = 5
        0xAA, 0xBB, 0xCC, 0xDD, 0xEE,      // 5 literal bytes
        0x11,                               // terminator
    ];
    let expected = vec![0xAA, 0xBB, 0xCC, 0xDD, 0xEE];
    run_test("short_literal (0x01..0x0F)", &src, 5, &expected)
}

/// Test 0x00: long initial literal run (length-extension + 0x0F).
fn test_long_initial_literal() -> TestResult {
    // First byte = 0x00 → read_length() + 0x0F
    // read_length: byte 0x03 → total = 3 → lit_count = 3 + 15 = 18
    let mut src: Vec<u8> = vec![0x00, 0x03]; // length-extension = 3, total = 18
    let literals: Vec<u8> = (1..=18).collect();
    src.extend_from_slice(&literals);
    src.push(0x11); // terminator
    let expected = literals;
    run_test("long_initial_literal (0x00)", &src, 18, &expected)
}

/// Test initial byte >= 0x10: no initial literals, jumps straight to opcode.
fn test_no_initial_literal() -> TestResult {
    // First byte = 0x40 (inline opcode), not a literal prefix.
    // We need some data in the output first, so we do a trick:
    // Actually, if first byte >= 0x10 it pushes back and enters opcode loop.
    // But inline back-ref needs existing data... Let's use a structure:
    // 0x03 (3 literals), AAh BBh CCh, then inline back-ref copying from them.

    // Better: test that first byte 0x11 (terminator) causes empty output.
    let src: Vec<u8> = vec![0x11];
    let expected: Vec<u8> = vec![0x00; 0]; // empty - but decompressed_size=0 returns empty
    // Actually with decompressed_size=0 it returns early. Let's use size > 0.
    // The 0x11 is first byte >= 0x10, so si is pushed back, then main loop reads 0x11 = break.
    let src2: Vec<u8> = vec![0x11];
    let expected2: Vec<u8> = vec![0x00; 4]; // zeros remain (buffer initialized to 0)
    run_test("no_initial_literal (first >= 0x10)", &src2, 4, &expected2)
}

/// Test 0x40..0xFF: inline back-reference.
fn test_inline_backref() -> TestResult {
    // Setup: write 4 literal bytes, then use inline back-ref to copy from them.
    // Inline opcode: comp_bytes = (opcode >> 4) - 1, comp_offset = B + ((opcode & 0x0C) << 6)
    // lit_count = opcode & 0x03
    //
    // We want to copy 3 bytes from offset 0 (most recent byte).
    // comp_bytes = 3 → (opcode >> 4) - 1 = 3 → opcode >> 4 = 4 → high nibble = 0x4_
    // comp_offset = 0 → B + ((opcode & 0x0C) << 6) = 0 → B=0, (opcode & 0x0C)=0
    // lit_count = 0 → opcode & 0x03 = 0
    // So opcode = 0x40, extra byte B = 0x00
    //
    // BUT comp_offset=0 means copy from di - 0 - 1 = di - 1.
    // After writing 4 literals (AA BB CC DD), di=4.
    // Copy 3 bytes from position 4 - 0 - 1 = 3 → dst[3], dst[4], dst[5]
    // But dst[4] and dst[5] overlap! Byte-by-byte: dst[4]=dst[3]=DD, dst[5]=dst[4]=DD, dst[6]=dst[5]=DD
    // Result: AA BB CC DD DD DD DD

    let src: Vec<u8> = vec![
        0x04,                           // initial literal count = 4
        0xAA, 0xBB, 0xCC, 0xDD,        // 4 literal bytes
        0x40,                           // inline: comp_bytes=3, comp_offset from B, lit_count=0
        0x00,                           // B=0 → comp_offset=0, copy from di-1
        0x11,                           // terminator (next byte after lit_count=0 peek)
    ];
    // After 4 literals: [AA, BB, CC, DD]
    // Inline: comp_bytes=3, comp_offset=0 → src_start = 4 - 0 - 1 = 3
    // Copy byte-by-byte from dst[3]: DD, DD, DD (overlapping)
    // di=7. lit_count=0, peek next byte = 0x11 (>= 0x10), don't consume.
    // Main loop reads 0x11 → break.
    let expected = vec![0xAA, 0xBB, 0xCC, 0xDD, 0xDD, 0xDD, 0xDD];
    run_test("inline_backref (0x40..0xFF)", &src, 7, &expected)
}

/// Test inline back-ref with non-zero lit_count.
fn test_inline_backref_with_literals() -> TestResult {
    // opcode = 0x42: comp_bytes = (0x42>>4)-1 = 4-1 = 3
    //   comp_offset bits from opcode: (0x42 & 0x0C) << 6 = 0 << 6 = 0
    //   lit_count = 0x42 & 0x03 = 2
    // B = 0x01 → comp_offset = 1 + 0 = 1
    // Copy from di - 1 - 1 = di - 2

    let src: Vec<u8> = vec![
        0x04,                           // 4 initial literals
        0xAA, 0xBB, 0xCC, 0xDD,
        0x42,                           // inline: comp_bytes=3, lit_count=2
        0x01,                           // B=1 → comp_offset=1 → copy from di-2
        0xEE, 0xFF,                     // 2 trailing literals
        0x11,                           // terminator
    ];
    // After 4 literals: [AA, BB, CC, DD], di=4
    // comp_offset=1, src_start=4-1-1=2 → copy from dst[2]: CC, DD, (dst[4]=CC from prev copy)
    // Wait, byte-by-byte: dst[4]=dst[2]=CC, dst[5]=dst[3]=DD, dst[6]=dst[4]=CC
    // di=7. Then 2 trailing literals: EE, FF → di=9
    let expected = vec![0xAA, 0xBB, 0xCC, 0xDD, 0xCC, 0xDD, 0xCC, 0xEE, 0xFF];
    run_test("inline_backref_with_literals (0x42)", &src, 9, &expected)
}

/// Test inline back-ref with large offset using the (opcode & 0x0C) << 6 bits.
fn test_inline_backref_large_offset() -> TestResult {
    // We need enough output data to reference a large offset.
    // opcode = 0x4C: comp_bytes=(0x4C>>4)-1=4-1=3
    //   (opcode & 0x0C) = 0x0C → << 6 = 0x300 = 768
    //   lit_count = 0x4C & 0x03 = 0
    // B = 0x00 → comp_offset = 0 + 768 = 768
    // Need at least 769 bytes of output data first.
    // We'll write 769 literal bytes using extended literal.

    // First byte = 0x00 → read_length() + 0x0F
    // We need lit_count = 769. read_length() + 15 = 769 → read_length() = 754
    // 754 = 2*255 + 244 → [0xFF, 0xFF, 244]
    let mut src: Vec<u8> = vec![0x00, 0xFF, 0xFF, 244u8];
    let mut literals: Vec<u8> = Vec::new();
    for i in 0..769 {
        literals.push((i % 256) as u8);
    }
    src.extend_from_slice(&literals);
    // Now inline opcode to copy 3 bytes from offset 768
    src.push(0x4C); // comp_bytes=3, offset bits=768, lit_count=0
    src.push(0x00); // B=0 → comp_offset=768
    src.push(0x11); // terminator

    // After 769 literals, di=769. Copy from 769 - 768 - 1 = 0 → dst[0],dst[1],dst[2]
    let mut expected = literals.clone();
    expected.push(literals[0]); // dst[0]
    expected.push(literals[1]); // dst[1]
    expected.push(literals[2]); // dst[2]

    run_test("inline_backref_large_offset (0x4C)", &src, 772, &expected)
}

/// Test 0x21..0x3F: medium back-reference.
fn test_medium_backref() -> TestResult {
    // opcode = 0x23: comp_bytes = 0x23 - 0x1E = 5
    // Then read two-byte offset.
    // offset=1, lit_count=1

    let two_byte = encode_two_byte_offset(1, 1);
    let src: Vec<u8> = vec![
        0x06,                               // 6 initial literals
        0x10, 0x20, 0x30, 0x40, 0x50, 0x60,
        0x23,                               // medium: comp_bytes = 5
        two_byte[0], two_byte[1],           // offset=1, lit_count=1
        0xAA,                               // 1 trailing literal
        0x11,                               // terminator
    ];
    // After 6 literals: [10,20,30,40,50,60], di=6
    // comp_bytes=5, comp_offset=1 → src_start=6-1-1=4
    // Byte-by-byte from dst[4]: 50,60,(dst[6]=50),(dst[7]=60),(dst[8]=50)
    // di=11. Then 1 trailing literal: AA → di=12
    let expected = vec![0x10, 0x20, 0x30, 0x40, 0x50, 0x60,
                        0x50, 0x60, 0x50, 0x60, 0x50,
                        0xAA];
    run_test("medium_backref (0x21..0x3F)", &src, 12, &expected)
}

/// Test 0x20: long back-reference.
fn test_long_backref() -> TestResult {
    // opcode = 0x20: comp_bytes = read_length() + 0x21
    // read_length: byte 0x00 → total=0, comp_bytes = 0 + 0x21 = 33
    // Then two-byte offset: offset=0, lit_count=0

    let two_byte = encode_two_byte_offset(0, 0);
    let mut src: Vec<u8> = vec![
        0x01,           // 1 initial literal
        0xAB,           // the literal
        0x20,           // long back-ref opcode
        0x00,           // read_length = 0 → comp_bytes = 33
    ];
    src.push(two_byte[0]);
    src.push(two_byte[1]);
    src.push(0x11); // terminator

    // After 1 literal: [AB], di=1
    // comp_bytes=33, comp_offset=0 → src_start=1-0-1=0
    // Copy 33 bytes from dst[0]: all AB (overlapping, byte-by-byte)
    // di=34. lit_count=0, peek next=0x11 (>=0x10) → don't consume. Loop reads 0x11 → break.
    let mut expected = vec![0xAB; 34];
    run_test("long_backref (0x20)", &src, 34, &expected)
}

/// Test 0x12..0x1F: far back-reference, short length.
fn test_far_backref_short() -> TestResult {
    // opcode = 0x14: comp_bytes = (0x14 & 0x0F) + 2 = 4 + 2 = 6
    // two-byte offset gives `offset`, then comp_offset = offset + 0x3FFF
    // We need comp_offset+1 <= di, so di > offset + 0x3FFF.
    // With offset=0: comp_offset = 0x3FFF = 16383, need di >= 16384.
    //
    // Create a large initial literal run of 16384 bytes.
    // 0x00 → read_length() + 0x0F = 16384 → read_length() = 16369
    // 16369 = 64*255 + 49 → [0xFF]*64 + [49]

    let mut src: Vec<u8> = vec![0x00];
    // encode read_length for 16369: 64 * 0xFF + 49
    for _ in 0..64 {
        src.push(0xFF);
    }
    src.push(49);
    // 16384 literal bytes
    let literals: Vec<u8> = (0..16384).map(|i| (i % 251) as u8).collect();
    src.extend_from_slice(&literals);
    // Far back-ref opcode
    src.push(0x14); // comp_bytes = 6
    let two_byte = encode_two_byte_offset(0, 0);
    src.push(two_byte[0]);
    src.push(two_byte[1]);
    src.push(0x11); // terminator

    // comp_offset = 0 + 0x3FFF = 16383
    // src_start = 16384 - 16383 - 1 = 0
    // Copy 6 bytes from dst[0..6]
    let mut expected = literals.clone();
    for i in 0..6 {
        expected.push(literals[i]);
    }

    run_test("far_backref_short (0x12..0x1F)", &src, 16390, &expected)
}

/// Test 0x10: far back-reference, long length.
fn test_far_backref_long() -> TestResult {
    // opcode = 0x10: comp_bytes = read_length() + 9
    // read_length: byte 0x01 → total=1, comp_bytes=10
    // two-byte offset: offset=0, lit_count=0
    // comp_offset = 0 + 0x3FFF = 16383
    // Need di >= 16384.

    let mut src: Vec<u8> = vec![0x00];
    // encode read_length for 16369 (= 16384 - 15)
    for _ in 0..64 {
        src.push(0xFF);
    }
    src.push(49);
    let literals: Vec<u8> = (0..16384).map(|i| (i % 253) as u8).collect();
    src.extend_from_slice(&literals);
    // Far long back-ref
    src.push(0x10); // opcode
    src.push(0x01); // read_length = 1 → comp_bytes = 1 + 9 = 10
    let two_byte = encode_two_byte_offset(0, 0);
    src.push(two_byte[0]);
    src.push(two_byte[1]);
    src.push(0x11); // terminator

    let mut expected = literals.clone();
    for i in 0..10 {
        expected.push(literals[i]);
    }

    run_test("far_backref_long (0x10)", &src, 16394, &expected)
}

/// Test extended literal run (lit_count=0, peek byte < 0x10).
fn test_extended_trailing_literal() -> TestResult {
    // Use inline back-ref with lit_count=0, then next byte 0x05 → 5 trailing literals
    let src: Vec<u8> = vec![
        0x03,                       // 3 initial literals
        0xAA, 0xBB, 0xCC,
        0x40,                       // inline: comp_bytes=3, lit_count=0
        0x00,                       // B=0 → comp_offset=0 → copy from di-1
        0x05,                       // peek: 0x05 < 0x10 → 5 extended trailing literals
        0x11, 0x22, 0x33, 0x44, 0x55,
        0x11,                       // terminator
    ];
    // After 3 literals: [AA,BB,CC], di=3
    // Inline: comp_bytes=3, comp_offset=0, src=3-0-1=2 → dst[2]=CC → CC,CC,CC
    // di=6. lit_count=0, peek=0x05 → consume, lit_count=5
    // Copy 5 literals: 11,22,33,44,55 → di=11
    let expected = vec![0xAA, 0xBB, 0xCC, 0xCC, 0xCC, 0xCC,
                        0x11, 0x22, 0x33, 0x44, 0x55];
    run_test("extended_trailing_literal", &src, 11, &expected)
}

/// Test extended literal via 0x00 (long literal in trailing position).
fn test_extended_trailing_literal_long() -> TestResult {
    // inline back-ref with lit_count=0, then next byte 0x00 → read_length() + 0x0F
    let src: Vec<u8> = vec![
        0x02,               // 2 initial literals
        0xAA, 0xBB,
        0x40,               // inline: comp_bytes=3, lit_count=0
        0x00,               // B=0 → comp_offset=0 → copy from di-1
        0x00,               // peek: 0x00 → consume, read_length + 0x0F
        0x03,               // read_length = 3 → lit_count = 3 + 15 = 18
        // 18 literal bytes
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
        0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12,
        0x11, // terminator (opcode in main loop)
    ];
    // After 2 literals: [AA,BB], di=2
    // Inline: comp_bytes=3, comp_offset=0 → src=2-0-1=1 → dst[1]=BB → BB,BB,BB
    // di=5. lit_count=0, peek=0x00 → consume, read_length=3, lit_count=18
    // Copy 18 literals → di=23
    let mut expected = vec![0xAA, 0xBB, 0xBB, 0xBB, 0xBB];
    expected.extend_from_slice(&[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
                                  0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12]);
    run_test("extended_trailing_literal_long (0x00)", &src, 23, &expected)
}

/// Test overlapping back-reference (RLE pattern).
fn test_overlapping_backref_rle() -> TestResult {
    // Write 1 byte, then back-ref with offset=0 and large length → RLE
    // opcode 0x23: comp_bytes = 0x23 - 0x1E = 5, medium
    let two_byte = encode_two_byte_offset(0, 0);
    let src: Vec<u8> = vec![
        0x01,           // 1 initial literal
        0x42,           // the literal byte
        0x23,           // medium: comp_bytes=5
        two_byte[0], two_byte[1],  // offset=0, lit_count=0
        0x11,           // terminator
    ];
    // After 1 literal: [42], di=1
    // comp_bytes=5, comp_offset=0 → src_start=1-0-1=0 → dst[0]=0x42
    // Byte-by-byte overlapping: all 0x42
    let expected = vec![0x42; 6];
    run_test("overlapping_backref_rle", &src, 6, &expected)
}

/// Test chained opcodes: multiple back-refs in sequence.
fn test_chained_opcodes() -> TestResult {
    // 4 literals, inline back-ref, medium back-ref, terminator
    let two_byte = encode_two_byte_offset(2, 0);
    let src: Vec<u8> = vec![
        0x04,                               // 4 literals
        0x10, 0x20, 0x30, 0x40,
        0x40,                               // inline: comp_bytes=3, lit_count=0, offset from B
        0x01,                               // B=1 → comp_offset=1 → copy from di-2
        // peek next: 0x23 >= 0x10, don't consume → lit_count stays 0
        0x23,                               // medium: comp_bytes=5
        two_byte[0], two_byte[1],           // offset=2, lit_count=0
        0x11,                               // terminator
    ];
    // After 4 literals: [10,20,30,40], di=4
    // Inline: comp_bytes=3, comp_offset=1 → src_start=4-1-1=2
    //   dst[4]=dst[2]=30, dst[5]=dst[3]=40, dst[6]=dst[4]=30
    //   → [10,20,30,40,30,40,30], di=7
    // lit_count=0, peek=0x23 (>=0x10) → don't consume
    // Medium: comp_bytes=5, comp_offset=2 → src_start=7-2-1=4
    //   dst[7]=dst[4]=30, dst[8]=dst[5]=40, dst[9]=dst[6]=30
    //   dst[10]=dst[7]=30, dst[11]=dst[8]=40
    //   → [10,20,30,40,30,40,30,30,40,30,30,40], di=12
    let expected = vec![0x10, 0x20, 0x30, 0x40,
                        0x30, 0x40, 0x30,
                        0x30, 0x40, 0x30, 0x30, 0x40];
    run_test("chained_opcodes", &src, 12, &expected)
}

/// Test inline with highest opcode value 0xFF.
fn test_inline_max_opcode() -> TestResult {
    // opcode = 0xFF: comp_bytes = (0xFF >> 4) - 1 = 15 - 1 = 14
    // (opcode & 0x0C) = 0x0C → << 6 = 768
    // lit_count = 0xFF & 0x03 = 3
    // B = 0x00 → comp_offset = 0 + 768 = 768
    // Need 769 bytes of output first.

    let mut src: Vec<u8> = vec![0x00];
    // 769 literals: read_length + 15 = 769, read_length = 754
    // 754 = 2*255 + 244
    src.push(0xFF);
    src.push(0xFF);
    src.push(244);
    let literals: Vec<u8> = (0..769).map(|i| (i % 239) as u8).collect();
    src.extend_from_slice(&literals);
    // opcode 0xFF
    src.push(0xFF);
    src.push(0x00); // B=0 → comp_offset=768
    // 3 trailing literals
    src.push(0xDE);
    src.push(0xAD);
    src.push(0xBE);
    src.push(0x11); // terminator

    // After 769 literals. comp_offset=768 → src_start=769-768-1=0
    // Copy 14 bytes from dst[0..14]
    let mut expected = literals.clone();
    for i in 0..14 {
        expected.push(literals[i]);
    }
    expected.push(0xDE);
    expected.push(0xAD);
    expected.push(0xBE);

    run_test("inline_max_opcode (0xFF)", &src, 786, &expected)
}

/// Test empty decompressed size.
fn test_empty() -> TestResult {
    let src: Vec<u8> = vec![0x11];
    run_test("empty (size=0)", &src, 0, &[])
}

/// Test medium back-ref edge: opcode 0x3F (max comp_bytes = 0x3F - 0x1E = 33).
fn test_medium_backref_max() -> TestResult {
    let two_byte = encode_two_byte_offset(0, 0);
    let src: Vec<u8> = vec![
        0x01,           // 1 literal
        0x77,
        0x3F,           // medium: comp_bytes = 0x3F - 0x1E = 33
        two_byte[0], two_byte[1],
        0x11,
    ];
    // RLE: 1 + 33 = 34 copies of 0x77
    let expected = vec![0x77; 34];
    run_test("medium_backref_max (0x3F)", &src, 34, &expected)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    println!("=== LZ77 R2004 Decompressor Fuzz Test ===\n");

    let results = vec![
        test_empty(),
        test_short_literal(),
        test_long_initial_literal(),
        test_no_initial_literal(),
        test_inline_backref(),
        test_inline_backref_with_literals(),
        test_inline_backref_large_offset(),
        test_inline_max_opcode(),
        test_medium_backref(),
        test_medium_backref_max(),
        test_long_backref(),
        test_far_backref_short(),
        test_far_backref_long(),
        test_extended_trailing_literal(),
        test_extended_trailing_literal_long(),
        test_overlapping_backref_rle(),
        test_chained_opcodes(),
    ];

    let mut pass_count = 0;
    let mut fail_count = 0;
    let mut report = String::new();
    report.push_str("# LZ77 R2004 Decompressor Fuzz Results\n\n");
    report.push_str("| Test | Status | Detail |\n");
    report.push_str("|------|--------|--------|\n");

    for r in &results {
        let status = if r.passed { "PASS" } else { "FAIL" };
        if r.passed {
            pass_count += 1;
            println!("[PASS] {}", r.name);
        } else {
            fail_count += 1;
            println!("[FAIL] {} — {}", r.name, r.detail);
        }
        // Escape pipes for markdown
        let detail_esc = r.detail.replace('|', "\\|").replace('\n', " ");
        report.push_str(&format!("| {} | {} | {} |\n", r.name, status, detail_esc));
    }

    println!("\n--- Summary: {} passed, {} failed ---", pass_count, fail_count);

    report.push_str(&format!("\n## Summary\n\n- **Passed**: {}\n- **Failed**: {}\n\n", pass_count, fail_count));

    if fail_count > 0 {
        report.push_str("## Analysis\n\n");
        for r in &results {
            if !r.passed {
                report.push_str(&format!("### {}\n\n```\n{}\n```\n\n", r.name, r.detail));
            }
        }
    }

    // Write report
    let report_path = r"C:\Users\rickd\Desktop\dwg_samples\squad\fuzz.md";
    match std::fs::write(report_path, &report) {
        Ok(_) => println!("\nReport written to {}", report_path),
        Err(e) => eprintln!("Failed to write report: {}", e),
    }
}
