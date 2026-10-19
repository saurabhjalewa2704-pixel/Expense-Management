import { ToastProvider } from "@/components/ui/toast";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
