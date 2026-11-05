"""A trip drawn on a map, as a picture to send (Telegram) after a drive.

The positions come from the recorder (a device_tracker's history between two
times); the background from OpenStreetMap's tiles, darkened to the look of the
wall's GPS card (a few tiles per trip, within OpenStreetMap's tile policy). The picture is written under /media (Home
Assistant's default media folder, readable by telegram_bot and never served
without a login, unlike /config/www).
"""

from __future__ import annotations

import io
import math
from collections.abc import Awaitable, Callable, Sequence

TILE = 256
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
MAX_TILES = 48
LINE = (108, 196, 245)      # the wall's accent blue
START = (92, 194, 143)
END = (229, 50, 59)          # Igor's red


def haversine_km(a: Sequence[float], b: Sequence[float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def clean(points: Sequence[Sequence[float]], min_m: float = 8.0) -> list[tuple[float, float]]:
    """Valid positions, without the ones a few metres from the last kept."""
    out: list[tuple[float, float]] = []
    for p in points:
        try:
            lat, lon = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            continue
        if not (-85 <= lat <= 85 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            continue
        if out and haversine_km(out[-1], (lat, lon)) * 1000 < min_m:
            continue
        out.append((lat, lon))
    return out


def world_px(lat: float, lon: float, z: int) -> tuple[float, float]:
    n = TILE * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def fit(points: Sequence[tuple[float, float]], width: int, height: int, pad: int = 48) -> tuple[int, float, float]:
    """The zoom that shows every point, and the world pixel at the picture's top left."""
    for z in range(17, 1, -1):
        xs, ys = zip(*(world_px(lat, lon, z) for lat, lon in points))
        if max(xs) - min(xs) <= width - 2 * pad and max(ys) - min(ys) <= height - 2 * pad:
            break
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return z, cx - width / 2, cy - height / 2


async def render(
    points: Sequence[Sequence[float]],
    fetch: Callable[[str], Awaitable[bytes | None]],
    width: int = 800,
    height: int = 560,
) -> tuple[bytes, dict]:
    """PNG bytes of the trip, and what it shows (points, km, zoom)."""
    from PIL import Image, ImageDraw, ImageOps

    pts = clean(points)
    if len(pts) < 2:
        raise ValueError("pas assez de positions pour ce trajet")
    z, left, top = fit(pts, width, height)
    img = Image.new("RGB", (width, height), (13, 16, 20))
    x0, y0 = int(left // TILE), int(top // TILE)
    x1, y1 = int((left + width) // TILE), int((top + height) // TILE)
    count = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            if count >= MAX_TILES or ty < 0 or ty >= 2 ** z:
                continue
            count += 1
            data = await fetch(TILE_URL.format(z=z, x=tx % (2 ** z), y=ty))
            if not data:
                continue
            try:
                # OpenStreetMap's light map, turned dark: land near black,
                # roads a little darker still, names light.
                gray = ImageOps.autocontrast(Image.open(io.BytesIO(data)).convert("L"), cutoff=1)
                tile = ImageOps.colorize(gray, black=(176, 184, 192), white=(18, 22, 27), mid=(70, 78, 88))
            except Exception:  # noqa: BLE001 - a bad tile leaves its square dark
                continue
            img.paste(tile, (int(tx * TILE - left), int(ty * TILE - top)))
    draw = ImageDraw.Draw(img)
    xy = [(world_px(lat, lon, z)[0] - left, world_px(lat, lon, z)[1] - top) for lat, lon in pts]
    draw.line(xy, fill=(13, 16, 20), width=9, joint="curve")
    draw.line(xy, fill=LINE, width=5, joint="curve")
    for (x, y), color in ((xy[0], START), (xy[-1], END)):
        draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=color, outline=(233, 228, 218), width=3)
    note = "© les contributeurs d'OpenStreetMap"
    tw = draw.textlength(note)
    draw.rectangle((width - tw - 12, height - 18, width, height), fill=(13, 16, 20))
    draw.text((width - tw - 6, height - 15), note, fill=(150, 160, 170))
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    km = sum(haversine_km(a, b) for a, b in zip(pts, pts[1:]))
    return out.getvalue(), {"points": len(pts), "distance_km": round(km, 2), "zoom": z}
