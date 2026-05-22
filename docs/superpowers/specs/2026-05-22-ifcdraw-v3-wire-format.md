# IFCDraw v3 — Binary Wire Format (CBOR + zstd)

Status: **Design — pending approval, implementation deferred**
Companion: `2026-05-22-ifcdraw-v3-ifcx-mapping.md` (JSON logical schema)
Supersedes (eventually): `2026-05-21-ifcdraw-binary-format.md` (IFCDraw v2)

## 0. Why a new envelope

IFCDraw v2 (`0.4-2d-binary-ifcdraw`) wraps a flat `BinaryIfcDraw` struct
in `rmp_serde` MessagePack and pipes that through `zstd::stream::encode_all`
at level 19. The struct fields are msgpack-named with `to_vec_named`,
so the blob is self-describing — but it is **not** an IFC-X document.
Every external consumer must reverse-engineer our struct layout.

v3 keeps the same compression strategy (heavy zstd, mid-size container)
but swaps the in-the-middle layer for an **IFC-X v2 JSON document
encoded as CBOR**, which is precisely what Ifc-Factory's IFCXB format
already does. The two contributions our envelope adds on top of vanilla
IFCXB are:

1. **`IFCDRAW\x03`** 8-byte magic, so a reader can dispatch on the
   first 8 bytes without trying to decompress.
2. **Optional zstd dictionary**, trained on a corpus of IFC-X
   documents — namespace strings (`ifcx::geom::compositeCurve`) repeat
   thousands of times per document, and a learned dictionary shaves
   25-40% off the compressed size for typical drawings.

A plain `.ifcdraw` blob with no dictionary and no magic byte is **byte-
identical to an IFCXB blob with our header chunk removed**, by design.
That gives us interop: an IFCXB reader (TS, Python, Rust, C++, C#) can
parse our files trivially, and we can read their files trivially.

## 1. Layer stack

```
.ifcdraw v3 file
    │
    ▼
[ IFCDRAW magic + version + flags + offsets ]   ← 32 bytes, plain
    │
    ▼
[ optional dict-id chunk ]                       ← 8-264 bytes, plain
    │
    ▼
[ zstd-compressed body ]                         ← rest of file
    │      level 3-22, with-or-without dictionary
    ▼
[ CBOR-encoded IFC-X v2 document ]               ← canonical form
    │      same map as the JSON spec
    ▼
[ logical IfcX document ]                        ← what the application
                                                    actually consumes
```

The reader implements this top-down: parse header → identify dict →
decompress → CBOR-decode → hand the resulting JSON-shaped value to the
shared IFC-X document loader.

## 2. Header (32 bytes, all little-endian)

```
Offset  Size  Type     Field
------  ----  -------  ------------------------------------------------
 0      8     ASCII    Magic: "IFCDRAW\x03"
 8      1     uint8    Wire format version  = 0x03
 9      1     uint8    Compression: 0=none  1=zstd-plain  2=zstd-dict
10      2     uint16   Flags (bitfield)
12      4     uint32   Reserved (must be 0)
16      8     uint64   Compressed body length in bytes
24      8     uint64   Uncompressed body length in bytes
```

The 8-byte magic embeds the wire version (`0x03` final byte) so even a
hex-dump reader sees "IFCDRAW v3". Bumping the wire version is allowed
without touching the schema version inside (which lives in the IFC-X
header's `ifcxVersion: "2.0"`).

### 2.1 Flags

| Bit  | Meaning                                                           |
|------|-------------------------------------------------------------------|
| 0    | Has dict-id chunk between header and body                         |
| 1    | Body is CBOR. (Always 1 in v3.0; reserved for future raw-bytes.)  |
| 2    | Has CRC32 trailer (4 bytes after body)                            |
| 3    | Has embedded thumbnail (PNG, in tess/thumbnail.png CBOR key)      |
| 4-15 | Reserved (must be 0)                                              |

Default flags for a writer: `0b0000_0000_0000_0010` (CBOR set, no
dict yet, no CRC, no thumbnail). The dict bit gets set once the writer
opts into a registered dictionary (see §6).

### 2.2 Length fields

Both lengths are uint64 — overkill for 2D drawings, but consistent with
glTF / GLB and keeps the door open for future bundles that include
embedded raster previews (the IFC-X `media` slot can carry MB of PNG
data).

If the compressed body length stored here doesn't match the file's
actual remaining bytes (minus any CRC trailer), the reader treats the
file as corrupt and refuses to decode.

## 3. Optional dict-id chunk

When flag bit 0 is set, a small chunk immediately follows the header:

```
Offset  Size  Type     Field
------  ----  -------  ------------------------------------------------
 0      4     ASCII    Chunk tag = "DICT"
 4      4     uint32   Dictionary ID (zstd's natural dict-id)
```

The dictionary itself is **not** embedded — it's identified by id, and
the reader looks it up in a registry it ships with. Ships-with-binary
saves 100-300 KB per file vs. embedding.

Registry: a `dicts/` folder in the `ifcdraw` crate, one file per dict:

```
ifcdraw/dicts/01000001.dict    ← general-purpose IFC-X drawing dict
ifcdraw/dicts/01000002.dict    ← Bonsai-export-optimised dict
ifcdraw/dicts/01000003.dict    ← DWG-import-optimised dict
```

The 4-byte id is `0x01xxxxxx` — high byte `0x01` marks "Open 2D Studio
managed". `0x00xxxxxx` is reserved for a future buildingSMART-managed
range; `0x02xxxxxx` for community user-trained dicts.

If a reader doesn't have the dict locally, two fallbacks:

1. **Refuse** (default behaviour, fail-loud)
2. **Auto-fetch** if `IFCDRAW_DICT_FETCH=1` and a registry URL is
   configured. The fetched dict is hash-verified against a built-in
   list of known good hashes — no arbitrary network resources.

A file written **without** a dict (compression byte = 1) is always
decodable by any reader and is the recommended default for shipping
files to external parties. Dict-compressed files are for tight internal
storage (e.g. cloud object storage) where the reader is known to have
the dict.

## 4. CBOR vs. msgpack — decision

We adopt **CBOR (RFC 8949)** and drop MessagePack. Rationale:

| Criterion                          | CBOR              | msgpack           | Winner    |
|------------------------------------|-------------------|-------------------|-----------|
| IETF standard                      | RFC 8949          | community spec    | CBOR      |
| Tag system for typed primitives    | yes (timestamps,  | no                | CBOR      |
|                                    | big integers,     |                   |           |
|                                    | UUIDs, etc.)      |                   |           |
| Canonical / deterministic encoding | RFC 8949 §4.2     | informal          | CBOR      |
| JSON-equivalence guarantee         | yes (RFC 8949 §6) | mostly            | CBOR      |
| Smallest size on small ints        | ~equal            | ~equal            | tie       |
| Smallest size on doubles           | identical         | identical         | tie       |
| Streaming decoder ergonomics       | excellent         | excellent         | tie       |
| Rust crate maturity                | `ciborium`        | `rmp-serde`       | both fine |
| IFC-X / IFCXB ecosystem alignment  | YES               | no                | CBOR      |
| TypeScript / browser decoder size  | `cbor-x` (8 KB)   | `@msgpack/msgpack`(7 KB)| tie |

The deciding factor is the last row but one: **Ifc-Factory's IFCXB is
already CBOR**, and they have working CBOR encoders in 6 languages
(`ciborium` in Rust, `cbor2` in Python, `cbor-x` in TS, `tinycbor` in
C++, `Dahomey.Cbor` in C#). Adopting CBOR makes IFCDraw v3 a strict
subset of the IFCXB ecosystem — anything that reads IFCXB reads IFCDraw
v3 once the header chunk is unwrapped.

Tags we use:

| CBOR Tag | Meaning            | Where                                |
|----------|--------------------|--------------------------------------|
| 0        | Standard date/time | `header.timestamp`                   |
| 37       | UUID (16 bytes)    | `header.id`, `bsi::ifc::guid`        |
| 25       | Stringref namespace| Big string-table optimization (opt-in)|

Tag 25 (stringref) is the CBOR equivalent of a string table — string
values can be replaced by indices into a per-document stringref
namespace. For an IFC-X document with thousands of repeated namespace
keys (`ifcx::geom::circle` etc.), this is ~30% size win even before
zstd. We emit stringref by default; the reader degrades gracefully if
the producer chose not to.

## 5. Roundtrip guarantees

The transformation chain is:

```
binary file ─decompress─► CBOR bytes ─decode─► IfcX JSON value
                                                       │
                                          encode + recompress
                                                       ▼
                                              binary file'
```

Roundtrip invariants we promise:

1. **Logical roundtrip** — `JSON(file) == JSON(file')` always. Tested
   in CI against the IFC-Factory test corpus + our `samples/` corpus.
2. **CBOR canonical roundtrip** — `CBOR(file) == CBOR(file')` if and
   only if the writer emits canonical-CBOR (RFC 8949 §4.2). The Open 2D
   Studio writer does emit canonical CBOR (sorted map keys, smallest
   int encoding, no indefinite-length items).
3. **Byte roundtrip** — `bytes(file) == bytes(file')` if and only if
   the writer emits canonical CBOR AND uses the same zstd level + dict.
   We DO NOT promise byte equality across versions of zstd because
   zstd's internal heuristics can shift. The CRC trailer (if enabled)
   covers byte-level corruption detection independent of any
   determinism claim.

For diff-friendliness (git, BCF threads, code review), we provide a
text mode (next section).

## 6. Text mode `.ifcdraw.json`

The same logical document can be persisted as plain UTF-8 JSON with
extension `.ifcdraw.json`:

```bash
$ cat drawing.ifcdraw.json
{
  "header": { "ifcxVersion": "2.0", "id": "...", ... },
  "imports": [...],
  "data": [...],
  "media": {}
}
```

There is **no binary header on the JSON file** — it's just an IFC-X
document on disk. The writer chooses between modes via extension:

| Extension       | Header        | Body            | Compression | Use case                |
|-----------------|---------------|-----------------|-------------|-------------------------|
| `.ifcdraw`      | IFCDRAW magic | CBOR            | zstd        | Default production save |
| `.ifcdraw.json` | none          | JSON UTF-8      | none        | Git, diff, BCF, review  |
| `.ifcdraw.cbor` | none          | CBOR            | none        | Raw interop with IFCXB  |
| `.ifcxb`        | IFCX magic    | CBOR (chunked)  | zstd        | True Ifc-Factory IFCXB  |

The text mode produces files that are valid against IFC-Factory's IFC-X
v2 JSON schema — drop them into the Ifc-Factory web viewer, into
Bonsai's IFC-X importer, etc., they Just Work. The binary mode is
strictly a size + dispatch optimisation.

## 7. Reader dispatch

Pseudocode for the top-level loader:

```rust
pub fn load_ifcdraw(path: &Path) -> Result<IfcxDocument> {
    let mut head = [0u8; 8];
    let mut file = File::open(path)?;
    file.read_exact(&mut head)?;

    match (path.extension().and_then(|s| s.to_str()), &head) {
        (Some("json"), _)  => load_text_json(file, head),
        (Some("cbor"), _)  => load_raw_cbor(file, head),
        (_, b"IFCDRAW\x03") => load_v3_binary(file),
        (_, b"IFCDRAW\x02") => load_v2_legacy(file),
        (_, b"IFCDRAW\x01") => load_v1_legacy(file),
        (_, b"IFCX")        => load_external_ifcxb(file, head),
        _ => Err(IfcxError::UnknownFormat),
    }
}
```

The magic-byte dispatch is **before any decompression**, so a malformed
or hostile file can't waste CPU on a doomed decompress. The first 8
bytes are also cheap to log for forensics.

Legacy v1 and v2 readers stay in the crate for the foreseeable future
(read-only). The writer always emits v3.

## 8. Tessellation cache (optional `tess/` map)

For viewer performance, the writer MAY embed a precomputed
tessellation cache **outside** the logical IFC-X document, under a
top-level `tess` map that lives only in the binary envelope:

```
{
  "header":  {...},        ← IFC-X document
  "imports": [...],
  "data":    [...],
  "media":   {...},
  "tess": {                ← cache, ignored by IFC-X readers
    "v":           1,
    "scene_bbox":  [xmin, ymin, xmax, ymax],
    "segments_q16":     <bin>,
    "segment_color":    <bin>,
    "segment_entity_idx":<bin>,
    "triangles_q16":    <bin>,
    "triangle_color":   <bin>,
    "thumbnail_png":    <bin>
  }
}
```

This is the v2 `BinaryIfcDraw` payload, reduced and packed in CBOR
binary strings. It is a pure cache — discarding it loses no
information, the renderer can rebuild it from the IFC-X data. A reader
that doesn't recognise `tess` ignores it. A reader that does
(specifically: Open 2D Studio's own loader) uses it to skip the curve →
polyline tessellation pass on first display.

The `.ifcdraw.json` text mode never includes `tess` — the cache is
binary-only. The CRC trailer, if present, covers tess too.

## 9. Trailer (optional, 4 bytes)

When flag bit 2 is set, the final 4 bytes of the file are a CRC32
(IEEE 802.3 polynomial, init 0xFFFFFFFF, final XOR 0xFFFFFFFF) of every
byte from offset 32 (just after the header) to `file_len - 4`. This
catches truncation and bit-rot in cloud storage, without requiring full
decompression to detect.

We do not include a cryptographic signature in v3.0 — that's a separate
concern for a later "signed IFCDraw" extension that would live in
`ifcx::signature::*` per IFC-Factory's `attributes.md`.

## 10. Versioning policy

| What                | Where                       | When it bumps                |
|---------------------|-----------------------------|------------------------------|
| Magic byte 8 (wire) | `IFCDRAW\x03`               | Incompatible envelope change |
| IFC-X schema        | `header.ifcxVersion`        | Tracks IFC-Factory upstream  |
| Application/writer  | `header.application`        | Each Open 2D Studio release  |
| Dictionary id       | DICT chunk uint32           | New trained dictionary       |

A new wire-version byte means the envelope itself changed (e.g. we
move from CBOR to something else, or add an inline dict). A new
`ifcxVersion` means the JSON schema inside changed (IFC-Factory ships
3.0). These are independent.

v3.x backward-compat rules:

- A v3.0 reader can read any v3.x file as long as the wire envelope is
  identical (compression byte, flag bits we know about, no new
  required chunks).
- Unknown flag bits cause a strict reader to refuse; a lenient reader
  warns and proceeds.
- New `ifcx::*` attribute keys at the JSON layer never break the
  binary reader — they pass through as opaque CBOR maps.

## 11. Estimated sizes

Same 2 875-entity world used in the JSON spec:

| Layer                                | Size       | Δ vs prev |
|--------------------------------------|------------|-----------|
| Raw JSON pretty-printed              | 1 240 KB   | -         |
| Raw JSON minified                    |   720 KB   | -42%      |
| Canonical CBOR                       |   540 KB   | -25%      |
| Canonical CBOR + stringref           |   380 KB   | -30%      |
| + zstd-19, no dict                   |    58 KB   | -85%      |
| + zstd-19 + corpus-trained dict      |    44 KB   | -24%      |
| + zstd-22 + dict (release mode)      |    41 KB   | -7%       |
| + CRC32 trailer                      |    41 KB+4 | -         |

Numbers are projected from IFCXB's published 94%-vs-DXF metric plus
typical zstd-dict gains on namespace-heavy data. The implementation
round needs to confirm these by running the writer over a real corpus
and emitting the table to a `bench-sizes.md`.

## 12. Test plan (for the implementation round)

1. **Format round-trip** — for every `.dxf` / `.dwg` in
   `samples/`, run `dxf → v3 binary → v3 binary'`, assert byte equality.
2. **JSON round-trip** — `dxf → v3 binary → v3 json → v3 binary'`,
   assert logical equality (sorted JSON deep-eq, no whitespace, no key
   ordering).
3. **IFCXB compat** — write a v3 file, strip the IFCDRAW header,
   decompress + CBOR-decode, hand to Ifc-Factory's Rust `ifcx::IfcxReader`,
   assert it loads without error.
4. **Reverse IFCXB compat** — take an IFCXB sample from
   `Ifc-Factory/examples/`, prepend an IFCDRAW header, assert our
   reader loads it.
5. **Dict savings** — over the test corpus, assert dict-compressed mean
   size is at least 15% smaller than no-dict size. Reject the dict if
   it's not.
6. **Corruption detection** — bit-flip random offsets in 1 000 files,
   assert CRC-enabled reads either succeed or fail loudly; never
   silent-corrupt.
7. **Magic dispatch** — feed the reader v1 / v2 / v3 / IFCXB / random
   garbage, assert routing matches §7.

## 13. Implementation crate split

Proposed Rust crate layout (in `kernel/crates/`):

| Crate         | Role                                                         |
|---------------|--------------------------------------------------------------|
| `ifcx-core`   | Mirror of Ifc-Factory's `libraries/rust/`. IfcxDocument,    |
|               | reader, writer, schema validation. Versioned vendor-import   |
|               | of upstream.                                                |
| `ifcdraw`     | The envelope (magic, header, dict, CBOR, zstd glue). Depends|
|               | on `ifcx-core` for the inner document.                      |
| `ifcdraw-cli` | `ifcdraw inspect/convert/strip-tess/validate/bench` tools.  |
| `ifcdraw-bench`| size + speed benches against the test corpus.              |
| `app`         | Existing crate. Drops `ifcx_export.rs`, depends on `ifcdraw`|
|               | for the new path. v2 reader stays in `ifcdraw-legacy`.      |

We do not modify any existing crate's public surface in the design
round. The implementation round will need a small migration in
`kernel/crates/app` to swap `ifcx_export::write_ifcx_binary` for
`ifcdraw::write_v3`.

## 14. External dependencies

| Crate              | Why                                            | Cost            |
|--------------------|------------------------------------------------|-----------------|
| `ciborium`         | CBOR codec, matches Ifc-Factory's choice       | already in deps |
| `zstd`             | already used by v2                             | already in deps |
| `serde_json`       | JSON text mode                                 | already in deps |
| `uuid`             | GlobalId generation                            | already in deps |
| `crc32fast`        | trailer CRC                                    | +1 dep, tiny    |
| `time` or `chrono` | RFC 3339 timestamps                            | already in deps |

The only new dependency is `crc32fast` (~15 KB compiled), gated behind
the CRC flag.

## 15. Open questions

Repeated from the JSON spec for convenience:

1. Pinned IFC-Factory revision strategy (vendor vs. git-dep).
2. Hatch boundary inlining shortcut yes/no.
3. q16 opt-in chunk in the envelope vs. trust-zstd.
4. GUID namespace UUID — public well-known or per-installation.
5. Synthesise IFC spatial hierarchy from DWG layout names?

Plus envelope-specific:

6. Do we ship the corpus-trained dictionary with v3.0, or release
   without a dictionary and add it in v3.1 after the format stabilises?
7. CRC trailer default-on or default-off? On adds 4 bytes per file +
   read-time CRC; off keeps files identical across CRC-capable and
   non-CRC writers.
8. Should we register `application/vnd.ifcdraw+cbor` as a MIME type
   (and `application/vnd.ifcdraw+json` for the text mode)? Useful for
   browser drag-drop and HTTP content-negotiation in a future viewer.

---

**Sister spec:** `2026-05-22-ifcdraw-v3-ifcx-mapping.md` — IFC-X JSON
layout and entity mapping table.
