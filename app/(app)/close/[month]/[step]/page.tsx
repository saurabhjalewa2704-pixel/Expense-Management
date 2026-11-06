import { notFound } from "next/navigation";
import { CloseDone } from "@/components/close/done";
import { StepBalances } from "@/components/close/step-balances";
import { StepBills } from "@/components/close/step-bills";
import { StepMissingDays } from "@/components/close/step-missing-days";
import { StepNext } from "@/components/close/step-next";
import { StepReview } from "@/components/close/step-review";
import { StepTidy } from "@/components/close/step-tidy";

export const metadata = { title: "Close the month" };
export default async function Page({ params }: { params: Promise<{ month: string; step: string }> }) {
  const { month, step } = await params;
  switch (step) {
    case "missing-days": return <StepMissingDays param={month} />;
    case "bills": return <StepBills param={month} />;
    case "balances": return <StepBalances param={month} />;
    case "tidy-up": return <StepTidy param={month} />;
    case "review": return <StepReview param={month} />;
    case "next-month": return <StepNext param={month} />;
    case "done": return <CloseDone param={month} />;
    default: notFound();
  }
}
