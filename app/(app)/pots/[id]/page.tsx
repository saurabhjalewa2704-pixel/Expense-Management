import { Suspense } from "react";
import { PotDetail } from "@/components/pots/pot-detail";
export const metadata = { title: "Pot" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><PotDetail id={id} /></Suspense>;
}
