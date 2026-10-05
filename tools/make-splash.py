# Renders build/splash.bmp: shown by the portable .exe while it unpacks the app (before the window opens).
# Run: python3 tools/make-splash.py   (needs Pillow and the Inter font)
from PIL import Image, ImageDraw, ImageFont
K = 4  # draw at 4x, then downsample for smooth edges
W, H = 360, 150
BG, LINE, FG, MUTED, ACCENT = '#141217', '#322d3a', '#ece9f1', '#9c95a8', '#ff4560'
F = '/usr/share/fonts/opentype/inter/Inter-'
img = Image.new('RGB', (W * K, H * K), BG)
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W * K - 1, H * K - 1], outline=LINE, width=K)
# the app's hexagon logo (32-unit viewBox), 40 px
s, ox, oy = 40 * K / 32, 32 * K, 34 * K
P = lambda x, y: (ox + x * s, oy + y * s)
d.polygon([P(16, 2), P(28.1, 9), P(28.1, 23), P(16, 30), P(3.9, 23), P(3.9, 9)], fill=ACCENT)
d.rectangle([*P(3.9, 14.8), *P(28.1, 17.2)], fill=BG)
d.ellipse([*P(11.4, 11.4), *P(20.6, 20.6)], fill=BG)
d.ellipse([*P(13.7, 13.7), *P(18.3, 18.3)], fill=ACCENT)
x, y = 84 * K, 36 * K
reg, bold = ImageFont.truetype(F + 'SemiBold.otf', 24 * K), ImageFont.truetype(F + 'ExtraBold.otf', 24 * K)
d.text((x, y), 'Radical', font=reg, fill=FG)
d.text((x + d.textlength('Radical', font=reg), y), 'Hex', font=bold, fill=FG)
d.text((x, y + 34 * K), 'Starting up…', font=ImageFont.truetype(F + 'Regular.otf', 13 * K), fill=MUTED)
d.rounded_rectangle([32 * K, 112 * K, (W - 32) * K, 115 * K], radius=2 * K, fill='#23202a')
d.rounded_rectangle([32 * K, 112 * K, 150 * K, 115 * K], radius=2 * K, fill=ACCENT)
img.resize((W, H), Image.LANCZOS).save('build/splash.bmp')
