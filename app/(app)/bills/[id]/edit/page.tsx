import { BillForm } from "@/components/bills/bill-form";
export const metadata = { title: "Edit recurring payment" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillForm id={id} />;
}
