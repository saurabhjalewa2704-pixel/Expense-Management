import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Reminders" };
export default function Page() {
  return <div className="scroll"><PageHeader title="Reminders" back="/" backLabel="Home" /><p className="sub" style={{ marginTop: 12 }}>Coming in a later milestone.</p></div>;
}
