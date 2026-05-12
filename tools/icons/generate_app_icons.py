"""GMD launcher-icon + RuStore featured-graphic generator.

Генерит источники иконок для flutter_launcher_icons:
  apps/mobile-{parent,child}/assets/icon/icon.png            (1024x1024 legacy, full bleed)
  apps/mobile-{parent,child}/assets/icon/icon_foreground.png (1024x1024 transparent BG, safe-zone aware)
  apps/mobile-{parent,child}/assets/icon/icon_monochrome.png (1024x1024 mono для themed icons Android 13+)

И featured-graphics для RuStore Console «Карточка приложения»:
  docs/rustore-assets/featured-parent.png  (1024x500)
  docs/rustore-assets/featured-child.png   (1024x500)

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


def _radial_background_landscape(w: int, h: int, center_color: tuple, edge_color: tuple) -> Image.Image:
    """Радиал-градиент для прямоугольного canvas. Центр в (w/2, h/2)."""
    img = Image.new("RGBA", (w, h), edge_color)
    cx = w / 2
    cy = h / 2
    max_r = math.sqrt(cx * cx + cy * cy)
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            r = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(r / max_r, 1.0)
            t = t * t  # ease-out
            pixel = tuple(int(center_color[i] * (1 - t) + edge_color[i] * t) for i in range(4))
            pixels[x, y] = pixel
    return img


def render_featured_graphic(accent: tuple, app_kind: str) -> Image.Image:
    """Featured-graphic 1024×500 для RuStore Console «Карточка приложения».

    Layout:
      - левый блок (~38% ширины): pin-иконка + glow-aura + pulse-кольца
      - правый блок (~62%): крупный title + subtitle + бейдж канала
    Безопасные зоны: RuStore Console накладывает на превью градиент-overlay
    снизу, поэтому subtitle держим выше нижней трети.
    """
    W, H = 1024, 500
    img = _radial_background_landscape(W, H, NAVY_BG, NAVY_BG_DEEP)

    # ── Левый блок: pin-иконка ───────────────────────────────────────────
    pin_cx = int(W * 0.20)
    pin_cy = int(H * 0.40)  # выше центра, чтобы хвост не наезжал на subtitle справа
    pin_radius = int(H * 0.18)

    # Pulse-кольца (2 — чтобы внешнее кольцо не пересекало текстовый блок)
    rings_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(rings_layer)
    for i in range(1, 3):
        r = pin_radius + int(pin_radius * 0.45 * i)
        alpha = max(20, 90 - i * 30)
        ring_color = (*accent[:3], alpha)
        thickness = max(4, int(H * 0.013))
        rdraw.ellipse(
            (pin_cx - r, pin_cy - r, pin_cx + r, pin_cy + r),
            outline=ring_color,
            width=thickness,
        )
    rings_layer = rings_layer.filter(ImageFilter.GaussianBlur(radius=3))
    img.alpha_composite(rings_layer)

    # Glow-aura
    aura = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    adraw = ImageDraw.Draw(aura)
    aura_r = int(pin_radius * 1.7)
    adraw.ellipse(
        (pin_cx - aura_r, pin_cy - aura_r, pin_cx + aura_r, pin_cy + aura_r),
        fill=(*accent[:3], 90),
    )
    aura = aura.filter(ImageFilter.GaussianBlur(radius=int(H * 0.05)))
    img.alpha_composite(aura)

    # Сам пин
    pin_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pin_draw = ImageDraw.Draw(pin_layer)
    draw_pin_shape(pin_draw, pin_cx, pin_cy, pin_radius, accent)
    img.alpha_composite(pin_layer)

    # Буква G в центре пина
    letter_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(letter_layer)
    letter_font = find_font(int(pin_radius * 1.35))
    bbox = ldraw.textbbox((0, 0), "G", font=letter_font)
    lw = bbox[2] - bbox[0]
    lh = bbox[3] - bbox[1]
    ldraw.text(
        (pin_cx - lw / 2 - bbox[0], pin_cy - lh / 2 - bbox[1]),
        "G",
        font=letter_font,
        fill=WHITE,
    )
    img.alpha_composite(letter_layer)

    # ── Правый блок: title + subtitle + бейдж ────────────────────────────
    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(text_layer)
    text_x = int(W * 0.46)

    if app_kind == "parent":
        title_lines = ["GMD", "Родительский", "контроль"]
        subtitle = "Геолокация ребёнка, геозоны, SOS"
        badge_text = "Родителю"
    else:
        title_lines = ["GMD", "для ребёнка"]
        subtitle = "Под защитой родителей"
        badge_text = "Ребёнку"

    title_font = find_font(int(H * 0.16))
    subtitle_font = find_font(int(H * 0.058))
    badge_font = find_font(int(H * 0.05))

    # Title: несколько строк, межстрочный интервал ~0.85 от font_size
    title_size = title_font.size
    line_gap = int(title_size * 0.88)
    title_y_start = int(H * 0.18)
    for i, line in enumerate(title_lines):
        tdraw.text(
            (text_x, title_y_start + i * line_gap),
            line,
            font=title_font,
            fill=WHITE,
        )

    # Subtitle — прижат к нижней зоне (выше нижнего overlay Console),
    # независимо от количества title-строк — иначе у child (2 строки) subtitle
    # упирался в хвост пина. Светло-серый slate-300 на radial-фоне читается лучше
    # чем SLATE.
    sub_bbox = tdraw.textbbox((0, 0), subtitle, font=subtitle_font)
    sub_h = sub_bbox[3] - sub_bbox[1]
    sub_y = H - sub_h - int(H * 0.13)
    subtitle_color = (203, 213, 225, 255)  # slate-300
    tdraw.text((text_x, sub_y), subtitle, font=subtitle_font, fill=subtitle_color)

    # Бейдж канала: rounded rect с accent-цветом и текстом
    badge_bbox = tdraw.textbbox((0, 0), badge_text, font=badge_font)
    bw = badge_bbox[2] - badge_bbox[0]
    bh = badge_bbox[3] - badge_bbox[1]
    pad_x = int(H * 0.04)
    pad_y = int(H * 0.022)
    badge_x = text_x
    badge_y = int(H * 0.04)
    tdraw.rounded_rectangle(
        (
            badge_x,
            badge_y,
            badge_x + bw + pad_x * 2,
            badge_y + bh + pad_y * 2,
        ),
        radius=int(H * 0.04),
        fill=(*accent[:3], 235),
    )
    tdraw.text(
        (badge_x + pad_x - badge_bbox[0], badge_y + pad_y - badge_bbox[1]),
        badge_text,
        font=badge_font,
        fill=NAVY_BG_DEEP,
    )

    img.alpha_composite(text_layer)
    return img


def render_promo_screenshot(
    accent: tuple,
    title_lines: list[str],
    subtitle: str,
    pin_letter: str,
    pin_secondary: str | None = None,
) -> Image.Image:
    """Promo-карточка 1920×1080 16:9 для поля «Скриншоты» в RuStore Console.

    Это не настоящий UI-скриншот, а маркетинговая карточка в стиле featured-graphic:
    radial-фон + крупный pin-bubble слева + многострочный title + subtitle справа.
    Используется как baseline до момента когда будут реальные UI-скрины.

    pin_letter — основная буква в круге пина (например "G", "SOS", "📍").
    pin_secondary — опциональная подпись под пином (например "Где ребёнок").
    """
    W, H = 1920, 1080
    img = _radial_background_landscape(W, H, NAVY_BG, NAVY_BG_DEEP)

    pin_cx = int(W * 0.27)
    pin_cy = int(H * 0.46)
    pin_radius = int(H * 0.20)

    # Pulse-кольца (3 — больший canvas, можем себе позволить)
    rings_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(rings_layer)
    for i in range(1, 4):
        r = pin_radius + int(pin_radius * 0.42 * i)
        alpha = max(15, 100 - i * 28)
        ring_color = (*accent[:3], alpha)
        thickness = max(5, int(H * 0.008))
        rdraw.ellipse(
            (pin_cx - r, pin_cy - r, pin_cx + r, pin_cy + r),
            outline=ring_color,
            width=thickness,
        )
    rings_layer = rings_layer.filter(ImageFilter.GaussianBlur(radius=4))
    img.alpha_composite(rings_layer)

    # Glow-aura
    aura = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    adraw = ImageDraw.Draw(aura)
    aura_r = int(pin_radius * 1.7)
    adraw.ellipse(
        (pin_cx - aura_r, pin_cy - aura_r, pin_cx + aura_r, pin_cy + aura_r),
        fill=(*accent[:3], 90),
    )
    aura = aura.filter(ImageFilter.GaussianBlur(radius=int(H * 0.04)))
    img.alpha_composite(aura)

    # Сам пин (используем тот же draw_pin_shape если pin_letter='G', иначе круг)
    pin_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pin_draw = ImageDraw.Draw(pin_layer)
    if pin_letter == "G":
        draw_pin_shape(pin_draw, pin_cx, pin_cy, pin_radius, accent)
    else:
        # Круг для других slides (без хвоста пина — нейтрально под любой текст)
        pin_draw.ellipse(
            (pin_cx - pin_radius, pin_cy - pin_radius, pin_cx + pin_radius, pin_cy + pin_radius),
            fill=accent,
        )
    img.alpha_composite(pin_layer)

    # Pin-letter в центре
    letter_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(letter_layer)
    # Размер шрифта зависит от длины текста — для коротких ("G", "📍") крупно,
    # для длинных ("SOS") поменьше чтобы влез в круг
    if len(pin_letter) <= 1:
        letter_size = int(pin_radius * 1.35)
    elif len(pin_letter) == 2:
        letter_size = int(pin_radius * 0.95)
    elif len(pin_letter) == 3:
        letter_size = int(pin_radius * 0.78)
    else:
        letter_size = int(pin_radius * 0.55)
    letter_font = find_font(letter_size)
    bbox = ldraw.textbbox((0, 0), pin_letter, font=letter_font)
    lw = bbox[2] - bbox[0]
    lh = bbox[3] - bbox[1]
    ldraw.text(
        (pin_cx - lw / 2 - bbox[0], pin_cy - lh / 2 - bbox[1]),
        pin_letter,
        font=letter_font,
        fill=WHITE,
    )
    img.alpha_composite(letter_layer)

    if pin_secondary:
        sec_font = find_font(int(H * 0.035))
        sb = ldraw.textbbox((0, 0), pin_secondary, font=sec_font)
        sw = sb[2] - sb[0]
        sec_y = pin_cy + int(pin_radius * 2.1)
        sl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sl)
        sd.text(
            (pin_cx - sw / 2 - sb[0], sec_y),
            pin_secondary,
            font=sec_font,
            fill=(203, 213, 225, 255),
        )
        img.alpha_composite(sl)

    # ── Правый блок: title + subtitle ─────────────────────────────────────
    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(text_layer)
    text_x = int(W * 0.51)

    title_font = find_font(int(H * 0.11))
    subtitle_font = find_font(int(H * 0.042))

    line_gap = int(title_font.size * 1.05)
    title_y_start = int(H * 0.22)
    for i, line in enumerate(title_lines):
        tdraw.text((text_x, title_y_start + i * line_gap), line, font=title_font, fill=WHITE)

    sub_bbox = tdraw.textbbox((0, 0), subtitle, font=subtitle_font)
    sub_h = sub_bbox[3] - sub_bbox[1]
    sub_y = H - sub_h - int(H * 0.13)
    tdraw.text((text_x, sub_y), subtitle, font=subtitle_font, fill=(203, 213, 225, 255))

    img.alpha_composite(text_layer)
    return img


def render_favicon(accent: tuple, size: int = 1024, padding_ratio: float = 0.0) -> Image.Image:
    """Web favicon / app-icon (apps/web/app/icon.png, apple-icon.png, favicon.ico).

    Простой плотный силуэт — круг фирменного цвета + белая буква G в центре,
    тёмно-синий фон. БЕЗ pulse-rings и glow-aura у launcher-варианта — на 16×16
    (favicon в tab) они превращаются в шум. apple-icon iOS клипает в squircle,
    поэтому содержимое держим в центральных 80% canvas (padding_ratio=0.1).
    """
    img = radial_background(size, NAVY_BG, NAVY_BG_DEEP)

    cx = cy = size // 2
    inner = int(size * (1 - 2 * padding_ratio))
    circle_radius = int(inner * 0.40)  # 40% от inner ≈ 64% canvas

    # Едва-заметная подсветка под кругом — силуэт не плоский, но не «акцент».
    aura_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    adraw = ImageDraw.Draw(aura_layer)
    aura_r = int(circle_radius * 1.35)
    adraw.ellipse(
        (cx - aura_r, cy - aura_r, cx + aura_r, cy + aura_r),
        fill=(*accent[:3], 70),
    )
    aura_layer = aura_layer.filter(ImageFilter.GaussianBlur(radius=int(size * 0.035)))
    img.alpha_composite(aura_layer)

    # Основной круг
    circle_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(circle_layer)
    cdraw.ellipse(
        (cx - circle_radius, cy - circle_radius, cx + circle_radius, cy + circle_radius),
        fill=accent,
    )
    img.alpha_composite(circle_layer)

    letter_size = int(circle_radius * 1.45)
    draw_letter_g(img, cx, cy, WHITE, font_size=letter_size)

    return img


FAVICON_SVG_TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="GMD">
  <rect width="64" height="64" rx="10" fill="#0a1628"/>
  <circle cx="32" cy="32" r="22" fill="#38bdf8"/>
  <text x="32" y="33.5" font-family="'Segoe UI', system-ui, Arial, sans-serif" font-weight="700" font-size="30" fill="#ffffff" text-anchor="middle" dominant-baseline="central">G</text>
</svg>
"""


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

    # RuStore Console «Карточка приложения» (1024×500) — для каждого app.
    rustore_dir = ROOT / "docs" / "rustore-assets"
    rustore_dir.mkdir(parents=True, exist_ok=True)
    for kind, accent in apps.items():
        featured = render_featured_graphic(accent, kind)
        out_path = rustore_dir / f"featured-{kind}.png"
        featured.save(out_path, "PNG")
        print(f"[{kind}] featured-{kind}.png ({out_path.stat().st_size} B, 1024x500)")

    # RuStore Console «Иконка приложения» 512×512 (ресайз из 1024×1024 launcher-icon).
    for kind, accent in apps.items():
        src = ROOT / "apps" / f"mobile-{kind}" / "assets" / "icon" / "icon.png"
        icon_512 = Image.open(src).resize((512, 512), Image.LANCZOS)
        out_path = rustore_dir / f"icon-{kind}-512.png"
        icon_512.save(out_path, "PNG")
        print(f"[{kind}] icon-{kind}-512.png ({out_path.stat().st_size} B, 512x512)")

    # RuStore Console «Скриншоты для телефонов» 1920×1080 16:9 — promo-карточки
    # как baseline до момента когда будут реальные UI-скрины с устройства.
    # parent: 4 слайда; child: 3 слайда.
    promo_slides = {
        "parent": [
            (["Карта", "ребёнка"], "В реальном времени и история 30 дней", "G", None),
            (["Геозоны"], "Push на вход и выход из ваших зон", "ZON", None),
            (["Расписание"], "Автоблокировка приложений по часам", "24/7", None),
            (["SOS и звук"], "Тревога и звук окружения по запросу", "SOS", None),
        ],
        "child": [
            (["Сканер", "QR"], "По одному QR-коду от родителя", "QR", None),
            (["Кнопка", "SOS"], "Координаты родителю одним кликом", "SOS", None),
            (["Защита", "приложения"], "Не удалить без согласия родителя", "LOCK", None),
        ],
    }
    for kind, accent in apps.items():
        for i, (title_lines, subtitle, pin_letter, pin_sec) in enumerate(promo_slides[kind], start=1):
            shot = render_promo_screenshot(accent, title_lines, subtitle, pin_letter, pin_sec)
            out_path = rustore_dir / f"screenshot-{kind}-{i:02d}.png"
            shot.save(out_path, "PNG")
            print(f"[{kind}] screenshot-{kind}-{i:02d}.png ({out_path.stat().st_size} B, 1920x1080)")

    # Web (Next.js 15 App Router convention-based metadata).
    # https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
    # apps/web/app/{favicon.ico, icon.png, apple-icon.png, icon.svg} —
    # Next.js сам инжектит <link rel="icon"> и <link rel="apple-touch-icon">.
    web_app_dir = ROOT / "apps" / "web" / "app"
    web_app_dir.mkdir(parents=True, exist_ok=True)
    # Используем sky-400 (parent-палитра) — это и кабинет, и landing.
    master = render_favicon(SKY, size=1024, padding_ratio=0.0)

    # icon.png — 512×512, Next.js нарежет до 32×32 / 192×192 для разных rel.
    icon_png = master.resize((512, 512), Image.LANCZOS)
    icon_path = web_app_dir / "icon.png"
    icon_png.save(icon_path, "PNG")
    print(f"[web] icon.png ({icon_path.stat().st_size} B, 512x512)")

    # apple-icon.png — 180×180 с padding'ом для iOS rounded mask.
    apple_master = render_favicon(SKY, size=1024, padding_ratio=0.10)
    apple = apple_master.resize((180, 180), Image.LANCZOS)
    apple_path = web_app_dir / "apple-icon.png"
    apple.save(apple_path, "PNG")
    print(f"[web] apple-icon.png ({apple_path.stat().st_size} B, 180x180)")

    # favicon.ico — multi-resolution (16/32/48), Pillow сам собирает ICO.
    ico_sources = [master.resize((s, s), Image.LANCZOS) for s in (48, 32, 16)]
    ico_path = web_app_dir / "favicon.ico"
    ico_sources[0].save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"[web] favicon.ico ({ico_path.stat().st_size} B, 16/32/48)")

    # icon.svg — vector fallback (резкий на любом DPI).
    svg_path = web_app_dir / "icon.svg"
    svg_path.write_text(FAVICON_SVG_TEMPLATE, encoding="utf-8")
    print(f"[web] icon.svg ({svg_path.stat().st_size} B)")


if __name__ == "__main__":
    main()
