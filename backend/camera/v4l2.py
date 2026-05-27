import re
import subprocess


def get_controls(device_path: str) -> dict:
    try:
        result = subprocess.run(
            ['v4l2-ctl', f'--device={device_path}', '--list-ctrls'],
            capture_output=True, text=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {}
    controls = {}
    for line in result.stdout.splitlines():
        m = re.match(r'\s+(\w+)\s+0x[0-9a-f]+\s+\((\w+)\)\s*:\s*(.*)', line)
        if not m:
            continue
        name, ctrl_type, rest = m.groups()
        if ctrl_type not in ('int', 'int64', 'bool'):
            continue
        parts = dict(re.findall(r'(\w+)=(-?\d+)', rest))
        if 'value' not in parts:
            continue
        controls[name] = {
            'type': ctrl_type,
            'min': int(parts.get('min', 0)),
            'max': int(parts.get('max', 1)),
            'step': int(parts.get('step', 1)),
            'default': int(parts.get('default', 0)),
            'value': int(parts['value']),
        }
    return controls


def set_control(device_path: str, name: str, value: int) -> bool:
    try:
        r = subprocess.run(
            ['v4l2-ctl', f'--device={device_path}', f'--set-ctrl={name}={value}'],
            capture_output=True, text=True, timeout=5,
        )
        return r.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def apply_controls(device_path: str, settings: dict) -> None:
    for name, value in settings.items():
        set_control(device_path, name, int(value))
