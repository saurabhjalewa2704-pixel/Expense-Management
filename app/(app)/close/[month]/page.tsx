import { CloseOverview } from "@/components/close/overview";

export const metadata = { title: "Close the month" };
export default async function Page({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ resume?: string }> }) {
  const { month } = await params;
  const { resume } = await searchParams;
  return <CloseOverview param={month} resume={resume === "1"} />;
}
