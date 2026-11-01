import { Suspense } from "react";
import { BudgetSetup } from "@/components/budget/budget-setup";
export const metadata = { title: "Set up budgets" };
export default function Page() { return <Suspense><BudgetSetup /></Suspense>; }
