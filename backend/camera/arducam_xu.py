"""Arducam USB camera UVC Extension Unit controls.

Extension unit: unit ID 3, GUID {28f03370-6311-4a2e-ba2c-6890eb334016}
Selector 1 = mode switch (day/auto/night)

Mode byte values (selector 1, byte[0]):
  1 = day   — color, IR cut filter active, IR LEDs off
  2 = auto  — camera photosensor switches automatically (factory default)
  3 = night — IR cut filter removed, IR LEDs on, B&W image
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
