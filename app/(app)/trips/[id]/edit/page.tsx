import { TripForm } from "@/components/trips/trip-form";
export const metadata = { title: "Edit trip" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripForm id={id} />;
}
