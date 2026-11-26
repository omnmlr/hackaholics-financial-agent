import type { Metadata } from "next";
import { DevnetWallet } from "@/components/devnet-wallet";

export const metadata: Metadata = {
  title: "Solana devnet | agus.",
  description: "Review and sign Solana devnet transfers with your own wallet.",
};

export default function DevnetPage() {
  return <DevnetWallet />;
}
