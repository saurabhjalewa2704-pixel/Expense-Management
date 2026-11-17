"use client";
import { useIsRestoring } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { QuickAddProvider } from "@/components/capture/quick-add";
import { ToastProvider } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/queries/hooks";
import { SyncEngine } from "@/lib/sync";
import { BillsCatchUp } from "@/components/bills/catch-up";
import { FailedEntries } from "./failed-entries";
import { Shortcuts } from "./shortcuts";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";
import { UpdateBanner } from "./update-banner";

/** Tab bar (phone) or sidebar (desktop), the pre-mounted Quick Add sheet, the toast layer and the sync engine. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Suspense fallback={<ShellFallback />}>
        <QuickAddProvider>
          <UpdateBanner />
          <FailedEntries />
          <BillsCatchUp />
          <OnboardingGate />
          <SessionGuard />
          <SyncEngine />
          <Shortcuts />
          <Sidebar />
          <div data-vaul-drawer-wrapper="" className="app-main"><Restored>{children}</Restored></div>
          <TabBar />
        </QuickAddProvider>
      </Suspense>
    </ToastProvider>
  );
}

/**
 * The app now opens from the copy on the device without asking the server first (app/sw.ts), so the proxy's sign-in check
 * no longer happens before the page shows. This is the same check from inside the page: no session (and not merely offline)
 * means the sign-in screen, exactly as before.
 */
function SessionGuard() {
  useEffect(() => {
    const auth = supabaseBrowser().auth;
    let live = true;
    const toSignIn = () => { if (live) window.location.replace("/sign-in"); };
    void auth.getSession().then(({ data, error }) => { if (!data.session && !error) toSignIn(); }).catch(() => {});
    const { data: sub } = auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") toSignIn(); });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);
  return null;
}

/**
 * While the saved copy of the data is read back from the device (a few milliseconds), TanStack reports every query as "not loading and
 * empty", so each screen's empty state or "Not found" showed for a moment on every open. Until it is back the page shows the same
 * skeleton the server sends, then the real screen with its cached figures. Queries do not start before the restore either way.
 */
function Restored({ children }: { children: ReactNode }) {
  return useIsRestoring() ? <ShellFallbackBody /> : <>{children}</>;
}

/** AUTH-02: until first-run setup is done, everything leads to /welcome. */
function OnboardingGate() {
  const router = useRouter();
  const { data: profile } = useProfile();
  useEffect(() => {
    if (profile && !profile.onboarded_at) router.replace("/welcome");
  }, [profile, router]);
  return null;
}

/**
 * What the server sends before the app has started. QuickAddProvider reads the URL (useSearchParams), so everything under it
 * is rendered in the browser, and until then the page was an empty dark screen. This paints the shape of Home straight
 * away, in the same classes the real screen uses, so it hands over without a jump.
 */
function ShellFallback() {
  return <div className="app-main" aria-busy><ShellFallbackBody /></div>;
}

function ShellFallbackBody() {
  return (
    <>
      <div className="scroll" aria-busy>
        <div className="topbar"><span className="skeleton" style={{ height: 14, width: 140 }} /></div>
        <section className="hero" style={{ marginTop: 20 }}>
          <div className="skeleton" style={{ height: 14, width: 120 }} />
          <div className="skeleton" style={{ height: 64, width: 260, marginTop: 10 }} />
          <div className="equation"><div className="skeleton" style={{ height: 40, width: "100%" }} /></div>
        </section>
        <div style={{ marginTop: 24 }} className="stack">
          <div className="bg-card"><div className="skeleton" style={{ height: 210 }} /></div>
        </div>
      </div>
    </>
  );
}
