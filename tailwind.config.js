/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // The white and light-grey backgrounds and borders follow the person's page palette (src/theme). Only background
      // and border colours are mapped, so text-white on buttons stays white.
      backgroundColor: {
        white: "rgb(var(--surface) / <alpha-value>)",
        gray: {
          50: "rgb(var(--surface-sunken) / <alpha-value>)",
          100: "rgb(var(--surface-muted) / <alpha-value>)",
          200: "rgb(var(--surface-strong) / <alpha-value>)",
          300: "rgb(var(--surface-stronger) / <alpha-value>)",
        },
        page: "rgb(var(--page) / <alpha-value>)",
      },
      borderColor: {
        DEFAULT: "rgb(var(--line) / <alpha-value>)",
        gray: {
          100: "rgb(var(--line-soft) / <alpha-value>)",
          200: "rgb(var(--line) / <alpha-value>)",
          300: "rgb(var(--line-strong) / <alpha-value>)",
        },
      },
      // the text greys turn light on a dark page colour (src/theme/themes.ts derivePageVars)
      textColor: {
        gray: {
          300: "rgb(var(--text-300) / <alpha-value>)",
          400: "rgb(var(--text-400) / <alpha-value>)",
          500: "rgb(var(--text-500) / <alpha-value>)",
          600: "rgb(var(--text-600) / <alpha-value>)",
          700: "rgb(var(--text-700) / <alpha-value>)",
          800: "rgb(var(--text-800) / <alpha-value>)",
          900: "rgb(var(--text-900) / <alpha-value>)",
        },
        black: "rgb(var(--text-black) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        subtle: "rgb(var(--subtle) / <alpha-value>)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Figbloom redesign tokens (see FIG-527) — flat palette used directly
        // as Tailwind utilities (bg-brand, text-subtle, etc.) alongside the
        // shadcn hsl() tokens above.
        // The theme colors are variables (see src/theme): each person can choose their own palette. The values
        // here are space-separated RGB triplets so opacity utilities (bg-brand/10) keep working.
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          dark: "rgb(var(--brand-dark) / <alpha-value>)",
        },
        // the app-shell sidebar: its background, the text on it, and the highlighted (active) item
        shell: {
          DEFAULT: "rgb(var(--shell) / <alpha-value>)",
          fg: "rgb(var(--shell-fg) / <alpha-value>)",
          active: "rgb(var(--shell-active) / <alpha-value>)",
          "active-fg": "rgb(var(--shell-active-fg) / <alpha-value>)",
        },
        orange: {
          DEFAULT: "rgb(var(--highlight) / <alpha-value>)",
          text: "#8A3D08",
          "text-alt": "#B8460A",
          tint: "#FDF1E8",
          "tint-alt": "#FDEBDF",
        },
        ink: "#16201A",
        subtle: "#9CA3A0",
        "green-tint": "rgb(var(--tint) / <alpha-value>)",
        status: {
          success: "#2E7D4F",
          danger: "#C0392B",
          info: "#1F4E79",
          "info-tint": "#E9F0F6",
          purple: "#7A5AF8",
          "purple-tint": "#F3EEFB",
        },
        // shadcn's sidebar block (used by the Teams chat channel/DM sidebar,
        // see src/components/chat/ui/sidebar.tsx) references bg-sidebar,
        // bg-sidebar-accent etc. — these were previously undefined, so every
        // sidebar-* utility silently generated no CSS at all (active channel
        // highlighting, background, borders). Mapped to the brand palette, and to the page palette for its
        // background, text and borders so it follows a dark page colour like every other white area.
        sidebar: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--ink) / <alpha-value>)",
          border: "rgb(var(--line) / <alpha-value>)",
          // the selected/hovered item: a see-through wash of the theme colour, so the page's own text colour
          // (dark on light pages, light on dark ones) stays readable on it
          accent: "rgb(var(--brand) / 0.16)",
          "accent-foreground": "rgb(var(--ink) / <alpha-value>)",
          ring: "rgb(var(--brand) / <alpha-value>)",
          primary: "rgb(var(--brand) / <alpha-value>)",
          "primary-foreground": "#ffffff",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "14px",
        tile: "12px",
        pill: "9999px",
      },
      fontFamily: {
        sans: ["Figtree", "-apple-system", "BlinkMacSystemFont", "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        "san-pro": ["Figtree", "-apple-system", "BlinkMacSystemFont", "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        poppins: ["Poppins", "sans-serif"],
        lexend: ["Lexend", "sans-serif"],
      },
    }
  },
  plugins: [],
};
