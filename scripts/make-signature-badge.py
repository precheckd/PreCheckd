# One-off: draws public/email/verified-badge.png (the "Verified by PreCheckd"
# image used in email signatures). Re-run only if the badge design changes:
#   python3 scripts/make-signature-badge.py
from PIL import Image, ImageDraw, ImageFont
S = 4                      # draw at 4x, shrink for crisp edges
W, H = 224, 44             # shown size in an email
img = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([S, S, W * S - S, H * S - S], radius=(H * S) // 2 - S, fill=(31, 54, 60, 255), outline=(46, 204, 113, 255), width=2 * S)
logo = Image.open('public/email/logo-mark.png').convert('RGBA').resize((30 * S, 30 * S), Image.LANCZOS)
img.alpha_composite(logo, (9 * S, 7 * S))
font = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf', 13 * S)
x, y = 46 * S, 12 * S
d.text((x, y), 'Verified by ', font=font, fill=(242, 244, 243, 255))
x += d.textlength('Verified by ', font=font)
d.text((x, y), 'PreCheckd', font=font, fill=(74, 222, 128, 255))
img = img.resize((W * 2, H * 2), Image.LANCZOS)   # 2x for sharp screens; shown at W x H
img.save('public/email/verified-badge.png', optimize=True)
print('ok', img.size)
