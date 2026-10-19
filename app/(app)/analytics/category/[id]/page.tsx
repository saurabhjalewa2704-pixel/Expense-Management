import { Suspense } from "react";
import { CategoryDeepDive } from "@/components/analytics/category-deep-dive";
export const metadata = { title: "Category" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><CategoryDeepDive id={id} /></Suspense>;
}
