/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
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
        brand: {
          DEFAULT: "#17402A",
          dark: "#1B4D2E",
        },
        orange: {
          DEFAULT: "#F26A1B",
          text: "#8A3D08",
          "text-alt": "#B8460A",
          tint: "#FDF1E8",
          "tint-alt": "#FDEBDF",
        },
        ink: "#16201A",
        subtle: "#9CA3A0",
        "green-tint": "#E3EFE7",
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
        // highlighting, background, borders). Mapped to the brand palette.
        sidebar: {
          DEFAULT: "#ffffff",
          foreground: "#16201A",
          border: "#E2E6E2",
          accent: "#E3EFE7",
          "accent-foreground": "#1B4D2E",
          ring: "#17402A",
          primary: "#17402A",
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
