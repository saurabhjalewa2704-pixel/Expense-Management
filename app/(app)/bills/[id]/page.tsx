import { Suspense } from "react";
import { BillDetail } from "@/components/bills/bill-detail";
export const metadata = { title: "Bill" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><BillDetail id={id} /></Suspense>;
}
