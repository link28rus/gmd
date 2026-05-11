"""GMD launcher-icon generator.

Генерит источники иконок для flutter_launcher_icons:
  apps/mobile-{parent,child}/assets/icon/icon.png            (1024x1024 legacy, full bleed)
  apps/mobile-{parent,child}/assets/icon/icon_foreground.png (1024x1024 transparent BG, safe-zone aware)
  apps/mobile-{parent,child}/assets/icon/icon_monochrome.png (1024x1024 mono для themed icons Android 13+)

Дизайн: GPS-pin (капля) с буквой G в центре, glow + pulse-кольца.
Палитра вытащена из лендинга (apps/web/app/page.tsx + globals.css):
  - тёмно-синий фон #0a1628 (deeper navy чем landing #050a15 — лучше контраст launcher'а)
  - sky-400 #38bdf8 (parent — основной бренд)
  - emerald-400 #34d399 (child — детский акцент, узнаваемо отличает от parent в семействе иконок)

Adaptive-icon safe zone: внутренний круг диаметром 66% canvas (Android рекомендация:
  система может маскировать иконку круглой/squircle/squared формой и зум до 0.66).
  Foreground PNG занимает 100% canvas, но всё содержимое — внутри safe-zone.
"""

from __future__ import annotations
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SIZE = 1024
SAFE_RADIUS = int(SIZE * 0.33)  # 66%/2 — adaptive-icon safe zone

# Палитра
NAVY_BG = (10, 22, 40, 255)              # #0a1628
NAVY_BG_DEEP = (5, 13, 26, 255)           # центр градиента, чуть темнее
SKY = (56, 189, 248, 255)                # #38bdf8 sky-400 (parent)
EMERALD = (52, 211, 153, 255)            # #34d399 emerald-400 (child)
WHITE = (255, 255, 255, 255)
SLATE = (148, 163, 184, 255)             # подложка/линии


def radial_background(size: int, center_color: tuple, edge_color: tuple) -> Image.Image:
    """Radial-gradient background — мягкий glow в центре, темнее к краям."""
    img = Image.new("RGBA", (size, size), edge_color)
    cx = cy = size / 2
    max_r = math.sqrt(2) * size / 2
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            r = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(r / max_r, 1.0)
            # ease-out — больше времени на центральный glow
            t = t * t
            pixel = tuple(int(center_color[i] * (1 - t) + edge_color[i] * t) for i in range(4))
            pixels[x, y] = pixel
    return img


def draw_pin_shape(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, color: tuple) -> None:
    """GPS-pin (капля) с центром головы (cx, cy)."""
    # Голова: круг
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=color,
    )
    # Хвост: треугольник вниз
    tip_y = cy + int(radius * 1.85)
    tail_w = int(radius * 0.95)
    draw.polygon(
        [(cx - tail_w, cy + int(radius * 0.55)),
         (cx + tail_w, cy + int(radius * 0.55)),
         (cx, tip_y)],
        fill=color,
    )


def draw_pulse_rings(img: Image.Image, cx: int, cy: int, radius: int, color: tuple, count: int = 2) -> None:
    """Концентрические кольца — эффект «pulse» как на лендинге."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for i in range(1, count + 1):
        r = radius + int(radius * 0.45 * i)
        alpha = max(20, 90 - i * 30)
        ring_color = (*color[:3], alpha)
        thickness = max(4, int(SIZE * 0.012))
        odraw.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            outline=ring_color,
            width=thickness,
        )
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=4))
    img.alpha_composite(overlay)


def find_font(size: int) -> ImageFont.FreeTypeFont:
    """Выбираем bold-шрифт из системных Windows-шрифтов."""
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",     # Segoe UI Bold
        "C:/Windows/Fonts/calibrib.ttf",      # Calibri Bold
        "C:/Windows/Fonts/arialbd.ttf",       # Arial Bold
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_letter_g(img: Image.Image, cx: int, cy: int, color: tuple, font_size: int) -> None:
    """Буква G в центре пина."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    font = find_font(font_size)
    text = "G"
    bbox = odraw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = cx - w / 2 - bbox[0]
    y = cy - h / 2 - bbox[1]
    odraw.text((x, y), text, font=font, fill=color)
    img.alpha_composite(overlay)


def render_icon(accent: tuple, app_kind: str, with_background: bool) -> Image.Image:
    """Главный рендер. with_background=True → legacy fullbleed; False → adaptive foreground."""
    size = SIZE
    if with_background:
        img = radial_background(size, NAVY_BG, NAVY_BG_DEEP)
    else:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    cx = size // 2
    pin_radius = int(SAFE_RADIUS * 0.55)
    pin_cy = int(size * 0.46)  # чуть выше центра, т.к. капля вниз вытягивается

    # Pulse-кольца только на legacy (на adaptive forground выйдут за safe zone)
    if with_background:
        draw_pulse_rings(img, cx, pin_cy, pin_radius, accent, count=2)

    # Glow-aura под пином
    aura = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    adraw = ImageDraw.Draw(aura)
    aura_r = int(pin_radius * 1.6)
    adraw.ellipse(
        (cx - aura_r, pin_cy - aura_r, cx + aura_r, pin_cy + aura_r),
        fill=(*accent[:3], 80),
    )
    aura = aura.filter(ImageFilter.GaussianBlur(radius=int(SIZE * 0.04)))
    img.alpha_composite(aura)

    # Сам пин
    pin_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pin_draw = ImageDraw.Draw(pin_layer)
    draw_pin_shape(pin_draw, cx, pin_cy, pin_radius, accent)
    img.alpha_composite(pin_layer)

    # Внутренняя «дырка» пина (классический пин: голова с маленьким кружком в центре).
    # Для нас — буква G белым цветом, без дырки.
    letter_size = int(pin_radius * 1.3)
    letter_color = NAVY_BG_DEEP if app_kind == "child" else WHITE
    # Для лучшего читаемости child — белый G тоже (на emerald — белый contrast лучше).
    letter_color = WHITE
    draw_letter_g(img, cx, pin_cy, letter_color, font_size=letter_size)

    return img


def render_monochrome() -> Image.Image:
    """Themed-icon Android 13+: monochrome silhouette на прозрачном."""
    size = SIZE
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mono = (255, 255, 255, 255)  # будет затинчено системой
    cx = size // 2
    pin_radius = int(SAFE_RADIUS * 0.55)
    pin_cy = int(size * 0.46)

    pin_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pin_draw = ImageDraw.Draw(pin_layer)
    draw_pin_shape(pin_draw, cx, pin_cy, pin_radius, mono)
    img.alpha_composite(pin_layer)

    # «Дырка» с буквой G — вырезаем буквы из пина чтобы был контраст в моно-режиме
    cutout = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(cutout)
    font = find_font(int(pin_radius * 1.3))
    text = "G"
    bbox = cdraw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = cx - w / 2 - bbox[0]
    y = pin_cy - h / 2 - bbox[1]
    cdraw.text((x, y), text, font=font, fill=(0, 0, 0, 255))
    # Вычитаем cutout из img: где cutout не прозрачный — делаем img прозрачным
    img_alpha = img.split()[3]
    cut_alpha = cutout.split()[3]
    new_alpha = Image.eval(img_alpha, lambda a: a)  # копия
    px_img = new_alpha.load()
    px_cut = cut_alpha.load()
    for y2 in range(size):
        for x2 in range(size):
            if px_cut[x2, y2] > 128:
                px_img[x2, y2] = 0
    img.putalpha(new_alpha)
    return img


def main() -> None:
    apps = {
        "parent": SKY,
        "child": EMERALD,
    }
    for kind, accent in apps.items():
        out_dir = ROOT / "apps" / f"mobile-{kind}" / "assets" / "icon"
        out_dir.mkdir(parents=True, exist_ok=True)

        legacy = render_icon(accent, kind, with_background=True)
        legacy.save(out_dir / "icon.png", "PNG")
        print(f"[{kind}] icon.png ({(out_dir / 'icon.png').stat().st_size} B)")

        foreground = render_icon(accent, kind, with_background=False)
        foreground.save(out_dir / "icon_foreground.png", "PNG")
        print(f"[{kind}] icon_foreground.png ({(out_dir / 'icon_foreground.png').stat().st_size} B)")

        mono = render_monochrome()
        mono.save(out_dir / "icon_monochrome.png", "PNG")
        print(f"[{kind}] icon_monochrome.png ({(out_dir / 'icon_monochrome.png').stat().st_size} B)")


if __name__ == "__main__":
    main()
