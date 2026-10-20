import { Suspense } from "react";
import { AskScreen } from "@/components/insights/ask-screen";
export const metadata = { title: "Ask Sterling" };
export default function Page() { return <Suspense fallback={null}><AskScreen /></Suspense>; }
