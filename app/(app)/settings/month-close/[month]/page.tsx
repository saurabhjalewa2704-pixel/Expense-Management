import { MonthReview } from "@/components/close/month-review";

export const metadata = { title: "Month review" };
export default async function Page({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  return <MonthReview param={month} />;
}
