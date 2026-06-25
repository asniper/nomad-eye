"""Arducam Webcam Vitade AF (0x0c45:0x6366) UVC Extension Unit controls.

This camera exposes one XU:
  Unit 3, GUID {28f03370-6311-4a2e-ba2c-6890eb334016} (Sonix SYS HW CTRL)
  bNumControls=32 claimed, but only selectors 1-5 respond.
  Unit 4 (USR HW CTRL / GPIO) is absent on this firmware.

Selector 1 (4 bytes) is used as the day/night mode switch.
Byte[0] values (empirically determined from factory default = [2,0,0,0]):
  1 = day   — force day mode (IR cut filter in, IR LEDs off)
  2 = auto  — photosensor-controlled auto switching (factory default)
  3 = night — force night mode (IR cut out, IR LEDs on)

These values are best-guess from probing; no Arducam datasheet was found.
If the IR does not respond, try swapping values or use linux-enable-ir-emitter
to brute-force the correct selector/payload.
"""
import ctypes
import fcntl
import struct

# _IOWR('u', 0x21, 16-byte struct) on ARM64 Linux
_UVCIOC_CTRL_QUERY = 0xC0107521
_UVC_SET_CUR = 0x01
_UVC_GET_CUR = 0x81
_UNIT_ID = 3
_SELECTOR_MODE = 1

# night_mode setting -> byte value for selector 1
_MODE_VAL = {
    'off':  1,  # day mode
    'auto': 2,  # auto (factory default)
    'on':   3,  # night mode (IR LEDs on)
}


def _xu_ioctl(device_path: str, selector: int, query: int, data: list) -> list | None:
    buf = (ctypes.c_uint8 * len(data))(*data)
    ptr = ctypes.cast(buf, ctypes.c_void_p).value
    req = struct.pack('<BBBBHH', _UNIT_ID, selector, query, 0, len(data), 0) + struct.pack('<Q', ptr)
    try:
        with open(device_path, 'rb') as f:
            fcntl.ioctl(f.fileno(), _UVCIOC_CTRL_QUERY, bytearray(req))
        return list(buf)
    except Exception:
        return None


def set_night_mode(device_path: str, mode: str) -> bool:
    """Set IR day/night mode via UVC XU. Returns True if the ioctl succeeded."""
    val = _MODE_VAL.get(mode, 1)
    result = _xu_ioctl(device_path, _SELECTOR_MODE, _UVC_SET_CUR, [val, 0, 0, 0])
    return result is not None


def get_night_mode_raw(device_path: str) -> int | None:
    """Read current selector-1 byte[0] value. Returns None on failure."""
    result = _xu_ioctl(device_path, _SELECTOR_MODE, _UVC_GET_CUR, [0, 0, 0, 0])
    return result[0] if result is not None else None


def is_supported(device_path: str) -> bool:
    """Quick probe: True if this camera responds to selector 1."""
    return get_night_mode_raw(device_path) is not None
