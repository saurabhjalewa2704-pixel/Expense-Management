import { Suspense } from "react";
import { ActivityScreen } from "@/components/activity/activity-screen";
export const metadata = { title: "Activity" };
export default function Page() { return <Suspense fallback={null}><ActivityScreen /></Suspense>; }
