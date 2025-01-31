#!/bin/bash

# Convert SVG to PNG at different sizes
convert -background none -size 16x16 public/favicon.svg public/favicon-16x16.png
convert -background none -size 32x32 public/favicon.svg public/favicon-32x32.png
convert -background none -size 180x180 public/favicon.svg public/apple-touch-icon.png
convert -background none -size 192x192 public/favicon.svg public/android-chrome-192x192.png
convert -background none -size 512x512 public/favicon.svg public/android-chrome-512x512.png

# Create ICO file (contains multiple sizes)
convert public/favicon-16x16.png public/favicon-32x32.png public/favicon.ico

# Create Safari pinned tab icon (should be single color)
convert -background none -size 512x512 public/favicon.svg -colorspace gray public/safari-pinned-tab.svg 