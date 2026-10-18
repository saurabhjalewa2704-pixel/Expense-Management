"use client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { QuickAddProvider } from "@/components/capture/quick-add";
import { ToastProvider } from "@/components/ui/toast";
import { useProfile } from "@/lib/queries/hooks";
import { SyncEngine } from "@/lib/sync";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";

/** Tab bar (phone) or sidebar (desktop), the pre-mounted Quick Add sheet, the toast layer and the sync engine. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <QuickAddProvider>
          <OnboardingGate />
          <SyncEngine />
          <Sidebar />
          <div data-vaul-drawer-wrapper="" className="app-main">{children}</div>
          <TabBar />
        </QuickAddProvider>
      </Suspense>
    </ToastProvider>
  );
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
