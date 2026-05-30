#!/usr/bin/env python3
"""
Generate all icon sizes for Airone IDE from the source logo.
The source logo is a transparent PNG (no white background).
All generated icons maintain transparency where appropriate.
"""
import os
import sys
from PIL import Image

# Source logo
SOURCE = "/home/z/my-project/upload/ei_1779786546294-removebg-preview.png"
PROJECT = "/home/z/airone-ide"

def load_source():
    """Load the source logo and ensure it has alpha channel."""
    img = Image.open(SOURCE).convert("RGBA")
    print(f"Source: {img.size[0]}x{img.size[1]} {img.mode}")
    return img

def resize_to_square(img, size, bg_color=None):
    """Resize image to fit in a square of given size, maintaining aspect ratio.
    If bg_color is None, keeps transparency. Otherwise composites on background."""
    padding = int(size * 0.08)  # 8% padding
    inner_size = size - (padding * 2)
    
    scale = min(inner_size / img.size[0], inner_size / img.size[1])
    new_w = int(img.size[0] * scale)
    new_h = int(img.size[1] * scale)
    
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    
    if bg_color is not None:
        canvas = Image.new("RGBA", (size, size), bg_color)
        offset_x = (size - new_w) // 2
        offset_y = (size - new_h) // 2
        canvas.paste(resized, (offset_x, offset_y), resized)
        return canvas
    else:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset_x = (size - new_w) // 2
        offset_y = (size - new_h) // 2
        canvas.paste(resized, (offset_x, offset_y), resized)
        return canvas

def generate_icon(img, size, path, bg_color=None):
    """Generate a single icon at the given size and save it."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    icon = resize_to_square(img, size, bg_color)
    
    if path.endswith('.bmp'):
        if bg_color is None:
            bg_color = (30, 30, 46)  # #1e1e2e
        icon_rgb = Image.new("RGB", icon.size, bg_color)
        icon_rgb.paste(icon, mask=icon.split()[3])
        icon_rgb.save(path, "BMP")
    else:
        icon.save(path, "PNG")
    
    print(f"  {os.path.relpath(path, PROJECT)} ({size}x{size})")

def main():
    img = load_source()
    
    DARK_BG = (30, 30, 46, 255)  # #1e1e2e
    
    # 1. Theia Product Extension icons
    print("\n=== Theia Product Extension ===")
    d = f"{PROJECT}/theia-extensions/product/src/browser/icons"
    generate_icon(img, 512, f"{d}/512-512.png")
    generate_icon(img, 512, f"{d}/512-512-next.png")
    
    # 2. Electron Window Icons
    print("\n=== Electron Window Icons ===")
    d = f"{PROJECT}/applications/electron/resources/icons/WindowIcon"
    for s in [16, 24, 32, 48, 64, 96, 128, 256, 512]:
        generate_icon(img, s, f"{d}/{s}x{s}.png")
        generate_icon(img, s, f"{d}/{s}-{s}.png")
    
    # 3. Top-level icons directory
    print("\n=== Top-Level Icons ===")
    d = f"{PROJECT}/applications/electron/resources/icons"
    for s in [16, 24, 32, 48, 64, 96, 128, 256, 512]:
        generate_icon(img, s, f"{d}/{s}x{s}.png")
        generate_icon(img, s, f"{d}/{s}-{s}.png")
    
    # 4. Linux Launcher Icons
    print("\n=== Linux Launcher Icons ===")
    d = f"{PROJECT}/applications/electron/resources/icons/LinuxLauncherIcons"
    for s in [16, 24, 32, 48, 64, 96, 128, 256, 512]:
        generate_icon(img, s, f"{d}/airone-ide-{s}x{s}.png")
        generate_icon(img, s, f"{d}/{s}x{s}.png")
        for subdir in [f"{s}x{s}", f"{s}x{s}/apps"]:
            generate_icon(img, s, f"{d}/{subdir}/airone-ide.png")
            generate_icon(img, s, f"{d}/{subdir}/icon.png")
    
    # 5. Windows Launcher Icons
    print("\n=== Windows Launcher Icons ===")
    d = f"{PROJECT}/applications/electron/resources/icons/WindowsLauncherIcons"
    for s in [16, 24, 32, 48, 64, 96, 128, 256, 512]:
        generate_icon(img, s, f"{d}/{s}x{s}.png")
        generate_icon(img, s, f"{d}/{s}-{s}.png")
        generate_icon(img, s, f"{d}/icon_{s}x{s}.png")
    
    # 6. macOS Launcher Icons
    print("\n=== macOS Launcher Icons ===")
    d = f"{PROJECT}/applications/electron/resources/icons/MacLauncherIcons"
    for s in [16, 32, 48, 64, 96, 128, 256, 512]:
        generate_icon(img, s, f"{d}/icon_{s}x{s}.png")
    for s in [16, 32, 64, 128, 256, 512]:
        generate_icon(img, s * 2, f"{d}/icon_{s}x{s}@2x.png")
    # Airone iconset
    for s in [16, 32, 64, 128, 256, 512]:
        generate_icon(img, s, f"{d}/airone-ide.iconset/icon_{s}x{s}.png")
        generate_icon(img, s * 2, f"{d}/airone-ide.iconset/icon_{s}x{s}@2x.png")
    # Standard iconset
    for s in [16, 32, 64, 128, 256, 512]:
        generate_icon(img, s, f"{d}/icon.icon/icon.iconset/icon_{s}x{s}.png")
        generate_icon(img, s * 2, f"{d}/icon.icon/icon.iconset/icon_{s}x{s}@2x.png")
    generate_icon(img, 512, f"{d}/icon.png")
    generate_icon(img, 512, f"{d}/512-512-2.png")
    
    # 7. NSIS Installer Images
    print("\n=== NSIS Installer Images ===")
    nsis_dir = f"{PROJECT}/applications/electron/resources/icons"
    
    # Header banner: 150x57
    header = Image.new("RGBA", (150, 57), DARK_BG)
    logo_sm = resize_to_square(img, 45)
    header.paste(logo_sm, (5, 6), logo_sm)
    header_rgb = Image.new("RGB", header.size, (30, 30, 46))
    header_rgb.paste(header, mask=header.split()[3])
    header_rgb.save(f"{nsis_dir}/installer-header-banner.bmp", "BMP")
    print(f"  installer-header-banner.bmp (150x57)")
    header_rgb.save(f"{nsis_dir}/installer-header.bmp", "BMP")
    print(f"  installer-header.bmp (150x57)")
    
    # Sidebar: 164x314
    sidebar = Image.new("RGBA", (164, 314), DARK_BG)
    logo_side = resize_to_square(img, 120)
    sidebar.paste(logo_side, (22, 80), logo_side)
    sidebar_rgb = Image.new("RGB", sidebar.size, (30, 30, 46))
    sidebar_rgb.paste(sidebar, mask=sidebar.split()[3])
    os.makedirs(f"{nsis_dir}/InstallerSidebarImage", exist_ok=True)
    sidebar_rgb.save(f"{nsis_dir}/InstallerSidebarImage/164-314Windows.bmp", "BMP")
    print(f"  InstallerSidebarImage/164-314Windows.bmp (164x314)")
    sidebar_rgb.save(f"{nsis_dir}/InstallerSidebarImage/164-314IOS.bmp", "BMP")
    print(f"  InstallerSidebarImage/164-314IOS.bmp (164x314)")
    
    # 8. Electron top-level resources
    print("\n=== Electron Resources ===")
    generate_icon(img, 512, f"{PROJECT}/applications/electron/resources/airone.png")
    
    # 9. Windows ICO
    print("\n=== Windows ICO ===")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [resize_to_square(img, s, bg_color=DARK_BG) for s in ico_sizes]
    ico_path = f"{PROJECT}/applications/electron/resources/icons/airone-icon.ico"
    ico_images[0].save(ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_images[1:])
    print(f"  airone-icon.ico (sizes: {ico_sizes})")
    ico_images[0].save(f"{PROJECT}/applications/electron/resources/icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_images[1:])
    print(f"  icon.ico (top-level)")
    
    # 10. Android Launcher Icons
    print("\n=== Android Launcher Icons ===")
    res = f"{PROJECT}/applications/browser/android/app/src/main/res"
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, s in densities.items():
        generate_icon(img, s, f"{res}/mipmap-{density}/ic_launcher.png", bg_color=DARK_BG)
        generate_icon(img, s, f"{res}/mipmap-{density}/ic_launcher_round.png", bg_color=DARK_BG)
        generate_icon(img, s, f"{res}/mipmap-{density}/ic_launcher_foreground.png")
    
    # 11. Android Splash Screens
    print("\n=== Android Splash Screens ===")
    splash_sizes = {
        "port-mdpi": (240, 320), "port-hdpi": (360, 480),
        "port-xhdpi": (480, 640), "port-xxhdpi": (720, 960), "port-xxxhdpi": (960, 1280),
        "land-mdpi": (320, 240), "land-hdpi": (480, 360),
        "land-xhdpi": (640, 480), "land-xxhdpi": (960, 720), "land-xxxhdpi": (1280, 960),
    }
    for name, (w, h) in splash_sizes.items():
        orient = "port" if name.startswith("port") else "land"
        density = name.split("-")[1]
        splash = Image.new("RGBA", (w, h), DARK_BG)
        logo_size = min(w, h) // 3
        logo_splash = resize_to_square(img, logo_size)
        splash.paste(logo_splash, ((w - logo_size) // 2, (h - logo_size) // 2), logo_splash)
        splash_rgb = Image.new("RGB", splash.size, (30, 30, 46))
        splash_rgb.paste(splash, mask=splash.split()[3])
        splash_dir = f"{res}/drawable-{orient}-{density}"
        os.makedirs(splash_dir, exist_ok=True)
        splash_rgb.save(f"{splash_dir}/splash.png", "PNG")
        print(f"  drawable-{orient}-{density}/splash.png ({w}x{h})")
    
    # Default splash
    splash = Image.new("RGBA", (480, 640), DARK_BG)
    logo_splash = resize_to_square(img, 160)
    splash.paste(logo_splash, (160, 240), logo_splash)
    splash_rgb = Image.new("RGB", splash.size, (30, 30, 46))
    splash_rgb.paste(splash, mask=splash.split()[3])
    splash_rgb.save(f"{res}/drawable/splash.png", "PNG")
    print(f"  drawable/splash.png (480x640)")
    
    print("\n✅ All icons generated!")

if __name__ == "__main__":
    main()
