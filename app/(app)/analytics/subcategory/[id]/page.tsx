import { Suspense } from "react";
import { CategoryDetail } from "@/components/analytics/category-detail";
export const metadata = { title: "Sub-category" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><CategoryDetail id={id} level="sub" /></Suspense>;
}
