---
name: Warm Academic Studio
colors:
  surface: '#fff8f4'
  surface-dim: '#e6d7cc'
  surface-bright: '#fff8f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1e7'
  surface-container: '#faebe0'
  surface-container-high: '#f4e6da'
  surface-container-highest: '#efe0d5'
  on-surface: '#211a14'
  on-surface-variant: '#534436'
  inverse-surface: '#372f27'
  inverse-on-surface: '#fdeee3'
  outline: '#857464'
  outline-variant: '#d8c3b1'
  surface-tint: '#895100'
  primary: '#895100'
  on-primary: '#ffffff'
  primary-container: '#d98b2c'
  on-primary-container: '#4e2c00'
  inverse-primary: '#ffb86d'
  secondary: '#5f5e60'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfe1'
  on-secondary-container: '#636264'
  tertiary: '#006685'
  on-tertiary: '#ffffff'
  tertiary-container: '#26a8d6'
  on-tertiary-container: '#00394b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcbd'
  primary-fixed-dim: '#ffb86d'
  on-primary-fixed: '#2c1600'
  on-primary-fixed-variant: '#683c00'
  secondary-fixed: '#e4e2e4'
  secondary-fixed-dim: '#c8c6c8'
  on-secondary-fixed: '#1b1b1d'
  on-secondary-fixed-variant: '#474649'
  tertiary-fixed: '#bfe9ff'
  tertiary-fixed-dim: '#6dd2ff'
  on-tertiary-fixed: '#001f2a'
  on-tertiary-fixed-variant: '#004d65'
  background: '#fff8f4'
  on-background: '#211a14'
  surface-variant: '#efe0d5'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
  paper-preview-body:
    fontFamily: Libre Caslon Text
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  ui-label-bold:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  ui-label-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  headline-sm-mobile:
    fontFamily: Newsreader
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.2'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 1px
  margin-page: 32px
  panel-padding: 16px
  density-dense: 8px
  density-comfy: 24px
---

## Brand & Style

This design system establishes a high-performance environment for editorial oversight, blending the focused atmosphere of a traditional studio with the surgical precision of modern technical tools. The aesthetic is "Warm Academic," prioritizing a tactile, paper-like experience that reduces eye strain during long-form composition and data-heavy analysis.

The UI avoids the sterility of pure white digital interfaces by utilizing an ivory-based foundation, evoking the quality of archival-grade paper. The visual language balances editorial heritage with functional utility, utilizing a mix of high-contrast serif typography for narrative structure and technical monospaced elements for metadata and system controls. The emotional response is one of calm authority, intellectual rigor, and organized complexity.

## Colors

The palette is anchored by a warm paper base (`#F9F8F6`), which serves as the primary canvas for all lower-level surfaces. Interaction layers and primary content containers use a pure white surface (`#FFFFFF`) to create subtle, natural depth without relying on heavy shadows.

- **Primary (Amber):** Used sparingly for critical calls to action, active states, and high-priority status indicators. It provides a warm, high-contrast focal point against the muted background.
- **Ink (Deep Charcoal):** Primary text and structural lines use this near-black value to maintain maximum legibility while appearing softer than true black.
- **Paper Edge (Borders):** A specific neutral beige-grey used for the dense grid lines and component boundaries, mimicking the subtle shadow of stacked paper.

## Typography

The typography system is a curated hierarchy of three distinct voices:

1.  **The Editorial Voice (Newsreader):** Used for headlines and section titles. It carries an authoritative, literary weight.
2.  **The Narrative Voice (Libre Caslon Text/Baskerville):** Reserved for the "Paper Preview" areas. It mimics the experience of reading a physical book or journal.
3.  **The Utility Voice (Geist/JetBrains Mono):** Used for all UI controls, sidebars, and data density. Geist provides a clean, modern grotesque feel for labels, while JetBrains Mono is used for timestamps, word counts, and system metadata to emphasize technical precision.

All UI labels should be rendered in Geist with slightly increased letter-spacing when using uppercase to ensure clarity at small sizes.

## Layout & Spacing

The layout utilizes a **Fixed Grid** system inspired by modular swiss design. The interface is divided into functional "panes" separated by 1px "ink-line" borders. 

- **Density:** The Command Center is a high-density environment. Use 8px (2 units) as the standard spacing between related UI elements.
- **Panels:** Major functional areas (Navigator, Editor, Inspector) are pinned to the viewport edges.
- **The Paper Surface:** The central editor mimics a physical sheet of paper with generous 64px vertical margins and a max-width of 720px for optimal reading line lengths.
- **Grid:** All components should snap to a 4px baseline grid to maintain surgical alignment across complex horizontal layouts.

## Elevation & Depth

This system eschews traditional shadows in favor of **Tonal Layering** and **Low-Contrast Outlines**.

- **Level 0 (Background):** `#F9F8F6` is the base for the application shell.
- **Level 1 (Panels):** Raised elements and primary workspace areas use `#FFFFFF` with a 1px border of `#E5E2DA`.
- **Active State:** Selected items or focused inputs do not "glow." Instead, they use a 2px interior border of `#D98B2C` or a subtle background shift to `#F2F0E9`.
- **Floating Elements:** Modals or context menus use a very soft, diffused shadow (`0 8px 24px rgba(26, 26, 28, 0.08)`) combined with a solid border to maintain the paper-like aesthetic.

## Shapes

To maintain a professional, academic feel, shapes are predominantly rectangular with very subtle softening.

- **Primary UI (Buttons, Inputs):** 4px (Soft) corner radius. This provides just enough softness to feel modern without losing the "grid-aligned" precision.
- **Paper Sheets/Cards:** 2px radius for a sharp, cut-paper appearance.
- **Status Pills:** Fully rounded (pill) only for status indicators to differentiate them from interactive buttons.
- **Selection Brackets:** Use sharp corners for selection highlights in the editor to mimic manual proofreading marks.

## Components

- **Buttons:** Primary buttons use `#1A1A1C` background with `#F9F8F6` text. Secondary buttons are outlined in `#E5E2DA` with a hover state that fills to `#F2F0E9`.
- **Input Fields:** Minimalist design—only a bottom border of `#E5E2DA` in a default state, moving to a full `#1A1A1C` border on focus. Labels always use `ui-label-bold`.
- **Metadata Chips:** Small, rectangular tags using `#F2F0E9` backgrounds and `mono-data` typography.
- **Lists:** Dense vertical stacks with 1px dividers. Hover states should use a subtle `#F9F8F6` tint.
- **Editorial Brackets:** Custom component for the paper preview; vertical lines in the margin (Amber `#D98B2C`) to indicate tracked changes or comments.
- **The "Command" Bar:** A fixed-position global search/command input at the top, using a floating surface with a crisp 1px border and the Amber accent for the cursor.