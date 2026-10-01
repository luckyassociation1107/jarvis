import 'dart:io';

// package:ffi re-exports dart:ffi, so this one import is enough for
// DynamicLibrary, Pointer, Uint64 and the calloc/Utf16 helpers alike.
import 'package:ffi/ffi.dart';

/// Real system statistics, read straight out of kernel32.
///
/// `dart:ffi` rather than a package, because the three numbers a desktop
/// monitor actually needs — memory load, disk free, and CPU busy — are each one
/// kernel32 call. The alternative is shelling out to `typeperf` or PowerShell,
/// which costs a subprocess per sample and about half a second of latency.
///
/// Windows only. On other platforms this reports `supported: false` and the
/// widgets say so, rather than inventing numbers.
abstract final class SystemStats {
  static final DynamicLibrary? _kernel32 =
      Platform.isWindows ? DynamicLibrary.open('kernel32.dll') : null;

  // GlobalMemoryStatusEx(BOOL) — fills a MEMORYSTATUSEX.
  static late final _globalMemoryStatusEx = _kernel32!
      .lookupFunction<Int32 Function(Pointer<Void>), int Function(Pointer<Void>)>(
          'GlobalMemoryStatusEx');

  // GetDiskFreeSpaceExW(LPCWSTR, PULARGE_INTEGER x3)
  static late final _getDiskFreeSpaceEx = _kernel32!.lookupFunction<
      Int32 Function(
          Pointer<Utf16>, Pointer<Uint64>, Pointer<Uint64>, Pointer<Uint64>),
      int Function(Pointer<Utf16>, Pointer<Uint64>, Pointer<Uint64>,
          Pointer<Uint64>)>('GetDiskFreeSpaceExW');

  // GetSystemTimes(LPFILETIME x3) — three 64-bit values, so Uint64 works.
  static late final _getSystemTimes = _kernel32!.lookupFunction<
      Int32 Function(Pointer<Uint64>, Pointer<Uint64>, Pointer<Uint64>),
      int Function(Pointer<Uint64>, Pointer<Uint64>, Pointer<Uint64>)>(
      'GetSystemTimes');

  static bool? _ffiOk;

  /// Looks the functions up once. `late` static fields initialise on first use,
  /// not on construction, so a missing symbol has to be caught here rather than
  /// left to surface mid-sample.
  static bool get _ready {
    if (_ffiOk != null) return _ffiOk!;
    if (_kernel32 == null) return _ffiOk = false;
    try {
      _globalMemoryStatusEx;
      _getDiskFreeSpaceEx;
      _getSystemTimes;
      return _ffiOk = true;
    } catch (_) {
      return _ffiOk = false;
    }
  }

  /// The drive to report on. The executable's own drive is the system drive in
  /// every real installation, and hardcoding `C:\` is wrong on a machine that
  /// boots from anywhere else.
  static String get _root {
    final exe = Platform.resolvedExecutable;
    final sep = exe.indexOf(r'\');
    return sep <= 0 ? r'C:\' : '${exe.substring(0, sep + 1)}';
  }

  /// A snapshot of the machine.
  ///
  /// [previous] is required for CPU: `GetSystemTimes` returns cumulative totals,
  /// so busy percentage is a delta between two samples. Without one the first
  /// call reports `cpuPercent: null` and the caller samples again shortly after.
  static Future<SystemSnapshot> sample({SystemSnapshot? previous}) async {
    if (!_ready) return const SystemSnapshot(supported: false);
    return _read(previous);
  }

  static SystemSnapshot _read(SystemSnapshot? previous) {
    try {
      // --- memory -----------------------------------------------------------
      // MEMORYSTATUSEX is 64 bytes: dwLength, dwMemoryLoad, then four
      // DWORDLONGs, each naturally aligned to 8.
      final mem = calloc<Uint8>(64);
      mem[0] = 64; // dwLength must be set before the call
      _globalMemoryStatusEx(mem.cast());
      final load = mem.cast<Uint32>()[1].toInt(); // dwMemoryLoad, 0..100
      final totalPhys = mem.cast<Uint64>()[1].toInt(); // ullTotalPhys
      final availPhys = mem.cast<Uint64>()[2].toInt(); // ullAvailPhys
      calloc.free(mem);

      // --- disk -------------------------------------------------------------
      final root = _root.toNativeUtf16();
      final free = calloc<Uint64>();
      final total = calloc<Uint64>();
      _getDiskFreeSpaceEx(root, free, total, nullptr);
      final diskFree = free.value;
      final diskTotal = total.value;
      calloc.free(root);
      calloc.free(free);
      calloc.free(total);

      // --- cpu --------------------------------------------------------------
      final idle = calloc<Uint64>();
      final kernel = calloc<Uint64>();
      final user = calloc<Uint64>();
      _getSystemTimes(idle, kernel, user);
      final idleNow = idle.value;
      final busyNow = kernel.value + user.value;
      calloc.free(idle);
      calloc.free(kernel);
      calloc.free(user);

      // On the very first sample there is nothing to subtract from, so the
      // caller is told to try again rather than handed a wrong number.
      final int? cpuPercent;
      if (previous == null || previous.cpuIdle == null || previous.cpuBusy == null) {
        cpuPercent = null;
      } else {
        final idleDelta = idleNow - previous.cpuIdle!;
        final busyDelta = busyNow - previous.cpuBusy!;
        final span = idleDelta + busyDelta;
        cpuPercent = span <= 0 ? null : (100 - (idleDelta * 100 / span)).clamp(0, 100);
      }

      return SystemSnapshot(
        supported: true,
        memoryLoad: load,
        memoryTotalBytes: totalPhys,
        memoryUsedBytes: totalPhys - availPhys,
        diskFreeBytes: diskFree,
        diskTotalBytes: diskTotal,
        cpuPercent: cpuPercent,
        cpuIdle: idleNow,
        cpuBusy: busyNow,
      );
    } catch (_) {
      // A failed sample is not worth crashing a desktop over.
      return const SystemSnapshot(supported: false);
    }
  }
}

/// One sample of the machine.
class SystemSnapshot {
  const SystemSnapshot({
    required this.supported,
    this.memoryLoad,
    this.memoryTotalBytes,
    this.memoryUsedBytes,
    this.diskFreeBytes,
    this.diskTotalBytes,
    this.cpuPercent,
    this.cpuIdle,
    this.cpuBusy,
  });

  final bool supported;

  /// 0..100, straight from dwMemoryLoad.
  final int? memoryLoad;

  final int? memoryTotalBytes;
  final int? memoryUsedBytes;

  final int? diskFreeBytes;
  final int? diskTotalBytes;

  /// 0..100. Null on the first sample, because it is a delta.
  final int? cpuPercent;

  final int? cpuIdle;
  final int? cpuBusy;

  double? get memoryFraction => memoryLoad == null ? null : memoryLoad! / 100;

  double? get diskFraction =>
      (diskFreeBytes == null || diskTotalBytes == null)
          ? null
          : 1 - (diskFreeBytes! / diskTotalBytes!);
}

/// Formats bytes the way a readout should: one decimal, a unit, no noise.
String formatBytes(int? bytes) {
  if (bytes == null) return '--';
  const units = ['B', 'K', 'M', 'G', 'T'];
  var value = bytes.toDouble();
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  final digits = value >= 100 || unit == 0 ? 0 : 1;
  return '${value.toStringAsFixed(digits)}${units[unit]}';
}
