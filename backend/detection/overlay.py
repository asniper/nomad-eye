"""Shared drawing helpers so snapshots, clips, and the live stream burn in identical overlays."""
import cv2
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from detection.detector import CATEGORY_COLORS_BGR

BAR_HEIGHT = 36
FONT = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE = 0.48
FONT_THICKNESS = 1
TEXT_COLOR = (210, 210, 210)
BAR_COLOR = (40, 40, 40)


def draw_boxes(frame, detections):
    """Draw a bounding box + '<label> <confidence>' per detection, color-coded by category."""
    for d in detections:
        x1, y1, x2, y2 = d.bbox
        color = CATEGORY_COLORS_BGR.get(d.category, (128, 128, 128))
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(frame, f"{d.label} {d.confidence:.0%}", (x1, y1 - 8),
                    FONT, 0.6, color, 2)
    return frame


def format_camera_time_str(cam_name: str, ts_iso: str, tz_name: str = 'UTC') -> str:
    """Build the '<camera>  -  <weekday month day, year  h:mm AM/PM TZ>' label."""
    try:
        tz = ZoneInfo(tz_name) if tz_name != 'UTC' else timezone.utc
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    dt = datetime.fromisoformat(ts_iso).astimezone(tz)
    hour = dt.strftime('%I').lstrip('0') or '12'
    time_str = dt.strftime(f'%a %b {dt.day}, %Y  {hour}:%M %p %Z')
    return f"{cam_name}  -  {time_str}"


def draw_info_bar(frame, left_text: str, detections=None):
    """Draw the bottom info bar: camera/time on the left, detection summary on the right."""
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, h - BAR_HEIGHT), (w, h), BAR_COLOR, -1)
    text_y = h - BAR_HEIGHT + 24

    cv2.putText(frame, left_text, (8, text_y), FONT, FONT_SCALE, TEXT_COLOR, FONT_THICKNESS, cv2.LINE_AA)

    if detections:
        parts = [f"{d.label}  {round(d.confidence * 100)}%" for d in detections]
        det_str = '   |   '.join(parts)
        (tw, _), _ = cv2.getTextSize(det_str, FONT, FONT_SCALE, FONT_THICKNESS)
        if tw > w // 2:
            det_str = parts[0] + (f'  +{len(parts) - 1} more' if len(parts) > 1 else '')
            (tw, _), _ = cv2.getTextSize(det_str, FONT, FONT_SCALE, FONT_THICKNESS)
        cv2.putText(frame, det_str, (w - tw - 8, text_y), FONT, FONT_SCALE, TEXT_COLOR, FONT_THICKNESS, cv2.LINE_AA)
    return frame
