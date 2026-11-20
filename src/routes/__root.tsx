import { brandText } from "@/lib/brand";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  useRouterState,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { handleStaleChunkError } from "@/lib/reload-stale-chunk";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    if (handleStaleChunkError(error)) return;
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },

      // ── Primary SEO ──────────────────────────────────────────────────────
      { title: brandText("{{brand}} — AI-Native Financial Audit & Compliance for PSX, NSE Traders") },
      {
        name: "description",
        content:
          brandText("{{brand}} is an AI-powered trade reconciliation and CGT tax engine for PSX (Pakistan) and NSE (India) traders. Upload broker slips, get a FIFO-accurate, audit-ready ledger in minutes. Free for 50 transactions/month."),
      },
      { name: "author", content: brandText("{{brand}}") },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { name: "keywords", content: "PSXL, financial operations, trade reconciliation, broker statement parser, PSX, NSE, FIFO capital gains tax, audit trail, portfolio ledger" },
      {
        name: "googlebot",
        content: "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1",
      },
      { name: "theme-color", content: "#0B0C0E" },
      { name: "rating", content: "general" },

      // ── Open Graph ───────────────────────────────────────────────────────
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: brandText("{{brand}}") },
      {
        property: "og:title",
        content: brandText("{{brand}} — AI-Native Trade Reconciliation & CGT Engine for PSX & NSE"),
      },
      {
        property: "og:description",
        content:
          brandText("Replace hours of manual ledger work with {{brand}}. Upload any PSX or NSE broker slip — AI extracts every field, FIFO math computes your CGT, and an immutable audit trail keeps you filing-ready."),
      },
      { property: "og:locale", content: "en_US" },
      { property: "og:image", content: "https://psxl.live/favicon.png" },
      { property: "og:image:alt", content: "PSXL financial operations and audit platform" },

      // ── Twitter / X ──────────────────────────────────────────────────────
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://psxl.live/favicon.png" },
      { name: "twitter:title", content: brandText("{{brand}} — AI-Native Trade Reconciliation & CGT Engine") },
      {
        name: "twitter:description",
        content:
          "Upload your PSX/NSE broker slips. AI extracts the data, FIFO math computes your capital gains tax, and an immutable audit trail keeps you filing-ready.",
      },

      // ── App/ / Mobile ─────────────────────────────────────────────────────
      { name: "application-name", content: brandText("{{brand}}") },
      { name: "apple-mobile-web-app-title", content: brandText("{{brand}}") },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "msapplication-TileColor", content: "#0B0C0E" },

      // ── Structured Data hint ─────────────────────────────────────────────
      { name: "category", content: "Finance, Tax, Accounting, Trading" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: "/mobile-chat.css" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://db.onlinewebfonts.com/c/04e6981992c0e2e7642af2074ebe3901?family=Helvetica+Now+Display+Bold",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "64x64" },
      { rel: "apple-touch-icon", href: "/favicon.png", sizes: "64x64" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const canonicalPath = pathname === "/" ? "" : pathname.replace(/\/+$/, "");
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": "https://psxl.live/#app",
        name: brandText("{{brand}}"),
        url: "https://psxl.live",
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        description:
          "Financial record parsing, trade reconciliation, discrepancy detection, and deterministic FIFO capital-gains calculations for supported PSX and NSE workflows.",
        offers: [
          {
            "@type": "Offer",
            name: "Basic",
            price: "0",
            priceCurrency: "USD",
            description: "Completely free. Limited AI quality, 30 transactions/month, core tools.",
          },
          {
            "@type": "Offer",
            name: "Standard",
            price: "9",
            priceCurrency: "USD",
            billingIncrement: "P1M",
            description: "$9/month or $45/year. 7-day free trial. Standard AI quality.",
          },
          {
            "@type": "Offer",
            name: "Pro",
            price: "25",
            priceCurrency: "USD",
            billingIncrement: "P1M",
            description: "$25/month or $90/year. Highest AI quality and full tool set.",
          },
        ],
        featureList: [
          "Multimodal trade confirmation parser (PDF, image, CSV)",
          "FIFO capital gains tax computation for PSX and NSE",
          "Traceable audit history",
          "AI anomaly detection and reconciliation",
          "Tax-loss harvesting suggestions",
          "Google OAuth and email authentication",
          "Multi-tenant row-level security",
        ],
      },
      {
        "@type": "Organization",
        "@id": "https://psxl.live/#org",
        name: brandText("{{brand}}"),
        url: "https://psxl.live",
        logo: "https://psxl.live/favicon.png",
      },
      {
        "@type": "WebSite",
        "@id": "https://psxl.live/#website",
        url: "https://psxl.live",
        name: brandText("{{brand}}"),
        description: "AI-Native Financial Audit & Compliance for PSX and NSE Traders",
        publisher: { "@id": "https://psxl.live/#org" },
      },
    ],
  });

  return (
    <html lang="en">
      <head>
        <HeadContent />
        <link rel="canonical" href={`https://psxl.live${canonicalPath}`} />
        <meta property="og:url" content={`https://psxl.live${canonicalPath}`} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (handleStaleChunkError(event.reason)) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      handleStaleChunkError(event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <Toaster position="bottom-right" />
            <Analytics />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
