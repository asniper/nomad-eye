"""Arducam Webcam Vitade AF (0x0c45:0x6366) UVC Extension Unit controls.

This camera exposes one XU:
  Unit 3, GUID {28f03370-6311-4a2e-ba2c-6890eb334016} (Sonix SYS HW CTRL)
  Only selector 1 responds; selectors 2-10 return None.

Selector 1 is a live counter (~1 Hz), NOT a mode register.
Writes are accepted by the firmware but have no observable effect on the IR
hardware — the camera's IR LEDs are controlled entirely by an onboard
photocell (hardware-only switching).

is_supported() detects this by writing a sentinel value (200) that a running
counter will never spontaneously equal, then verifying it sticks. On this
camera it never sticks, so is_supported() returns False and callers fall
back to software processing.
"""
import ctypes
import fcntl
import struct
import time

# _IOWR('u', 0x21, 16-byte struct) on ARM64 Linux
_UVCIOC_CTRL_QUERY = 0xC0107521
_UVC_SET_CUR = 0x01
_UVC_GET_CUR = 0x81
_UNIT_ID = 3
_SELECTOR_MODE = 1

# night_mode setting -> byte value for selector 1 (kept for future cameras)
_MODE_VAL = {
    'off':  1,
    'auto': 2,
    'on':   3,
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


def is_supported(device_path: str) -> bool:
    """True only if selector 1 is a writable static mode register.

    Writes a sentinel value (200) that a running counter will never
    spontaneously equal, then verifies it sticks after 100ms.
    Returns False for cameras where the selector is a live counter.
    """
    # Counter resets to the written value then ticks after ~500ms.
    # Wait 700ms so we can tell if the value drifted (counter) vs held (mode register).
    _xu_ioctl(device_path, _SELECTOR_MODE, _UVC_SET_CUR, [200, 0, 0, 0])
    time.sleep(0.7)
    result = _xu_ioctl(device_path, _SELECTOR_MODE, _UVC_GET_CUR, [0, 0, 0, 0])
    return result is not None and result[0] == 200


def set_night_mode(device_path: str, mode: str) -> bool:
    """Set IR day/night mode via UVC XU. Returns True only if HW control confirmed."""
    if not is_supported(device_path):
        return False
    val = _MODE_VAL.get(mode, 1)
    result = _xu_ioctl(device_path, _SELECTOR_MODE, _UVC_SET_CUR, [val, 0, 0, 0])
    return result is not None


def get_night_mode_raw(device_path: str) -> int | None:
    """Read current selector-1 byte[0] value. Returns None on failure."""
    result = _xu_ioctl(device_path, _SELECTOR_MODE, _UVC_GET_CUR, [0, 0, 0, 0])
    return result[0] if result is not None else None
