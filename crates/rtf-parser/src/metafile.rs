//! Extract the bitmap a rasterising producer embedded in a WMF or EMF.
//!
//! This is deliberately not a metafile player. Issue #33 measured that the metafile a real
//! producer emits for a drawing can contain no vector records at all: LibreOffice rasterises
//! the artwork and wraps the bitmap in an EMF, wrapped again in a WMF. Reading that bitmap out
//! is a bounded raster task; playing back GDI is not, and an empty picture would be worse than
//! the placeholder the engine draws today.

/// Bounded so a crafted header cannot ask for an unreasonable allocation. Four million pixels
/// is far beyond any document picture and costs 16 MiB as RGBA.
const MAX_PIXELS: u32 = 4_000_000;
const MAX_DIMENSION: i32 = 32_767;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Bitmap {
    pub width: u32,
    pub height: u32,
    /// Row-major RGBA, top row first, which is what ImageData expects.
    pub rgba: Vec<u8>,
}

/// Why a metafile produced no bitmap, so the caller can say something specific.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Rejection {
    /// No blit record at all: the metafile may hold real vector records.
    NoBitmap,
    /// A blit exists but its DIB uses a compression or header this decoder does not read.
    UnsupportedBitmap,
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn i32_at(bytes: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// One candidate blit: the device-independent bitmap header, palette and pixel bytes. Owned,
/// because a WMF's blits can come from an EMF reassembled out of its comment records.
struct Candidate {
    info: Vec<u8>,
    bits: Vec<u8>,
}

pub(crate) fn extract_bitmap(bytes: &[u8], is_emf: bool) -> Result<Bitmap, Rejection> {
    let mut candidates = Vec::new();
    if is_emf {
        collect_emf(bytes, &mut candidates);
    } else {
        collect_wmf(bytes, &mut candidates);
    }
    if candidates.is_empty() {
        return Err(Rejection::NoBitmap);
    }
    // A transparent blit is written as a mask and an image. Over the white page the mask is a
    // no-op, so the last decodable image is what the producer meant to show.
    let mut rejected = false;
    for candidate in candidates.iter().rev() {
        match decode_dib(&candidate.info, &candidate.bits) {
            Some(bitmap) => return Ok(bitmap),
            None => rejected = true,
        }
    }
    Err(if rejected {
        Rejection::UnsupportedBitmap
    } else {
        Rejection::NoBitmap
    })
}

/// Walk WMF records, collecting DIB blits and any EMF hidden in a comment escape.
fn collect_wmf(bytes: &[u8], candidates: &mut Vec<Candidate>) {
    // A placeable header precedes the standard 18-byte METAHEADER in some files.
    let mut position = if bytes.starts_with(&[0xd7, 0xcd, 0xc6, 0x9a]) {
        22 + 18
    } else {
        18
    };
    let mut embedded = Vec::new();
    while position + 6 <= bytes.len() {
        let Some(words) = u32_at(bytes, position) else {
            return;
        };
        let Some(function) = u16_at(bytes, position + 4) else {
            return;
        };
        let Some(size) = (words as usize).checked_mul(2) else {
            return;
        };
        if size < 6 || position + size > bytes.len() {
            return;
        }
        let body = &bytes[position + 6..position + size];
        match function {
            // META_STRETCHDIB, META_DIBSTRETCHBLT, META_DIBBITBLT: the DIB trails fixed fields.
            0x0f43 => push_dib(body, 22, candidates),
            0x0b41 => push_dib(body, 20, candidates),
            0x0940 => push_dib(body, 16, candidates),
            // META_ESCAPE with an MFCOMMENT carrying EMF spool data.
            0x0626 => collect_comment_chunk(body, &mut embedded),
            _ => {}
        }
        position += size;
    }
    if !embedded.is_empty() {
        // The embedded EMF is the producer's own higher-fidelity copy, so prefer its blits.
        collect_emf(&embedded, candidates);
    }
}

fn collect_comment_chunk(body: &[u8], embedded: &mut Vec<u8>) {
    let Some(escape) = u16_at(body, 0) else {
        return;
    };
    let Some(count) = u16_at(body, 2) else { return };
    // MFCOMMENT with the WMFC identifier, then a 34-byte header before the EMF chunk.
    if escape != 15 || count < 34 || body.len() < 4 + count as usize {
        return;
    }
    if body.get(4..8) != Some(b"WMFC") {
        return;
    }
    embedded.extend_from_slice(&body[4 + 34..4 + count as usize]);
}

fn collect_emf(bytes: &[u8], candidates: &mut Vec<Candidate>) {
    let mut position = 0usize;
    while position + 8 <= bytes.len() {
        let Some(kind) = u32_at(bytes, position) else {
            return;
        };
        let Some(size) = u32_at(bytes, position + 4).map(|size| size as usize) else {
            return;
        };
        if size < 8 || position + size > bytes.len() {
            return;
        }
        let record = &bytes[position..position + size];
        // EMR_STRETCHDIBITS, EMR_BITBLT and EMR_STRETCHBLT all address their DIB by offset from
        // the start of the record. The two blit records share a layout; STRETCHDIBITS does not.
        let offsets = match kind {
            81 => Some((48, 52, 56, 60)),
            76 | 77 => Some((84, 88, 92, 96)),
            _ => None,
        };
        if let Some((info_at, info_size_at, bits_at, bits_size_at)) = offsets {
            push_emf_dib(
                record,
                info_at,
                info_size_at,
                bits_at,
                bits_size_at,
                candidates,
            );
        }
        position += size;
    }
}

fn push_emf_dib(
    record: &[u8],
    info_at: usize,
    info_size_at: usize,
    bits_at: usize,
    bits_size_at: usize,
    candidates: &mut Vec<Candidate>,
) {
    let (Some(info_offset), Some(info_size), Some(bits_offset), Some(bits_size)) = (
        u32_at(record, info_at),
        u32_at(record, info_size_at),
        u32_at(record, bits_at),
        u32_at(record, bits_size_at),
    ) else {
        return;
    };
    // Offsets and sizes come straight out of the file, so the ends are computed without
    // trusting them to fit: a crafted record must fail the lookup, not the addition.
    let end = |offset: u32, size: u32| (offset as usize).checked_add(size as usize);
    let info = end(info_offset, info_size).and_then(|end| record.get(info_offset as usize..end));
    let bits = end(bits_offset, bits_size).and_then(|end| record.get(bits_offset as usize..end));
    if let (Some(info), Some(bits)) = (info, bits)
        && !info.is_empty()
        && !bits.is_empty()
    {
        candidates.push(Candidate {
            info: info.to_vec(),
            bits: bits.to_vec(),
        });
    }
}

/// A WMF blit stores its BITMAPINFO and pixels contiguously, so the split is computed here.
fn push_dib(body: &[u8], fixed: usize, candidates: &mut Vec<Candidate>) {
    let Some(dib) = body.get(fixed..) else { return };
    let Some(header_size) = u32_at(dib, 0) else {
        return;
    };
    let Some(palette) = palette_bytes(dib) else {
        return;
    };
    let split = header_size as usize + palette;
    if let (Some(info), Some(bits)) = (dib.get(..split), dib.get(split..))
        && !bits.is_empty()
    {
        candidates.push(Candidate {
            info: info.to_vec(),
            bits: bits.to_vec(),
        });
    }
}

fn palette_bytes(info: &[u8]) -> Option<usize> {
    let header_size = u32_at(info, 0)?;
    if header_size < 40 {
        return None;
    }
    let bits_per_pixel = u16_at(info, 14)?;
    if bits_per_pixel > 8 {
        return Some(0);
    }
    let used = u32_at(info, 32)?;
    let entries = if used == 0 {
        1u32 << bits_per_pixel
    } else {
        used
    };
    Some(entries as usize * 4)
}

fn decode_dib(info: &[u8], bits: &[u8]) -> Option<Bitmap> {
    let header_size = u32_at(info, 0)?;
    // BITMAPCOREHEADER and the v4/v5 headers past the fields this decoder reads are rejected
    // rather than guessed at.
    if header_size < 40 {
        return None;
    }
    let width = i32_at(info, 4)?;
    let stored_height = i32_at(info, 8)?;
    let bits_per_pixel = u16_at(info, 14)?;
    let compression = u32_at(info, 16)?;
    if compression != 0 {
        return None;
    }
    let bottom_up = stored_height > 0;
    let height = stored_height.checked_abs()?;
    if width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
        return None;
    }
    let (width, height) = (width as u32, height as u32);
    if width.checked_mul(height)? > MAX_PIXELS {
        return None;
    }
    let stride = (width as usize)
        .checked_mul(bits_per_pixel as usize)?
        .checked_add(31)?
        / 32
        * 4;
    if stride.checked_mul(height as usize)? > bits.len() {
        return None;
    }
    let palette = info.get(header_size as usize..).unwrap_or_default();
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for row in 0..height as usize {
        let source_row = if bottom_up {
            height as usize - 1 - row
        } else {
            row
        };
        let line = &bits[source_row * stride..source_row * stride + stride];
        for column in 0..width as usize {
            let colour = sample(line, column, bits_per_pixel, palette)?;
            let at = (row * width as usize + column) * 4;
            rgba[at..at + 4].copy_from_slice(&colour);
        }
    }
    Some(Bitmap {
        width,
        height,
        rgba,
    })
}

/// Palette entries and 16/24/32-bit pixels are all stored blue first.
fn sample(line: &[u8], column: usize, bits_per_pixel: u16, palette: &[u8]) -> Option<[u8; 4]> {
    let indexed = |index: usize| -> Option<[u8; 4]> {
        let entry = palette.get(index * 4..index * 4 + 4)?;
        Some([entry[2], entry[1], entry[0], 255])
    };
    match bits_per_pixel {
        1 => {
            let byte = *line.get(column / 8)?;
            indexed(((byte >> (7 - column % 8)) & 1) as usize)
        }
        4 => {
            let byte = *line.get(column / 2)?;
            let nibble = if column.is_multiple_of(2) {
                byte >> 4
            } else {
                byte & 0x0f
            };
            indexed(nibble as usize)
        }
        8 => indexed(*line.get(column)? as usize),
        16 => {
            // Without BI_BITFIELDS the layout is 5-5-5 with the top bit unused.
            let value = u16_at(line, column * 2)?;
            let expand = |channel: u16| ((channel * 255 + 15) / 31) as u8;
            Some([
                expand((value >> 10) & 0x1f),
                expand((value >> 5) & 0x1f),
                expand(value & 0x1f),
                255,
            ])
        }
        24 => {
            let pixel = line.get(column * 3..column * 3 + 3)?;
            Some([pixel[2], pixel[1], pixel[0], 255])
        }
        32 => {
            let pixel = line.get(column * 4..column * 4 + 4)?;
            // The fourth byte is undefined without BI_BITFIELDS, so it is not read as alpha.
            Some([pixel[2], pixel[1], pixel[0], 255])
        }
        _ => None,
    }
}
