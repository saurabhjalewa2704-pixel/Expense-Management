import { AccountDetail } from "@/components/accounts/account-detail";
export const metadata = { title: "Account" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountDetail id={id} />;
}
