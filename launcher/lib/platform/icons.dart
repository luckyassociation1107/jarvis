import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
// dart:ui, not package:flutter — `instantiateImageCodec` lives there, and
// aliased so it does not collide with the Color/Size that material re-exports.
import 'dart:ui' as ui;

/// Icon extraction for the formats Flutter cannot read.
///
/// This is the piece that makes a desktop workspace possible rather than a
/// monogram grid. Flutter's image decoder handles PNG, JPEG, GIF, WebP and BMP
/// — it does not handle `.ico` or `.icns`, which are the two formats Windows and
/// macOS actually use for application icons.
///
/// The trick is that neither format is really opaque:
///
///   `.icns`  is a container. Its large elements (ic07, ic08, ic09, ic10) are
///            *literal PNG data*, so extraction is a length-prefixed walk.
///   `.ico`   is a directory of images. Modern files embed PNG directly, so
///            again the payload is a PNG that Flutter can decode.
///
/// So both reduce to "find the PNG inside, hand it to the decoder". The decoded
/// image is re-encoded to PNG and written to a cache file, because the UI loads
/// icons with `Image.file` and a `MemoryImage` would keep every icon resident at
/// once — a few hundred icons is a few hundred megabytes.
///
/// Where this genuinely cannot work — a `.ico` holding only BMP data, an old
/// `.icns` with only raw ARGB elements — it returns null and the UI falls back
/// to a monogram. That fallback is a real design decision, not a placeholder.
abstract final class IconExtractor {
  static const _pngMagic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  /// Decodes whatever is at [path] into a PNG file, returning its path.
  ///
  /// Returns null if the format is not one this understands, or the payload is
  /// not decodable. Never throws — an icon is a nicety.
  static Future<String?> decode(String path, {required String cacheDir}) async {
    try {
      final file = File(path);
      if (!await file.exists()) return null;

      final bytes = await file.readAsBytes();
      final png = await _extractPng(bytes, path);
      if (png == null) return null;

      final codec = await ui.instantiateImageCodec(png);
      final frame = await codec.getNextFrame();
      final image = frame.image;

      // Re-encode rather than copying the extracted bytes: an .ico can hold a
      // 16x16 PNG alongside a 256x256 one, and picking the largest is what
      // keeps the grid crisp. This is also where a BMP-backed icon would have
      // to be converted by hand, which is why those fall back.
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (data == null) return null;

      final out = File('$cacheDir/${_key(path)}.png');
      await out.parent.create(recursive: true);
      await out.writeAsBytes(data.buffer.asUint8List(), flush: true);
      return out.path;
    } catch (_) {
      return null;
    }
  }

  /// A stable filename for a source path.
  static String _key(String path) =>
      path.hashCode.toUnsigned(32).toRadixString(16);

  /// Pulls PNG bytes out of an `.ico` or `.icns`, or null.
  static Future<Uint8List?> _extractPng(Uint8List bytes, String path) async {
    final lower = path.toLowerCase();
    if (lower.endsWith('.icns')) return _fromIcns(bytes);
    if (lower.endsWith('.ico')) return _fromIco(bytes);
    // Already a format Flutter reads — hand it straight through.
    if (_looksLikePng(bytes)) return bytes;
    return null;
  }

  /// Byte-by-byte rather than `List.equals`, which does not exist on the core
  /// List type — that would be a compile error, not a behaviour difference.
  static bool _looksLikePng(Uint8List b) {
    if (b.length < _pngMagic.length) return false;
    for (var i = 0; i < _pngMagic.length; i++) {
      if (b[i] != _pngMagic[i]) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // .icns
  // -------------------------------------------------------------------------

  /// Apple Icon Image.
  ///
  ///   magic 'icns' (4)
  ///   total length (4, big-endian, includes the header)
  ///   then elements: type (4), length (4, big-endian, includes these 8 bytes)
  ///
  /// Big-endian, unlike everything else on either platform — which is exactly
  /// the kind of detail that is wrong in the first implementation.
  static Uint8List? _fromIcns(Uint8List b) {
    if (b.length < 8) return null;
    if (b[0] != 0x69 || b[1] != 0x63 || b[2] != 0x6E || b[3] != 0x73) return null;

    // ic10 = 1024px, ic09 = 512, ic08 = 256, ic07 = 128. All PNG.
    // Listed largest-first so the first match is the best icon available.
    const pngTypes = ['ic10', 'ic09', 'ic08', 'ic07', 'ic11', 'ic12', 'ic13', 'ic14'];

    var offset = 8;
    while (offset + 8 <= b.length) {
      final type = String.fromCharCodes(b.sublist(offset, offset + 4));
      // Big-endian length.
      final length = (b[offset + 4] << 24) |
          (b[offset + 5] << 16) |
          (b[offset + 6] << 8) |
          b[offset + 7];
      if (length < 8 || offset + length > b.length) break;

      if (pngTypes.contains(type)) {
        final payload = b.sublist(offset + 8, offset + length);
        if (_looksLikePng(payload)) return payload;
      }
      offset += length;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // .ico
  // -------------------------------------------------------------------------

  /// Windows icon.
  ///
  ///   reserved (2) = 0
  ///   type (2) = 1 for icon
  ///   count (2)
  ///   then `count` directory entries of 16 bytes each:
  ///     width (1)    0 means 256
  ///     height (1)   0 means 256
  ///     colourCount (1)
  ///     reserved (1)
  ///     planes (2)
  ///     bitCount (2)
  ///     bytesInRes (4)
  ///     imageOffset (4)
  ///
  /// All little-endian.
  static Uint8List? _fromIco(Uint8List b) {
    if (b.length < 6) return null;
    if (b[0] != 0 || b[1] != 0) return null;
    if (b[2] != 1 || b[3] != 0) return null;

    final count = b[4] | (b[5] << 8);
    if (count <= 0 || 6 + count * 16 > b.length) return null;

    // Collect the PNG-backed entries with their declared size, so the largest
    // can be preferred — a 16x16 icon scaled to a grid cell is mush.
    final candidates = <_IcoEntry>[];
    for (var i = 0; i < count; i++) {
      final base = 6 + i * 16;
      final width = b[base] == 0 ? 256 : b[base];
      final height = b[base + 1] == 0 ? 256 : b[base + 1];
      final bytesInRes = _le32(b, base + 8);
      final imageOffset = _le32(b, base + 12);
      if (bytesInRes <= 0 || imageOffset + bytesInRes > b.length) continue;

      final payload = b.sublist(imageOffset, imageOffset + bytesInRes);
      if (_looksLikePng(payload)) {
        candidates.add(_IcoEntry(width * height, payload));
      }
    }

    if (candidates.isEmpty) return null; // BMP-backed; not handled
    candidates.sort((a, b2) => b2.area.compareTo(a.area));
    return candidates.first.payload;
  }

  static int _le32(Uint8List b, int at) =>
      b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);
}

class _IcoEntry {
  const _IcoEntry(this.area, this.payload);

  final int area;
  final Uint8List payload;
}

/// Reads the icon path out of a Windows `.lnk` shortcut.
///
/// A shell link stores its icon in the optional StringData block, and only when
/// the ICON_LOCATION flag is set. The strings before it — name, relative path,
/// working dir, arguments — are present or absent according to their own flags,
/// so they have to be skipped in exactly that order or the offset is wrong.
///
/// The result is often a path to an `.ico`, and sometimes a path to an `.exe`
/// or `.dll` with a comma and an index appended. Only the `.ico` case is
/// resolved here; the exe case would need a PE resource parser, which is a
/// different order of work.
abstract final class LnkIconReader {
  static const _hasIconLocation = 0x00000080;
  static const _hasName = 0x00000010;
  static const _hasRelativePath = 0x00000020;
  static const _hasWorkingDir = 0x00000040;
  static const _hasArguments = 0x00000100;

  /// Returns the icon location string, or null.
  static String? read(String path) {
    try {
      final b = File(path).readAsBytesSync();
      if (b.length < 76) return null;

      final flags = _le32(b, 20);
      if (flags & _hasIconLocation == 0) return null;

      var offset = 76;

      // LinkTargetIDList — a size-prefixed blob of shell items.
      if (flags & 0x00000001 != 0) {
        final idListSize = b[offset] | (b[offset + 1] << 8);
        offset += 2 + idListSize;
      }

      // LinkInfo — also size-prefixed, in its own header.
      if (flags & 0x00000002 != 0) {
        final linkInfoSize = _le32(b, offset);
        offset += linkInfoSize;
      }

      // StringData, in flag order, each a (uint16 count, UTF-16 chars) pair.
      for (final present in [
        _hasName,
        _hasRelativePath,
        _hasWorkingDir,
        _hasArguments,
        _hasIconLocation,
      ]) {
        if (flags & present == 0) continue;
        if (offset + 2 > b.length) return null;
        final charCount = b[offset] | (b[offset + 1] << 8);
        offset += 2;
        if (offset + charCount * 2 > b.length) return null;

        final value = _utf16(b, offset, charCount);
        offset += charCount * 2;

        if (present == _hasIconLocation) return value.isEmpty ? null : value;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  static int _le32(Uint8List b, int at) =>
      b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);

  static String _utf16(Uint8List b, int at, int count) {
    final codes = <int>[];
    for (var i = 0; i < count; i++) {
      codes.add(b[at + i * 2] | (b[at + i * 2 + 1] << 8));
    }
    return String.fromCharCodes(codes);
  }
}
