//! Bit-level reader for DWG binary format.
//!
//! Reads individual bits and DWG-specific compressed data types from a byte
//! buffer. Built from scratch using only the Rust standard library.

use crate::error::DwgError;

/// Reads individual bits and DWG-specific data types from a byte buffer.
///
/// DWG files use bit-level packing. Bits are numbered MSB-first within each
/// byte (bit 7 of byte 0 is the first bit in the stream).
pub struct DwgBitReader<'a> {
    data: &'a [u8],
    bit_position: usize,
}

impl<'a> DwgBitReader<'a> {
    /// Create a new bit reader starting at the given byte offset.
    pub fn new(data: &'a [u8], byte_offset: usize) -> Self {
        Self {
            data,
            bit_position: byte_offset * 8,
        }
    }

    // ------------------------------------------------------------------
    // Low-level bit reading
    // ------------------------------------------------------------------

    /// Read a single bit (B).
    pub fn read_bit(&mut self) -> Result<u8, DwgError> {
        let byte_idx = self.bit_position >> 3;
        let bit_idx = 7 - (self.bit_position & 7);
        if byte_idx >= self.data.len() {
            return Err(DwgError::InvalidBinary("DwgBitReader: read past end of data".into()));
        }
        let val = (self.data[byte_idx] >> bit_idx) & 1;
        self.bit_position += 1;
        Ok(val)
    }

    /// Read *count* bits and return them as an unsigned integer (MSB first).
    pub fn read_bits(&mut self, count: usize) -> Result<u32, DwgError> {
        let mut result = 0u32;
        for _ in 0..count {
            result = (result << 1) | (self.read_bit()? as u32);
        }
        Ok(result)
    }

    // ------------------------------------------------------------------
    // Raw fixed-size types
    // ------------------------------------------------------------------

    /// Read an unsigned byte (RC) -- 8 bits, not byte-aligned.
    pub fn read_byte(&mut self) -> Result<u8, DwgError> {
        Ok(self.read_bits(8)? as u8)
    }

    /// Read a signed 16-bit little-endian short (RS).
    pub fn read_short(&mut self) -> Result<i16, DwgError> {
        let lo = self.read_bits(8)? as u16;
        let hi = self.read_bits(8)? as u16;
        let val = lo | (hi << 8);
        Ok(val as i16)
    }

    /// Read an unsigned 16-bit LE short (RS).
    pub fn read_raw_short(&mut self) -> Result<u16, DwgError> {
        let lo = self.read_bits(8)? as u16;
        let hi = self.read_bits(8)? as u16;
        Ok(lo | (hi << 8))
    }

    /// Read a signed 32-bit LE long (RL).
    pub fn read_long(&mut self) -> Result<i32, DwgError> {
        let b0 = self.read_bits(8)? as u32;
        let b1 = self.read_bits(8)? as u32;
        let b2 = self.read_bits(8)? as u32;
        let b3 = self.read_bits(8)? as u32;
        let val = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
        Ok(val as i32)
    }

    /// Read an unsigned 32-bit LE long (RL).
    pub fn read_raw_long(&mut self) -> Result<u32, DwgError> {
        let b0 = self.read_bits(8)?;
        let b1 = self.read_bits(8)?;
        let b2 = self.read_bits(8)?;
        let b3 = self.read_bits(8)?;
        Ok(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24))
    }

    /// Read a 64-bit IEEE double (RD).
    pub fn read_double(&mut self) -> Result<f64, DwgError> {
        let mut bytes = [0u8; 8];
        for b in bytes.iter_mut() {
            *b = self.read_byte()?;
        }
        Ok(f64::from_le_bytes(bytes))
    }

    // ------------------------------------------------------------------
    // DWG compressed types
    // ------------------------------------------------------------------

    /// Read a 2-bit value (BB).
    pub fn read_bb(&mut self) -> Result<u8, DwgError> {
        Ok(self.read_bits(2)? as u8)
    }

    /// Bit Short (BS) -- 2-bit prefix + variable payload.
    pub fn read_bs(&mut self) -> Result<i16, DwgError> {
        let prefix = self.read_bits(2)?;
        match prefix {
            0 => self.read_short(),
            1 => Ok(self.read_byte()? as i16),
            2 => Ok(0),
            _ => Ok(256),
        }
    }

    /// Bit Long (BL) -- 2-bit prefix + variable payload.
    pub fn read_bl(&mut self) -> Result<i32, DwgError> {
        let prefix = self.read_bits(2)?;
        match prefix {
            0 => self.read_long(),
            1 => Ok(self.read_byte()? as i32),
            2 => Ok(0),
            _ => self.read_long(),
        }
    }

    /// Bit Double (BD) -- 2-bit prefix + variable payload.
    pub fn read_bd(&mut self) -> Result<f64, DwgError> {
        let prefix = self.read_bits(2)?;
        match prefix {
            0 => self.read_double(),
            1 => Ok(1.0),
            _ => Ok(0.0),
        }
    }

    /// Default Double (DD) -- 2-bit prefix + variable payload.
    pub fn read_dd(&mut self, default: f64) -> Result<f64, DwgError> {
        let prefix = self.read_bits(2)?;
        match prefix {
            0 => Ok(default),
            3 => self.read_double(),
            _ => {
                let mut raw = default.to_le_bytes();
                if prefix == 1 {
                    raw[0] = self.read_byte()?;
                    raw[1] = self.read_byte()?;
                    raw[2] = self.read_byte()?;
                    raw[3] = self.read_byte()?;
                } else {
                    // prefix == 2
                    raw[4] = self.read_byte()?;
                    raw[5] = self.read_byte()?;
                    raw[0] = self.read_byte()?;
                    raw[1] = self.read_byte()?;
                    raw[2] = self.read_byte()?;
                    raw[3] = self.read_byte()?;
                }
                Ok(f64::from_le_bytes(raw))
            }
        }
    }

    /// Bit Thickness (BT) -- for R2000+.
    pub fn read_bt(&mut self) -> Result<f64, DwgError> {
        if self.read_bit()? == 1 {
            Ok(0.0)
        } else {
            self.read_bd()
        }
    }

    /// Bit Extrusion (BE) -- for R2000+.
    pub fn read_be(&mut self) -> Result<(f64, f64, f64), DwgError> {
        if self.read_bit()? == 1 {
            Ok((0.0, 0.0, 1.0))
        } else {
            let x = self.read_bd()?;
            let y = self.read_bd()?;
            let z = self.read_bd()?;
            if x == 0.0 && y == 0.0 {
                let z = if z <= 0.0 { -1.0 } else { 1.0 };
                Ok((0.0, 0.0, z))
            } else {
                Ok((x, y, z))
            }
        }
    }

    // ------------------------------------------------------------------
    // Handle references
    // ------------------------------------------------------------------

    /// Handle reference. Returns `(code, handle_value)`.
    pub fn read_h(&mut self) -> Result<(u8, u32), DwgError> {
        let code = self.read_bits(4)? as u8;
        let counter = self.read_bits(4)? as usize;
        let mut handle = 0u32;
        for _ in 0..counter {
            handle = (handle << 8) | (self.read_byte()? as u32);
        }
        Ok((code, handle))
    }

    // ------------------------------------------------------------------
    // Text strings
    // ------------------------------------------------------------------

    /// Text string (T). For R2000: BS length + raw bytes.
    pub fn read_t(&mut self, is_unicode: bool) -> Result<String, DwgError> {
        let length = self.read_bs()? as usize;
        if length == 0 {
            return Ok(String::new());
        }
        // Sanity check: reject implausibly large strings
        if length > 100_000 {
            return Err(DwgError::InvalidBinary(
                format!("read_t: string length {} exceeds limit", length),
            ));
        }
        if is_unicode {
            let mut bytes = Vec::with_capacity(length * 2);
            for _ in 0..length * 2 {
                bytes.push(self.read_byte()?);
            }
            // UTF-16LE decode
            let mut chars = Vec::new();
            for i in (0..bytes.len()).step_by(2) {
                if i + 1 < bytes.len() {
                    let w = u16::from_le_bytes([bytes[i], bytes[i + 1]]);
                    if let Some(c) = char::from_u32(w as u32) {
                        if c != '\0' {
                            chars.push(c);
                        }
                    }
                }
            }
            Ok(chars.into_iter().collect())
        } else {
            let mut bytes = Vec::with_capacity(length);
            for _ in 0..length {
                bytes.push(self.read_byte()?);
            }
            // Latin-1 decode
            Ok(bytes.iter()
                .filter(|&&b| b != 0)
                .map(|&b| b as char)
                .collect())
        }
    }

    // ------------------------------------------------------------------
    // Point helpers
    // ------------------------------------------------------------------

    /// Two raw doubles (2D point).
    pub fn read_2rd(&mut self) -> Result<(f64, f64), DwgError> {
        Ok((self.read_double()?, self.read_double()?))
    }

    /// Three raw doubles (3D point).
    pub fn read_3rd(&mut self) -> Result<(f64, f64, f64), DwgError> {
        Ok((self.read_double()?, self.read_double()?, self.read_double()?))
    }

    /// Two bit doubles (2D point, compressed).
    pub fn read_2bd(&mut self) -> Result<(f64, f64), DwgError> {
        Ok((self.read_bd()?, self.read_bd()?))
    }

    /// Three bit doubles (3D point, compressed).
    pub fn read_3bd(&mut self) -> Result<(f64, f64, f64), DwgError> {
        Ok((self.read_bd()?, self.read_bd()?, self.read_bd()?))
    }

    // ------------------------------------------------------------------
    // Color
    // ------------------------------------------------------------------

    /// Read a color value (CMC) -- for R2000 this is just a BS index.
    pub fn read_cmc(&mut self) -> Result<i16, DwgError> {
        self.read_bs()
    }

    /// Read an Extended NamedColor (ENC) for R2004+.
    ///
    /// Returns `(color_index, optional_rgb, optional_name)`.
    /// The ENC type starts with a BS color index, then optional
    /// true-color and book-name data indicated by flag bits.
    pub fn read_enc(&mut self) -> Result<(i16, Option<u32>, Option<String>), DwgError> {
        let index = self.read_bs()?;
        let flags = self.read_bs()? as u16;

        let rgb = if flags & 0x01 != 0 {
            Some(self.read_raw_long()?)
        } else {
            None
        };

        let name = if flags & 0x02 != 0 {
            Some(self.read_t(false)?)
        } else {
            None
        };

        Ok((index, rgb, name))
    }

    // ------------------------------------------------------------------
    // Bit Long Long (BLL) -- R2004+
    // ------------------------------------------------------------------

    /// Read a Bit Long Long (BLL): 3-bit length prefix + N bytes.
    pub fn read_bll(&mut self) -> Result<u64, DwgError> {
        let num_bytes = self.read_bits(3)? as usize;
        let mut result = 0u64;
        for i in 0..num_bytes {
            let b = self.read_byte()? as u64;
            result |= b << (i * 8);
        }
        Ok(result)
    }

    // ------------------------------------------------------------------
    // Unicode text (TU) -- R2007+
    // ------------------------------------------------------------------

    /// Read a Unicode text string (TU) for R2007+.
    ///
    /// BS length (number of UTF-16 code units) followed by 16-bit
    /// little-endian code units read from the bit stream.
    pub fn read_tu(&mut self) -> Result<String, DwgError> {
        let length = self.read_bs()? as usize;
        if length == 0 {
            return Ok(String::new());
        }
        if length > 100_000 {
            return Err(DwgError::InvalidBinary(
                format!("read_tu: string length {} exceeds limit", length),
            ));
        }
        let mut units = Vec::with_capacity(length);
        for _ in 0..length {
            let lo = self.read_byte()? as u16;
            let hi = self.read_byte()? as u16;
            units.push(lo | (hi << 8));
        }
        // Decode UTF-16LE
        let mut chars = Vec::new();
        let mut i = 0;
        while i < units.len() {
            let w = units[i];
            i += 1;
            if w == 0 { continue; }
            if (0xD800..=0xDBFF).contains(&w) && i < units.len() {
                // Surrogate pair
                let w2 = units[i];
                if (0xDC00..=0xDFFF).contains(&w2) {
                    i += 1;
                    let cp = 0x10000 + ((w as u32 - 0xD800) << 10) + (w2 as u32 - 0xDC00);
                    if let Some(c) = char::from_u32(cp) {
                        chars.push(c);
                    }
                }
            } else if let Some(c) = char::from_u32(w as u32) {
                chars.push(c);
            }
        }
        Ok(chars.into_iter().collect())
    }

    /// Version-aware text string reader.
    ///
    /// For R2007+ (`is_r2007 == true`) reads a TU (Unicode) string.
    /// Otherwise reads a T (code-page) string.
    pub fn read_tv(&mut self, is_r2007: bool) -> Result<String, DwgError> {
        if is_r2007 {
            self.read_tu()
        } else {
            self.read_t(false)
        }
    }

    // ------------------------------------------------------------------
    // Modular char / modular short
    // ------------------------------------------------------------------

    /// Read a modular char (MC) from raw bytes at pos.
    /// Returns `(value, new_pos)`.
    pub fn read_modular_char(data: &[u8], pos: usize) -> Result<(i32, usize), DwgError> {
        let mut result = 0i32;
        let mut shift = 0u32;
        let mut negative = false;
        let mut p = pos;

        loop {
            if p >= data.len() {
                return Err(DwgError::InvalidBinary("modular_char: unexpected end".into()));
            }
            let b = data[p];
            p += 1;
            let cont = b & 0x80;
            if shift < 32 {
                result |= ((b & 0x7F) as i32) << shift;
            }
            shift += 7;
            if cont == 0 {
                if b & 0x40 != 0 && shift >= 7 && shift - 7 < 32 {
                    negative = true;
                    result &= !(0x40i32.wrapping_shl(shift - 7));
                }
                break;
            }
            if shift > 35 {
                return Err(DwgError::InvalidBinary("modular_char: too many bytes".into()));
            }
        }
        if negative {
            result = -result;
        }
        Ok((result, p))
    }

    /// Read a modular short (MS) from raw bytes at pos.
    /// Returns `(value, new_pos)`.
    pub fn read_modular_short(data: &[u8], pos: usize) -> Result<(i32, usize), DwgError> {
        let mut result = 0u32;
        let mut shift = 0u32;
        let mut p = pos;

        loop {
            if p + 1 >= data.len() {
                return Err(DwgError::InvalidBinary("modular_short: unexpected end".into()));
            }
            let lo = data[p];
            let hi = data[p + 1];
            p += 2;
            let word = (lo as u32) | (((hi & 0x7F) as u32) << 8);
            if shift < 32 {
                result |= word << shift;
            }
            shift += 15;
            if hi & 0x80 == 0 {
                break;
            }
            if shift > 45 {
                return Err(DwgError::InvalidBinary("modular_short: too many words".into()));
            }
        }
        Ok((result as i32, p))
    }

    // ------------------------------------------------------------------
    // Positioning
    // ------------------------------------------------------------------

    /// Set position to byte offset.
    pub fn seek_byte(&mut self, offset: usize) {
        self.bit_position = offset * 8;
    }

    /// Set position to an exact bit offset.
    pub fn seek_bit(&mut self, bit_offset: usize) {
        self.bit_position = bit_offset;
    }

    /// Return current byte offset (truncated).
    pub fn tell_byte(&self) -> usize {
        self.bit_position >> 3
    }

    /// Return current bit position.
    pub fn tell_bit(&self) -> usize {
        self.bit_position
    }

    /// Advance to the next byte boundary.
    pub fn align_byte(&mut self) {
        let rem = self.bit_position & 7;
        if rem != 0 {
            self.bit_position += 8 - rem;
        }
    }

    /// Approximate number of bytes remaining.
    pub fn remaining_bytes(&self) -> usize {
        self.data.len().saturating_sub(self.tell_byte())
    }

    /// Read *count* raw bytes from the bit stream.
    pub fn read_raw_bytes(&mut self, count: usize) -> Result<Vec<u8>, DwgError> {
        let mut bytes = Vec::with_capacity(count);
        for _ in 0..count {
            bytes.push(self.read_byte()?);
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_bits() {
        let data = [0b10110100u8, 0b01011000u8];
        let mut reader = DwgBitReader::new(&data, 0);
        assert_eq!(reader.read_bit().unwrap(), 1);
        assert_eq!(reader.read_bit().unwrap(), 0);
        assert_eq!(reader.read_bit().unwrap(), 1);
        assert_eq!(reader.read_bit().unwrap(), 1);
    }

    #[test]
    fn test_modular_char() {
        // Simple value: 5 (byte = 0x05, no continuation)
        let data = [0x05u8];
        let (val, pos) = DwgBitReader::read_modular_char(&data, 0).unwrap();
        assert_eq!(val, 5);
        assert_eq!(pos, 1);
    }
}
