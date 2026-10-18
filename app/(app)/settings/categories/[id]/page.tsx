import { CategoryDetail } from "@/components/categories/category-detail";
export const metadata = { title: "Category" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CategoryDetail id={id} />;
}
