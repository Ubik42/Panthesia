"""Replace hard-coded CSS colors with palette tokens (src/tokens.css).

The palette is fitted to the colors in use: weighted k-means in OKLab, with pure white and
black fixed. Each token is named by hue family and OKLCH lightness (`--blue-62`), so a later
redesign changes token values instead of hunting literals. A color with alpha becomes
`color-mix(in oklab, var(--token) N%, transparent)`.

Usage: python scripts/tokenize-colors.py [--k N] [--write]
"""
import math
import os
import random
import re
import statistics
import sys

sys.stdout.reconfigure(encoding="utf-8")
SRC = os.path.join(os.path.dirname(__file__), "..", "src")
WRITE = "--write" in sys.argv
K = int(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 72
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|(?<![\w-])white(?![\w-])")
HUES = [(40, "red"), (70, "orange"), (100, "amber"), (125, "lime"), (160, "green"), (195, "teal"),
        (235, "cyan"), (265, "blue"), (285, "indigo"), (320, "violet"), (360, "pink")]


def parse(text):
    t = text.lower()
    if t == "white":
        return 1.0, 1.0, 1.0, 1.0
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        return r, g, b, int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    nums = re.findall(r"-?[\d.]+%?", t)
    if len(nums) < 3:
        return None
    rgb = [float(n[:-1]) * 2.55 if n.endswith("%") else float(n) for n in nums[:3]]
    a = 1.0
    if len(nums) > 3:
        a = float(nums[3][:-1]) / 100 if nums[3].endswith("%") else float(nums[3])
    return rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, a


def oklab(r, g, b):
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(r), lin(g), lin(b)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (math.copysign(abs(x) ** (1 / 3), x) for x in (l, m, s))
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def files():
    for d, _, names in os.walk(SRC):
        for f in names:
            if f.endswith(".css") and f != "tokens.css":
                yield os.path.join(d, f)


def kmeans(points, weights, k, fixed):
    rng = random.Random(7)
    centers = list(fixed)
    while len(centers) < k:  # k-means++ seeding, weighted
        d2 = [w * min(math.dist(p, c) ** 2 for c in centers) for p, w in zip(points, weights)]
        x = rng.random() * sum(d2)
        for p, d in zip(points, d2):
            x -= d
            if x <= 0:
                centers.append(p)
                break
    for _ in range(60):
        groups = [[] for _ in centers]
        for p, w in zip(points, weights):
            groups[min(range(len(centers)), key=lambda i: math.dist(p, centers[i]))].append((p, w))
        moved = False
        for i, g in enumerate(groups):
            if i < len(fixed) or not g:
                continue
            total = sum(w for _, w in g)
            c = tuple(sum(p[j] * w for p, w in g) / total for j in range(3))
            moved |= math.dist(c, centers[i]) > 1e-6
            centers[i] = c
        if not moved:
            break
    return centers


def name_of(center, taken):
    L, a, b = center
    C, H = math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360
    family = "gray" if C < 0.025 else next(n for limit, n in HUES if H < limit)
    base = f"{family}-{round(L * 100)}"
    name = base if base not in taken else f"{base}-c{round(C * 100)}"
    while name in taken:
        name += "x"
    taken.add(name)
    return name, (L, C, H)


def main():
    occurrences = []
    for path in files():
        for m in COLOR.finditer(open(path, encoding="utf-8").read()):
            parsed = parse(m.group(0))
            if parsed:
                occurrences.append(oklab(*parsed[:3]))
    unique = {}
    for p in occurrences:
        unique[p] = unique.get(p, 0) + 1
    # Square-root weights: frequent neutrals must not crowd out rare but prominent accents.
    points, weights = list(unique), [math.sqrt(n) for n in unique.values()]
    centers = kmeans(points, weights, K, [oklab(1, 1, 1), oklab(0, 0, 0)])
    errors = sorted(min(math.dist(p, c) for c in centers) for p in occurrences)
    print(f"k={K}：颜色 {len(occurrences)}，平均 ΔE {statistics.mean(errors) * 100:.2f}，"
          f"p90 {errors[int(len(errors) * .9)] * 100:.2f}，p99 {errors[int(len(errors) * .99)] * 100:.2f}，最大 {errors[-1] * 100:.2f}")
    taken, named = set(), []
    for c in centers:
        named.append((*name_of(c, taken), c))
    if not WRITE:
        return
    for path in files():
        text = open(path, encoding="utf-8").read()

        def replace(m):
            parsed = parse(m.group(0))
            if not parsed:
                return m.group(0)
            p = oklab(*parsed[:3])
            name = min(named, key=lambda n: math.dist(p, n[2]))[0]
            a = parsed[3]
            if a >= 0.999:
                return f"var(--{name})"
            if a <= 0.001:
                return "transparent"
            return f"color-mix(in oklab, var(--{name}) {round(a * 100)}%, transparent)"

        new = COLOR.sub(replace, text)
        if new != text:
            open(path, "w", encoding="utf-8", newline="\n").write(new)
    order = [n for _, n in HUES]
    named.sort(key=lambda n: (n[0].startswith("gray") is False, order.index(n[0].split("-")[0]) if not n[0].startswith("gray") else 0, n[1][0]))
    lines = ["/* Palette tokens, fitted to the colors the interface used (scripts/tokenize-colors.py).",
             "   Styles use only these variables and the theme variables defined from them. */", ":root {"]
    for name, (L, C, H), _ in named:
        lines.append(f"  --{name}: oklch({L * 100:.1f}% {C:.3f} {H:.0f});")
    lines.append("}")
    open(os.path.join(SRC, "tokens.css"), "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")


main()
