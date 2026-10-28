import { Suspense } from "react";
import { TripDetail } from "@/components/trips/trip-detail";
export const metadata = { title: "Trip" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><TripDetail id={id} /></Suspense>;
}
