// ── Tenant branding — single source of truth ────────────────────────────────
// Everything that says the company / product name pulls from here, so rebranding
// the app for another company (B2B SaaS) is a one-place change. Values can be
// overridden at build time via Vite env (VITE_COMPANY_NAME etc.) without touching
// code; later this could be swapped for a per-tenant /brand API fetch.
//
//   COMPANY_NAME → the hiring company's full name. Used in candidate emails, the
//                  candidate interview page, and sent to the AI so generated job
//                  descriptions/criteria reference the right company.
//   BRAND_NAME   → the product/app name shown in the header + tab title.
export const COMPANY_NAME  = import.meta.env.VITE_COMPANY_NAME  || 'Diyar United Company';
export const BRAND_NAME    = import.meta.env.VITE_BRAND_NAME    || 'Diyar HR';
export const BRAND_TAGLINE = import.meta.env.VITE_BRAND_TAGLINE || 'Local-first hiring workspace';
