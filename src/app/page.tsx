import { AgusWorkspace } from "@/components/agus/workspace";
import { FinancialConversation } from "@/components/financial-conversation";
import { config } from "@/lib/config";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.workspace === "payments" || params.fromChat) {
    const chat =
      typeof params.fromChat === "string" &&
      /^[a-f0-9-]{36}$/i.test(params.fromChat)
        ? `&chat=${encodeURIComponent(params.fromChat)}`
        : "";
    redirect(`/conversation?payments=history${chat}`);
  }
  const mode = config().mode;
  if (mode === "live") return <FinancialConversation paymentMode={mode} />;
  return <AgusWorkspace paymentMode={mode} />;
}
